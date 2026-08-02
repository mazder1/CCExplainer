// Wave 4 — The Explainer ("call 2")
//
// Explains THE LAST MESSAGE Claude sent — not the whole session — in a
// chosen persona, calibrated by the listener notes from analyze.mjs.
// Prints the spoken-word text to stdout (pipeable into the speak script).
//
//   node scripts/explain.mjs                            -> educator, latest session
//   node scripts/explain.mjs --persona senior-engineer
//   node scripts/explain.mjs --no-notes                 -> skip the analyzer (faster, generic)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
  pickMessageToExplain,
} from "./lib/transcript.mjs";
import { getListenerNotes } from "./analyze.mjs";
import { chat, llmConfig } from "./lib/llm.mjs";

try {
  process.loadEnvFile();
} catch {}

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const personaName = flag("persona", "educator");
const modelId = flag("model", llmConfig().model);
const useNotes = !args.includes("--no-notes");
const live = args.includes("--live");
const transcriptArg = args.find((a) => a.endsWith(".jsonl"));

// The material: the last assistant message — or, in --live mode, the last
// one BEFORE the /speak invocation (see pickMessageToExplain for why).
const transcriptPath = transcriptArg ?? latestTranscript(projectTranscriptDir(process.cwd()));
const turns = readConversation(transcriptPath);
const lastMessage = pickMessageToExplain(turns, { live });
if (!lastMessage) {
  console.error("No assistant message found in this session yet.");
  process.exit(1);
}

// The lens: listener notes from the history (cached; see analyze.mjs).
let notes = null;
if (useNotes) {
  const result = await getListenerNotes(transcriptPath, { model: modelId });
  notes = result.notes;
  console.error(`Listener notes ${result.fromCache ? "loaded from cache" : "freshly analyzed"}.`);
}

// The style: persona file = delivery style only (the task rules live below).
const personaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "personas");
let persona;
try {
  persona = readFileSync(join(personaDir, `${personaName}.md`), "utf8");
} catch {
  console.error(`Unknown persona "${personaName}". Available: educator, senior-engineer, rubber-duck`);
  process.exit(1);
}

// The task rules — fixed for every persona. This is where the user's design
// decisions are enforced: explain ONLY the last message; notes are context,
// never content; past problems are not re-explained.
const TASK_RULES = `You explain the LATEST MESSAGE from an AI coding assistant
to the human user it was written for. Your text will be read aloud by a
text-to-speech voice.

Hard rules:
- Explain ONLY the latest message below. It is your entire subject.
- You also receive LISTENER NOTES describing this user's past struggles and
  strengths. Use them ONLY to calibrate: go deeper and slower on things the
  notes say the user finds hard, stay brief on what they know well.
- Do NOT re-explain problems or topics from earlier in the conversation —
  they were already explained when they happened. At most, when the latest
  message genuinely relates to something the user saw before, you may draw
  the connection in passing ("this works like..."). Never force it.
- Never mention that listener notes exist. Never say "according to your
  profile" or similar. The calibration must be invisible.
- Written for the ear: no markdown, no lists, no symbols, no code. Short
  spoken sentences. Say names of files and commands naturally.`;

console.error(`Explaining the last message (${lastMessage.text.length} chars) as "${personaName}" via ${modelId}...\n`);

let result;
try {
  result = await chat(
    [
      { role: "system", content: TASK_RULES + "\n\nDelivery style:\n" + persona },
      {
        role: "user",
        content:
          (notes ? `LISTENER NOTES (context only, never mention them):\n${notes}\n\n` : "") +
          `LATEST MESSAGE to explain:\n${lastMessage.text}`,
      },
    ],
    { model: modelId },
  );
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(result.text);
if (result.usage) {
  console.error(`\n(tokens: ${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out)`);
}
