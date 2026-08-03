import test from "node:test";
import assert from "node:assert/strict";
import { loadPersona, buildExplainerMessages, TASK_RULES } from "../scripts/lib/explainer.mjs";

test("loadPersona loads shipped personas and rejects unknown ones", () => {
  const educator = loadPersona("educator");
  assert.match(educator, /educator/i);
  assert.throws(() => loadPersona("nonexistent"), /Unknown persona/);
});

test("buildExplainerMessages: system = task rules + persona, user = notes + message", () => {
  const messages = buildExplainerMessages({
    persona: "PERSONA STYLE HERE",
    notes: "user struggles with pipes",
    lastMessageText: "The tests are green.",
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.startsWith(TASK_RULES));
  assert.match(messages[0].content, /PERSONA STYLE HERE/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /LISTENER NOTES \(context only/);
  assert.match(messages[1].content, /user struggles with pipes/);
  assert.match(messages[1].content, /LATEST MESSAGE to explain:\nThe tests are green\./);
});

test("buildExplainerMessages injects the LENGTH instruction when a budget is given", () => {
  const m = buildExplainerMessages({
    persona: "style",
    lastMessageText: "short message",
    budget: { min: 10, max: 40, messageWords: 2 },
  });
  assert.match(m[0].content, /between 10 and 40 words/);
  assert.match(m[0].content, /2 words long/);
  assert.match(m[0].content, /Never pad/);
});

test("buildExplainerMessages: without notes, no notes section appears", () => {
  const messages = buildExplainerMessages({
    persona: "style",
    lastMessageText: "Hello.",
  });
  assert.ok(!messages[1].content.includes("LISTENER NOTES"));
  assert.ok(messages[1].content.startsWith("LATEST MESSAGE"));
});

test("task rules still contain the product's core guarantees", () => {
  // If someone edits the rules and loses a guarantee, this fails loudly.
  assert.match(TASK_RULES, /ONLY the latest message/);
  assert.match(TASK_RULES, /Do NOT re-explain/);
  assert.match(TASK_RULES, /Never mention that listener notes exist/);
  assert.match(TASK_RULES, /no markdown/);
  assert.match(TASK_RULES, /NARRATOR/);
  assert.match(TASK_RULES, /NEVER offer to act/);
});
