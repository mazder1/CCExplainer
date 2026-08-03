// Harness layer 1 — mechanical lint for spoken explanations.
//
// Deterministic, instant, free: catches the failures a machine can catch
// without any intelligence, so the (paid) judge model only rules on what
// genuinely needs judgment. Each rule returns a violation naming itself —
// an explanation is "lint-clean" when the list is empty.

// Legacy fixed budgets — fallback when the caller cannot supply the message
// length (then we cannot scale, so the old persona-wide range applies).
export const WORD_BUDGETS = {
  educator: { min: 120, max: 220 },
  "senior-engineer": { min: 50, max: 100 },
  "rubber-duck": { min: 90, max: 160 },
};

// Proportional length budgets — derived from the 2026-08-03 length probe
// (evals/length-probe.mjs): 28 real messages showed explanation length was
// FLAT (~130-200 words) regardless of input, giving an 11-word message a
// 148-word lecture (ratio 10x). Tiers: [message words below, min, max].
// This function is the SINGLE source of truth — it feeds both the prompt
// instruction and this linter, so they can never disagree.
const LENGTH_TIERS = {
  educator: [
    [25, 10, 40],
    [80, 30, 80],
    [200, 60, 140],
    [Infinity, 100, 220],
  ],
  "senior-engineer": [
    [25, 8, 30],
    [80, 15, 45],
    [200, 25, 70],
    [Infinity, 50, 100],
  ],
  "rubber-duck": [
    // questions barely scale with subject length
    [25, 25, 90],
    [Infinity, 80, 160],
  ],
};

export function lengthBudget(persona, messageWords) {
  const tiers = LENGTH_TIERS[persona];
  if (!tiers) return null;
  const [, min, max] = tiers.find(([cap]) => messageWords < cap);
  return { min, max };
}

const BUDGET_TOLERANCE = 0.25; // ±25% before we call it a violation
const MAX_SENTENCE_WORDS = 28; // longer than this is misery to karaoke through

const FORBIDDEN_PHRASES = [
  "listener notes",
  "according to your profile",
  "your learner profile",
  "as mentioned in the notes",
  "the notes say",
  "based on your history",
];

export function lintExplanation(text, { persona = null, messageWords = null } = {}) {
  const violations = [];
  const trimmed = (text ?? "").trim();

  if (trimmed.length === 0) {
    return { ok: false, violations: [{ rule: "empty", detail: "no text at all" }] };
  }

  // --- markdown / symbols: this text is spoken, not rendered -------------
  if (/```/.test(trimmed)) violations.push({ rule: "markdown", detail: "code fence ```" });
  if (/`[^`]+`/.test(trimmed)) violations.push({ rule: "markdown", detail: "inline backticks" });
  if (/^\s*#{1,6}\s/m.test(trimmed)) violations.push({ rule: "markdown", detail: "heading #" });
  if (/^\s*[-*]\s+/m.test(trimmed)) violations.push({ rule: "markdown", detail: "bullet list" });
  if (/\*\*[^*]+\*\*/.test(trimmed)) violations.push({ rule: "markdown", detail: "bold **" });
  if (/\]\(/.test(trimmed)) violations.push({ rule: "markdown", detail: "markdown link" });

  // --- calibration must be invisible -------------------------------------
  const lower = trimmed.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) violations.push({ rule: "mentions-notes", detail: `"${phrase}"` });
  }

  // --- role confusion: the narrator offering to act -----------------------
  const ROLE_CONFUSION =
    /\b(let me know|tell me if you want|shall i|want me to|i (?:can|could|will|'ll|’ll) (?:change|add|update|implement|fix|adjust|proceed|switch|set|make))\b/i;
  const roleHit = trimmed.match(ROLE_CONFUSION);
  if (roleHit) violations.push({ rule: "role-confusion", detail: `"${roleHit[0]}"` });

  // --- unspeakable tokens -------------------------------------------------
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(trimmed))
    violations.push({ rule: "unspeakable", detail: "UUID" });
  if (/https?:\/\/|www\./i.test(trimmed)) violations.push({ rule: "unspeakable", detail: "URL" });
  if (/[A-Za-z]:\\|\\\\|\w+\\\w+/.test(trimmed)) violations.push({ rule: "unspeakable", detail: "file path" });
  if (/\b[\w.-]+\/[\w.-]+\.\w{1,5}\b/.test(trimmed)) violations.push({ rule: "unspeakable", detail: "raw slash path" });
  if (/\b\w{2,6}_(live|test)_\w{6,}\b/.test(trimmed)) violations.push({ rule: "unspeakable", detail: "secret-looking key" });
  if (/[0-9a-f]{16,}/i.test(trimmed)) violations.push({ rule: "unspeakable", detail: "long hex string" });

  // --- sentence length: karaoke pace -------------------------------------
  for (const sentence of trimmed.split(/[.!?]+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length > MAX_SENTENCE_WORDS) {
      violations.push({
        rule: "sentence-too-long",
        detail: `${words.length} words: "${words.slice(0, 6).join(" ")}…"`,
      });
    }
  }

  // --- word budget: proportional to the message when its length is known --
  const budget = persona
    ? messageWords != null
      ? lengthBudget(persona, messageWords)
      : WORD_BUDGETS[persona]
    : null;
  if (budget) {
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const min = Math.floor(budget.min * (1 - BUDGET_TOLERANCE));
    const max = Math.ceil(budget.max * (1 + BUDGET_TOLERANCE));
    if (wordCount < min)
      violations.push({ rule: "too-short", detail: `${wordCount} words, persona minimum ~${min}` });
    if (wordCount > max)
      violations.push({ rule: "too-long", detail: `${wordCount} words, persona maximum ~${max}` });
  }

  return { ok: violations.length === 0, violations };
}
