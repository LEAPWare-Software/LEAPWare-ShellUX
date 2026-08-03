import { describe, expect, it, vi } from 'vitest';
import {
  HOST_UPDATE_LABELS,
  hostUpdateCommands,
} from '../hostUpdates';
import type { HostUpdateStatus, HostUpdates } from '../hostUpdates';

/**
 * ============================================================================
 * THE UPDATE COMMANDS, WITHOUT A SHELL AROUND THEM.
 * ============================================================================
 * `hostUpdateCommands` is a pure function of one nullable record, which is why
 * it is a module of its own rather than four lines inside `ShellLayout.tsx`. The
 * whole matrix — seven statuses, present and absent host — is asserted here at
 * the cost of one import, and the shell integration is a spread that carries no
 * decision of its own.
 *
 * The status list below is written out rather than derived from the union,
 * because a list derived from the thing under test cannot notice a member being
 * removed from it. `HOST_UPDATE_LABELS` is a `Record` over the union, so the
 * compiler already refuses an incomplete table; this list is the runtime half of
 * the same statement and the first assertion pins the two together.
 * ============================================================================
 */

const ALL_STATUSES: readonly HostUpdateStatus[] = [
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'error',
  'unsupported',
];

function updatesAt(status: HostUpdateStatus): {
  updates: HostUpdates;
  check: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
} {
  const check = vi.fn();
  const restart = vi.fn();
  return {
    updates: { state: { status, version: null, detail: null }, check, restart },
    check,
    restart,
  };
}

describe('hostUpdateCommands', () => {
  it('describes every status the union declares and invents none', () => {
    expect(Object.keys(HOST_UPDATE_LABELS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('offers nothing when there is no native host', () => {
    expect(hostUpdateCommands(null)).toEqual([]);
  });

  it('offers nothing in a development run, where an updater cannot exist', () => {
    expect(hostUpdateCommands(updatesAt('unsupported').updates)).toEqual([]);
  });

  for (const status of ALL_STATUSES.filter((candidate) => candidate !== 'unsupported')) {
    it(`offers the check command when the status is ${status}`, () => {
      const commands = hostUpdateCommands(updatesAt(status).updates);
      expect(commands[0]?.id).toBe('host-check-for-updates');
      expect(commands[0]?.label).toBe(HOST_UPDATE_LABELS[status]);
      expect(commands[0]?.surfaces).toEqual(['palette']);
    });
  }

  it('offers the check command after a failed check, which is when it is most wanted', () => {
    const commands = hostUpdateCommands(updatesAt('error').updates);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.isDisabled).toBe(false);
  });

  it('disables the check while one is already in flight', () => {
    for (const status of ['checking', 'available', 'downloading'] as const) {
      expect(hostUpdateCommands(updatesAt(status).updates)[0]?.isDisabled).toBe(true);
    }
    for (const status of ['idle', 'downloaded', 'error'] as const) {
      expect(hostUpdateCommands(updatesAt(status).updates)[0]?.isDisabled).toBe(false);
    }
  });

  it('adds the restart command only once an update has been downloaded', () => {
    const downloaded = hostUpdateCommands(updatesAt('downloaded').updates);
    expect(downloaded.map((command) => command.id)).toEqual([
      'host-check-for-updates',
      'host-restart-to-update',
    ]);
    expect(downloaded[1]?.label).toBe('Restart to update');
    expect(downloaded[1]?.priority).toBe(1);

    for (const status of ['idle', 'checking', 'available', 'downloading', 'error'] as const) {
      expect(hostUpdateCommands(updatesAt(status).updates)).toHaveLength(1);
    }
  });

  it('routes the check command to the host and nothing else', () => {
    const { updates, check, restart } = updatesAt('idle');
    hostUpdateCommands(updates)[0]?.onSelect();
    expect(check).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
  });

  it('routes the restart command to the host and nothing else', () => {
    const { updates, check, restart } = updatesAt('downloaded');
    hostUpdateCommands(updates)[1]?.onSelect();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
  });

  it('confines both commands to the palette, never to the 32px context bar', () => {
    for (const command of hostUpdateCommands(updatesAt('downloaded').updates)) {
      expect(command.surfaces).toEqual(['palette']);
    }
  });

  it('carries no version string into a label, because the version comes off a remote feed', () => {
    const commands = hostUpdateCommands({
      state: { status: 'downloaded', version: '9.9.9', detail: null },
      check: vi.fn(),
      restart: vi.fn(),
    });
    for (const command of commands) {
      expect(command.label).not.toContain('9.9.9');
    }
  });
});
