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

import { writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";

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

const text =
  args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ??
  "Hello! I am C C Explainer, and this is my first spoken sentence.";

// "Rachel" — one of ElevenLabs' default voices, available on every account.
const voiceId = flag("voice", "21m00Tcm4TlvDq8ikWAM");
const speed = parseFloat(flag("speed", "1.0"));
const modelId = flag("model", "eleven_flash_v2_5"); // fast + cheapest; try eleven_multilingual_v2 for richer delivery

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
// Step 4: save the audio bytes to a file...
// ---------------------------------------------------------------------------

const audio = Buffer.from(await response.arrayBuffer());
mkdirSync("output", { recursive: true });
const outPath = join("output", "speech.mp3");
writeFileSync(outPath, audio);
console.log(`Saved ${(audio.length / 1024).toFixed(0)} KB to ${outPath}`);

// ---------------------------------------------------------------------------
// Step 5: ...and play it with the system's default audio player.
// ---------------------------------------------------------------------------

if (process.platform === "win32") {
  execFile("cmd", ["/c", "start", "", outPath]);
} else {
  execFile(process.platform === "darwin" ? "open" : "xdg-open", [outPath]);
}
console.log("Playing.");
