import { app, BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * ============================================================================
 * AUTO-UPDATE. THE FEED IS STATIC, THE SURFACE IS A COMMAND, AND NEITHER OF
 * THOSE IS A PREFERENCE.
 * ============================================================================
 *
 * `electron-updater` against a **generic** feed. Not the GitHub provider, and the
 * reason is a fact rather than a taste: this repository is private on a free plan
 * — HANDOFF.md §5 records a `403` on the branch-protection and rulesets endpoints
 * with the message to upgrade or make the repository public — and
 * `electron-updater`'s GitHub provider against a private repository needs a token
 * **inside the shipped client**. An asar archive is a container, not a safe;
 * extracting a string from one takes seconds. Shipping an extractable credential
 * so that an update check works is not a trade-off with a good side, and
 * docs/adr/0004-native-host-runtime.md clause 7 records the two alternatives that
 * were weighed against it.
 *
 * **The feed URL is not in this file, and that is the design.** It is written
 * once, in `electron-builder.yml`'s `publish` block, and electron-builder bakes
 * it into `app-update.yml` inside the packaged application's resources.
 * `autoUpdater` reads that file. So the renderer cannot name a feed, this module
 * cannot name a feed, and changing the feed is a one-line edit to one tracked
 * file followed by a rebuild — which is exactly the property ADR-0002's
 * `DOCUMENTED_ENDPOINTS` entry in scripts/check-portability.mjs is declaring.
 *
 * FIVE DECISIONS, EACH OF WHICH IS THE KIND THAT IS OTHERWISE COPIED FROM A
 * TUTORIAL.
 *
 * 1. **NOTHING RUNS UNLESS `app.isPackaged`.** `electron-updater` throws
 *    outright in an unpackaged run — there is no `app-update.yml` beside a
 *    checkout and no installer to hand a downloaded file to. The guard is the
 *    same signal ADR-0004 clause 9 already argues for, for the same reason:
 *    it is a property of the running application's own layout and cannot be set
 *    from outside the build, so it needs no entry in docs/signing.md. A
 *    development run reports `unsupported`, truthfully, rather than reporting an
 *    error the developer cannot act on.
 *
 * 2. **THE `error` LISTENER IS REGISTERED BEFORE ANYTHING CAN FAIL.**
 *    `autoUpdater` is an `EventEmitter`, and an `error` event with no listener is
 *    re-thrown by Node — so the failure mode of an unreachable feed would be a
 *    crashed main process rather than a command that says it could not reach the
 *    feed. An unreachable feed is not an exotic case: it is the state of every
 *    build made before the bucket in `electron-builder.yml` is provisioned.
 *
 * 3. **CHECK ON LAUNCH AND ON AN INTERVAL, NEVER ON A MODAL.** `checkForUpdates`
 *    rather than `checkForUpdatesAndNotify`: the `AndNotify` half raises a system
 *    notification, and the surface this project chose is the command palette —
 *    plan §6, and §11 item 4's refusal of two command modes where one is a
 *    crippled version of the other. State goes to the renderer over one channel
 *    and appears as a host command. Nothing interrupts, nothing steals focus,
 *    and there is no dialog whose only button is the one the user did not ask
 *    for.
 *
 * 4. **THE DOWNLOAD IS AUTOMATIC AND THE INSTALL IS NOT.** `autoDownload` is left
 *    at its default of `true`, so "Restart to update" is a restart and not a
 *    download the user waits through after asking for one. `autoInstallOnAppQuit`
 *    is also left at its default of `true`, which means a user who never invokes
 *    the command still gets the update the next time they quit — the difference
 *    between an update mechanism and an update suggestion.
 *
 * 5. **THE STATE THIS MODULE PUBLISHES IS A FLAT RECORD, AND IT IS THE WHOLE
 *    CONTRACT.** `status`, a `version` when one is known, and a `detail` string
 *    for the error case. No `UpdateInfo`, no release notes, no download URL:
 *    everything `electron-updater` hands back is shaped by the feed, the feed is
 *    remote, and the renderer renders text. Release notes are attacker-controlled
 *    HTML if the feed is ever compromised, so they do not cross this boundary at
 *    all until something needs them and can sanitise them.
 * ============================================================================
 */

// electron-updater is CommonJS and this file compiles to an ES module, so the
// default import is `module.exports` and the members come off it. Written as a
// destructure of the default rather than as a named import because the named
// form depends on Node's CJS named-export detection succeeding on a file that
// defines `autoUpdater` through a getter.
const { autoUpdater } = electronUpdater;

/** Main to renderer, whenever the record below changes. */
const CHANNEL_CHANGED = 'shellux:updates:changed';
/** Renderer to main. Both carry no payload; see electron/preload/index.cts. */
const CHANNEL_CHECK = 'shellux:updates:check';
const CHANNEL_RESTART = 'shellux:updates:restart';

/**
 * How often a running application asks again.
 *
 * Six hours, and the number is chosen against what the check costs and what it
 * buys. It is one small HTTPS request to a static file, so the cost is
 * negligible; the benefit is that a machine left running for a week is not a
 * machine a week behind. Shorter would be noise against a release cadence
 * measured in days at best.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * What the palette is describing.
 *
 * `unsupported` is not an error and is not idle: it is a development run, where
 * an updater cannot exist. It is a distinct value so that the renderer can offer
 * nothing at all rather than offering a command that would always fail.
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  readonly status: UpdateStatus;
  /** The version an update names, when one is known. Never the running version. */
  readonly version: string | null;
  /** Human-readable failure text, `null` on every non-error status. */
  readonly detail: string | null;
}

let state: UpdateState = { status: 'idle', version: null, detail: null };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Record the new state and tell every live window.
 *
 * Every window, not the one that asked: the state belongs to the application,
 * not to whoever invoked the command, and a second window showing a stale
 * "Check for updates" while the first shows "Restart to update" would be two
 * answers to one question.
 */
function publish(next: UpdateState): void {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(CHANNEL_CHANGED, state);
  }
}

/**
 * Wire the updater up. Called once, after `app.whenReady()`.
 *
 * Registers the two renderer-facing channels unconditionally — a development run
 * still has a palette, and a command that reports `unsupported` is better than a
 * command whose channel has no handler and whose invocation therefore does
 * nothing at all, silently.
 */
export function initializeUpdater(): void {
  // Every new window is told the current state once it can receive it. Without
  // this, a window opened after a check completed would sit on the preload's
  // initial `idle` until the next state change.
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.webContents.send(CHANNEL_CHANGED, state);
    });
  });

  ipcMain.on(CHANNEL_CHECK, () => {
    void check();
  });

  ipcMain.on(CHANNEL_RESTART, () => {
    if (state.status !== 'downloaded') return;
    // `quitAndInstall` closes every window and hands over to the installer. It
    // is only ever reached from a command the user invoked, which is why there
    // is no confirmation here: the confirmation was the invocation.
    autoUpdater.quitAndInstall();
  });

  if (!app.isPackaged) {
    publish({
      status: 'unsupported',
      version: null,
      detail: 'Updates are only available in a packaged build.',
    });
    return;
  }

  // Decision 2. Before the first check, and before anything else can emit.
  autoUpdater.on('error', (error: unknown) => {
    publish({ status: 'error', version: null, detail: describe(error) });
  });
  autoUpdater.on('checking-for-update', () => {
    publish({ status: 'checking', version: null, detail: null });
  });
  autoUpdater.on('update-available', (info: { version?: string }) => {
    publish({ status: 'available', version: info.version ?? null, detail: null });
  });
  // `autoDownload` is on, so `available` moves to `downloading` on its own. Both
  // states are wired because both are real: a union member no event produces is
  // a state the renderer would carry a branch for and never reach.
  autoUpdater.on('download-progress', () => {
    publish({ status: 'downloading', version: state.version, detail: null });
  });
  autoUpdater.on('update-not-available', () => {
    publish({ status: 'idle', version: null, detail: null });
  });
  autoUpdater.on('update-downloaded', (info: { version?: string }) => {
    publish({ status: 'downloaded', version: info.version ?? null, detail: null });
  });

  void check();
  setInterval(() => {
    void check();
  }, CHECK_INTERVAL_MS);
}

/**
 * One check.
 *
 * `catch` as well as the `error` listener, because `checkForUpdates` returns a
 * promise that rejects on the same faults the event reports and an unhandled
 * rejection in the main process is fatal under Node's default. The listener has
 * already published the state by the time this runs; this exists so that the
 * process survives to show it.
 */
async function check(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ status: 'error', version: null, detail: describe(error) });
  }
}
