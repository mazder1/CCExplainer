// Harness step 4 — the runner. For every fixture: generate a real
// explanation through the production prompt path, lint it for free, then
// have a judge model rule on the trap and the core dimensions with quoted
// evidence. Prints a scorecard; saves full details to evals/results/.
//
//   npm run eval                 -> all fixtures
//   node evals/run.mjs --only code-heavy
//
// Judge configuration (optional — defaults to the main LLM provider):
//   EVAL_JUDGE_BASE_URL / EVAL_JUDGE_API_KEY / EVAL_JUDGE_MODEL

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPersona, buildExplainerMessages } from "../scripts/lib/explainer.mjs";
import { lintExplanation } from "../scripts/lib/lint.mjs";
import { chat } from "../scripts/lib/llm.mjs";

try {
  process.loadEnvFile();
} catch {}

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

const judgeOpts = {
  baseUrl: process.env.EVAL_JUDGE_BASE_URL,
  apiKey: process.env.EVAL_JUDGE_API_KEY,
  model: process.env.EVAL_JUDGE_MODEL,
};

const DIMENSIONS = ["trap", "faithfulness", "scope", "calibration", "coherence"];

const JUDGE_RULES = `You are a strict evaluator of spoken explanations produced
by a voice assistant for coding sessions. You receive: the assistant MESSAGE
that was explained, optional LISTENER NOTES, the specific TRAP this scenario
tests, the fixture author's EXPECTATIONS, and the EXPLANATION under test.

Judge these dimensions, each pass/fail, each with one short piece of quoted
evidence from the explanation (or the reason no evidence exists):
- trap: did the explanation avoid the specific trap described?
- faithfulness: is every claim about the message actually supported by it?
- scope: does it explain only the latest message (no re-explaining of past
  problems that appear in the notes)?
- calibration: is the influence of the listener notes invisible — never
  referenced or hinted at?
- coherence: could a listener who never read the message follow it?

Be strict; when in doubt, fail. Answer with ONLY this JSON, no markdown:
{"trap":{"pass":true,"evidence":"..."},"faithfulness":{"pass":true,"evidence":"..."},"scope":{"pass":true,"evidence":"..."},"calibration":{"pass":true,"evidence":"..."},"coherence":{"pass":true,"evidence":"..."}}`;

function parseJudgeVerdict(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("judge returned no JSON");
  return JSON.parse(match[0]);
}

const fixtures = readdirSync(join(HERE, "fixtures"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8")))
  .filter((f) => !only || f.name === only);

if (fixtures.length === 0) {
  console.error(only ? `No fixture named "${only}".` : "No fixtures found.");
  process.exit(1);
}

console.log(`Running ${fixtures.length} fixture(s)...\n`);
const rows = [];

for (const fixture of fixtures) {
  process.stdout.write(`• ${fixture.name} … `);
  const row = { name: fixture.name, trap: fixture.trap };
  try {
    // 1. Generate — through the SAME code path production uses.
    const persona = loadPersona(fixture.persona);
    const messages = buildExplainerMessages({
      persona,
      notes: fixture.notes,
      lastMessageText: fixture.lastMessage,
    });
    const { text: explanation } = await chat(messages);
    row.explanation = explanation;

    // 2. Lint — free mechanical checks.
    row.lint = lintExplanation(explanation, { persona: fixture.persona });

    // 3. Judge — rules on the trap and dimensions, with evidence.
    const judgeInput = [
      `TRAP: ${fixture.trap}`,
      `EXPECTATIONS: ${fixture.expectations}`,
      fixture.notes ? `LISTENER NOTES:\n${fixture.notes}` : "LISTENER NOTES: (none)",
      `MESSAGE:\n${fixture.lastMessage}`,
      `EXPLANATION UNDER TEST:\n${explanation}`,
    ].join("\n\n");
    const { text: judgeText } = await chat(
      [
        { role: "system", content: JUDGE_RULES },
        { role: "user", content: judgeInput },
      ],
      judgeOpts,
    );
    row.verdict = parseJudgeVerdict(judgeText);

    const lintTag = row.lint.ok ? "lint:clean" : `lint:${row.lint.violations.length} violation(s)`;
    const dims = DIMENSIONS.map((d) => `${d}:${row.verdict[d]?.pass ? "✓" : "✗"}`).join(" ");
    console.log(`${lintTag}  ${dims}`);
  } catch (err) {
    row.error = err.message;
    console.log(`ERROR: ${err.message}`);
  }
  rows.push(row);
}

// ---- scorecard -------------------------------------------------------------

const judged = rows.filter((r) => r.verdict);
console.log(`\n${"─".repeat(56)}\nSCORECARD (${judged.length}/${rows.length} fixtures judged)`);
for (const dim of DIMENSIONS) {
  const passes = judged.filter((r) => r.verdict[dim]?.pass).length;
  console.log(`  ${dim.padEnd(14)} ${passes}/${judged.length}`);
}
const lintClean = rows.filter((r) => r.lint?.ok).length;
console.log(`  ${"lint-clean".padEnd(14)} ${lintClean}/${rows.length}`);

const failures = judged.flatMap((r) =>
  DIMENSIONS.filter((d) => !r.verdict[d]?.pass).map((d) => `  ${r.name} → ${d}: ${r.verdict[d]?.evidence}`),
);
if (failures.length) console.log(`\nFAILED CHECKS:\n${failures.join("\n")}`);

const lintFailures = rows.filter((r) => r.lint && !r.lint.ok);
if (lintFailures.length)
  console.log(
    `\nLINT VIOLATIONS:\n` +
      lintFailures
        .map((r) => `  ${r.name}: ${r.lint.violations.map((v) => `${v.rule} (${v.detail})`).join(", ")}`)
        .join("\n"),
  );

// ---- persist full details --------------------------------------------------

const resultsDir = join(HERE, "results");
mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 2));
console.log(`\nFull details (every explanation + verdict): ${outPath}`);
