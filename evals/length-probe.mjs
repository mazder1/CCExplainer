// PROBE — how does explanation length respond to message length TODAY?
//
// Harvests real assistant messages from local Claude Code transcripts across
// length buckets, explains each through the production path (educator, no
// notes, low effort), and reports words-in vs words-out statistics. Run
// BEFORE designing proportional budgets (and again after, for comparison).
//
//   node evals/length-probe.mjs           (~25 API calls, a few cents)

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { readConversation } from "../scripts/lib/transcript.mjs";
import { generateExplanation } from "../scripts/lib/explainer.mjs";

try {
  process.loadEnvFile();
} catch {}
const HERE = dirname(fileURLToPath(import.meta.url));

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------
// Harvest: assistant messages from the most recently active transcripts of
// EVERY local project, bucketed by word count.
// ---------------------------------------------------------------------------

const BUCKETS = [
  [1, 20],
  [20, 50],
  [50, 100],
  [100, 200],
  [200, 400],
  [400, 800],
  [800, Infinity],
];
const PER_BUCKET = 4;

const projectsDir = join(homedir(), ".claude", "projects");
const transcripts = [];
for (const proj of readdirSync(projectsDir)) {
  const dir = join(projectsDir, proj);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    continue;
  }
  for (const f of files) transcripts.push(join(dir, f));
}
// Newest first, cap how many files we parse.
transcripts.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

const byBucket = BUCKETS.map(() => []);
for (const t of transcripts.slice(0, 40)) {
  let turns;
  try {
    turns = readConversation(t);
  } catch {
    continue;
  }
  for (const turn of turns) {
    if (turn.role !== "CLAUDE") continue;
    const text = turn.text.trim();
    if (text.startsWith("[used tool")) continue; // pure tool-noise entries
    const w = words(text);
    const bucketIndex = BUCKETS.findIndex(([lo, hi]) => w >= lo && w < hi);
    if (bucketIndex !== -1) byBucket[bucketIndex].push(text);
  }
}

// Random sample per bucket (dedup by text).
const samples = [];
byBucket.forEach((pool, i) => {
  const unique = [...new Set(pool)];
  for (let k = 0; k < PER_BUCKET && unique.length > 0; k++) {
    const pick = unique.splice(Math.floor(Math.random() * unique.length), 1)[0];
    samples.push({ bucket: `${BUCKETS[i][0]}-${BUCKETS[i][1] === Infinity ? "∞" : BUCKETS[i][1]}`, message: pick });
  }
});

console.log(`Probing ${samples.length} real messages across ${BUCKETS.length} length buckets...\n`);

// ---------------------------------------------------------------------------
// Explain each (modest concurrency), record in vs out.
// ---------------------------------------------------------------------------

const results = [];
async function worker() {
  while (samples.length) {
    const s = samples.shift();
    const msgWords = words(s.message);
    try {
      const gen = await generateExplanation({
        personaName: "educator",
        notes: null,
        lastMessageText: s.message,
        effort: "low",
      });
      const explWords = words(gen.text);
      results.push({ bucket: s.bucket, msgWords, explWords, ratio: +(explWords / msgWords).toFixed(2), retried: gen.retried });
      console.log(`  msg ${String(msgWords).padStart(4)}w → expl ${String(explWords).padStart(3)}w  (bucket ${s.bucket})`);
    } catch (err) {
      console.log(`  msg ${msgWords}w → ERROR: ${String(err.message).slice(0, 60)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

// ---------------------------------------------------------------------------
// Statistics per bucket.
// ---------------------------------------------------------------------------

const med = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
console.log(`\nbucket        n   median msg→expl words   median ratio`);
for (const [lo, hi] of BUCKETS) {
  const label = `${lo}-${hi === Infinity ? "∞" : hi}`;
  const rows = results.filter((r) => r.bucket === label);
  if (!rows.length) continue;
  console.log(
    `${label.padEnd(12)} ${String(rows.length).padStart(2)}   ${String(med(rows.map((r) => r.msgWords))).padStart(6)} → ${String(med(rows.map((r) => r.explWords))).padStart(4)}          ${med(rows.map((r) => r.ratio)).toFixed(2)}`,
  );
}
const all = results.map((r) => r.explWords);
console.log(`\nAll explanations: min ${Math.min(...all)}w, median ${med(all)}w, max ${Math.max(...all)}w`);

writeFileSync(join(HERE, "results", "length-probe.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`Saved to evals/results/length-probe.json`);
