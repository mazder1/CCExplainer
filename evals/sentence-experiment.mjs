// EXPLORATION — sentence-level pairwise support.
//
// Hypothesis (user's): score each EXPLANATION SENTENCE by its best cosine
// against the message's sentences. A proper compression sentence aligns
// strongly with 1-2 source sentences; a sentence supported by nothing is
// likely invented. Whole-text cosine averages this away; sentence level
// should not.
//
// Outputs: per-case minimum support + unsupported fraction, GOOD/BAD
// separation, classification ceiling, and — the qualitative check — the
// weakest sentence of each BAD case, to eyeball against the judge's quotes.
//
//   node evals/sentence-experiment.mjs   (one embeddings call, <1 cent)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile();
} catch {}
const HERE = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

const splitSentences = (text) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

const fixtures = {};
for (const f of readdirSync(join(HERE, "fixtures"))) {
  const fx = JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8"));
  fixtures[fx.name] = fx;
}
const { cases } = JSON.parse(readFileSync(join(HERE, "results", "embedding-calibration.json"), "utf8"));

// Collect every unique sentence (explanations + messages) for ONE batch call.
const texts = new Map();
const want = (s) => {
  if (!texts.has(s)) texts.set(s, texts.size);
};
for (const c of cases) splitSentences(c.explanation).forEach(want);
for (const fx of Object.values(fixtures)) splitSentences(fx.lastMessage).forEach(want);

console.log(`Embedding ${texts.size} unique sentences...`);
const response = await fetch("https://api.openai.com/v1/embeddings", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: process.env.EMBED_MODEL ?? "text-embedding-3-small", input: [...texts.keys()] }),
});
if (!response.ok) {
  console.error(`Embeddings API: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const embs = (await response.json()).data.map((d) => d.embedding);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (v) => {
  const l = Math.sqrt(dot(v, v));
  return v.map((x) => x / l);
};
const vec = new Map([...texts.keys()].map((t, i) => [t, norm(embs[texts.get(t)])]));

// Per case: support profile of its explanation sentences.
for (const c of cases) {
  const msgVecs = splitSentences(fixtures[c.name].lastMessage).map((s) => vec.get(s));
  const sents = splitSentences(c.explanation);
  c.sentences = sents.map((s) => {
    const sims = msgVecs.map((m) => dot(vec.get(s), m)).sort((a, b) => b - a);
    return { text: s, support: sims[0], second: sims[1] ?? 0 };
  });
  const supports = c.sentences.map((s) => s.support);
  c.minSupport = Math.min(...supports);
  c.meanSupport = supports.reduce((a, b) => a + b, 0) / supports.length;
  c.weakest = c.sentences.reduce((w, s) => (s.support < w.support ? s : w));
}

// Separation on minSupport.
const med = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const good = cases.filter((c) => c.good);
const bad = cases.filter((c) => !c.good);
console.log(`\nminSupport — GOOD median: ${med(good.map((c) => c.minSupport)).toFixed(3)}, BAD median: ${med(bad.map((c) => c.minSupport)).toFixed(3)}`);
console.log(`meanSupport — GOOD median: ${med(good.map((c) => c.meanSupport)).toFixed(3)}, BAD median: ${med(bad.map((c) => c.meanSupport)).toFixed(3)}`);

// Classification ceiling on minSupport alone (EXPLORATION, overfit).
let best = { acc: -1 };
for (const t of cases.map((c) => c.minSupport)) {
  const correct = cases.filter((c) => (c.minSupport <= t ? !c.good : c.good)).length;
  const caught = bad.filter((c) => c.minSupport <= t).length;
  const fp = good.filter((c) => c.minSupport <= t).length;
  if (correct > best.acc) best = { acc: correct, t, caught, fp };
}
console.log(`\nCeiling on minSupport (overfit): flag if minSupport <= ${best.t.toFixed(3)}`);
console.log(`  catches ${best.caught}/${bad.length} bad, ${best.fp}/${good.length} false alarms, ${best.acc}/${cases.length} correct = ${((100 * best.acc) / cases.length).toFixed(0)}%`);
console.log(`  (whole-text cosine ceiling: 75%; always-say-good: 68%)`);

// Qualitative: weakest sentence of each BAD case — does it match the judge?
console.log(`\nWeakest sentence per BAD case (support in parens):`);
for (const c of bad.sort((a, b) => a.minSupport - b.minSupport)) {
  const t = c.weakest.text.length > 90 ? c.weakest.text.slice(0, 90) + "…" : c.weakest.text;
  console.log(`  ${c.name.padEnd(22)} (${c.minSupport.toFixed(2)}) "${t}"`);
}

writeFileSync(
  join(HERE, "results", "sentence-exploration.json"),
  JSON.stringify(
    { ranAt: new Date().toISOString(), cases: cases.map(({ explanation, sentences, weakest, ...r }) => ({ ...r, weakest: weakest.text })) },
    null,
    2,
  ),
);
console.log(`\nSaved to evals/results/sentence-exploration.json`);
