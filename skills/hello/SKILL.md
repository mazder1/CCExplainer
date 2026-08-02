---
name: hello
description: Confirm the CCExplainer plugin is installed and working
disable-model-invocation: true
---

The user invoked the CCExplainer hello command to verify the plugin is loaded.

Greet the user warmly and confirm that the CCExplainer plugin is installed and
working. Tell them:

1. The plugin loaded successfully — this message came from a skill file inside it.
2. The current session id is `${CLAUDE_SESSION_ID}` (proof that skills can see
   session context — the same mechanism CCExplainer will later use to find the
   session transcript).
3. In a future wave, the `/speak` command will live right next to this one.

Keep it short and friendly — three or four sentences.
