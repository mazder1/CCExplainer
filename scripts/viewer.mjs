// Wave 6c — the real karaoke viewer.
//
// Run it in a second terminal pane, FROM THE PROJECT ROOT:
//
//   node scripts/viewer.mjs
//
// It idles until /speak (or `... | node scripts/speak.mjs -`) drops a job in
// the mailbox, then plays the audio and highlights each word as the voice
// speaks it. Keys: [s] skip current speech, [q] quit.

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { touchHeartbeat, clearHeartbeat, claimNextJob } from "./lib/mailbox.mjs";

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME_AND_CLEAR = "\x1b[H\x1b[2J";
const DIM = "\x1b[2m";
const HIGHLIGHT = "\x1b[7m";
const RESET = "\x1b[0m";

if (!process.stdout.isTTY) {
  console.error("The viewer needs a real terminal (it draws on the screen).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// State: either idle (watching the mailbox) or speaking one job.
// ---------------------------------------------------------------------------

let job = null; // the job being spoken, or null when idle
let startedAt = 0; // wall-clock ms when audio actually began
let player = null; // child process playing the audio
let audioPath = null; // temp file the player reads
let pollCountdown = 0;

function width() {
  return Math.min(process.stdout.columns ?? 80, 72);
}

function renderIdle() {
  let frame = HOME_AND_CLEAR;
  frame += "CCExplainer viewer\n";
  frame += `${"─".repeat(width())}\n\n`;
  frame += `${DIM}Waiting for /speak …${RESET}\n\n`;
  frame += `${"─".repeat(width())}\n[q] quit\n`;
  process.stdout.write(frame);
}

function renderKaraoke(elapsed) {
  const w = width();
  let frame = HOME_AND_CLEAR;
  frame += `CCExplainer viewer — speaking (${job.duration.toFixed(1)}s)\n`;
  frame += `${"─".repeat(w)}\n\n`;
  let lineLen = 0;
  for (const word of job.words) {
    if (lineLen + word.text.length + 1 > w) {
      frame += "\n";
      lineLen = 0;
    }
    if (elapsed >= word.start && elapsed < word.end) frame += HIGHLIGHT + word.text + RESET;
    else if (elapsed >= word.end) frame += word.text;
    else frame += DIM + word.text + RESET;
    frame += " ";
    lineLen += word.text.length + 1;
  }
  frame += `\n\n${"─".repeat(w)}\n`;
  frame += `${elapsed.toFixed(1)}s / ${job.duration.toFixed(1)}s   [s] skip  [q] quit\n`;
  process.stdout.write(frame);
}

// ---------------------------------------------------------------------------
// Audio playback — same hidden-player technique as speak.mjs, with one
// addition: the player prints START the instant playback truly begins, and
// THAT is when we start the karaoke clock. Spawning a process takes a
// human-noticeable moment; syncing to START instead of to spawn time is
// what keeps the first words aligned.
// ---------------------------------------------------------------------------

function startJob(nextJob) {
  job = nextJob;
  audioPath = join(tmpdir(), `ccexplainer-viewer-${Date.now()}.mp3`);
  writeFileSync(audioPath, Buffer.from(job.audioBase64, "base64"));
  startedAt = Date.now(); // provisional; corrected by START below

  if (process.platform === "win32") {
    const durMs = Math.ceil((job.duration + 0.6) * 1000);
    const psScript = [
      "Add-Type -AssemblyName PresentationCore",
      "$p = New-Object System.Windows.Media.MediaPlayer",
      `$p.Open([Uri](Resolve-Path '${audioPath}').Path)`,
      "$p.Play()",
      "while (-not $p.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 50 }",
      "[Console]::Out.WriteLine('START')",
      `Start-Sleep -Milliseconds ${durMs}`,
      "$p.Close()",
    ].join("; ");
    player = execFile("powershell", ["-NoProfile", "-Command", psScript], { windowsHide: true });
    player.stdout.on("data", (d) => {
      if (String(d).includes("START")) startedAt = Date.now();
    });
  } else {
    player = execFile(process.platform === "darwin" ? "afplay" : "mpg123", [audioPath]);
    startedAt = Date.now();
  }
  player.on("exit", () => {
    try {
      unlinkSync(audioPath);
    } catch {}
  });
}

function stopJob() {
  if (player && player.exitCode === null) player.kill();
  player = null;
  job = null;
}

// ---------------------------------------------------------------------------
// Lifecycle: alternate screen, heartbeat, keys, the loop, clean exit.
// ---------------------------------------------------------------------------

function cleanupAndExit() {
  clearInterval(loop);
  clearInterval(heartbeat);
  stopJob();
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
  if (k === "s" && job) stopJob();
});

touchHeartbeat();
const heartbeat = setInterval(touchHeartbeat, 2000);

const loop = setInterval(() => {
  if (job) {
    const elapsed = (Date.now() - startedAt) / 1000;
    renderKaraoke(elapsed);
    if (elapsed > job.duration + 0.5) stopJob();
  } else {
    if (--pollCountdown <= 0) {
      pollCountdown = 5; // check the mailbox roughly 3x per second
      const next = claimNextJob();
      if (next) {
        startJob(next);
        return;
      }
    }
    renderIdle();
  }
}, 60);
