# CCExplainer — Adaptive Voice Summaries for Claude Code

*Design brief · v0.2 · 2026-08-02*

## 1. Vision

Claude Code's built-in text-to-speech reads messages verbatim and reads them badly. CCExplainer is a Claude Code enhancement (a plugin, in the same spirit as WOZCODE) that replaces "read the text aloud" with **"have a tutor explain it to me aloud."**

On demand, an agent:

1. Reads the **current session context** (what you and Claude have been doing).
2. Consults a persistent **learner profile** — built from your past sessions — that records which concepts you've struggled with, asked about repeatedly, or already mastered.
3. Writes a **spoken-word script** in a configurable persona (e.g. *Educator* explains unfamiliar concepts in simple terms; *Senior Engineer* gives a terse status brief).
4. Speaks it through **ElevenLabs** TTS, with user-controlled voice, speed, and style.

The key differentiator: it doesn't read what was written — it decides *how to present the knowledge to you specifically*, based on evidence of what you do and don't understand.

## 2. Core user flow

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ Claude Code session      │        │ CCExplainer panel (localhost web UI)│
│ (user working normally)  │        │  [▶ Speak summary]            │
│                          │        │  persona: Educator ▾          │
│ transcript JSONL on disk │───────▶│  speed: 1.0×  voice: Rachel ▾ │
└─────────────────────────┘        │  ⏯ audio player               │
                                    └──────────────────────────────┘
```

1. User works in Claude Code as usual.
2. When they want a spoken recap (of the last reply, or the whole session), they click **Speak** in the CCExplainer panel — a small always-available browser page served locally by the plugin — or type `/speak` in the session.
3. Within a few seconds, audio starts playing: a personalized, persona-voiced explanation of what happened and what it means.

Why a browser panel: Claude Code runs in a terminal — there are no clickable buttons to add. A localhost web panel gives us real buttons, sliders, an audio player, and persona pickers without building a desktop app. The `/speak` slash command covers keyboard-first users.

## 3. Architecture

```
            ┌────────────────────────────────────────────────────┐
            │                CCExplainer plugin (Node/TypeScript)        │
            │                                                      │
 ~/.claude/ │  ┌────────────┐   ┌──────────────┐   ┌───────────┐  │
 projects/  │  │ Transcript │──▶│ Summarizer   │──▶│ TTS       │  │   ElevenLabs
 <session>  │──▶ Reader     │   │ Agent        │   │ Adapter   │──┼──▶ API
 .jsonl     │  │ (watcher)  │   │ (Claude API) │   │ (stream)  │  │
            │  └────────────┘   └──────┬───────┘   └─────┬─────┘  │
            │                          │                 │        │
            │  ┌────────────────┐      │           ┌─────▼─────┐  │
            │  │ Learner Profile│◀─────┘           │ Local HTTP│  │   Browser
            │  │ store (JSON)   │                  │ server +  │──┼──▶ panel
            │  └────────────────┘                  │ SSE/audio │  │   (buttons,
            │                                      └───────────┘  │    player)
            └────────────────────────────────────────────────────┘
```

### Components

**Transcript Reader.** Claude Code persists every session as JSONL under `~/.claude/projects/<project-slug>/<session-id>.jsonl`. The reader tails the active session file, reconstructs the conversation (user messages, assistant text, tool activity at a coarse level), and exposes two scopes: *last exchange* and *whole session*. No hooks into Claude Code internals needed — the transcript on disk **is** the session context.

**Summarizer Agent** (Claude API). One API call per speak-request. Inputs: the selected transcript scope, the active persona's prompt template, and the relevant slice of the learner profile. Output: a script written *for the ear*, not the eye — no code blocks read aloud, no markdown, file names spoken naturally, ElevenLabs audio tags (e.g. `[pause]`, emphasis) where the model supports them. Model: `claude-opus-5` ($5/$25 per MTok) for quality of pedagogy; a config option can drop to `claude-haiku-4-5` for cheap quick-briefs.

**Learner Profile.** A per-user JSON store (`~/.ccexplainer/profile.json`) of concept-level comprehension evidence, e.g.:

```json
{
  "concepts": {
    "react-useEffect-deps": {
      "signal": "struggled",
      "evidence": ["asked for re-explanation 2026-07-28", "same bug recurred twice"],
      "last_seen": "2026-07-30"
    },
    "sql-joins": { "signal": "mastered", "last_seen": "2026-07-12" }
  }
}
```

It is updated by a lightweight **profiling pass**: after each speak-request (or on a schedule), a cheap model (`claude-haiku-4-5`) scans the recent transcript for comprehension signals — repeated questions on the same topic, "I don't understand", corrections the user needed twice, topics the user handled confidently — and upserts concept entries. The Summarizer then *adapts*: concepts marked "struggled" get slowed down and explained from first principles; "mastered" concepts are mentioned, not re-taught.

**Personas.** A persona = prompt template + voice configuration, stored in `~/.ccexplainer/personas/*.json`. Shipped defaults:

| Persona | Style | Voice settings |
|---|---|---|
| Educator | Explains unfamiliar concepts simply, uses analogies, checks-your-understanding phrasing | expressive model, speed 0.95 |
| Senior Engineer | Terse status brief: what changed, what's risky, what's next | fast model, speed 1.1 |
| Rubber Duck | Narrates the reasoning and asks reflective questions | expressive model, speed 1.0 |

Users can create their own personas (any prompt + any ElevenLabs voice).

**TTS Adapter** (ElevenLabs). Two quality tiers, selected per persona:

- **`eleven_flash_v2_5`** — ~75 ms model latency, cheapest; for quick briefs.
- **`eleven_v3` / `eleven_multilingual_v2`** — most expressive (v3 supports inline audio tags for delivery control); for the Educator persona where delivery matters.

Speed is controlled via `voice_settings.speed` (≈0.7–1.2) so "suit the speed to the listener" is a native API knob, not audio post-processing. For minimum time-to-first-audio, the adapter can pipe the Claude response **stream** into ElevenLabs' WebSocket streaming-input endpoint, so speech starts before the script is fully written. (Exact endpoint/parameter names to be re-verified against current ElevenLabs docs at implementation time.)

**Local server + panel.** A small HTTP server (Express/Fastify, bound to `127.0.0.1`) serving a single-page panel: speak button (scope: last reply / whole session), persona dropdown, voice + speed controls, audio player, and a history of past summaries. Server pushes state via SSE. The Claude Code plugin also registers a `/speak [scope] [persona]` slash command that triggers the same pipeline.

### Packaging

Distributed as a **Claude Code plugin**: a skill providing `/speak` (+ `/ccexplainer` for settings), and a background process (the server) started on demand. Configuration (API keys for Anthropic + ElevenLabs, default persona/voice/speed) lives in `~/.ccexplainer/config.json`; keys via environment variables (`ELEVENLABS_API_KEY`, standard Anthropic credential resolution).

## 4. API choices

| Purpose | API | Choice | Why |
|---|---|---|---|
| Summarization + persona scripting | Anthropic Messages API | `claude-opus-5`, streaming, prompt caching on persona/profile prefix | Best pedagogy per dollar; caching cuts repeat-summary cost ~90% |
| Comprehension profiling | Anthropic Messages API | `claude-haiku-4-5` | Cheap classification-style pass, runs often |
| Text-to-speech | ElevenLabs TTS | `eleven_flash_v2_5` (fast) / `eleven_v3` (expressive) | Latency vs delivery-quality tiering; native speed control; streaming input |
| Session context | none (filesystem) | Claude Code transcript JSONL | Zero-integration source of truth for session state |

**Rough cost per spoken summary** (whole-session scope, ~20K input tokens, ~600-token script, ~1,800 characters of speech): Claude ≈ $0.10–0.12 (far less with caching on repeat requests in a session); ElevenLabs ≈ 900–1,800 credits depending on model (a $22/mo Creator plan covers ~50–100 educator-quality summaries). Quick-brief persona on Haiku + Flash costs roughly a tenth of that.

## 5. Milestones

| Phase | Deliverable | Proves |
|---|---|---|
| **0 — Spike** | CLI script: read latest session transcript → Claude summary → ElevenLabs MP3 → play | End-to-end pipeline works; script quality is good enough to keep going |
| **1 — Plugin** | `/speak` slash command, config file, persona templates, speed control | Usable daily inside Claude Code |
| **2 — Panel** | Localhost web panel with buttons, audio player, persona/voice/speed UI, summary history | The "click a button" experience |
| **3 — Adaptive** | Learner profile store + profiling pass + profile-aware summarization | The differentiator: explanations tuned to what *you* struggle with |
| **4 — Polish** | Streaming TTS (speech starts <2 s after click), cross-session profile insights ("you've hit this concept 3 times this week"), persona marketplace/export | Latency + delight |

## 6. Risks & open questions

- **Transcript format stability.** The JSONL schema is internal to Claude Code and can change between versions. Mitigation: defensive parser + version pinning note; only depend on coarse fields (role, text content, timestamps).
- **Latency budget.** Whole-session summarization over a long transcript can take 10–20 s before audio starts. Mitigations: prompt caching on the transcript prefix, streaming Claude → streaming TTS, and an incremental mode that summarizes only the delta since the last speak.
- **Profile cold start.** The learner profile is empty at first, so early summaries aren't personalized. Acceptable — personas still provide value on day one; optionally offer a one-time backfill pass over recent session history.
- **Privacy.** Transcripts contain code and possibly secrets. All processing stays local except the two API calls (Anthropic, ElevenLabs); the panel binds to localhost only; the profile stores *concept names*, never code snippets.
- **Open:** Should the profiling pass run per-project or globally per-user? (Proposed: global profile with per-project concept tags.) Should `/speak` also be triggerable automatically after each Claude reply (an "auto-narrate" mode)? (Proposed: yes, as an opt-in toggle in Phase 2.)

## 7. Proposed stack

TypeScript / Node 22 · `@anthropic-ai/sdk` · `@elevenlabs/elevenlabs-js` · Fastify (localhost server) · plain HTML/JS panel (no framework needed at this size) · packaged as a Claude Code plugin.
