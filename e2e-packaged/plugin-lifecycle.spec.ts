import {
  EXTENSION_ENTRY,
  PLUGIN_DIRECTORY,
  expect,
  fetchEntry,
  listingFor,
  readBuiltPackage,
  stubPicker,
  test,
} from './packaged';
import type { BuiltPackage, HostWindow } from './packaged';

/**
 * ADR-0006 step 10, the plan's acceptance line: "Install → appears → disable →
 * gone → a crashing plugin shows *crashed* and the shell survives."
 *
 * **Written, never run.** The session that wrote this could not package or
 * launch Electron. Until a human runs it (`docs/runbooks/packaged-plugin-e2e.md`)
 * nothing below is evidence of anything, and no document may cite it as such.
 *
 * Five checkpoints, and what each can reach in the tree as it stands:
 *
 *   1. Install      — through main's real installer, from host chrome's bridge.
 *                     The native picker is stubbed (`stubPicker`).
 *   2. Appears      — in the store's listing and at the `/plugins/` route. NOT in
 *                     a plugin manager: none exists (step 9). `test.fixme` below.
 *   3. Disable/gone — the same two places. The UI half is `test.fixme` (steps 6, 9).
 *   4. Crashed      — `test.fixme`: no surface loader runs plugin code, nothing
 *                     records `crashed`, and no UI shows it (steps 6, 9).
 *   5. Survives     — host chrome outlives a killed extension renderer and main
 *                     reloads it. No plugin is involved: that is the part of
 *                     "survives" the tree has today, and the title says so.
 *
 * Serial: each case leaves the state the next one starts from, and a failure
 * skips the rest rather than letting them run against the wrong state.
 */

test.describe.configure({ mode: 'serial' });

let built: BuiltPackage;

test.beforeAll(() => {
  built = readBuiltPackage(PLUGIN_DIRECTORY);
});

test.describe('ADR-0006 step 10: the packaged plugin lifecycle', () => {
  test('1 install: installs the built .lwplugin through main, from host chrome, and lists it enabled', async ({ shell }) => {
    await expect
      .poll(() => shell.chrome.evaluate(() => (window as unknown as HostWindow).shelluxHost.plugins.list()))
      .toEqual({ ok: true, value: [] });

    await stubPicker(shell.app, built.path);
    const installed = await shell.chrome.evaluate(() => (window as unknown as HostWindow).shelluxHost.plugins.install());

    expect(installed).toEqual({ ok: true, value: listingFor(built.manifest, 'enabled') });
  });

  test('2 appears: the listing names it enabled, and /plugins/ serves the entry that was installed', async ({ shell }) => {
    const listed = await shell.chrome.evaluate(() => (window as unknown as HostWindow).shelluxHost.plugins.list());
    expect(listed).toEqual({ ok: true, value: [listingFor(built.manifest, 'enabled')] });

    // Requested from the extension surface, where a loader would import it.
    expect(await fetchEntry(shell.extension, built.manifest)).toEqual({ status: 200, sha512: built.manifest.sha512 });
  });

  test.fixme(
    '2 appears: the plugin manager shows the installed plugin',
    { annotation: { type: 'not built', description: 'ADR-0006 step 9: no plugin manager exists in host chrome' } },
    () => {},
  );

  test('3 disable, gone: the listing names it disabled, and /plugins/ stops serving its entry', async ({ shell }) => {
    const id = built.manifest.id;
    const disabled = await shell.chrome.evaluate(
      (pluginId) => (window as unknown as HostWindow).shelluxHost.plugins.disable(pluginId),
      id,
    );
    expect(disabled).toEqual({ ok: true, value: listingFor(built.manifest, 'disabled') });

    const listed = await shell.chrome.evaluate(() => (window as unknown as HostWindow).shelluxHost.plugins.list());
    expect(listed).toEqual({ ok: true, value: [listingFor(built.manifest, 'disabled')] });

    expect(await fetchEntry(shell.extension, built.manifest)).toEqual({ status: 404, sha512: null });
  });

  test.fixme(
    '3 disable, gone: the plugin manager shows it disabled, and its nav and panes leave the shell',
    {
      annotation: {
        type: 'not built',
        description: 'ADR-0006 step 9 (plugin manager) and step 6 (surface loader): nothing drew it, so nothing can be seen to go',
      },
    },
    () => {},
  );

  test.fixme(
    '4 crashed: a plugin that throws is shown as crashed, with its reason',
    {
      annotation: {
        type: 'not built',
        description:
          'ADR-0006 step 6: no surface loader imports a plugin, no fault report reaches main, nothing records "crashed"; step 9: nothing shows it. No crashing fixture plugin exists either',
      },
    },
    () => {},
  );

  test('5 survives: host chrome outlives a killed extension renderer, and main reloads it (no plugin involved)', async ({ shell }) => {
    const pidOf = (entry: string) =>
      shell.app.evaluate(({ webContents }, name) => {
        const target = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith(`/${name}`));
        return target === undefined || target.isCrashed() || target.isLoading() ? 0 : target.getOSProcessId();
      }, entry);

    const before = await pidOf(EXTENSION_ENTRY);
    expect(before).toBeGreaterThan(0);

    // Electron's own API, called from main; nothing is added to the app for it.
    const crashed = shell.extension.waitForEvent('crash');
    await shell.app.evaluate(({ webContents }, name) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith(`/${name}`))
        ?.forcefullyCrashRenderer();
    }, EXTENSION_ENTRY);
    await crashed;

    // `render-process-gone` in `electron/main/paneViews.ts` reloads the view into
    // a new renderer: a different, live process id.
    await expect.poll(() => pidOf(EXTENSION_ENTRY), { timeout: 30_000 }).not.toBe(0);
    expect(await pidOf(EXTENSION_ENTRY)).not.toBe(before);

    // Host chrome still paints and still takes the keyboard.
    await shell.chrome.keyboard.press('Control+k');
    await expect(shell.chrome.getByRole('dialog', { name: 'Commands' })).toBeVisible();
    await shell.chrome.keyboard.press('Escape');

    // And the management door still answers.
    const listed = await shell.chrome.evaluate(() => (window as unknown as HostWindow).shelluxHost.plugins.list());
    expect(listed).toEqual({ ok: true, value: [listingFor(built.manifest, 'disabled')] });
  });
});
