// Wave 2 — Transcript Reader
//
// Reads a Claude Code session transcript (a .jsonl file) and prints the
// conversation as readable text. Run it with:
//
//   node scripts/read-transcript.mjs             -> latest session for THIS project
//   node scripts/read-transcript.mjs <path>      -> a specific .jsonl file
//
// No dependencies — only Node's built-in modules.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Step 1: find the transcript file.
//
// Claude Code stores transcripts under ~/.claude/projects/<encoded-path>/,
// where <encoded-path> is the project's absolute path with every
// non-alphanumeric character replaced by "-".
// e.g.  C:\Users\USER\Desktop\projects\eleven
//   ->  C--Users-USER-Desktop-projects-eleven
// ---------------------------------------------------------------------------

function projectTranscriptDir(projectPath) {
  const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

function latestTranscript(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
  if (files.length === 0) throw new Error(`No transcripts found in ${dir}`);
  return files[0].file;
}

const transcriptPath =
  process.argv[2] ?? latestTranscript(projectTranscriptDir(process.cwd()));

console.log(`# Transcript: ${transcriptPath}\n`);

// ---------------------------------------------------------------------------
// Step 2: parse the JSONL.
//
// "JSONL" = JSON Lines: one complete JSON object per line. We split on
// newlines and JSON.parse each line independently. A transcript mixes
// conversation lines (type "user" / "assistant") with metadata lines
// ("mode", "summary", ...) — we keep only the conversation.
// ---------------------------------------------------------------------------

const lines = readFileSync(transcriptPath, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

// ---------------------------------------------------------------------------
// Step 3: extract readable text from each conversation entry.
//
// message.content comes in two shapes:
//   - a plain string (simple user messages)
//   - an array of "content blocks": {type: "text"|"tool_use"|"tool_result"|...}
// We render text blocks as-is and reduce tool activity to a one-line note —
// for a spoken summary, WHAT tool ran matters; its full output does not.
// ---------------------------------------------------------------------------

function renderContent(content) {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return ""; // internal reasoning — not part of the visible conversation
        case "tool_use":
          return `[used tool: ${block.name}]`;
        case "tool_result":
          return "[tool result received]";
        default:
          return `[${block.type}]`;
      }
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

let turns = 0;
for (const entry of lines) {
  if (entry.type !== "user" && entry.type !== "assistant") continue; // metadata
  if (entry.isSidechain) continue; // subagent traffic, not the main conversation

  const text = renderContent(entry.message.content).trim();
  if (text.length === 0) continue;

  const role = entry.type === "user" ? "USER" : "CLAUDE";
  const time = entry.timestamp?.slice(11, 19) ?? "--:--:--"; // HH:MM:SS
  console.log(`── ${role} @ ${time} ${"─".repeat(50)}`);
  console.log(text + "\n");
  turns++;
}

console.log(`(${turns} conversation entries, ${lines.length} total lines in file)`);
