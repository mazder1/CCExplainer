// Wave 6a proof — fetch speech WITH word timings and print the timeline.
// No audio is played, nothing is saved; this only demonstrates that the
// timing data is real and word-accurate.
//
//   node scripts/timing-demo.mjs
//   node scripts/timing-demo.mjs "Any text you like" --speed 0.9

import { synthesizeWithTimings } from "./lib/tts.mjs";

try {
  process.loadEnvFile();
} catch {}
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY — add it to your .env file.");
  process.exit(1);
}

const args = process.argv.slice(2);
const speedIdx = args.indexOf("--speed");
const speedValue = speedIdx !== -1 ? args[speedIdx + 1] : undefined;
const speed = speedValue ? parseFloat(speedValue) : 1.0;
const text =
  args.find((a) => !a.startsWith("--") && a !== speedValue) ??
  "The karaoke viewer will highlight every single word at the exact moment the voice speaks it.";

console.log(`Synthesizing ${text.length} chars (speed ${speed})...\n`);
const { audio, words, duration } = await synthesizeWithTimings(text, { apiKey, speed });

for (const w of words) {
  console.log(`${w.start.toFixed(2).padStart(6)}s – ${w.end.toFixed(2).padStart(5)}s  ${w.text}`);
}
console.log(`\n${words.length} words, ${duration.toFixed(2)}s of speech, ${(audio.length / 1024).toFixed(0)} KB of audio (discarded).`);
