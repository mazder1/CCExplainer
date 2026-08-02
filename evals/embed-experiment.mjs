// Embedding-geometry experiment (harness layer 1.5 candidate).
//
// Hypothesis (user's): an explanation's embedding deviates from its message's
// embedding partly because the listener-notes CONTEXT steers it. Deviation
// along the (context − message) direction is justified; deviation that
// neither input explains is suspicious. Tolerance should scale with how far
// the context is from the message: tolerance(x) = base + k · x.
//
// This script HARVESTS the tolerance from data we already trust: it reads
// every judged explanation in evals/results/, embeds (explanation, message,
// notes), computes the geometry, groups cases by judge verdict, fits the
// tolerance line on the GOOD pile, and reports whether good and bad separate.
//
//   node evals/embed-experiment.mjs
//
// Uses the OpenAI embeddings API (OPENAI_API_KEY; override model with
// EMBED_MODEL). Cost: fractions of a cent.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile();
} catch {}

const HERE = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY — embeddings need it.");
  process.exit(1);
}
const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-embedding-3-small";

// ---------------------------------------------------------------------------
// Load fixtures (for message + notes) and all judged rows from past runs.
// ---------------------------------------------------------------------------

const fixtures = {};
for (const f of readdirSync(join(HERE, "fixtures"))) {
  const fx = JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8"));
  fixtures[fx.name] = fx;
}

const cases = [];
for (const file of readdirSync(join(HERE, "results")).filter((f) => f.startsWith("run-"))) {
  const run = JSON.parse(readFileSync(join(HERE, "results", file), "utf8"));
  for (const row of run.rows ?? []) {
    if (!row.explanation || !row.verdict || !fixtures[row.name]) continue;
    // "good" = the three geometry-relevant dimensions all passed.
    const v = row.verdict;
    const good = !!(v.faithfulness?.pass && v.scope?.pass && v.calibration?.pass);
    cases.push({ run: file, name: row.name, explanation: row.explanation, good });
  }
}
if (cases.length < 10) {
  console.error(`Only ${cases.length} judged cases found — run npm run eval a few times first.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Embed every unique text in ONE batched API call.
// ---------------------------------------------------------------------------

const texts = new Map(); // text -> index
function want(text) {
  if (text && !texts.has(text)) texts.set(text, texts.size);
}
for (const c of cases) {
  want(c.explanation);
  want(fixtures[c.name].lastMessage);
  want(fixtures[c.name].notes);
}

console.log(`Embedding ${texts.size} unique texts for ${cases.length} judged cases (${EMBED_MODEL})...`);
const response = await fetch("https://api.openai.com/v1/embeddings", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: EMBED_MODEL, input: [...texts.keys()] }),
});
if (!response.ok) {
  console.error(`Embeddings API answered ${response.status}: ${await response.text()}`);
  process.exit(1);
}
const embedding = (await response.json()).data.map((d) => d.embedding);
const vec = (text) => embedding[texts.get(text)];

// ---------------------------------------------------------------------------
// Geometry helpers (all vectors normalized to unit length first).
// ---------------------------------------------------------------------------

const norm = (v) => {
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / len);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (v) => Math.sqrt(dot(v, v));

// ---------------------------------------------------------------------------
// Per-case geometry: coverage, context distance, steering, unexplained.
// ---------------------------------------------------------------------------

for (const c of cases) {
  const fx = fixtures[c.name];
  const e = norm(vec(c.explanation));
  const m = norm(vec(fx.lastMessage));
  c.coverage = dot(e, m); // cos(e, m)
  const r = sub(e, m); // residual: where the explanation strayed
  if (fx.notes) {
    const cv = norm(vec(fx.notes));
    c.ctxDist = 1 - dot(m, cv); // how far the context is from the message
    const dRaw = sub(cv, m);
    const d = norm(dRaw); // steering direction: message -> context
    c.steer = dot(r, d); // deviation ALONG the context direction (justified)
    c.unexplained = Math.sqrt(Math.max(len(r) ** 2 - c.steer ** 2, 0)); // the rest
  } else {
    c.ctxDist = null;
    c.steer = null;
    c.unexplained = len(r); // no context: all deviation is unexplained
  }
}

// ---------------------------------------------------------------------------
// Report: table, pile statistics, fitted tolerance line, separation.
// ---------------------------------------------------------------------------

const fmt = (x, d = 3) => (x === null ? "  —  " : x.toFixed(d));
console.log(`\ncase                        verdict  coverage  ctxDist  steer  unexplained`);
for (const c of [...cases].sort((a, b) => b.unexplained - a.unexplained)) {
  console.log(
    `${c.name.padEnd(26)} ${c.good ? "GOOD" : "BAD "}    ${fmt(c.coverage)}     ${fmt(c.ctxDist)}   ${fmt(c.steer)}  ${fmt(c.unexplained)}`,
  );
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const good = cases.filter((c) => c.good);
const bad = cases.filter((c) => !c.good);
for (const [label, pile] of [["GOOD", good], ["BAD", bad]]) {
  const u = pile.map((c) => c.unexplained);
  console.log(
    `\n${label} pile (${pile.length}): unexplained p10=${fmt(pct(u, 10))} median=${fmt(pct(u, 50))} p90=${fmt(pct(u, 90))}`,
  );
}

// Fit tolerance(x) = base + k*x on the GOOD pile (cases with context only).
const fitPts = good.filter((c) => c.ctxDist !== null);
let k = 0;
let a = pct(good.map((c) => c.unexplained), 50);
if (fitPts.length >= 3) {
  const mx = fitPts.reduce((s, c) => s + c.ctxDist, 0) / fitPts.length;
  const my = fitPts.reduce((s, c) => s + c.unexplained, 0) / fitPts.length;
  const denom = fitPts.reduce((s, c) => s + (c.ctxDist - mx) ** 2, 0);
  k = denom > 0 ? fitPts.reduce((s, c) => s + (c.ctxDist - mx) * (c.unexplained - my), 0) / denom : 0;
  a = my - k * mx;
}
// Shift the line up so ~90% of good cases sit under it.
const offsets = good.map((c) => c.unexplained - (a + k * (c.ctxDist ?? 0)));
const base = a + pct(offsets, 90);
console.log(`\nFitted tolerance line: allowed unexplained = ${base.toFixed(3)} + ${k.toFixed(3)} · ctxDist`);

const over = (c) => c.unexplained > base + k * (c.ctxDist ?? 0);
console.log(`Separation: ${bad.filter(over).length}/${bad.length} BAD cases above the line; ${good.filter(over).length}/${good.length} GOOD cases above (false alarms).`);

writeFileSync(
  join(HERE, "results", "embedding-calibration.json"),
  JSON.stringify({ ranAt: new Date().toISOString(), model: EMBED_MODEL, base, k, cases }, null, 2),
);
console.log(`\nSaved geometry + fitted line to evals/results/embedding-calibration.json`);
