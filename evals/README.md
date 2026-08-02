# Evals — the output-quality harness

`fixtures/` holds hand-written trap scenarios: frozen inputs for the explainer
(persona + listener notes + last message), each engineered to tempt one
specific failure the task rules forbid. They are plain JSON — reading and
editing them costs nothing, and they must stay stable so score comparisons
across prompt changes stay meaningful.

Fixture schema:

```json
{
  "name": "unique-slug",
  "trap": "one sentence: the mistake this scenario tempts",
  "persona": "educator | senior-engineer | rubber-duck",
  "notes": "listener notes text, or null for a cold start",
  "lastMessage": "the assistant message the explainer must explain",
  "expectations": "what a passing explanation does and does not contain"
}
```

The runner (step 4 of the harness plan) generates a real explanation for each
fixture through the production prompt path, lints it mechanically for free
(`scripts/lib/lint.mjs`), then has a judge model rule on the trap with quoted
evidence. Until the runner lands, these files check nothing on their own.
