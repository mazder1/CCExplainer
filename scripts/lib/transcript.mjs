// Shared transcript-reading logic (born in Wave 2, promoted to a library in
// Wave 4 so both read-transcript.mjs and summarize.mjs can use it — the
// "don't copy-paste code, extract a module" rule in action).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ~/.claude/projects/<project path with non-alphanumerics replaced by "-">
export function projectTranscriptDir(projectPath) {
  const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

export function latestTranscript(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) throw new Error(`No transcripts found in ${dir}`);
  return files[0].file;
}

function renderContent(content) {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return "";
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

// Returns the conversation as [{role: "USER"|"CLAUDE", time: "HH:MM:SS", text}]
export function readConversation(transcriptPath) {
  const turns = [];
  const rawLines = readFileSync(transcriptPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  for (const line of rawLines) {
    const entry = JSON.parse(line);
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.isSidechain) continue;
    const text = renderContent(entry.message.content).trim();
    if (text.length === 0) continue;
    turns.push({
      role: entry.type === "user" ? "USER" : "CLAUDE",
      time: entry.timestamp?.slice(11, 19) ?? "--:--:--",
      text,
    });
  }
  return turns;
}

// One plain-text block, ready to hand to a language model.
export function conversationAsText(turns) {
  return turns.map((t) => `${t.role} @ ${t.time}:\n${t.text}`).join("\n\n");
}

// Which assistant message should the explainer explain?
//
// Normally: the last CLAUDE turn. In --live mode (running inside a session
// via /speak) the transcript already contains the /speak invocation itself
// (a USER turn) and possibly in-progress assistant activity after it — so
// the message the user actually means is the last CLAUDE turn BEFORE that
// final USER turn.
export function pickMessageToExplain(turns, { live = false } = {}) {
  let picked;
  if (live) {
    const lastUserIndex = turns.findLastIndex((t) => t.role === "USER");
    picked = turns
      .slice(0, Math.max(lastUserIndex, 0))
      .reverse()
      .find((t) => t.role === "CLAUDE");
  }
  return picked ?? [...turns].reverse().find((t) => t.role === "CLAUDE");
}
