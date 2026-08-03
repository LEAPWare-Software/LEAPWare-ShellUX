import type { HostCommand } from '../commands/CommandRegistry';

/**
 * ============================================================================
 * AUTO-UPDATE, AS THE COMMAND REGISTRY SEES IT.
 * ============================================================================
 *
 * The updater itself is in the main process — `electron/main/updater.ts` — for a
 * reason that is not architectural taste: only the main process can replace the
 * application on disk and relaunch it. What reaches this file is the *state* of
 * that updater and two intents that carry no arguments.
 *
 * **THE SURFACE IS THE PALETTE, AND NOTHING ELSE.** Plan section 6 and section
 * 11 item 4 are both explicit: update state appears as a host command, never as a
 * modal that interrupts work. So there is no dialog here, no toast and no
 * notification. Both commands declare `surfaces: ['palette']` — the same
 * confinement `host-switch-extension` uses in `ShellLayout.tsx`, and for the same
 * reason: the context bar is 32 pixels of contextual actions, and spending one of
 * them on an update check that is relevant twice a month is exactly the ribbon
 * thinking this project deleted.
 *
 * **THE LABEL TABLE IS A `Record` OVER THE UNION, WITH NO INTERPOLATION.** Two
 * properties follow from that and both are deliberate. The compiler rejects a
 * missing arm and an invented one, in the same shape as `CATEGORY_LABELS` in
 * `CommandRegistry.ts` and `SLOT_NORMALIZERS` in `HydrationEngine`. And a label
 * that never interpolates carries no version string into a rendered surface — the
 * version comes off a remote feed, and a feed is the one input to this subsystem
 * that nobody in this repository controls. The version is carried on the state
 * for a badge to use once something can sanitise it; it does not reach a label
 * here.
 *
 * **`unsupported` OFFERS NOTHING, AND EVERY OTHER STATUS OFFERS THE CHECK —
 * INCLUDING `error`.** That asymmetry is the one design decision in this file
 * worth arguing for. `unsupported` means a development run, where an updater
 * cannot exist at all and a command would be a button that always fails.
 * `error` means the check ran and could not reach the feed, which is the state
 * every build made before the feed host is provisioned will be in — and it is
 * precisely the state in which a user most wants to press the thing again. It is
 * also the only positive evidence that the preload bridge is alive at all: a
 * preload that failed to load and a browser tab both produce "no update commands
 * in the palette", so a packaged build that OFFERS the command is the observation
 * that tells them apart.
 * ============================================================================
 */

/**
 * What the main process is doing, as the palette describes it.
 *
 * Mirrors `UpdateStatus` in `electron/main/updater.ts`. The two are separate
 * declarations across a process boundary rather than a shared import, which is
 * the same shape `src/core/ipc/` uses: the boundary is a contract, and a contract
 * written twice is a contract that can be checked, whereas a shared type is a
 * compile-time convenience that vanishes at runtime.
 */
export type HostUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface HostUpdateState {
  readonly status: HostUpdateStatus;
  /** The version an update names, or `null`. Never the running version. */
  readonly version: string | null;
  /** Failure text on `error`, `null` on every other status. */
  readonly detail: string | null;
}

/** The renderer's view of the host updater: one state and two intents. */
export interface HostUpdates {
  readonly state: HostUpdateState;
  /** Ask the host to check now. */
  check(): void;
  /** Ask the host to quit and install what it has already downloaded. */
  restart(): void;
}

/**
 * One label per status. `Record` over the union, so a status added to
 * `HostUpdateStatus` fails to compile until it is described here.
 *
 * `unsupported` carries a label it will never render, because the alternative is
 * an optional member and an optional member is a branch at every read site. The
 * command list refuses that status structurally instead.
 */
export const HOST_UPDATE_LABELS: Readonly<Record<HostUpdateStatus, string>> = Object.freeze({
  idle: 'Check for updates',
  checking: 'Checking for updates…',
  available: 'Update available — downloading',
  downloading: 'Downloading update…',
  downloaded: 'Update downloaded',
  error: 'Check for updates — last check failed',
  unsupported: 'Updates are unavailable in a development run',
});

/**
 * Statuses in which asking again would do nothing.
 *
 * A `Set` lookup rather than a boolean expression, on purpose: `a || b || c`
 * is three branches the 100% gate has to be walked through one arm at a time,
 * and this is one call whose answer is data. The same trick `wantsSurface` uses.
 */
const IN_FLIGHT: ReadonlySet<HostUpdateStatus> = Object.freeze(
  new Set<HostUpdateStatus>(['checking', 'available', 'downloading']),
);

/** Reused rather than rebuilt, so "no host" allocates nothing per render. */
const NONE: readonly HostCommand[] = Object.freeze([]);

/**
 * The host commands the palette should offer for the current update state.
 *
 * Returns an empty list in the two cases where an update command would be a lie:
 * there is no host at all (the browser lane, where `updates` is `null`), and a
 * development run (`unsupported`).
 */
export function hostUpdateCommands(updates: HostUpdates | null): readonly HostCommand[] {
  if (updates === null) {
    return NONE;
  }
  const { status } = updates.state;
  if (status === 'unsupported') {
    return NONE;
  }

  const check: HostCommand = {
    id: 'host-check-for-updates',
    label: HOST_UPDATE_LABELS[status],
    icon: 'refresh',
    category: 'help',
    surfaces: ['palette'],
    isDisabled: IN_FLIGHT.has(status),
    onSelect: () => {
      updates.check();
    },
  };

  if (status !== 'downloaded') {
    return Object.freeze([check]);
  }

  return Object.freeze([
    check,
    {
      id: 'host-restart-to-update',
      label: 'Restart to update',
      icon: 'box',
      category: 'help',
      surfaces: ['palette'],
      // Deliberately higher than the check it sits beside: this is the one
      // update command that is ever the thing the user came to the palette for.
      priority: 1,
      onSelect: () => {
        updates.restart();
      },
    },
  ]);
}
