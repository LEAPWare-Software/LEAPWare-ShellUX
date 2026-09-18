import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ============================================================================
 * THE LOCAL LOG. SIZE-BOUNDED, ROTATING, AND THE ONLY PLACE A FAILURE GOES.
 * ============================================================================
 * GitHub issue #86: nothing in this application reports a failure to anyone.
 * `console.error` is not a report — nobody is watching a packaged application's
 * console — and the two failure classes this module exists for,
 * `uncaughtException`/`unhandledRejection` in the main process and a renderer's
 * `error`/`unhandledrejection` forwarded over IPC, currently reach neither a user
 * nor a maintainer. This closes that: every entry below is a write to one file
 * under `app.getPath('logs')`, and nothing here ever makes a network call — the
 * failure mode this repairs is "undetectable", not "unreported to a vendor",
 * and issue #86 is explicit that no telemetry SDK is being asked for.
 *
 * ---------------------------------------------------------------------------
 * ROTATION, WRITTEN HERE RATHER THAN TAKEN FROM A DEPENDENCY.
 * ---------------------------------------------------------------------------
 * `package.json` is not this change's to edit — a new dependency for one rotating
 * file is a decision for whoever owns that file — so rotation is the plain
 * scheme a log file has used since before any package existed for it: cap the
 * live file at a byte size, and when a write would exceed it, shift the live
 * file to `.1`, an existing `.1` to `.2`, up to `MAX_BACKUPS`, and drop whatever
 * falls off the end. The check runs before the write that would overflow, not
 * after, so the live file never exceeds `MAX_BYTES` by more than one entry.
 *
 * ---------------------------------------------------------------------------
 * THE FILESYSTEM IS INJECTED, NOT IMPORTED DIRECTLY.
 * ---------------------------------------------------------------------------
 * A test that wants to observe rotation cannot stub `node:fs` globally without
 * doing the thing CLAUDE.md's coverage rule forbids — reaching into the runtime
 * rather than the module under test. `DiagnosticsFs` is the seam: production
 * code gets `nodeDiagnosticsFs`, a test gets an in-memory fake it can inspect
 * after every call.
 * ============================================================================
 */

/** The filesystem operations rotation needs, and nothing else. */
export interface DiagnosticsFs {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { size: number };
  renameSync: (from: string, to: string) => void;
  unlinkSync: (path: string) => void;
  appendFileSync: (path: string, data: string) => void;
}

/** The real filesystem. What production code passes. */
export const nodeDiagnosticsFs: DiagnosticsFs = {
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  appendFileSync,
};

/** One entry, before it is serialised. */
export interface DiagnosticsEntry {
  readonly source: 'main' | 'renderer-chrome' | 'renderer-extension';
  readonly kind: string;
  readonly message: string;
  readonly stack?: string | null;
  readonly filename?: string | null;
  readonly lineno?: number | null;
  readonly colno?: number | null;
}

/** 1 MiB. Large enough to hold a real crash's stack several times over. */
export const MAX_BYTES = 1_048_576;

/** `diagnostics.log`, `diagnostics.log.1`, `diagnostics.log.2`. Nothing older survives. */
export const MAX_BACKUPS = 2;

const LOG_FILE_NAME = 'diagnostics.log';

/** Where the live file and its backups live, given the log directory root. */
export function logFilePath(logsDir: string, backup = 0): string {
  return backup === 0 ? join(logsDir, LOG_FILE_NAME) : join(logsDir, `${LOG_FILE_NAME}.${String(backup)}`);
}

/**
 * Shift `diagnostics.log.1` → `.2` → dropped, then the live file → `.1`.
 *
 * Walked from the oldest backup down, so a rename never clobbers a file this
 * function has not yet moved out of the way.
 */
function rotate(fs: DiagnosticsFs, logsDir: string): void {
  const oldestPath = logFilePath(logsDir, MAX_BACKUPS);
  if (fs.existsSync(oldestPath)) fs.unlinkSync(oldestPath);
  for (let backup = MAX_BACKUPS - 1; backup >= 0; backup -= 1) {
    const from = logFilePath(logsDir, backup);
    if (!fs.existsSync(from)) continue;
    fs.renameSync(from, logFilePath(logsDir, backup + 1));
  }
}

/**
 * Append one entry as a line of JSON, rotating first if the live file is
 * already at or over the cap.
 *
 * Every failure here is swallowed rather than thrown: a logger that can bring
 * the process down is worse than the silence it was written to replace, which
 * is the same argument `shelluxHost`'s listener containment already makes for a
 * subscriber that throws.
 */
export function writeDiagnosticsEntry(fs: DiagnosticsFs, logsDir: string, entry: DiagnosticsEntry): void {
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`;
  try {
    const target = logFilePath(logsDir);
    if (fs.existsSync(target) && fs.statSync(target).size + line.length > MAX_BYTES) {
      rotate(fs, logsDir);
    }
    fs.appendFileSync(target, line);
  } catch {
    // Best-effort. A logging failure must not become the failure being logged.
  }
}
