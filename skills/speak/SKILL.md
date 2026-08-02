---
name: speak
description: Speak an explanation of the latest Claude message aloud, in a chosen persona, via ElevenLabs
argument-hint: "[educator|senior-engineer|rubber-duck]"
disable-model-invocation: true
allowed-tools: Bash
---

The user wants to HEAR an explanation of your latest message, spoken aloud.

Run this command from the project root (a persona may have been passed in the
arguments; if "$ARGUMENTS" is empty or not one of educator, senior-engineer,
rubber-duck, use educator):

```
node "${CLAUDE_SKILL_DIR}/../../scripts/explain.mjs" --live --persona <persona> | node "${CLAUDE_SKILL_DIR}/../../scripts/speak.mjs" -
```

Rules:
- Run the command exactly once and wait for it to finish. Audio plays in the
  background on the user's machine — that IS the product working.
- Do not print the explanation text yourself; the whole point is that it is
  heard, not read. After the command succeeds, reply with a single short
  sentence confirming the audio is playing and which persona spoke.
- If the command fails, show the error output and suggest the likely fix
  (missing keys in .env are the usual suspect).
