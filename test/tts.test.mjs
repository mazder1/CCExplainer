import test from "node:test";
import assert from "node:assert/strict";
import { wordsFromAlignment } from "../scripts/lib/tts.mjs";

// "Hi you" spoken over 1.1 seconds, with a pause between the words.
const alignment = {
  characters: ["H", "i", " ", "y", "o", "u"],
  character_start_times_seconds: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
  character_end_times_seconds: [0.2, 0.4, 0.6, 0.8, 1.0, 1.1],
};

test("wordsFromAlignment groups characters into words with correct spans", () => {
  const words = wordsFromAlignment(alignment);
  assert.equal(words.length, 2);
  assert.deepEqual(words[0], { text: "Hi", start: 0.0, end: 0.4 });
  assert.deepEqual(words[1], { text: "you", start: 0.6, end: 1.1 });
});

test("wordsFromAlignment handles leading/multiple whitespace and empty input", () => {
  assert.deepEqual(wordsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }), []);
  const messy = wordsFromAlignment({
    characters: [" ", "a", " ", " ", "b"],
    character_start_times_seconds: [0, 1, 2, 3, 4],
    character_end_times_seconds: [1, 2, 3, 4, 5],
  });
  assert.deepEqual(messy.map((w) => w.text), ["a", "b"]);
  assert.equal(messy[1].start, 4);
});
