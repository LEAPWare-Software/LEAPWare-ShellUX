import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_BACKUPS,
  MAX_BYTES,
  logFilePath,
  writeDiagnosticsEntry,
} from '../main/diagnosticsLog';
import type { DiagnosticsFs, DiagnosticsEntry } from '../main/diagnosticsLog';

/**
 * ============================================================================
 * ROTATION, EXERCISED AGAINST AN IN-MEMORY FAKE — NOT THE REAL FILESYSTEM.
 * ============================================================================
 * `DiagnosticsFs` is the seam `electron/main/diagnosticsLog.ts` takes exactly so
 * this file does not stub `node:fs` globally: CLAUDE.md's coverage rule treats a
 * green jsdom-style suite that never observed the real behaviour as worse than
 * no test, and a fake that models rename/unlink/append as string-map operations
 * is the same discipline applied to a filesystem instead of a DOM.
 *
 * Paths are built with `node:path`'s own `join`, not written as literal forward
 * slashes: `diagnosticsLog.ts` builds every path with `join`, which emits `\`
 * on Windows, and a fixture hard-coding `/` would fail on the platform ADR-0002
 * is written to keep this suite honest about.
 *
 * `electron/**` is outside the 100% coverage gate (`vitest.config.ts`'s
 * `coverage.include` is `src/core/**`, `src/components/**`, `src/hooks/**`
 * only), so this suite is written to be complete by inspection rather than
 * because a gate demands it.
 * ============================================================================
 */

const LOGS_DIR = join('logs');
const LIVE = join(LOGS_DIR, 'diagnostics.log');
const BACKUP1 = join(LOGS_DIR, 'diagnostics.log.1');
const BACKUP2 = join(LOGS_DIR, 'diagnostics.log.2');
const BACKUP3 = join(LOGS_DIR, 'diagnostics.log.3');

function makeFakeFs(initial: Record<string, string> = {}): DiagnosticsFs & { files: Record<string, string> } {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    existsSync: (path: string): boolean => Object.hasOwn(files, path),
    statSync: (path: string): { size: number } => ({ size: files[path]?.length ?? 0 }),
    renameSync: (from: string, to: string): void => {
      const content = files[from];
      if (content === undefined) throw new Error(`fake fs: rename of missing file ${from}`);
      files[to] = content;
      delete files[from];
    },
    unlinkSync: (path: string): void => {
      if (!Object.hasOwn(files, path)) throw new Error(`fake fs: unlink of missing file ${path}`);
      delete files[path];
    },
    appendFileSync: (path: string, data: string): void => {
      files[path] = (files[path] ?? '') + data;
    },
  };
}

const ENTRY: DiagnosticsEntry = { source: 'main', kind: 'uncaughtException', message: 'boom' };

describe('logFilePath', () => {
  it('names the live file with no suffix', () => {
    expect(logFilePath(LOGS_DIR)).toBe(LIVE);
  });

  it('names a backup with its numeric suffix', () => {
    expect(logFilePath(LOGS_DIR, 1)).toBe(BACKUP1);
    expect(logFilePath(LOGS_DIR, 2)).toBe(BACKUP2);
  });
});

describe('writeDiagnosticsEntry', () => {
  it('creates the live file on the first write', () => {
    const fs = makeFakeFs();
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    expect(fs.files[LIVE]).toContain('"message":"boom"');
  });

  it('appends rather than replacing on a second write', () => {
    const fs = makeFakeFs();
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    writeDiagnosticsEntry(fs, LOGS_DIR, { ...ENTRY, message: 'second' });
    const lines = fs.files[LIVE]!.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"message":"second"');
  });

  it('serialises every field, including the optional ones', () => {
    const fs = makeFakeFs();
    const entry: DiagnosticsEntry = {
      source: 'renderer-chrome',
      kind: 'window.onerror',
      message: 'oops',
      stack: 'Error: oops\n  at x',
      filename: 'app.js',
      lineno: 12,
      colno: 3,
    };
    writeDiagnosticsEntry(fs, LOGS_DIR, entry);
    const parsed = JSON.parse(fs.files[LIVE]!.trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject(entry);
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('rotates the live file to .1 when the next write would exceed the cap', () => {
    const fs = makeFakeFs({ [LIVE]: 'x'.repeat(MAX_BYTES) });
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    expect(fs.files[BACKUP1]).toBe('x'.repeat(MAX_BYTES));
    expect(fs.files[LIVE]).toContain('"message":"boom"');
  });

  it('shifts every backup up by one and drops the oldest', () => {
    const fs = makeFakeFs({
      [LIVE]: 'x'.repeat(MAX_BYTES),
      [BACKUP1]: 'first-backup',
      [BACKUP2]: 'oldest-backup',
    });
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    expect(fs.files[BACKUP1]).toBe('x'.repeat(MAX_BYTES));
    expect(fs.files[BACKUP2]).toBe('first-backup');
    expect(fs.files[BACKUP3]).toBeUndefined();
    expect(Object.values(fs.files)).not.toContain('oldest-backup');
  });

  it('does not rotate when the live file is absent', () => {
    const fs = makeFakeFs();
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    expect(fs.files[BACKUP1]).toBeUndefined();
  });

  it('does not rotate when the write still fits under the cap', () => {
    const fs = makeFakeFs({ [LIVE]: 'small' });
    writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY);
    expect(fs.files[BACKUP1]).toBeUndefined();
    expect(fs.files[LIVE]).toContain('small');
  });

  it('swallows a filesystem failure rather than throwing', () => {
    const fs: DiagnosticsFs = {
      existsSync: () => {
        throw new Error('disk is gone');
      },
      statSync: () => ({ size: 0 }),
      renameSync: () => undefined,
      unlinkSync: () => undefined,
      appendFileSync: () => undefined,
    };
    expect(() => writeDiagnosticsEntry(fs, LOGS_DIR, ENTRY)).not.toThrow();
  });

  it('has a backup count of exactly MAX_BACKUPS constants used by the module', () => {
    // Guards the fixture above against MAX_BACKUPS changing silently underneath it.
    expect(MAX_BACKUPS).toBe(2);
  });
});
