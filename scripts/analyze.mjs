// Wave 4b — The Comprehension Analyzer ("call 1")
//
// Reads the session HISTORY and produces "listener notes": what this user
// has shown they struggle with, what they clearly understand, and how they
// like things explained. The notes are NEVER spoken — they are context for
// the explainer, cached in .ccexplainer/listener-notes.json and refreshed
// only when enough new conversation has accumulated.
//
//   node scripts/analyze.mjs             -> analyze latest session, print notes
//   node scripts/analyze.mjs --refresh   -> force re-analysis even if cached

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
  conversationAsText,
} from "./lib/transcript.mjs";

const CACHE_DIR = ".ccexplainer";
const CACHE_FILE = join(CACHE_DIR, "listener-notes.json");
// Re-analyze once this much NEW conversation text has appeared since last time.
const STALE_AFTER_CHARS = 15000;

const ANALYST_PROMPT = `You are a learning analyst. Read the coding-session
conversation below and produce short LISTENER NOTES about the human user
(the USER turns — not the assistant). These notes will help another AI
explain future messages to this user at the right depth. Cover:

1. Concepts the user visibly struggled with or asked to have re-explained
   (with a word on the evidence).
2. Concepts the user clearly handles confidently.
3. How they seem to prefer explanations (pace, analogies, level of detail).

Be concrete and honest. Plain text, at most 150 words. If the conversation
is too short to tell, say so briefly.`;

export async function getListenerNotes(transcriptPath, apiKey, { force = false, model = "gpt-5-mini" } = {}) {
  const turns = readConversation(transcriptPath);
  const conversation = conversationAsText(turns);

  // Serve from cache if it is fresh enough (analysis is the slow call —
  // what the user struggles with does not change between two messages).
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {}
  const grownBy = conversation.length - (cache?.analyzedChars ?? 0);
  if (!force && cache && cache.transcriptPath === transcriptPath && grownBy < STALE_AFTER_CHARS) {
    return { notes: cache.notes, fromCache: true };
  }

  // Analyze the most recent slice of history (recent behavior matters most).
  const material = conversation.length > 60000
    ? conversation.slice(-60000)
    : conversation;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: ANALYST_PROMPT },
        { role: "user", content: material },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI answered ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const notes = data.choices[0].message.content.trim();

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({ transcriptPath, analyzedChars: conversation.length, generatedAt: new Date().toISOString(), notes }, null, 2),
  );
  return { notes, fromCache: false };
}

// When run directly from the terminal (not imported), behave as a command.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    process.loadEnvFile();
  } catch {}
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY — add it to your .env file.");
    process.exit(1);
  }
  const force = process.argv.includes("--refresh");
  const transcriptPath = process.argv.find((a) => a.endsWith(".jsonl")) ??
    latestTranscript(projectTranscriptDir(process.cwd()));
  const { notes, fromCache } = await getListenerNotes(transcriptPath, apiKey, { force });
  console.error(fromCache ? "(from cache)\n" : "(freshly analyzed)\n");
  console.log(notes);
}
