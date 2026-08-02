import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  projectTranscriptDir,
  latestTranscript,
  readConversation,
  conversationAsText,
  pickMessageToExplain,
} from "../scripts/lib/transcript.mjs";

test("projectTranscriptDir encodes every non-alphanumeric character as a dash", () => {
  const dir = projectTranscriptDir("C:\\Users\\X\\my proj.2");
  assert.equal(basename(dir), "C--Users-X-my-proj-2");
});

test("latestTranscript returns the newest .jsonl and ignores other files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cctest-"));
  const old = join(dir, "old.jsonl");
  const fresh = join(dir, "fresh.jsonl");
  writeFileSync(old, "{}");
  writeFileSync(fresh, "{}");
  writeFileSync(join(dir, "notes.txt"), "not a transcript");
  utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1));
  utimesSync(fresh, new Date(2026, 6, 1), new Date(2026, 6, 1));
  assert.equal(latestTranscript(dir), fresh);
});

test("latestTranscript throws on a directory with no transcripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "cctest-empty-"));
  assert.throws(() => latestTranscript(dir), /No transcripts found/);
});

function writeFixtureTranscript() {
  const lines = [
    { type: "mode", mode: "normal" },
    {
      type: "user",
      message: { role: "user", content: "hello" },
      timestamp: "2026-08-02T10:00:00.000Z",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal reasoning" },
          { type: "text", text: "hi there" },
          { type: "tool_use", name: "Bash", input: {} },
        ],
      },
      timestamp: "2026-08-02T10:00:05.000Z",
    },
    { type: "user", isSidechain: true, message: { role: "user", content: "subagent traffic" } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "big output" }] } },
  ];
  const file = join(mkdtempSync(join(tmpdir(), "cctest-fix-")), "s.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

test("readConversation keeps conversation, skips metadata/sidechains/thinking, condenses tools", () => {
  const turns = readConversation(writeFixtureTranscript());
  assert.equal(turns.length, 3);
  assert.deepEqual(turns[0], { role: "USER", time: "10:00:00", text: "hello" });
  assert.equal(turns[1].role, "CLAUDE");
  assert.equal(turns[1].text, "hi there\n[used tool: Bash]");
  assert.ok(!turns[1].text.includes("internal reasoning"));
  assert.equal(turns[2].text, "[tool result received]");
});

test("conversationAsText renders role, time and text", () => {
  const text = conversationAsText(readConversation(writeFixtureTranscript()));
  assert.match(text, /USER @ 10:00:00:\nhello/);
  assert.match(text, /CLAUDE @ 10:00:05:/);
});

const turn = (role, text) => ({ role, time: "", text });

test("pickMessageToExplain: default picks the last CLAUDE turn", () => {
  const turns = [turn("USER", "q"), turn("CLAUDE", "a1"), turn("USER", "q2"), turn("CLAUDE", "a2")];
  assert.equal(pickMessageToExplain(turns).text, "a2");
});

test("pickMessageToExplain: live mode picks the CLAUDE turn before the final USER turn", () => {
  const turns = [
    turn("USER", "question"),
    turn("CLAUDE", "the reply the user just read"),
    turn("USER", "/ccexplainer:speak"),
    turn("CLAUDE", "[used tool: Bash]"), // in-progress activity after /speak
  ];
  assert.equal(pickMessageToExplain(turns, { live: true }).text, "the reply the user just read");
});

test("pickMessageToExplain: returns undefined when no CLAUDE turn exists", () => {
  assert.equal(pickMessageToExplain([turn("USER", "only me")]), undefined);
});

test("pickMessageToExplain: offset walks backwards through assistant messages", () => {
  const turns = [
    turn("CLAUDE", "a1"),
    turn("USER", "q"),
    turn("CLAUDE", "a2"),
    turn("USER", "q"),
    turn("CLAUDE", "a3"),
  ];
  assert.equal(pickMessageToExplain(turns, { offset: 0 }).text, "a3");
  assert.equal(pickMessageToExplain(turns, { offset: -1 }).text, "a2");
  assert.equal(pickMessageToExplain(turns, { offset: 2 }).text, "a1"); // sign ignored
  assert.equal(pickMessageToExplain(turns, { offset: -5 }), undefined); // out of range
});

test("pickMessageToExplain: offset composes with live mode", () => {
  const turns = [
    turn("CLAUDE", "a1"),
    turn("USER", "q"),
    turn("CLAUDE", "a2"),
    turn("USER", "/speak"),
    turn("CLAUDE", "[used tool: Bash]"),
  ];
  assert.equal(pickMessageToExplain(turns, { live: true, offset: 0 }).text, "a2");
  assert.equal(pickMessageToExplain(turns, { live: true, offset: -1 }).text, "a1");
});
