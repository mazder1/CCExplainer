// The mailbox — how the /speak pipeline hands jobs to the karaoke viewer.
//
// Plain files in .ccexplainer/mailbox/, with the guarantees the design
// demands (ACID, pragmatically applied to an ephemeral queue):
//
//   Atomicity   — jobs are written to a .tmp name and RENAMED into place;
//                 a rename on the same volume is all-or-nothing, so the
//                 viewer can never observe half a job file.
//   Consistency — every job carries a version; consumers validate before
//                 acting and discard anything malformed.
//   Isolation   — unique job filenames (time + random); consumers CLAIM a
//                 job by renaming it first, so it can never be played twice
//                 even with two viewers open.
//   Durability  — deliberately relaxed: a karaoke job is worthless seconds
//                 after creation; replaying one after a crash would be a
//                 bug, not a feature.
//
// The viewer also maintains a heartbeat file so the pipeline can tell
// whether anyone is listening before it posts a job.

import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";

export const MAILBOX_DIR = join(".ccexplainer", "mailbox");
export const LOCK_FILE = join(".ccexplainer", "viewer.lock");
export const JOB_VERSION = 1;

export function writeJob(job, dir = MAILBOX_DIR) {
  mkdirSync(dir, { recursive: true });
  const name = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const tmpPath = join(dir, name + ".tmp");
  writeFileSync(tmpPath, JSON.stringify({ version: JOB_VERSION, ...job }));
  renameSync(tmpPath, join(dir, name)); // the atomic moment
  return join(dir, name);
}

// Take the oldest waiting job, or null. Claiming = renaming: whoever wins
// the rename owns the job; a loser's rename throws and they move on.
export function claimNextJob(dir = MAILBOX_DIR) {
  let names;
  try {
    names = readdirSync(dir)
      .filter((f) => f.startsWith("job-") && f.endsWith(".json"))
      .sort();
  } catch {
    return null; // mailbox does not even exist yet
  }
  for (const name of names) {
    const path = join(dir, name);
    const claimed = path + ".claimed";
    try {
      renameSync(path, claimed);
    } catch {
      continue; // another consumer got it first
    }
    try {
      const job = JSON.parse(readFileSync(claimed, "utf8"));
      if (job.version !== JOB_VERSION) throw new Error("unknown job version");
      unlinkSync(claimed);
      return job;
    } catch {
      try {
        unlinkSync(claimed); // malformed: discard, never half-process
      } catch {}
      continue;
    }
  }
  return null;
}

export function touchHeartbeat(lockPath = LOCK_FILE) {
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, time: Date.now() }));
}

export function clearHeartbeat(lockPath = LOCK_FILE) {
  try {
    unlinkSync(lockPath);
  } catch {}
}

export function viewerAlive(maxAgeMs = 6000, lockPath = LOCK_FILE) {
  try {
    const { time } = JSON.parse(readFileSync(lockPath, "utf8"));
    return Date.now() - time < maxAgeMs;
  } catch {
    return false;
  }
}
