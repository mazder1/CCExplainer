// Wave 3 — First Voice
//
// Sends text to the ElevenLabs text-to-speech API, saves the returned audio
// as an MP3, and plays it. Run it with:
//
//   node scripts/speak.mjs                                 -> speaks a default greeting
//   node scripts/speak.mjs "Any text you want"             -> speaks your text
//   node scripts/speak.mjs "Slower please" --speed 0.8     -> adjust speaking speed (0.7–1.2)
//   node scripts/speak.mjs "Hi" --voice <voice_id>         -> use a different voice
//
// No dependencies — Node's built-in fetch() and fs are enough.

import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { synthesizeWithTimings } from "./lib/tts.mjs";
import { viewerAlive, writeJob } from "./lib/mailbox.mjs";

// ---------------------------------------------------------------------------
// Step 1: load the secret.
//
// process.loadEnvFile() reads the .env file in the current directory and
// puts its entries into process.env — the program's "environment". The key
// itself never appears in this code, only its NAME.
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile();
} catch {
  // No .env file — fine if the variable is set some other way.
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error(
    "Missing ELEVENLABS_API_KEY.\n" +
      "Create a .env file in the project root (copy .env.example) and put your key there.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2: read the command-line arguments.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

// The text can arrive two ways: as an argument, or PIPED IN from another
// program ("-" means "read standard input" — a classic CLI convention).
// Piping is what lets explain.mjs and speak.mjs chain into one pipeline.
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

const positional = args.find(
  (a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true,
);
const text =
  positional === "-" || (!positional && !process.stdin.isTTY)
    ? await readStdin()
    : positional ?? "Hello! I am C C Explainer, and this is my first spoken sentence.";

if (!text) {
  console.error("No text to speak — the pipe was empty.");
  process.exit(1);
}

// "Rachel" — one of ElevenLabs' default voices, available on every account.
const voiceId = flag("voice", "21m00Tcm4TlvDq8ikWAM");
const speed = parseFloat(flag("speed", "1.0"));
// Default: multilingual_v2 — the user's listening test (2026-08-02) found flash_v2_5
// stutters on longer sentences; quality wins for spoken explanations.
// Use --model eleven_flash_v2_5 where speed matters more than smoothness.
const modelId = flag("model", "eleven_multilingual_v2");

// ---------------------------------------------------------------------------
// Step 3: synthesize — WITH word timings (since Wave 6, via the shared tts
// lib). The timings cost nothing extra and make karaoke playback possible.
// ---------------------------------------------------------------------------

console.log(`Speaking ${text.length} characters with voice ${voiceId}, speed ${speed}, model ${modelId}...`);

let audio, words, duration;
const tSynth = Date.now();
try {
  ({ audio, words, duration } = await synthesizeWithTimings(text, { apiKey, voiceId, modelId, speed }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log(`Synthesized in ${((Date.now() - tSynth) / 1000).toFixed(1)}s`);

// The karaoke viewer opens ON ITS OWN when possible: if none is running and
// we are inside Windows Terminal, ask it to split the current window and
// start the viewer in the new pane, then wait for its heartbeat. If that
// is impossible (different terminal, wt missing, opt-out), we fall back to
// invisible background playback — the viewer is never a requirement.
async function ensureViewer() {
  if (viewerAlive()) return true;
  if (process.platform !== "win32") return false;
  if (!process.env.WT_SESSION) return false; // not inside Windows Terminal
  if (process.env.CCEXPLAINER_NO_AUTOSPAWN) return false; // explicit opt-out
  const viewerPath = join(dirname(fileURLToPath(import.meta.url)), "viewer.mjs");
  try {
    execFile("cmd", ["/c", "wt", "-w", "0", "split-pane", "-V", "-d", process.cwd(), "node", viewerPath], {
      windowsHide: true,
    });
  } catch {
    return false;
  }
  // Give the new pane a few seconds to boot and announce itself.
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (viewerAlive()) return true;
  }
  return false;
}

// If the karaoke viewer is running (or just auto-opened), hand the speech to
// it — it plays the audio AND highlights each word as it is spoken.
if (await ensureViewer()) {
  writeJob({
    createdAt: new Date().toISOString(),
    text,
    words,
    duration,
    audioBase64: audio.toString("base64"),
    meta: { source: "speak-cli", voiceSpeed: speed },
  });
  console.log("Karaoke viewer detected — speaking there.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 4: stage the audio for playback.
//
// The audio engine has to read from a file, so the bytes briefly land in the
// system TEMP folder — and are deleted automatically as soon as playback
// finishes. Nothing persists. Pass --keep to save a copy to output/ instead
// (useful for debugging or comparing voices).
// ---------------------------------------------------------------------------

const keep = args.includes("--keep");
let outPath;
if (keep) {
  mkdirSync("output", { recursive: true });
  outPath = join("output", "speech.mp3");
  console.log(`Keeping a copy at ${outPath}`);
} else {
  outPath = join(tmpdir(), `ccexplainer-${Date.now()}.mp3`);
}
writeFileSync(outPath, audio);

// ---------------------------------------------------------------------------
// Step 5: ...and play it silently in the background — no window, no player app.
//
// On Windows we hand the file to a hidden PowerShell process that uses the
// OS's built-in audio engine (System.Windows.Media.MediaPlayer). It has no
// user interface at all: it plays, waits for the end, and exits.
// ---------------------------------------------------------------------------

if (process.platform === "win32") {
  const psScript = [
    "Add-Type -AssemblyName PresentationCore",
    "$p = New-Object System.Windows.Media.MediaPlayer",
    `$p.Open([Uri](Resolve-Path '${outPath}').Path)`,
    "$p.Play()",
    // Wait until Windows has read the file's duration, then sleep through playback.
    "while (-not $p.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 100 }",
    "Start-Sleep -Milliseconds ($p.NaturalDuration.TimeSpan.TotalMilliseconds + 300)",
    "$p.Close()",
    // Clean up the temp file once playback is over (unless --keep was used).
    ...(keep ? [] : [`Remove-Item -Force '${outPath}'`]),
  ].join("; ");
  execFile(
    "powershell",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript],
    { windowsHide: true },
  );
} else {
  // macOS/Linux: afplay/mpg123 are terminal-only players — also windowless.
  const player = execFile(process.platform === "darwin" ? "afplay" : "mpg123", [outPath]);
  if (!keep) player.on("exit", () => { try { unlinkSync(outPath); } catch {} });
}
console.log("Playing in the background. No window, no saved file.");
