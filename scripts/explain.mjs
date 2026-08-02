// Wave 4 — The Explainer ("call 2")
//
// Explains THE LAST MESSAGE Claude sent — not the whole session — in a
// chosen persona, calibrated by the listener notes from analyze.mjs.
// Prints the spoken-word text to stdout (pipeable into the speak script).
//
//   node scripts/explain.mjs                            -> educator, latest session
//   node scripts/explain.mjs --persona senior-engineer
//   node scripts/explain.mjs --no-notes                 -> skip the analyzer (faster, generic)
//   node scripts/explain.mjs --offset -2                -> explain the message two BEFORE the last

import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
  pickMessageToExplain,
} from "./lib/transcript.mjs";
import { getListenerNotes, refreshNotesInBackground } from "./analyze.mjs";
import { llmConfig } from "./lib/llm.mjs";
import { generateExplanation } from "./lib/explainer.mjs";

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
const offset = parseInt(flag("offset", "0"), 10) || 0;
const transcriptArg = args.find((a) => a.endsWith(".jsonl"));

// The material: the last assistant message — or, in --live mode, the last
// one BEFORE the /speak invocation (see pickMessageToExplain for why).
const transcriptPath = transcriptArg ?? latestTranscript(projectTranscriptDir(process.cwd()));
const turns = readConversation(transcriptPath);
const lastMessage = pickMessageToExplain(turns, { live, offset });
if (!lastMessage) {
  const available = turns.filter((t) => t.role === "CLAUDE").length;
  console.error(
    offset
      ? `No assistant message at offset ${offset} — this session has ${available} assistant message(s).`
      : "No assistant message found in this session yet.",
  );
  process.exit(1);
}

// The lens: listener notes — served from cache instantly even when stale
// (narration never waits for a history re-analysis); a background refresh
// keeps the cache good for next time.
let notes = null;
if (useNotes) {
  const tNotes = Date.now();
  const result = await getListenerNotes(transcriptPath, { model: modelId, allowStale: true });
  notes = result.notes;
  if (result.stale) refreshNotesInBackground(transcriptPath);
  const label = result.stale
    ? "from cache (stale — refreshing in background)"
    : result.fromCache
      ? "from cache"
      : "freshly analyzed";
  console.error(`Listener notes ${label} — ${((Date.now() - tNotes) / 1000).toFixed(1)}s`);
}

console.error(`Explaining the last message (${lastMessage.text.length} chars) as "${personaName}" via ${modelId}...\n`);

// Generation, linting and the one-shot retry all live in the shared
// explainer library — the same code path the eval harness measures.
let result;
const tGen = Date.now();
try {
  result = await generateExplanation({ personaName, notes, lastMessageText: lastMessage.text, model: modelId });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.error(
  `Script written in ${((Date.now() - tGen) / 1000).toFixed(1)}s${result.retried ? " (incl. one lint retry)" : ""}`,
);

console.log(result.text);
if (result.usage) {
  console.error(`\n(tokens: ${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out)`);
}
