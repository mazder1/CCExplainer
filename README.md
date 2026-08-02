# CCExplainer

[![CI](https://github.com/mazder1/CCExplainer/actions/workflows/ci.yml/badge.svg)](https://github.com/mazder1/CCExplainer/actions/workflows/ci.yml)

**A voice that explains your Claude Code session to you — not a voice that reads it at you.**

Claude Code's built-in text-to-speech reads messages verbatim: every file path, every code identifier, monotonously. CCExplainer takes a different approach: when you ask, an agent looks at the **last message** Claude sent you, considers **what you personally tend to struggle with** (learned from your session history), writes a short explanation *for the ear* in a persona of your choice — and speaks it through [ElevenLabs](https://elevenlabs.io).

It is a [Claude Code plugin](https://code.claude.com/docs/en/plugins.md): type `/ccexplainer:speak` after any reply, and a few seconds later you hear a calm human explanation of what just happened. No windows open, no files are left behind — just the voice.

## How it works

```
                        ┌──────────────────────────┐
  session history ────▶ │ comprehension analyzer       │
  (whole story)         │ "what does this user find    │
                        │  hard? what do they know?"   │
                        └────────────┬─────────────┘
                                     │ listener notes (cached, never spoken)
                                     ▼
                        ┌──────────────────────────┐
  last Claude message ▶ │ explainer (persona-styled)   │──▶ ElevenLabs TTS ──▶ 🔊
  (the actual subject)  └──────────────────────────┘
```

Two model calls with strictly separated jobs:

1. **The analyzer** reads session history and produces *listener notes* — which concepts this user has struggled with, what they handle confidently, how they like things explained. Notes are cached locally and refreshed only as real new history accumulates.
2. **The explainer** explains *only the latest message*. The notes are calibration, never content: concepts you find hard get explained from first principles, things you know get a passing mention, and problems already solved earlier in the session are never re-explained. The calibration is deliberately invisible — it feels like a tutor who simply knows you.

Session context comes straight from Claude Code's own transcript files on disk (`~/.claude/projects/`) — no hooks into internals, no telemetry. Everything stays on your machine except the two API calls you configured (OpenAI for the text, ElevenLabs for the voice). Generated audio plays from a temp file that is deleted the moment playback ends.

## Personas

A persona is a plain-text style file in [`personas/`](personas/) — edit one, or drop in your own:

| Persona | Character |
|---|---|
| `educator` (default) | Patient, warm; explains unfamiliar concepts with analogies; under a minute |
| `senior-engineer` | Terse status brief: outcome, changes, risks, next step; ~30 seconds |
| `rubber-duck` | Mirrors what happened, then asks you two or three questions worth thinking about |

## Running it today

> ⚖️ Work in progress — the core pipeline works end-to-end as a plugin; the fancier UI is [on the roadmap](#roadmap).

**You need:** Node 22+, a [Claude Code](https://claude.com/claude-code) install, an [ElevenLabs API key](https://elevenlabs.io) (free tier is fine) and an [OpenAI API key](https://platform.openai.com).

```bash
git clone https://github.com/mazder1/CCExplainer
cd CCExplainer
cp .env.example .env     # then put your two keys in .env
```

**As a plugin** (the real experience):

```bash
claude --plugin-dir .
```

…then work normally, and whenever a reply deserves a spoken explanation:

```
/ccexplainer:speak                    # educator explains the last message
/ccexplainer:speak senior-engineer    # or pick a persona
```

**As standalone scripts** (each stage is independently runnable — useful for tinkering):

```bash
node scripts/read-transcript.mjs      # print the latest session as readable text
node scripts/analyze.mjs              # see your own listener notes
node scripts/explain.mjs              # explanation of the last message (text)
node scripts/speak.mjs "Hello there"  # just the voice
node scripts/explain.mjs | node scripts/speak.mjs -   # the whole pipeline, piped
node scripts/viewer.mjs               # karaoke viewer: run in a 2nd terminal pane —
                                      # /speak then highlights each word as it is spoken
```

Useful flags: `--persona <name>`, `--speed 0.7..1.2`, `--voice <elevenlabs-voice-id>`, `--model` (defaults: `eleven_multilingual_v2` for speech — chosen by ear over the faster `eleven_flash_v2_5` — and `gpt-5-mini` for text), `--keep` to keep the MP3, `--no-notes` to skip calibration.

**Bring your own model:** the brain speaks the standard chat-completions dialect, so any OpenAI-compatible provider works — Kimi, DeepSeek, Groq, Anthropic's compatibility endpoint, or a free local model via Ollama. Set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` in `.env`; ready-made recipes are in [.env.example](.env.example).

## Roadmap

- **Karaoke viewer** (next): a companion terminal pane that shows the explanation text and highlights each sentence as the voice speaks it, using ElevenLabs per-character timestamps — so ear and eye never desync. Playback keys (J/K/L) live here too.
- Cross-session learner profile — remember next week what you struggled with today.
- Opt-in auto-narrate via the `Stop` hook.
- Per-persona voice & speed pairing; marketplace packaging.

The original design brief — including ideas since evolved or rejected — is preserved in [BRIEF.md](BRIEF.md).

## Tests

```bash
npm test        # or: node --test
```

Zero test dependencies — the suite runs on Node's built-in test runner, needs no API keys, and never touches the network (providers are faked). CI runs it on Linux and Windows on every push.

## Output-quality evals

Tests prove the plumbing; [`evals/`](evals/) judges the words. Eleven hand-written trap fixtures each tempt one forbidden failure (re-explaining a solved problem, revealing the listener notes, speaking a raw file path…). `npm run eval` generates a real explanation per fixture through the production prompt path, lints it mechanically for free, then has a judge model rule on each trap with quoted evidence — and prints the scorecard as deltas against the committed [`baseline.json`](evals/baseline.json), so any prompt change is answered with "improved / unchanged / REGRESSION" instead of vibes. Costs a few cents per run (uses your configured LLM key); judge provider is overridable via `EVAL_JUDGE_*` env vars.

## Repo layout

```
.claude-plugin/     plugin manifest
skills/             /ccexplainer:speak and friends (slash commands)
scripts/            the pipeline: read-transcript, analyze, explain, speak
scripts/lib/        shared transcript parsing
personas/           editable persona style files
```

## License

[MIT](LICENSE)
