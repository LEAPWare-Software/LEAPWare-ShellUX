import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { parsePluginPackage } from '../electron/main/plugins/pluginPackage';
import type { PluginManifest } from '../electron/main/plugins/pluginPackage';
import type { PluginListing, StoreResult } from '../electron/main/plugins/pluginStore';
import { RENDERER_ENTRY } from '../electron/main/rendererCsp';

/**
 * ============================================================================
 * THE PACKAGED LANE'S HARNESS. ADR-0006 IMPLEMENTATION STEP 10, PREPARED.
 * ============================================================================
 * Helpers for `e2e-packaged/`, which drives a **packaged** LEAPWare ShellUX
 * through Playwright's `_electron.launch()`. `e2e/` drives the dev server and a
 * `vite preview` build in plain Chromium, and says of itself that it cannot see
 * the packaged app; this lane is its sibling, with its own config
 * (`playwright.packaged.config.ts`), so neither config describes the other.
 *
 * **Never run in the session that wrote it.** That sandbox cannot package or
 * launch Electron (`docs/cloud/runbook.md`, "Not doable in the cloud"). Every
 * statement below about what the packaged app does is a reading of the source
 * named beside it, not an observation. The runbook for a human is
 * `docs/runbooks/packaged-plugin-e2e.md`.
 *
 * WHAT IS REAL IN THE PACKAGED APP TODAY, AND SO WHAT THIS CAN DRIVE:
 *
 *   - `window.shelluxHost.plugins` in host chrome (`electron/preload/index.cts`).
 *     Main compares each call's sender with host chrome's `webContents`
 *     (`electron/main/plugins/pluginIpc.ts`) — entry-point validation, which is
 *     why every call below is made from the `chrome` page. *Tests:*
 *     `electron/__tests__/pluginIpc.test.ts` — "refuses a management call whose
 *     sender is the extension surface". This harness calls three of the six.
 *   - The `/plugins/<id>/<version>/bundle.js` route
 *     (`electron/main/plugins/pluginRoute.ts`). *Tests:*
 *     `electron/__tests__/pluginScheme.test.ts` — "serves only the entry of an
 *     installed, enabled, compatible plugin", "answers 404 for every other path
 *     under /plugins/, and never reads dist for one".
 *   - Main's reload of a dead extension renderer (`electron/main/paneViews.ts`,
 *     the `render-process-gone` branch).
 *
 * WHAT IS NOT BUILT, AND SO WHAT THIS CANNOT DRIVE — the spec marks each one
 * `test.fixme` with the reason, rather than asserting a stand-in:
 *
 *   - No plugin manager UI (ADR-0006 step 9, blocked on the gate-4 decision
 *     row). "Appears" and "gone" are asserted at the store and the route only.
 *   - No surface loader (step 6). `src/paneview/PaneViewShell.tsx` registers
 *     nothing in the packaged app, so an installed plugin's code never runs,
 *     and no plugin can crash.
 *   - No fault report (step 6). Nothing in main writes the `crashed` state
 *     `electron/main/plugins/pluginStore.ts` can list.
 *
 * ONE SUBSTITUTION, NAMED: main's native file picker. Playwright cannot drive
 * an operating-system dialog, so `stubPicker` replaces `dialog.showOpenDialog`
 * inside main, through `electronApp.evaluate`, to answer with the built
 * `.lwplugin`'s path. Everything after the picker returns a path — the
 * validator, the staging directory, the rename, `state.json` — is the shipped
 * code. The picker itself is not exercised.
 * ============================================================================
 */

/**
 * The extension surface's document. Written out, not imported: it is a
 * module-private constant (`EXTENSION_ENTRY`) in `electron/main/index.ts`, and
 * importing that module would start an Electron main process.
 */
export const EXTENSION_ENTRY = 'paneview.html';

/** Host chrome's document, which `electron/main/rendererCsp.ts` does export. */
export const CHROME_ENTRY = RENDERER_ENTRY;

/**
 * The plugin this lane installs: `plugins/hello/`, the smallest of the three
 * first-party plugins and the one `CLAUDE.md` names as the contract in ~100 lines.
 */
export const PLUGIN_DIRECTORY = 'hello';

/** What `stubPicker` hands main, and what the listing must then describe. */
export interface BuiltPackage {
  readonly path: string;
  readonly manifest: PluginManifest;
}

/**
 * The `.lwplugin` `npm run plugins:build` wrote for `plugins/<directory>/`,
 * checked by the validator main's installer runs (`parsePluginPackage`) against
 * THIS checkout's contract version before the app is ever launched — so a stale
 * or damaged package fails here, with the validator's own words, rather than
 * as a refused install later.
 */
export function readBuiltPackage(directory: string): BuiltPackage {
  const config = JSON.parse(
    readFileSync(new URL(`../plugins/${directory}/plugin.json`, import.meta.url), 'utf8'),
  ) as { readonly id: string };
  const path = fileURLToPath(new URL(`../dist-plugins/${config.id}.lwplugin`, import.meta.url));
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(
      `could not read ${path} (${error instanceof Error ? error.message : String(error)}). ` +
        'Run `npm run plugins:build` in this checkout first.',
    );
  }
  const parsed = parsePluginPackage(bytes);
  if (!parsed.ok) throw new Error(`${path} is not a valid package: ${parsed.reason}`);
  if (parsed.plugin.compatibility.state !== 'compatible') {
    throw new Error(`${path} is not compatible with this checkout's host contract: ${parsed.plugin.compatibility.reason}`);
  }
  return { path, manifest: parsed.plugin.manifest };
}

/**
 * The listing `PluginStore.list` produces for a validated manifest in a given
 * state (`listingOf` in `electron/main/plugins/pluginStore.ts`).
 */
export function listingFor(manifest: PluginManifest, status: 'enabled' | 'disabled'): PluginListing {
  return {
    id: manifest.id,
    version: manifest.version,
    title: manifest.title,
    icon: manifest.icon ?? null,
    hostApiVersion: manifest.hostApiVersion,
    status,
    reason: null,
  };
}

/**
 * The part of `shelluxHost.plugins` this lane calls, typed with the store's
 * own result types. The preload declares each as `Promise<unknown>`
 * (`electron/preload/index.cts`), and `src/App.tsx`'s `Window` declaration
 * carries no `plugins` member because no renderer code calls it yet (step 9);
 * the shapes here are what `electron/main/plugins/pluginIpc.ts` returns.
 */
export interface HostPluginsBridge {
  list(): Promise<StoreResult<readonly PluginListing[]>>;
  install(): Promise<StoreResult<PluginListing>>;
  disable(id: string): Promise<StoreResult<PluginListing>>;
}

/** The cast every `page.evaluate` below reaches the bridge through. */
export interface HostWindow {
  readonly shelluxHost: { readonly plugins: HostPluginsBridge };
}

/** One launched packaged app and its two surfaces. */
export interface PackagedShell {
  readonly app: ElectronApplication;
  /** Host chrome: the rail, pane 1, the palette. `shellux://renderer/index.html`. */
  readonly chrome: Page;
  /** The extension surface: panes 2 and 3. `shellux://renderer/paneview.html`. */
  readonly extension: Page;
  /** The `--user-data-dir` this run launched with, which `app.getPath('userData')` must equal. */
  readonly userData: string;
}

/** Set by `playwright.packaged.config.ts` from the one argument `scripts/packaged-e2e.mjs` takes. */
export interface PackagedWorkerOptions {
  readonly packagedExecutable: string;
}

interface PackagedWorkerFixtures {
  readonly shell: PackagedShell;
}

function pathOf(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return '';
  }
}

async function surface(app: ElectronApplication, entry: string): Promise<Page> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const found = app.windows().find((page) => pathOf(page) === `/${entry}`);
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(`no page for /${entry} within 30s; saw: ${app.windows().map((page) => page.url()).join(', ') || 'none'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The packaged app, launched once per worker (the config runs one worker), with
 * Chromium's `--user-data-dir` switch pointing under this run's output
 * directory. Whether Electron's `app.getPath('userData')` follows that switch
 * is **not verified** here; the fixture asks the running app and refuses to
 * go on when the answer differs, so no install is made into another profile.
 * Launching itself happens before that question can be asked, and writes
 * wherever the app's user data really is. The directory is left in place after
 * the run for inspection — `plugins/state.json` is in it — and Playwright
 * empties the output directory when the next run starts.
 */
export const test = base.extend<Record<never, never>, PackagedWorkerOptions & PackagedWorkerFixtures>({
  packagedExecutable: ['', { option: true, scope: 'worker' }],
  shell: [
    async ({ packagedExecutable }, use, workerInfo) => {
      if (packagedExecutable === '') {
        throw new Error('no packaged executable was given. Run: npm run test:packaged -- <path to packaged executable>');
      }
      const userData = join(workerInfo.project.outputDir, 'user-data');
      rmSync(userData, { recursive: true, force: true });
      mkdirSync(userData, { recursive: true });

      const app = await _electron.launch({
        executablePath: packagedExecutable,
        args: [`--user-data-dir=${userData}`],
      });
      await app.context().tracing.start({ screenshots: true, snapshots: true });
      try {
        // Refuse to go on if the switch did not move `userData`: an install past
        // this line would land in the real profile of whoever ran the lane.
        const reported = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
        if (reported !== userData && reported !== realpathSync(userData)) {
          throw new Error(`the packaged app reports userData ${reported}, not ${userData}; refusing to install into it`);
        }
        const chrome = await surface(app, CHROME_ENTRY);
        const extension = await surface(app, EXTENSION_ENTRY);
        await chrome.waitForLoadState('load');
        await extension.waitForLoadState('load');
        await use({ app, chrome, extension, userData });
      } finally {
        await app.context().tracing.stop({ path: join(workerInfo.project.outputDir, 'trace.zip') });
        await app.close();
      }
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';

/**
 * Replace main's native picker with one that answers `packagePath`. The one
 * substitution this lane makes; see the banner.
 */
export async function stubPicker(app: ElectronApplication, packagePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    Object.assign(dialog, {
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [path] }),
    });
  }, packagePath);
}

/**
 * Fetch a plugin's entry over the `shellux:` scheme from inside `page`, and
 * report the status and the SHA-512 of the bytes served. A fetch, not an
 * `import()`: nothing here evaluates plugin code.
 */
export async function fetchEntry(
  page: Page,
  manifest: PluginManifest,
): Promise<{ readonly status: number; readonly sha512: string | null }> {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return { status: response.status, sha512: null };
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', await response.arrayBuffer()));
    let binary = '';
    for (const byte of digest) binary += String.fromCharCode(byte);
    return { status: response.status, sha512: btoa(binary) };
  }, `/plugins/${manifest.id}/${manifest.version}/bundle.js`);
}
