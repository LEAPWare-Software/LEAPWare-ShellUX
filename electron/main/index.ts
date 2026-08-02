import { app, BrowserWindow, dialog, nativeTheme, net, protocol, shell } from 'electron';
import { release } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ============================================================================
 * THE NATIVE HOST — PHASE 1. ONE WINDOW, AND THE ARGUMENT FOR EVERY SETTING.
 * ============================================================================
 *
 * This file is the whole of the native host at Phase 1: application lifecycle
 * and a single `BrowserWindow` that loads the SPA this repository already
 * builds. There is no `BaseWindow`, no `WebContentsView`, no IPC channel and no
 * `contextBridge` surface.
 *
 * That is a decision, not an omission. The three-view topology in
 * docs/plans/native-host-pivot.md section 3.2 is *gated* on an accessibility
 * spike that has not been run (section 9, R1): Electron may expose N views as N
 * separate platform accessibility trees, and if it does, the two-process shape
 * wins instead. Building the split before the gate means building it twice. The
 * full argument, including what per-pane processes do and do not buy, is in
 * docs/adr/0004-native-host-runtime.md.
 *
 * Eight decisions are made here. Each is argued rather than asserted, because
 * every one of them is the kind of setting that is copied from a tutorial once
 * and never revisited.
 *
 * 1. THE THREE SECURITY SWITCHES ARE NOT NEGOTIABLE, AND THE REASON IS NOT
 *    "DEFENCE IN DEPTH".
 *    `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
 *
 *    ADR-0001 Amendment E establishes that this project cannot enforce a
 *    boundary *between extensions* inside one document, and that the honest
 *    words for what it does have are integrity control, entry-point validation
 *    and guardrail. Those three switches are the one place where a real
 *    integrity control is available cheaply, and it is a different boundary:
 *    between the *renderer as a whole* and the operating system. Turning any of
 *    them off does not soften a guarantee this codebase makes — it converts
 *    every extension, every mock and every dependency in the renderer's module
 *    graph into code with the file system, the network and process creation in
 *    reach. Amendment E already concedes that a hostile extension can reach the
 *    activation controller by walking React fibers. There is no version of this
 *    project where that same reach may also include `require('node:fs')`.
 *
 *    `sandbox: true` has one consequence that must be recorded now rather than
 *    discovered in Phase 6: **a sandboxed preload script cannot use ESM
 *    imports.** Whoever adds the first `contextBridge` call inherits that
 *    constraint, and inherits it from this line. See electron/preload/index.ts.
 *
 *    `webSecurity` is left at its default of `true` and is never set. It is
 *    named here only so that a future reader can see that the question was
 *    asked: the usual reason to disable it is that a `file://` document cannot
 *    fetch its own sibling assets, and decision 3 removes that reason instead of
 *    accommodating it.
 *
 * 2. DEVELOPMENT AND PRODUCTION ARE TOLD APART BY `app.isPackaged`, AND BY
 *    NOTHING ELSE.
 *    ADR-0002 clause 6 forbids "an environment assumption that is not declared
 *    and defaulted", and `.gitignore` records that nothing in this repository
 *    reads an environment variable at all. `NODE_ENV` would be exactly the
 *    forbidden thing: an undeclared name, with a default that differs between a
 *    shell that happens to export it and one that does not, deciding which
 *    document the user sees.
 *
 *    `app.isPackaged` asks a question about the running application's own
 *    layout — whether it is executing from a packaged bundle or from a checkout
 *    — and Electron answers it from the process's own paths. Nothing outside the
 *    build can change the answer, and it needs no entry in docs/signing.md.
 *
 *    Rejected alternatives, each for a stated reason:
 *      - `process.defaultApp`, which is true when the Electron binary was handed
 *        a path argument. It answers "how was this launched", which is nearly
 *        the question and not it: it is false for a packaged app and also false
 *        for a checkout launched through anything but the plain binary.
 *      - Probing the dev server before deciding. That makes the first act of a
 *        packaged application a request to a loopback port, and makes the answer
 *        depend on what else is listening.
 *      - A constant substituted at build time. Phase 1 does not bundle the main
 *        process, and it would move the answer out of the runtime and into build
 *        configuration, where it is invisible to the person debugging it.
 *
 *    **The gap, stated plainly.** `app.isPackaged` conflates "packaged" with
 *    "production", so a built-but-unpackaged run — `npm run build`, then the
 *    Electron binary against this directory — is treated as development and
 *    tries the dev server. That case is real and it is not handled. What it gets
 *    instead is decision 6: a named error dialog saying which URL failed and
 *    what to start, rather than a white window. The production load path is
 *    genuinely first exercised by packaging, which is Phase 9.
 *
 * 3. THE PACKAGED RENDERER IS SERVED OVER A PRIVATE SCHEME, NOT OVER `file://`.
 *    This is the only part of Phase 1 that is more than a window, and it exists
 *    because of a fact about this repository's own build output rather than a
 *    preference. `vite.config.ts` sets no `base`, so `base` is Vite's default of
 *    `'/'`, and the built `dist/index.html` therefore loads
 *    `/assets/<name>.js` and `/assets/<name>.css` — absolute, and with
 *    `crossorigin` on both. Under `file://` those two paths resolve against the
 *    file-system root, not against the bundle, and the module script is
 *    additionally a cross-origin request from an opaque origin. The result is a
 *    blank window whose failure `did-fail-load` never sees, because the main
 *    frame loaded fine and it was the sub-resources that did not.
 *
 *    There were two ways out. Setting `base: './'` in `vite.config.ts` is one
 *    line, and it makes the desktop shell's correctness depend on a setting in a
 *    file the browser lane also owns, where nothing states why it is there. A
 *    privileged scheme handled in this file is about thirty lines and keeps the
 *    dependency where the requirement is. The second one also buys two things
 *    the first does not: a real, stable origin — so `HydrationEngine`'s
 *    `localStorage` persistence behaves as it does in a browser rather than as
 *    an opaque-origin special case — and something for decision 5 to compare a
 *    navigation against.
 *
 *    The handler resolves every request under one root directory and refuses
 *    anything that normalises outside it. `net.fetch` performs no traversal
 *    check of its own; that check is here, and it is the reason this function is
 *    longer than it looks like it should be.
 *
 * 4. THE DEV WINDOW LOADS `/`, WHICH IS THE FIXTURE SHELL, AND THAT ASYMMETRY IS
 *    ON PURPOSE.
 *    `vite.config.ts` installs a dev-server-only middleware rewriting `/` to
 *    `dev.html`, so the dev server's root is the populated shell and
 *    `/index.html` is the empty production one. This window loads `/`, which
 *    means the first native window anyone opens has navigation entries and rows
 *    in it — which is the whole of GitHub issue #39, "nobody has ever run the
 *    app", on the desktop side.
 *
 *    The cost is that the native window in development shows mock extensions and
 *    the packaged application shows an empty registry. That asymmetry is real
 *    and could mislead. It is accepted because it is *the same* asymmetry
 *    `npm run dev` already has in a browser: the native window agrees with the
 *    browser dev experience rather than inventing a third behaviour. The
 *    middleware is `apply: 'serve'`, so `vite build` never runs it and no mock
 *    can reach a packaged bundle by this route.
 *
 * 5. WINDOW OPENING AND TOP-LEVEL NAVIGATION BOTH DENY BY DEFAULT.
 *    `setWindowOpenHandler` returns `{ action: 'deny' }` on every path. An
 *    `https:` target is handed to the operating system's browser first; every
 *    other scheme — `http:`, `file:`, `data:`, anything a plug-in string could
 *    carry — is dropped without being opened anywhere. `http:` is excluded
 *    deliberately: a plaintext URL is not something this host should launch on a
 *    user's behalf, and the dev server is *loaded*, never *opened*.
 *
 *    `will-navigate` is the other half of the same rule and is easy to forget.
 *    Without it, a top-level navigation replaces the entire application with a
 *    remote document inside a window that has no address bar and no back
 *    button. Anything that does not begin with the origin this window was loaded
 *    from is cancelled.
 *
 * 6. A FAILED LOAD PRODUCES A SENTENCE, NOT A WHITE RECTANGLE.
 *    This repository has no top-level React error boundary, and a native window
 *    has no address bar, no reload button a user will find, and no console
 *    anyone will open. Every failure that would otherwise be silent is turned
 *    into a line on stderr and a native error box naming the URL, the code and
 *    the description: `did-fail-load` for the main frame, `render-process-gone`
 *    for a crashed or killed renderer, `preload-error` for a preload that threw,
 *    and a warning from the scheme handler in decision 3 for a request that
 *    resolved to nothing — which is the one case none of the others can see.
 *
 *    Sub-frame failures and `ERR_ABORTED` are filtered out. The first is not
 *    this window's failure and the second is what a cancelled navigation looks
 *    like, so reporting either would train a reader to ignore the dialog.
 *
 *    **A sentence is not sufficient on its own, and two of these handlers do
 *    something as well as say something.** A dialog followed by the same blank
 *    rectangle is the blank rectangle with an extra click in front of it. So a
 *    renderer that is gone takes its window with it — there is nothing left that
 *    can ever paint — and a load that failed before the window was shown shows
 *    it anyway, because the alternative is a dismissed dialog and a process with
 *    no window at all, which on macOS does not even quit.
 *
 * 7. MICA IS APPLIED ONCE, CONDITIONALLY, AND THE FALLBACK IS A COLOUR RATHER
 *    THAN A BRANCH.
 *    `backgroundMaterial: 'mica'` needs Windows 11 22H2 (build 22621) or newer.
 *    It is requested only when the platform reports at least that build and only
 *    when the system is not in High Contrast, which is the one degradation
 *    Electron exposes a signal for (`nativeTheme.shouldUseHighContrastColors`),
 *    and the material is re-evaluated when that signal changes.
 *
 *    Transparency-off and Battery Saver are the other two states in which
 *    Windows declines to draw the material. **Electron surfaces neither, this
 *    file does not detect either, and no attempt is made to.** What handles them
 *    is that the window always carries an opaque `backgroundColor`, so a
 *    material that does not draw leaves a solid surface rather than a
 *    transparent or black one. The fallback is the colour, not a code path — the
 *    code path is what would rot, because it would need a signal that does not
 *    exist.
 *
 *    Microsoft's guidance is not to apply a backdrop material more than once,
 *    and to keep vertical panes opaque. Phase 1 satisfies both trivially: there
 *    is one window and the SPA paints opaque, so the material is visible only
 *    where the system draws — the title bar and the frame. **The obligation this
 *    creates for Phase 7 is that the `WebContentsView`s must not set
 *    `backgroundMaterial` at all**, and it is written here because that is the
 *    commit where it would be got wrong.
 *
 * 8. macOS KEEPS ITS SYSTEM TITLE BAR IN PHASE 1, AND ITS LIFECYCLE
 *    DIFFERENCE IS HONOURED.
 *    `titleBarStyle` is set explicitly to `'default'`. `'hiddenInset'` is where
 *    this ends up — a shell that owns a 48px rail should own the traffic-light
 *    inset too — but it is wrong *now*: the renderer has no drag region and no
 *    top inset, so hiding the bar puts the traffic lights over pane content in a
 *    window that can only be moved by whatever empty space the SPA happens to
 *    have. `'hiddenInset'` lands in the same commit as the rail and its
 *    `-webkit-app-region` rules, in Phase 7, or not at all.
 *
 *    On macOS, closing the last window does not quit the application and the
 *    dock icon re-opens one. Both halves are implemented, because implementing
 *    only the first gives a process with no way back to a window.
 * ============================================================================
 */

/**
 * The private scheme the packaged renderer is served over. Single-label by
 * design: it names no host, resolves nowhere public, and is registered by this
 * process for this process.
 */
const APP_SCHEME = 'shellux';

/** Origin of the packaged renderer. Also the navigation allowlist of decision 5. */
const APP_ORIGIN = `${APP_SCHEME}://renderer`;

/** The one document `vite build` produces, and the only entry point served. */
const RENDERER_ENTRY = 'index.html';

/**
 * The dev server's root, which `vite.config.ts` rewrites to the fixture shell.
 * 5173 is Vite's own default and is the single entry in the documented-port
 * table ADR-0002 clause 5 refers to; it is not a port this file chose.
 */
const DEV_SERVER_URL = 'http://localhost:5173/';

/** Windows 11 22H2. Below this build there is no Mica to ask for. */
const WINDOWS_11_22H2_BUILD = 22621;

/** Chromium's code for a navigation that was cancelled rather than failed. */
const ERR_ABORTED = -3;

/**
 * Where this file is, and therefore where everything else is.
 *
 * `import.meta.url` rather than `__dirname`, because the compiled main process is
 * an ES module: the nearest `package.json` declares `"type": "module"`, so the
 * emitted `.js` is loaded by the ESM loader and `__dirname` does not exist.
 *
 * The layout assumption, stated so it can be checked: this file compiles to
 * `dist-electron/main/index.js`, and `dist/` is its grandparent's child. That
 * holds in a working tree and it holds inside a packaged archive, because
 * packaging preserves the pair.
 */
const MAIN_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

/** Root of the built renderer. Every served path must normalise inside this. */
const RENDERER_ROOT = join(MAIN_DIRECTORY, '..', '..', 'dist');

/** The preload of decision 1. Deliberately inert; see electron/preload/index.ts. */
const PRELOAD_SCRIPT = join(MAIN_DIRECTORY, '..', 'preload', 'index.js');

/**
 * Registered before the application is ready, which is the only time this call
 * is legal.
 *
 * `standard` is what gives the scheme an ordinary origin, and it is what makes
 * `localStorage` and the `crossorigin` module script in the built HTML behave as
 * they do over http. `secure` puts the renderer in a secure context. Neither is
 * a convenience: without them the packaged application and the dev server would
 * differ in ways that only show up in a feature nobody tested.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** One diagnostic channel, so a failure reads the same wherever it came from. */
function warn(message: string): void {
  process.stderr.write(`shellux-host: ${message}\n`);
}

/**
 * The absolute path a request under `APP_SCHEME` names, or `null` when it names
 * something outside the renderer root.
 *
 * The containment test is `startsWith(root + separator)`, not a prefix test on
 * the root alone: `dist-extra` starts with `dist` and is a different directory.
 * `join` normalises `..` away before the comparison, so a traversal attempt is
 * compared in its resolved form rather than its written one.
 */
function resolveRendererFile(requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    // A malformed URL or a malformed percent-escape. Neither names a file.
    return null;
  }
  const relative = pathname.replace(/^\/+/, '');
  const target = join(RENDERER_ROOT, relative === '' ? RENDERER_ENTRY : relative);
  if (target !== RENDERER_ROOT && !target.startsWith(RENDERER_ROOT + sep)) return null;
  return target;
}

/** Decision 3. Serves `dist/` over `APP_SCHEME`, and says so when it cannot. */
function registerRendererProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const target = resolveRendererFile(request.url);
    if (target === null) {
      warn(`refused a request that resolves outside the renderer root: ${request.url}`);
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    }
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      // The white-screen case: the document loaded and one of its assets did
      // not. No load-failure event fires for this, so this line is the only
      // place it is ever visible.
      warn(`renderer asset not found: ${request.url} (${describeError(error)})`);
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decision 2. The URL this window loads, and the origin decision 5 compares against. */
function rendererTarget(): string {
  return app.isPackaged ? `${APP_ORIGIN}/${RENDERER_ENTRY}` : DEV_SERVER_URL;
}

function rendererOrigin(): string {
  return app.isPackaged ? `${APP_ORIGIN}/` : DEV_SERVER_URL;
}

/** Decision 7. Whether this machine can draw the material at all. */
function supportsBackdropMaterial(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number(release().split('.')[2]);
  return Number.isFinite(build) && build >= WINDOWS_11_22H2_BUILD;
}

/** Decision 7. `'none'` is a request for no material, not a failure to ask. */
function backdropMaterial(): 'mica' | 'none' {
  return supportsBackdropMaterial() && !nativeTheme.shouldUseHighContrastColors ? 'mica' : 'none';
}

/**
 * Decision 7's fallback, and half of the answer to the flash-of-wrong-theme
 * problem the pivot plan records as R6.
 *
 * The SPA's Tailwind configuration leaves `darkMode` unset, so Tailwind 3
 * defaults to `media` and the operating system decides. This colour is chosen
 * the same way, from the same signal, so the native surface underneath agrees
 * with the document that is about to paint on top of it. The two values are the
 * `neutral` endpoints the shell's own classes already use.
 */
function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff';
}

/** Decision 6. One shape for every failure a user would otherwise see as blankness. */
function reportFailure(headline: string, detail: string): void {
  warn(`${headline} — ${detail}`);
  dialog.showErrorBox('LEAPWare ShellUX could not start', `${headline}\n\n${detail}`);
}

function attachDiagnostics(window: BrowserWindow): void {
  const contents = window.webContents;

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === ERR_ABORTED) return;
    const advice = app.isPackaged
      ? 'The packaged renderer did not load. This is a packaging fault, not a runtime one.'
      : 'The Vite dev server did not answer. Start it with "npm run dev" and reopen the window.';
    reportFailure(
      `Could not load ${validatedURL}`,
      `${errorDescription} (${String(errorCode)})\n${advice}`,
    );
    // The window is created with `show: false` and is shown from
    // `ready-to-show`. Chromium paints its own error document on a failed
    // navigation, so that event normally still fires — but "normally" is not a
    // guarantee, and the failure it does not cover is the worst one available: a
    // dismissed dialog followed by a process with no window, which on macOS does
    // not even quit. Showing it here costs nothing when it is already visible.
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  });

  contents.on('render-process-gone', (_event, details) => {
    // Phase 1 has one renderer, so this is the whole window. Phase 7 is where
    // this event stops being fatal and starts being the crash containment the
    // ADR claims — and where this handler has to learn which view died.
    reportFailure(
      'The window process stopped',
      `reason: ${details.reason}, exit code: ${String(details.exitCode)}`,
    );
    // A window whose renderer is gone never paints again. Reporting and
    // returning would leave exactly the blank native rectangle this whole
    // handler exists to prevent, with the added insult that the user has just
    // been told why and can now do nothing about it. Destroying it ends the
    // application on Windows through `window-all-closed`, and on macOS leaves
    // the dock icon as the way back — both of which are states a user can act
    // on. It is not reloaded: a deterministic crash would reload into itself,
    // and Phase 1 has no state a reload would preserve.
    if (!window.isDestroyed()) window.destroy();
  });

  contents.on('preload-error', (_event, preloadPath, error) => {
    // Wired in Phase 1 on purpose. The preload is inert today, so the only
    // thing this can report is that the file is missing or in the wrong module
    // format — which is exactly the failure Phase 6 would otherwise meet for
    // the first time while also debugging a new IPC surface.
    reportFailure('The preload script failed', `${preloadPath}\n${describeError(error)}`);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // 800 is not a round number chosen for looks. `ShellLayout`'s pixel
    // minimums stop fitting simultaneously below roughly 700 CSS px, at which
    // point `react-resizable-panels` warns on every render; 800 keeps the shell
    // inside its own documented range at the smallest size this window offers.
    minWidth: 800,
    minHeight: 600,
    backgroundColor: surfaceColor(),
    backgroundMaterial: backdropMaterial(),
    // Decision 8.
    titleBarStyle: 'default',
    // Nothing is shown until the renderer has something to show. Without this
    // the user sees the browser's default white document for one frame, which
    // in a dark appearance is the most visible defect the app can have before
    // it has done anything at all.
    show: false,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      // Decision 1. All three, and no exceptions.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  attachDiagnostics(window);

  window.once('ready-to-show', () => {
    window.show();
  });

  // Decision 5.
  window.webContents.setWindowOpenHandler(({ url }) => {
    let protocolOfTarget = '';
    try {
      protocolOfTarget = new URL(url).protocol;
    } catch {
      protocolOfTarget = '';
    }
    if (protocolOfTarget === 'https:') {
      shell.openExternal(url).catch((error: unknown) => {
        warn(`could not hand ${url} to the system browser: ${describeError(error)}`);
      });
    } else {
      warn(`refused to open a window for ${url}`);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(rendererOrigin())) return;
    event.preventDefault();
    warn(`refused a top-level navigation to ${url}`);
  });

  // `loadURL` REJECTS on the same failures `did-fail-load` reports, and an
  // unhandled rejection in the main process is fatal under Node's default — so
  // `void` here would kill the process before the dialog decision 6 promises
  // could be shown. The rejection is swallowed on purpose: it is the same event,
  // already reported, and reporting it twice would produce two dialogs for one
  // fault.
  window.loadURL(rendererTarget()).catch(() => {
    /* reported by the did-fail-load handler above. */
  });

  return window;
}

/**
 * Decision 7. The material and the surface colour both follow the system, so
 * both are re-derived when it changes.
 *
 * `setBackgroundMaterial` is a Windows call and is guarded as one. The colour is
 * not — every platform has an appearance and every platform can change it while
 * the window is open.
 */
function followSystemAppearance(window: BrowserWindow): void {
  const update = (): void => {
    if (window.isDestroyed()) return;
    window.setBackgroundColor(surfaceColor());
    if (process.platform === 'win32') window.setBackgroundMaterial(backdropMaterial());
  };
  nativeTheme.on('updated', update);
  window.on('closed', () => {
    nativeTheme.off('updated', update);
  });
}

function openShellWindow(): void {
  followSystemAppearance(createWindow());
}

app
  .whenReady()
  .then(() => {
    registerRendererProtocol();
    openShellWindow();

    // Decision 8. macOS keeps the process alive with no windows, and the dock
    // icon is how a user asks for one back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openShellWindow();
    });
  })
  .catch((error: unknown) => {
    // Decision 6, at the one point where there is no window to fail in. Startup
    // throwing with no handler would exit silently with a non-zero code and no
    // window ever appearing, which is the least diagnosable failure this
    // process has.
    reportFailure('The application could not start', describeError(error));
    app.exit(1);
  });

// Decision 8, the other half. Everywhere but macOS, the last window closing is
// the application ending.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
