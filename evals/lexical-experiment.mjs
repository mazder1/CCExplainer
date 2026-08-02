// EXPLORATION — rarity-aware lexical layer over cosine similarity.
//
// Hypothesis (user's): embeddings under-serve rare words, so a low cosine is
// JUSTIFIED when the explanation still shares the message's rare vocabulary
// (lexical overlap high), and is a REAL problem when it shares neither
// meaning nor words. Rarity is measured against general English (Norvig's
// trillion-word counts, top 50k) — computable a priori, no fixture history.
//
// 2x2 diagnosis:            lex HIGH              lex LOW
//   cosine HIGH             fine                  fine (paraphrase)
//   cosine LOW              justified (rare-word  ALARM (drift /
//                           geometry artifact)    hallucination)
//
// Per the project's methodology rule: results on the existing 56 cases are
// exploration, not confirmation — the confirmatory test needs fresh data.
//
//   node evals/lexical-experiment.mjs   (no API calls, free)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// IDF from the general-English frequency list.
// ---------------------------------------------------------------------------

const freq = new Map();
let total = 0;
for (const line of readFileSync(join(HERE, "data", "word-freq-top50k.txt"), "utf8").trim().split("\n")) {
  const [word, count] = line.trim().split(/\s+/);
  const n = Number(count);
  freq.set(word, n);
  total += n;
}
const MIN_COUNT = Math.min(...freq.values());
// Unseen words (identifiers, jargon beyond rank 50k) count as rarer than
// anything on the list.
const idf = (w) => Math.log2(total / (freq.get(w) ?? MIN_COUNT / 8));

const tokenize = (text) => (text.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);

// IDF-weighted share of the MESSAGE's vocabulary that the explanation reuses.
function lexOverlap(explanation, message) {
  const eTypes = new Set(tokenize(explanation));
  const mTypes = [...new Set(tokenize(message))];
  const totalW = mTypes.reduce((s, w) => s + idf(w), 0);
  const sharedW = mTypes.filter((w) => eTypes.has(w)).reduce((s, w) => s + idf(w), 0);
  return totalW > 0 ? sharedW / totalW : 0;
}

const meanRarity = (text) => {
  const types = [...new Set(tokenize(text))];
  return types.reduce((s, w) => s + idf(w), 0) / Math.max(types.length, 1);
};

// ---------------------------------------------------------------------------
// Load cases (embedding geometry already computed) + fixture messages.
// ---------------------------------------------------------------------------

const fixtures = {};
for (const f of readdirSync(join(HERE, "fixtures"))) {
  const fx = JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8"));
  fixtures[fx.name] = fx;
}
const { cases } = JSON.parse(readFileSync(join(HERE, "results", "embedding-calibration.json"), "utf8"));

for (const c of cases) {
  c.lex = lexOverlap(c.explanation, fixtures[c.name].lastMessage);
  c.rarity = meanRarity(fixtures[c.name].lastMessage);
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const fmt = (x, d = 3) => x.toFixed(d);
console.log("case                        verdict  coverage   lex   msgRarity");
for (const c of [...cases].sort((a, b) => a.coverage - b.coverage)) {
  console.log(`${c.name.padEnd(26)} ${c.good ? "GOOD" : "BAD "}    ${fmt(c.coverage)}    ${fmt(c.lex)}    ${fmt(c.rarity, 1)}`);
}

// 1. The core claim: among LOW-cosine cases, GOOD ones should show HIGH
// lexical overlap (justified) and BAD ones LOW (alarm).
const byCov = [...cases].sort((a, b) => a.coverage - b.coverage);
const lowCos = byCov.slice(0, Math.floor(cases.length / 3));
const med = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const lcGood = lowCos.filter((c) => c.good);
const lcBad = lowCos.filter((c) => !c.good);
console.log(`\nLow-cosine tercile (${lowCos.length} cases):`);
console.log(`  GOOD (${lcGood.length}): median lex = ${fmt(med(lcGood.map((c) => c.lex)))}`);
console.log(`  BAD  (${lcBad.length}): median lex = ${fmt(med(lcBad.map((c) => c.lex)))}`);
console.log(`  Hypothesis wants: GOOD median clearly ABOVE bad median.`);

// 2. Rarity theory check: for GOOD cases, message rarity should correlate
// NEGATIVELY with coverage (rarer message -> lower innocent cosine).
const g = cases.filter((c) => c.good);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const mr = mean(g.map((c) => c.rarity));
const mc = mean(g.map((c) => c.coverage));
const r =
  g.reduce((s, c) => s + (c.rarity - mr) * (c.coverage - mc), 0) /
  Math.sqrt(g.reduce((s, c) => s + (c.rarity - mr) ** 2, 0) * g.reduce((s, c) => s + (c.coverage - mc) ** 2, 0));
console.log(`\nGOOD cases: correlation(message rarity, coverage) = ${fmt(r)} (hypothesis wants clearly negative)`);

// 3. Exploration ceiling of the combined alarm rule: cosine low AND lex low.
let best = { score: -1 };
for (const t1 of cases.map((c) => c.coverage)) {
  for (const t2 of cases.map((c) => c.lex)) {
    const flagged = cases.filter((c) => c.coverage <= t1 && c.lex <= t2);
    const caught = flagged.filter((c) => !c.good).length;
    const fp = flagged.length - caught;
    const score = caught / 18 - fp / 38;
    if (score > best.score) best = { t1, t2, caught, fp, score };
  }
}
console.log(
  `\nCombined alarm rule ceiling (EXPLORATION, overfit by construction):\n  coverage <= ${fmt(best.t1)} AND lex <= ${fmt(best.t2)} -> catches ${best.caught}/18 BAD, ${best.fp}/38 GOOD false alarms`,
);
console.log(`  (coverage-only ceiling from the previous experiment: 9/18 caught, 5/38 false alarms)`);

writeFileSync(
  join(HERE, "results", "lexical-exploration.json"),
  JSON.stringify({ ranAt: new Date().toISOString(), cases: cases.map(({ explanation, ...rest }) => rest) }, null, 2),
);
console.log(`\nSaved to evals/results/lexical-exploration.json`);
