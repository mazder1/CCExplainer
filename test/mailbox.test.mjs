import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeJob,
  claimNextJob,
  touchHeartbeat,
  viewerAlive,
  clearHeartbeat,
} from "../scripts/lib/mailbox.mjs";

const freshDir = (label) => mkdtempSync(join(tmpdir(), `ccmail-${label}-`));

test("writeJob is atomic: a complete job appears, no .tmp litter remains", () => {
  const dir = freshDir("atomic");
  writeJob({ text: "hello", words: [], duration: 1 }, dir);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.ok(files[0].startsWith("job-") && files[0].endsWith(".json"));
  const parsed = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.text, "hello");
});

test("claimNextJob consumes a job exactly once (isolation)", () => {
  const dir = freshDir("claim");
  writeJob({ text: "only once" }, dir);
  const first = claimNextJob(dir);
  assert.equal(first.text, "only once");
  assert.equal(claimNextJob(dir), null); // gone — cannot be played twice
  assert.equal(readdirSync(dir).length, 0); // and nothing left behind
});

test("claimNextJob claims oldest first", () => {
  const dir = freshDir("order");
  writeFileSync(join(dir, "job-100-aaa.json"), JSON.stringify({ version: 1, text: "older" }));
  writeFileSync(join(dir, "job-200-bbb.json"), JSON.stringify({ version: 1, text: "newer" }));
  assert.equal(claimNextJob(dir).text, "older");
  assert.equal(claimNextJob(dir).text, "newer");
});

test("claimNextJob discards malformed and wrong-version jobs (consistency)", () => {
  const dir = freshDir("bad");
  writeFileSync(join(dir, "job-1-garbage.json"), "{not json at all");
  writeFileSync(join(dir, "job-2-future.json"), JSON.stringify({ version: 99, text: "?" }));
  assert.equal(claimNextJob(dir), null);
  assert.equal(readdirSync(dir).length, 0); // both rejected AND removed
});

test("viewerAlive reflects heartbeat freshness", () => {
  const lock = join(freshDir("lock"), "viewer.lock");
  assert.equal(viewerAlive(6000, lock), false); // no heartbeat yet
  touchHeartbeat(lock);
  assert.equal(viewerAlive(6000, lock), true); // fresh
  writeFileSync(lock, JSON.stringify({ pid: 1, time: Date.now() - 60000 }));
  assert.equal(viewerAlive(6000, lock), false); // stale = viewer is gone
  clearHeartbeat(lock);
  assert.equal(viewerAlive(6000, lock), false);
});
