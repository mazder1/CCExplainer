# CCExplainer

**Adaptive voice summaries for Claude Code.** Instead of reading messages aloud verbatim, CCExplainer has an agent read your session, consult a learner profile built from your past sessions, write a spoken-word explanation in a persona of your choice (Educator, Senior Engineer, Rubber Duck…), and speak it through [ElevenLabs](https://elevenlabs.io) — with adjustable voice, style, and speed.

## How it works

1. **Session context from disk** — Claude Code persists every session as JSONL under `~/.claude/projects/`; a transcript reader gives full session context with no invasive integration.
2. **Learner profile** — a cheap background pass scans transcripts for comprehension signals (repeated questions, recurring bugs, "I don't understand") and records which concepts you've struggled with or mastered.
3. **Persona-scripted summary** — Claude writes a script *for the ear*, adapted to your profile: weak concepts get explained from first principles, mastered ones get mentioned, not re-taught.
4. **ElevenLabs TTS** — fast model for quick briefs, expressive model for the Educator persona; speech can start streaming before the script is finished.

Trigger it from a `/speak` slash command in Claude Code, or from a localhost web panel with real buttons, a persona picker, a speed slider, and an audio player.

## Status

🚧 Design phase. See [BRIEF.md](BRIEF.md) for the full design brief, architecture, API choices, and roadmap.

## Planned stack

TypeScript / Node 22 · `@anthropic-ai/sdk` · `@elevenlabs/elevenlabs-js` · Fastify · packaged as a Claude Code plugin.
