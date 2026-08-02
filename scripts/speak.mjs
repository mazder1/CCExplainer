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
import { join } from "node:path";
import { tmpdir } from "node:os";

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
// Step 3: call the API.
//
// The "order through the service window": an HTTPS POST to ElevenLabs'
// text-to-speech endpoint. The voice is part of the address; the text and
// settings travel in the JSON body; the API key rides in the 'xi-api-key'
// header. What comes back is not JSON — it is raw MP3 bytes.
// ---------------------------------------------------------------------------

const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

console.log(`Speaking ${text.length} characters with voice ${voiceId}, speed ${speed}, model ${modelId}...`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text,
    model_id: modelId,
    voice_settings: {
      speed, // 0.7 (slow) .. 1.2 (fast) — the voice actually speaks differently
      stability: 0.5, // lower = more expressive variation, higher = more monotone
      similarity_boost: 0.75, // how closely to stick to the original voice character
    },
  }),
});

if (!response.ok) {
  // Readable errors beat mysterious ones — 401 means bad/missing key,
  // 422 usually means a bad parameter (e.g. speed out of range).
  const detail = await response.text();
  console.error(`ElevenLabs answered ${response.status} ${response.statusText}:\n${detail}`);
  process.exit(1);
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
const audio = Buffer.from(await response.arrayBuffer());
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
