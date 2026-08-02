// Wave 6c/6d — the karaoke viewer.
//
// Opens automatically on /speak (or run it yourself, from the project root):
//
//   node scripts/viewer.mjs
//
// It idles until the pipeline drops a job in the mailbox, then plays the
// audio and highlights each word as the voice speaks it.
//
// Keys (YouTube-style):
//   [k] pause / resume      [j] back 5s        [l] forward 5s
//   [0] restart speech      [s] skip/dismiss   [q] quit
// After a speech ends the text stays on screen — [r] replays it.

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { touchHeartbeat, clearHeartbeat, claimNextJob } from "./lib/mailbox.mjs";
import { projectTranscriptDir, latestTranscript, readConversation, pickMessageToExplain } from "./lib/transcript.mjs";
import { getListenerNotes, refreshNotesInBackground } from "./analyze.mjs";
import { generateExplanation } from "./lib/explainer.mjs";
import { synthesizeWithTimings } from "./lib/tts.mjs";

try {
  process.loadEnvFile();
} catch {}

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME_AND_CLEAR = "\x1b[H\x1b[2J";
const DIM = "\x1b[2m";
const HIGHLIGHT = "\x1b[1m"; // bold/bright — single-layer highlight: font only, background untouched
const RESET = "\x1b[0m";

if (!process.stdout.isTTY) {
  console.error("The viewer needs a real terminal (it draws on the screen).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// State. mode is one of: "idle" (watching the mailbox), "playing", "done"
// (speech finished, text kept on screen for replay).
//
// The clock is SEEK-AWARE: elapsed = clockOffset + time since startedAt,
// frozen while paused. Every pause/resume/jump updates the pair so the
// highlight always agrees with what the ear hears.
// ---------------------------------------------------------------------------

let mode = "idle";
let job = null;
let player = null;
let audioPath = null;
let startedAt = 0; // wall-clock ms of the last play/resume/seek
let clockOffset = 0; // seconds of speech already "on the clock" at startedAt
let paused = false;
let pollCountdown = 0;
let rate = 1.0; // playback speed multiplier (0.5x .. 2x), survives across jobs
let volume = 1.0; // 0..1, survives across jobs

// Self-service narration: the viewer can run the whole pipeline itself —
// no Claude Code turn involved, fully deterministic. Press [n].
const PERSONAS = ["educator", "senior-engineer", "rubber-duck"];
let currentPersona = PERSONAS[0];
let generating = null; // status line while the pipeline runs, or null
let currentOffset = 0; // 0 = latest assistant message, 1 = one before it, ...

// Cached view of the latest session (re-read at most every 3 s) so arrow-key
// browsing and previews stay snappy without re-parsing a megabyte per press.
let turnsCache = { turns: [], at: 0 };
function sessionTurns() {
  if (Date.now() - turnsCache.at > 3000) {
    try {
      turnsCache = {
        turns: readConversation(latestTranscript(projectTranscriptDir(process.cwd()))),
        at: Date.now(),
      };
    } catch {
      turnsCache = { turns: [], at: Date.now() };
    }
  }
  return turnsCache.turns;
}

function targetLine() {
  if (currentOffset === 0) return null; // default: no noise on screen
  const msg = pickMessageToExplain(sessionTurns(), { offset: currentOffset });
  if (!msg) return `Target: ${currentOffset} back — (no message that far back)`;
  const snippet = msg.text.replace(/\s+/g, " ").slice(0, 58);
  return `Target: ${currentOffset} back — "${snippet}…"`;
}

async function narrate() {
  if (generating || mode === "playing") return;
  try {
    generating = "reading the session…";
    const transcriptPath = latestTranscript(projectTranscriptDir(process.cwd()));
    const turns = readConversation(transcriptPath);
    const msg = pickMessageToExplain(turns, { offset: currentOffset });
    if (!msg) throw new Error(`no assistant message at offset ${currentOffset}`);
    let notes = null;
    try {
      generating = "loading listener notes…";
      const result = await getListenerNotes(transcriptPath, { allowStale: true });
      notes = result.notes;
      if (result.stale) refreshNotesInBackground(transcriptPath); // fresh for next time
    } catch {} // notes are optional — proceed uncalibrated rather than fail
    generating = `writing the script (${currentPersona})…`;
    const gen = await generateExplanation({ personaName: currentPersona, notes, lastMessageText: msg.text });
    generating = "synthesizing voice…";
    const { audio, words, duration } = await synthesizeWithTimings(gen.text, {
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    generating = null;
    startJob({ text: gen.text, words, duration, audioBase64: audio.toString("base64") });
  } catch (err) {
    generating = `error: ${String(err.message).slice(0, 60)}`;
    setTimeout(() => {
      if (generating?.startsWith("error")) generating = null;
    }, 6000);
  }
}

function elapsed() {
  // Speech-position advances at `rate` × wall-clock — the karaoke highlight
  // must follow the sped-up/slowed-down voice, not real time.
  return paused ? clockOffset : clockOffset + ((Date.now() - startedAt) / 1000) * rate;
}

function width() {
  return Math.min(process.stdout.columns ?? 80, 72);
}

// ---------------------------------------------------------------------------
// Rendering — one frame per state, drawn fresh every tick.
// ---------------------------------------------------------------------------

function renderIdle() {
  let frame = HOME_AND_CLEAR;
  frame += "CCExplainer viewer\n";
  frame += `${"─".repeat(width())}\n\n`;
  frame += generating
    ? `♪ ${generating}\n\n`
    : `${DIM}Press [n] to narrate — or use /speak in Claude Code.${RESET}\n\n`;
  const target = targetLine();
  if (target) frame += `${target}\n\n`;
  frame += `${"─".repeat(width())}\n[n] narrate  [←/→] older/newer msg  [1/2/3] persona: ${currentPersona}  [q] quit\n`;
  process.stdout.write(frame);
}

function renderWords(t) {
  const w = width();
  let out = "";
  let lineLen = 0;
  for (const word of job.words) {
    if (lineLen + word.text.length + 1 > w) {
      out += "\n";
      lineLen = 0;
    }
    if (t >= word.start && t < word.end) out += HIGHLIGHT + word.text + RESET;
    else if (t >= word.end) out += word.text;
    else out += DIM + word.text + RESET;
    out += " ";
    lineLen += word.text.length + 1;
  }
  return out;
}

function renderPlaying() {
  const t = elapsed();
  let frame = HOME_AND_CLEAR;
  frame += `CCExplainer viewer — ${paused ? "⏸ paused" : "speaking"}\n`;
  frame += `${"─".repeat(width())}\n\n`;
  frame += renderWords(t);
  frame += `\n\n${"─".repeat(width())}\n`;
  frame += `${t.toFixed(1)}s / ${job.duration.toFixed(1)}s   ${rate.toFixed(2)}x   vol ${Math.round(volume * 100)}%\n`;
  frame += `[k] ${paused ? "resume" : "pause"}  [j/l] -/+5s  [↑/↓] volume  [[/]] speed  [0] restart  [s] skip  [q] quit\n`;
  process.stdout.write(frame);
}

function renderDone() {
  let frame = HOME_AND_CLEAR;
  frame += "CCExplainer viewer — finished\n";
  frame += `${"─".repeat(width())}\n\n`;
  frame += renderWords(Infinity); // everything "already spoken": plain text
  frame += `\n\n${"─".repeat(width())}\n`;
  const target = targetLine();
  if (target) frame += `${target}\n`;
  frame += generating
    ? `♪ ${generating}\n`
    : `[r] replay  [n] narrate  [←/→] older/newer  [1/2/3] persona: ${currentPersona}  [s] dismiss  [q] quit\n`;
  process.stdout.write(frame);
}

// ---------------------------------------------------------------------------
// The audio player — a hidden PowerShell process we now COMMAND over stdin:
// PAUSE / PLAY / SEEK <ms>. It prints START the instant audio truly begins,
// which is when the karaoke clock starts. (On macOS/Linux the fallback
// players cannot seek — playback works, J/K/L quietly do not.)
// ---------------------------------------------------------------------------

function startJob(nextJob) {
  job = nextJob;
  mode = "playing";
  paused = false;
  clockOffset = 0;
  startedAt = Date.now(); // provisional; corrected by START
  audioPath = join(tmpdir(), `ccexplainer-viewer-${Date.now()}.mp3`);
  writeFileSync(audioPath, Buffer.from(job.audioBase64, "base64"));

  if (process.platform === "win32") {
    // Windows Media Player COM — NOT WPF MediaPlayer: that engine mutes the
    // audio track whenever SpeedRatio differs from 1.0. WMP has real
    // variable-speed playback (settings.rate), volume and seeking.
    const psScript = [
      "$w = New-Object -ComObject WMPlayer.OCX",
      "$w.settings.autoStart = $false",
      `$w.URL = (Resolve-Path '${audioPath}').Path`,
      `$w.settings.rate = ${Math.round(rate * 100)} / 100`,
      `$w.settings.volume = ${Math.round(volume * 100)}`,
      "$w.controls.play()",
      "$tries = 0; while ($w.playState -ne 3 -and $tries -lt 100) { Start-Sleep -Milliseconds 50; $tries++ }",
      "[Console]::Out.WriteLine('START')",
      "while ($true) { $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }; $parts = $line.Split(' '); if ($parts[0] -eq 'PAUSE') { $w.controls.pause() } elseif ($parts[0] -eq 'PLAY') { $w.controls.play() } elseif ($parts[0] -eq 'SEEK') { $w.controls.currentPosition = [int]$parts[1] / 1000 } elseif ($parts[0] -eq 'RATE') { $w.settings.rate = [int]$parts[1] / 100 } elseif ($parts[0] -eq 'VOL') { $w.settings.volume = [int]$parts[1] } }",
      "$w.controls.stop()",
    ].join("; ");
    player = execFile("powershell", ["-NoProfile", "-Command", psScript], { windowsHide: true });
    player.stdout.on("data", (d) => {
      if (String(d).includes("START")) startedAt = Date.now();
    });
  } else {
    player = execFile(process.platform === "darwin" ? "afplay" : "mpg123", [audioPath]);
  }
  player.on("exit", () => {
    try {
      unlinkSync(audioPath);
    } catch {}
  });
}

function commandPlayer(line) {
  if (player?.stdin?.writable) player.stdin.write(line + "\n");
}

function stopPlayer() {
  if (player) {
    try {
      player.stdin?.end(); // polite: lets the player Close() cleanly
    } catch {}
    if (player.exitCode === null) player.kill();
  }
  player = null;
}

// ---------------------------------------------------------------------------
// The controls — each one updates the player AND the clock together.
// ---------------------------------------------------------------------------

function togglePause() {
  if (paused) {
    startedAt = Date.now();
    paused = false;
    commandPlayer("PLAY");
  } else {
    clockOffset = elapsed();
    paused = true;
    commandPlayer("PAUSE");
  }
}

function seekTo(seconds) {
  const t = Math.min(Math.max(seconds, 0), Math.max(job.duration - 0.05, 0));
  commandPlayer(`SEEK ${Math.round(t * 1000)}`);
  clockOffset = t;
  startedAt = Date.now();
}

function setRate(newRate) {
  clockOffset = elapsed(); // freeze the clock at the old rate first
  startedAt = Date.now();
  rate = Math.min(2, Math.max(0.5, Math.round(newRate * 100) / 100));
  commandPlayer(`RATE ${Math.round(rate * 100)}`);
}

function setVolume(v) {
  volume = Math.min(1, Math.max(0, Math.round(v * 10) / 10));
  commandPlayer(`VOL ${Math.round(volume * 100)}`);
}

function finishJob() {
  stopPlayer();
  mode = "done"; // keep the text on screen — the user may want to re-read or replay
}

function dismissJob() {
  stopPlayer();
  job = null;
  mode = "idle";
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

function cleanupAndExit() {
  clearInterval(loop);
  clearInterval(heartbeat);
  stopPlayer();
  clearHeartbeat();
  process.stdout.write(RESET + CURSOR_SHOW + ALT_SCREEN_OFF);
  process.exit(0);
}

process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (key) => {
  const k = key.toString();
  if (k === "q" || k === "\x03") cleanupAndExit();
  if (mode === "playing") {
    if (k === "k") togglePause();
    if (k === "j") seekTo(elapsed() - 5);
    if (k === "l") seekTo(elapsed() + 5);
    if (k === "0") seekTo(0);
    if (k === "s") dismissJob();
    if (k === "[") setRate(rate - 0.25);
    if (k === "]") setRate(rate + 0.25);
    if (k === "\x1b[A") setVolume(volume + 0.1); // up arrow
    if (k === "\x1b[B") setVolume(volume - 0.1); // down arrow
  } else if (mode === "done") {
    if (k === "r") startJob(job);
    if (k === "s") dismissJob();
  }
  if (mode !== "playing") {
    if (k === "n") narrate();
    const personaKey = ["1", "2", "3"].indexOf(k);
    if (personaKey !== -1) currentPersona = PERSONAS[personaKey];
    if (k === "\x1b[D") {
      // left arrow: older — but never past the oldest assistant message
      const max = sessionTurns().filter((t) => t.role === "CLAUDE").length - 1;
      currentOffset = Math.min(currentOffset + 1, Math.max(max, 0));
    }
    if (k === "\x1b[C") currentOffset = Math.max(0, currentOffset - 1); // right: newer
  }
});

touchHeartbeat();
const heartbeat = setInterval(touchHeartbeat, 2000);

const loop = setInterval(() => {
  if (mode === "playing") {
    renderPlaying();
    if (!paused && elapsed() > job.duration + 0.5) finishJob();
  } else {
    // idle and done both keep watching the mailbox for the next speech
    if (--pollCountdown <= 0) {
      pollCountdown = 5;
      const next = claimNextJob();
      if (next) {
        stopPlayer();
        startJob(next);
        return;
      }
    }
    if (mode === "done") renderDone();
    else renderIdle();
  }
}, 60);
