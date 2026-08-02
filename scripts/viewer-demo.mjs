// Wave 6b — the repainting proof.
//
// A toy karaoke viewer: displays a paragraph and moves a word-level
// highlight through it on a FAKE clock — no audio, no ElevenLabs, no cost.
// Its only job is to prove we can animate a terminal. The real viewer (6c)
// will reuse this rendering with real timings and real audio.
//
//   node scripts/viewer-demo.mjs           -> run the animation
//   keys: [r] replay, [q] or Ctrl+C quit

const DEMO_TEXT =
  "This is the karaoke viewer rehearsing without any audio. Every word lights " +
  "up on a pretend clock, timed roughly the way a voice would speak it. When " +
  "the real voice arrives, only the clock changes and the rest of this code " +
  "stays exactly the same.";

// ---------------------------------------------------------------------------
// Fake timings — shaped exactly like wordsFromAlignment() output in 6a:
// [{text, start, end}]. Longer words "take longer to say"; small gaps
// between words imitate the voice's natural micro-pauses.
// ---------------------------------------------------------------------------

function fakeTimings(text) {
  const words = [];
  let t = 0;
  for (const w of text.split(/\s+/)) {
    const duration = 0.12 + w.length * 0.045;
    words.push({ text: w, start: t, end: t + duration });
    t += duration + 0.05;
  }
  return words;
}

// ---------------------------------------------------------------------------
// ANSI escape codes — the terminal's command language. Each is a string
// that the terminal OBEYS instead of printing.
// ---------------------------------------------------------------------------

const ALT_SCREEN_ON = "\x1b[?1049h"; // switch to the blank second screen
const ALT_SCREEN_OFF = "\x1b[?1049l"; // and back, restoring the user's shell
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME_AND_CLEAR = "\x1b[H\x1b[2J"; // cursor to top-left, wipe screen
const DIM = "\x1b[2m"; // upcoming words: faint
const HIGHLIGHT = "\x1b[7m"; // current word: inverted colors
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Rendering: one function draws the ENTIRE frame from the current time.
// No partial updates, no cleverness — "state in, picture out", ~20x/second.
// ---------------------------------------------------------------------------

function render(words, elapsed, done) {
  const width = Math.min(process.stdout.columns ?? 80, 72);
  let frame = HOME_AND_CLEAR;
  frame += `CCExplainer viewer — 6b demo (fake clock, no audio)\n`;
  frame += `${"─".repeat(width)}\n\n`;

  let lineLen = 0;
  for (const w of words) {
    if (lineLen + w.text.length + 1 > width) {
      frame += "\n";
      lineLen = 0;
    }
    if (elapsed >= w.start && elapsed < w.end) {
      frame += HIGHLIGHT + w.text + RESET; // being "spoken" right now
    } else if (elapsed >= w.end) {
      frame += w.text; // already "spoken": plain
    } else {
      frame += DIM + w.text + RESET; // still coming: faint
    }
    frame += " ";
    lineLen += w.text.length + 1;
  }

  frame += `\n\n${"─".repeat(width)}\n`;
  frame += done
    ? "done — [r] replay, [q] quit\n"
    : `${elapsed.toFixed(1)}s   [r] restart, [q] quit\n`;
  process.stdout.write(frame);
}

// ---------------------------------------------------------------------------
// The loop: check the clock, redraw, repeat. Plus keys and a clean exit —
// ALWAYS restore the terminal, even on Ctrl+C, or we leave the user's
// terminal in a broken state (the cardinal sin of TUI programs).
// ---------------------------------------------------------------------------

if (!process.stdout.isTTY) {
  console.error("This demo needs a real terminal (it draws on the screen).");
  process.exit(1);
}

const words = fakeTimings(DEMO_TEXT);
const total = words.at(-1).end;
let startedAt = Date.now();

function cleanupAndExit() {
  clearInterval(timer);
  process.stdout.write(RESET + CURSOR_SHOW + ALT_SCREEN_OFF);
  process.exit(0);
}

process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
process.stdin.setRawMode(true); // keys reach us instantly, unbuffered
process.stdin.resume();
process.stdin.on("data", (key) => {
  const k = key.toString();
  if (k === "q" || k === "\x03") cleanupAndExit(); // \x03 = Ctrl+C in raw mode
  if (k === "r") startedAt = Date.now();
});

const timer = setInterval(() => {
  const elapsed = (Date.now() - startedAt) / 1000;
  render(words, elapsed, elapsed > total);
}, 50);
