// Wave 4 — The Brain
//
// Reads the latest session transcript, sends it to OpenAI with a persona's
// instructions, and prints the spoken-word summary to the screen.
//
//   node scripts/summarize.mjs                            -> educator persona, latest session
//   node scripts/summarize.mjs --persona senior-engineer  -> different persona
//   node scripts/summarize.mjs --chars 40000              -> include more history
//   node scripts/summarize.mjs <path-to.jsonl>            -> a specific session

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
  conversationAsText,
} from "./lib/transcript.mjs";

// Step 1: the secret — same ritual as Wave 3, different name.
try {
  process.loadEnvFile();
} catch {}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY — add it to your .env file.");
  process.exit(1);
}

// Step 2: arguments.
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const personaName = flag("persona", "educator");
const maxChars = parseInt(flag("chars", "24000"), 10);
const modelId = flag("model", "gpt-5-mini");
const transcriptArg = args.find((a) => a.endsWith(".jsonl"));

// Step 3: the persona — a plain text file that becomes the system message.
const personaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "personas");
let persona;
try {
  persona = readFileSync(join(personaDir, `${personaName}.md`), "utf8");
} catch {
  console.error(`Unknown persona "${personaName}". Available: educator, senior-engineer, rubber-duck`);
  process.exit(1);
}

// Step 4: the transcript (Wave 2's logic, now imported from the shared lib).
const transcriptPath = transcriptArg ?? latestTranscript(projectTranscriptDir(process.cwd()));
const turns = readConversation(transcriptPath);
let conversation = conversationAsText(turns);

// Keep only the most recent part — models charge per token, and the recent
// history is what a summary is usually about anyway.
if (conversation.length > maxChars) {
  conversation = "[...earlier conversation trimmed...]\n\n" + conversation.slice(-maxChars);
}

console.error(
  `Summarizing ${transcriptPath.split(/[\\/]/).pop()} — ${turns.length} turns, sending ${conversation.length} chars to ${modelId} as "${personaName}"...\n`,
);

// Step 5: the API call. Same service-window pattern as ElevenLabs, but the
// body carries MESSAGES with roles: "system" (the persona = job description)
// and "user" (the material to work on). Text comes back instead of audio.
const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: modelId,
    messages: [
      { role: "system", content: persona },
      {
        role: "user",
        content:
          "Here is the coding session to summarize. It is a conversation between " +
          "a USER and CLAUDE (an AI coding assistant), with tool activity reduced " +
          "to short notes.\n\n" +
          conversation,
      },
    ],
  }),
});

if (!response.ok) {
  const detail = await response.text();
  console.error(`OpenAI answered ${response.status} ${response.statusText}:\n${detail}`);
  process.exit(1);
}

const data = await response.json();

// Step 6: print ONLY the summary to stdout. Progress notes above went to
// stderr — so the clean text can be piped straight into the speak script
// (that is Wave 5, and this line is what makes it possible).
console.log(data.choices[0].message.content.trim());

const usage = data.usage;
if (usage) {
  console.error(`\n(tokens: ${usage.prompt_tokens} in, ${usage.completion_tokens} out)`);
}
