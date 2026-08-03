# CCExplainer

[![CI](https://github.com/mazder1/CCExplainer/actions/workflows/ci.yml/badge.svg)](https://github.com/mazder1/CCExplainer/actions/workflows/ci.yml)

**A voice that explains your Claude Code session to you — not a voice that reads it at you.**

Claude Code's built-in text-to-speech reads messages verbatim: every file path, every code identifier, monotonously. CCExplainer takes a different approach: an agent looks at the **last message** Claude sent you (or any earlier one you pick), considers **what you personally tend to struggle with** (learned from your session history), writes a short explanation *for the ear* in a persona of your choice — and speaks it through [ElevenLabs](https://elevenlabs.io) while a terminal pane **highlights each word as it is spoken**, karaoke-style, so ear and eye never lose each other.

## How it works

```
                        ┌──────────────────────────┐
  session history ────▶ │ comprehension analyzer       │  cached, refreshed in the
  (whole story)         │ "what does this user find    │  background — narration
                        │  hard? what do they know?"   │  never waits for it
                        └────────────┬─────────────┘
                                     │ listener notes (never spoken)
                                     ▼
                        ┌──────────────────────────┐      ElevenLabs TTS
  chosen message ─────▶ │ explainer (persona-styled)   │──▶  with per-word     ──▶ 🎤 karaoke viewer
  (the actual subject)  └──────────────────────────┘      timestamps
```

Two model calls with strictly separated jobs: the **analyzer** mines history into *listener notes* (which concepts this user struggles with, what they know, how they like things explained); the **explainer** explains *only the chosen message*, with the notes as invisible calibration — hard concepts get depth, mastered ones get a mention, solved past problems are never re-explained, and the explanation never reveals that notes exist. It is a narrator, never an actor: it reports, it does not offer to change your code.

Session context comes from Claude Code's own transcript files on disk (`~/.claude/projects/`) — no hooks into internals, no telemetry. Everything stays local except the API calls you configured. Audio plays from a temp file deleted after playback; nothing persists.

## The karaoke viewer

A companion terminal pane (auto-opened on first use in Windows Terminal, or run `node scripts/viewer.mjs` yourself, from the repo root). It idles until a narration arrives, then plays the voice and lights up each word at the moment it is spoken — timing comes from ElevenLabs' per-character alignment, not guesswork.

| Keys (idle) | |
|---|---|
| `n` | narrate the targeted message — runs the whole pipeline, no Claude Code needed |
| `←` / `→` | target an older / newer message (with a preview snippet) |
| `1` `2` `3` | persona: educator / senior-engineer / rubber-duck |
| `[` / `]` | voice speaking speed for the next narration (0.7–1.2×) |

| Keys (during speech) | |
|---|---|
| `k` | pause / resume |
| `j` / `l` | jump back / forward 5 seconds (voice and highlight together) |
| `0` | restart the speech |
| `↑` / `↓` | volume |
| `s` | skip · after it ends, the text stays on screen and `r` replays |

## Personas

A persona is a plain-text style file in [`personas/`](personas/) — edit one, or drop in your own:

| Persona | Character |
|---|---|
| `educator` (default) | Patient, warm; explains unfamiliar concepts with analogies; under a minute |
| `senior-engineer` | Terse status brief: outcome, changes, risks, next step; ~30 seconds |
| `rubber-duck` | Mirrors what happened, then asks you two or three questions worth thinking about |

## Running it

**You need:** Node 22+, [Claude Code](https://claude.com/claude-code), an [ElevenLabs API key](https://elevenlabs.io) (free tier is fine) and an LLM API key — OpenAI by default, or any compatible provider (Kimi, DeepSeek, Groq, Anthropic's compatibility endpoint, local Ollama): recipes in [.env.example](.env.example).

```bash
git clone https://github.com/mazder1/CCExplainer
cd CCExplainer
cp .env.example .env     # put your keys in .env
```

**As a plugin** — in this repo or any other project:

```bash
claude --plugin-dir /path/to/CCExplainer     # works from any directory
```

or install it permanently:

```
/plugin marketplace add mazder1/CCExplainer
/plugin install ccexplainer@ccexplainer
```

Keys are read from the current project's `.env` if present, else from the
plugin's own `.env` — configure once, use everywhere. Transcripts, listener
notes and the viewer all resolve per-project automatically.

```
/ccexplainer:speak                     # educator explains the last message
/ccexplainer:speak senior-engineer -2  # persona + offset: two messages back
```

**Without Claude Code at all:** run the viewer (`node scripts/viewer.mjs`) and press `n` — or `npm run speak` for audio-only. Each pipeline stage is also independently runnable for tinkering:

```bash
node scripts/read-transcript.mjs      # print the latest session as readable text
node scripts/analyze.mjs              # see your own listener notes
node scripts/explain.mjs --offset -2  # explanation text for an earlier message
node scripts/speak.mjs "Hello there"  # just the voice
```

Useful flags: `--persona <name>`, `--offset <n>`, `--speed 0.7..1.2`, `--voice <elevenlabs-voice-id>`, `--model`, `--keep` (keep the MP3), `--no-notes` (skip calibration). Defaults: `eleven_multilingual_v2` for speech (chosen by listening test over the faster flash model) and `gpt-5-mini` for text, with reasoning effort tuned per call — full depth where quality matters, low where nobody waits (`LLM_REASONING_EFFORT` overrides).

## Tests

```bash
npm test        # or: node --test
```

Zero test dependencies — Node's built-in runner, no API keys, no network (providers are faked). CI runs Linux + Windows on every push.

## Output-quality evals

Tests prove the plumbing; [`evals/`](evals/) judges the words. Twelve hand-written trap fixtures each tempt one forbidden failure — re-explaining a solved problem, revealing the listener notes, speaking a raw file path, offering to act instead of narrating. `npm run eval` generates a real explanation per fixture **through the production code path**, lints it mechanically for free, then has a judge model rule on each trap with quoted evidence — reported as deltas against the committed [`baseline.json`](evals/baseline.json), so every prompt change is answered with *improved / unchanged / REGRESSION* instead of vibes. The harness has already paid for itself twice: it caught a latency optimization silently degrading rule-following, and a sentence-level embedding experiment surfaced a failure mode (the narrator offering to write code) that no other layer was watching for. Costs a few cents per run; judge provider overridable via `EVAL_JUDGE_*`.

Current baseline: scope, calibration, coherence and lint at ceiling; trap avoidance and faithfulness close behind — exact numbers in [`baseline.json`](evals/baseline.json). Design decisions are probe-driven where possible: explanation length scales with message length per the measured before/after curves in [`evals/length-budgets.md`](evals/length-budgets.md).

## Roadmap

- Verbalized math — formulas spoken as words, not symbols (needs its own eval round)
- Cross-session learner profile — remember next week what you struggled with today
- Opt-in auto-narrate via the `Stop` hook; streaming synthesis for faster first sound
- Marketplace packaging; smoother word-highlight rendering

The original design brief — including ideas since evolved or rejected — is preserved in [BRIEF.md](BRIEF.md).

## Repo layout

```
.claude-plugin/     plugin manifest
skills/             /ccexplainer:speak and friends (slash commands)
scripts/            the pipeline: read-transcript, analyze, explain, speak, viewer
scripts/lib/        shared: transcript parsing, prompt assembly, lint, LLM, TTS, mailbox
personas/           editable persona style files
evals/              trap fixtures, judge runner, baseline, metric experiments
test/               unit tests (npm test)
```

## License

[MIT](LICENSE)
