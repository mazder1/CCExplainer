// The explainer's core: how a persona, listener notes, and the last message
// become the exact prompt sent to the model.
//
// This lives in a library — not in explain.mjs — so that production and the
// eval harness build prompts through the SAME code path. If they each had a
// copy, the copies would drift and the evals would quietly measure nothing.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./llm.mjs";
import { lintExplanation } from "./lint.mjs";

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
  notes say the user finds hard. Topics the notes mark as mastered get NAMED
  but NOT explained — not even one defining sentence.
- Do NOT re-explain problems or topics from earlier in the conversation —
  they were already explained when they happened. At most, when the latest
  message genuinely relates to something the user saw before, you may draw
  the connection in passing ("this works like..."). Never force it.
- Never mention that listener notes exist. Never say "according to your
  profile" or similar. NEVER hint at what the listener knows, likes or finds
  easy ("since you're comfortable with...", "as someone who knows...").
  The calibration must leave no trace in the wording.
- Written for the ear: no markdown, no lists, no symbols, no code. Say names
  of files and commands naturally — never as raw paths.
- FAITHFULNESS: say only what the message actually says. NEVER invent
  commands, numbers, reasons, or outcomes it does not state. When the
  message is silent on something, stay silent too — do not guess or
  say "probably".
- You are a NARRATOR describing what the assistant did. You cannot do
  anything yourself. NEVER offer to act, change, or implement anything, and
  never ask the listener to choose or reply ("let me know", "I can change
  it", "shall I") — open decisions in the message are reported as
  information, nothing more.
- HARD LIMIT: every sentence MUST be UNDER 20 WORDS. If a sentence grows
  long, split it into two.`;

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

// The full production generation path: build prompt, generate, lint — and if
// the mechanical rules were broken, retry ONCE with the violations quoted
// back. Models fix a named violation far more reliably than they avoid it.
// Both explain.mjs and the eval runner call THIS, so evals measure exactly
// what production ships, retry included.
export async function generateExplanation({ personaName, notes = null, lastMessageText, model } = {}) {
  const persona = loadPersona(personaName);
  const messages = buildExplainerMessages({ persona, notes, lastMessageText });
  let result = await chat(messages, { model });
  let lint = lintExplanation(result.text, { persona: personaName });
  let retried = false;
  if (!lint.ok) {
    retried = true;
    const violationList = lint.violations.map((v) => `${v.rule} (${v.detail})`).join("; ");
    result = await chat(
      [
        ...messages,
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your explanation broke these mechanical rules: ${violationList}. Rewrite the SAME explanation with every violation fixed. Keep the content; correct the form. Output only the rewritten explanation.`,
        },
      ],
      { model },
    );
    lint = lintExplanation(result.text, { persona: personaName });
  }
  return { text: result.text, usage: result.usage, lint, retried };
}
