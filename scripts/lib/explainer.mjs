// The explainer's core: how a persona, listener notes, and the last message
// become the exact prompt sent to the model.
//
// This lives in a library — not in explain.mjs — so that production and the
// eval harness build prompts through the SAME code path. If they each had a
// copy, the copies would drift and the evals would quietly measure nothing.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PERSONA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "personas");

// The task rules — fixed for every persona. This is where the product's core
// design decisions are enforced: explain ONLY the last message; notes are
// context, never content; past problems are not re-explained.
export const TASK_RULES = `You explain the LATEST MESSAGE from an AI coding assistant
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

export function loadPersona(name, dir = PERSONA_DIR) {
  try {
    return readFileSync(join(dir, `${name}.md`), "utf8");
  } catch {
    throw new Error(`Unknown persona "${name}". Available: educator, senior-engineer, rubber-duck`);
  }
}

// The single source of truth for prompt assembly. Pure function: inputs in,
// messages out — no file reads, no network, fully unit-testable.
export function buildExplainerMessages({ persona, notes = null, lastMessageText }) {
  return [
    { role: "system", content: TASK_RULES + "\n\nDelivery style:\n" + persona },
    {
      role: "user",
      content:
        (notes ? `LISTENER NOTES (context only, never mention them):\n${notes}\n\n` : "") +
        `LATEST MESSAGE to explain:\n${lastMessageText}`,
    },
  ];
}
