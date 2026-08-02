// Wave 2 — Transcript Reader
//
// Prints a Claude Code session transcript as readable text.
//
//   node scripts/read-transcript.mjs             -> latest session for THIS project
//   node scripts/read-transcript.mjs <path>      -> a specific .jsonl file
//
// The actual reading logic lives in scripts/lib/transcript.mjs since Wave 4,
// shared with the summarizer — this file is now just the "print it" command.

import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
} from "./lib/transcript.mjs";

const transcriptPath =
  process.argv[2] ?? latestTranscript(projectTranscriptDir(process.cwd()));

console.log(`# Transcript: ${transcriptPath}\n`);

const turns = readConversation(transcriptPath);
for (const t of turns) {
  console.log(`── ${t.role} @ ${t.time} ${"─".repeat(50)}`);
  console.log(t.text + "\n");
}
console.log(`(${turns.length} conversation entries)`);
