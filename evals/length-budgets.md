# Length budgets — why explanation length scales with message length

*2026-08-03 · probe: [`length-probe.mjs`](length-probe.mjs) · 28 real assistant
messages harvested from local Claude Code transcripts, 7 length buckets,
explained via the production path (educator persona, no notes).*

## The problem, measured (before)

Explanation length was governed by a fixed persona budget (educator: 120–220
words) — so output length was FLAT regardless of the input:

| message words (median) | explanation words (median) | ratio |
|---:|---:|---:|
| 17 | 132 | **10.2×** |
| 41 | 136 | 4.1× |
| 65 | 143 | 2.2× |
| 156 | 148 | 1.3× |
| 358 | 205 | 0.7× |
| 738 | 202 | 0.3× |
| 911 | 173 | 0.2× |

An 11-word message received a 148-word lecture. Every explanation landed
between 100 and 249 words no matter what went in.

## The fix

A single shared function — `lengthBudget(persona, messageWords)` in
[`scripts/lib/lint.mjs`](../scripts/lib/lint.mjs) — maps message length to a
word budget per persona (tiers chosen from the healthy region of the probe
data). The same function feeds BOTH the prompt instruction ("between 10 and
40 words … never pad to fill the budget") and the linter that validates the
output, with the existing lint-retry loop as the enforcement. The
[`one-liner`](fixtures/one-liner.json) fixture pins the behavior in the eval
suite permanently.

## The result (after — same probe, re-run)

| message words (median) | explanation words (median) | ratio |
|---:|---:|---:|
| 15 | 31 | 2.1× |
| 36 | 56 | 1.6× |
| 75 | 72 | 1.4× |
| 165 | 130 | 0.9× |
| 301 | 194 | 0.6× |
| 455 | 232 | 0.6× |
| 903 | 164 | 0.2× |

Short messages now get short spoken replies (minimum observed: 18 words);
long messages keep the same ~200-word summaries they already had. The curve
bends exactly where the pathology was and nowhere else.
