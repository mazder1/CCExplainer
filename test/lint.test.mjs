import test from "node:test";
import assert from "node:assert/strict";
import { lintExplanation } from "../scripts/lib/lint.mjs";

// A clean, speakable, educator-length text: short sentences, ~150 words.
const CLEAN = Array(22).fill("This is a plain spoken sentence about the code.").join(" ");

function rules(text, opts) {
  return lintExplanation(text, opts).violations.map((v) => v.rule);
}

test("clean spoken text passes with no violations", () => {
  const result = lintExplanation(CLEAN, { persona: "educator" });
  assert.deepEqual(result, { ok: true, violations: [] });
});

test("empty output is a violation", () => {
  assert.deepEqual(rules("   "), ["empty"]);
});

test("markdown is caught: fences, backticks, headings, bullets, bold, links", () => {
  assert.ok(rules("Look: ```js\ncode\n```").includes("markdown"));
  assert.ok(rules("Run `npm test` now.").includes("markdown"));
  assert.ok(rules("# Summary\nAll good.").includes("markdown"));
  assert.ok(rules("- first thing\n- second thing").includes("markdown"));
  assert.ok(rules("This is **very** important.").includes("markdown"));
  assert.ok(rules("See [the docs](https://x.dev).").includes("markdown"));
});

test("mentioning the notes is caught (calibration must be invisible)", () => {
  assert.ok(rules("According to your profile, you struggle with pipes.").includes("mentions-notes"));
  assert.ok(rules("The Listener Notes say you know git well.").includes("mentions-notes"));
});

test("unspeakable tokens are caught: UUIDs, URLs, paths, hex, keys", () => {
  assert.ok(rules("Session 817e3f0e-6fde-4202-8ee9-195a9ea99120 is done.").includes("unspeakable"));
  assert.ok(rules("Visit https://example.com for more.").includes("unspeakable"));
  assert.ok(rules("Open C:\\Users\\you\\project now.").includes("unspeakable"));
  assert.ok(rules("The commit is deadbeefdeadbeef42.").includes("unspeakable"));
  assert.ok(rules("They renamed utils/helpers.js this morning.").includes("unspeakable"));
  assert.ok(rules("It stays under the limit of key wk_live_8f3a91d2.").includes("unspeakable"));
  assert.ok(!rules("They renamed the helpers file this morning.").includes("unspeakable"));
});

test("role-confusion offers are caught, plain narration is not", () => {
  assert.ok(rules("Let me know which option you prefer.").includes("role-confusion"));
  assert.ok(rules("Or I can change the expiration to a different duration.").includes("role-confusion"));
  assert.ok(rules("Shall I switch it to hourly?").includes("role-confusion"));
  assert.ok(!rules("The assistant said it will change the timeout later.").includes("role-confusion"));
  assert.ok(!rules("You can change the page size in the settings.").includes("role-confusion"));
});

test("sentences longer than karaoke pace are caught", () => {
  const runOn =
    "This sentence just keeps going and going with more and more words piled on top of each other until nobody could possibly follow the moving highlight anymore at all.";
  assert.ok(rules(runOn).includes("sentence-too-long"));
});

test("persona word budgets: too short and too long are caught, tolerance applies", () => {
  assert.ok(rules("Done. All tests pass.", { persona: "educator" }).includes("too-short"));
  const tooLong = Array(60).fill("Here is one more short sentence again.").join(" ");
  assert.ok(rules(tooLong, { persona: "educator" }).includes("too-long"));
  // ~150 words is fine for educator but too long for the senior engineer:
  assert.ok(rules(CLEAN, { persona: "senior-engineer" }).includes("too-long"));
  // no persona given -> no budget check at all
  assert.ok(!rules("Short.").includes("too-short"));
});
