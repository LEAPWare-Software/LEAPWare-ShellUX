import { app, BaseWindow, dialog, ipcMain, net, protocol } from 'electron';
import { initializeUpdater } from './updater.js';
import { openShellSurfaces, followSystemAppearance } from './paneViews.js';
import type { PaneWindow } from './paneViews.js';
import type { PaneSurfaceId } from './surfaces.js';
import { nodeDiagnosticsFs, writeDiagnosticsEntry } from './diagnosticsLog.js';
import type { DiagnosticsEntry } from './diagnosticsLog.js';
import { createRendererHandler, RENDERER_ENTRY } from './rendererCsp.js';
import { createPluginStore, nodePluginStoreFs } from './plugins/pluginStore.js';
import type { PluginStore } from './plugins/pluginStore.js';
import { createPluginRoute } from './plugins/pluginRoute.js';
import { registerPluginIpc } from './plugins/pluginIpc.js';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ============================================================================
 * THE NATIVE HOST — APPLICATION LIFECYCLE, THE PRIVATE SCHEME, AND THE SPLIT.
 * ============================================================================
 *
 * This file was the whole of the native host at Phase 1: lifecycle and a single
 * `BrowserWindow` loading the SPA. It said, in as many words, that the split was
 * not built because the topology was gated on an accessibility spike nobody had
 * run, and that building it before the gate meant building it twice.
 *
 * **Phase 7 built it, in the two-process shape, and the window now lives in
 * electron/main/paneViews.ts.** The argument for two views rather than three —
 * and the reason that choosing two does not pre-empt docs/adr/0005-pane-topology.md,
 * which is still `Proposed` and whose deciding arm still needs a human with NVDA
 * — is in electron/main/surfaces.ts. The spike's measurements are in
 * spike/topology/RESULTS.md.
 *
 * What stayed here is what was never about the window: the lifecycle, the
 * private scheme, and the two URLs the views load. Decisions 5, 6, 7 and 8 below
 * describe behaviour that MOVED rather than behaviour that vanished; each says
 * where it went, because a decision that is silently deleted is one that gets
 * re-derived wrongly.
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
 * 3a. THERE ARE NOW TWO DOCUMENTS, AND THE SCHEME SERVES BOTH.
 *    `vite build` emits `index.html` and `paneview.html`. The first is host
 *    chrome; the second is the extension surface holding panes 2 and 3 in ONE
 *    document, which is the whole of the two-process topology's renderer half.
 *    The handler in decision 3 is unchanged by this — it resolves any path under
 *    one root — and `RENDERER_ENTRY` is still the entry the bare path serves.
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
 *    **This rule now lives in `lockDown` in electron/main/paneViews.ts, and the
 *    move was mandatory rather than tidy.** A `BaseWindow` has no `webContents`,
 *    so the two handlers below had nothing left to attach to; installed on the
 *    window they would have denied nothing at all, silently, which is the worst
 *    available failure for a rule whose whole job is to refuse. They are
 *    installed per view, so both surfaces carry them.
 *
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
 *    **Also moved to electron/main/paneViews.ts, per view, and it grew one
 *    branch there.** `render-process-gone` was fatal because there was one
 *    renderer and it was the whole application; there are two now, and the
 *    extension view dying is the case the split was bought for — it reloads, and
 *    the rail, pane 1 and the command surfaces stay up. Host chrome dying is
 *    still fatal, for the reason stated below: there is nothing left that can
 *    paint. `ready-to-show` does not exist on a `BaseWindow`, so the window is
 *    shown when host chrome's contents finish loading instead.
 *
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
 *    and to keep vertical panes opaque. Phase 1 satisfied both trivially: one
 *    window, an opaque SPA, and the material visible only where the system draws
 *    it — the title bar and the frame. **The obligation this created for Phase 7
 *    was that the `WebContentsView`s must not set `backgroundMaterial` at all**,
 *    and it was written here because this was the commit where it would be got
 *    wrong. **It was discharged**: electron/main/paneViews.ts requests the
 *    material on the `BaseWindow` and gives both views an opaque colour, which
 *    is also their fallback for the two states — Transparency-off and Battery
 *    Saver — that Electron exposes no signal for.
 *
 * 8. macOS KEEPS ITS SYSTEM TITLE BAR, AND ITS LIFECYCLE DIFFERENCE IS
 *    HONOURED.
 *    `titleBarStyle` is set explicitly to `'default'`. `'hiddenInset'` is where
 *    this ends up — a shell that owns a 48px rail should own the traffic-light
 *    inset too — but it is wrong *now*: the renderer has no drag region and no
 *    top inset, so hiding the bar puts the traffic lights over pane content in a
 *    window that can only be moved by whatever empty space the SPA happens to
 *    have. It lands in the same commit as the rail and its `-webkit-app-region`
 *    rules, which is the commit that splits `ShellLayout` into a chrome surface
 *    and an extension surface. That commit has not happened, so this is still a
 *    live reason rather than a historical one.
 *
 *    On macOS, closing the last window does not quit the application and the
 *    dock icon re-opens one. Both halves are implemented, because implementing
 *    only the first gives a process with no way back to a window. **The counter
 *    is `BaseWindow.getAllWindows()` and not `BrowserWindow.getAllWindows()`,
 *    which is a correction rather than a preference:** this application no
 *    longer creates a `BrowserWindow` at all, so the old call would have
 *    reported zero forever — opening a second window on every dock click, and
 *    answering `window-all-closed` about a class of window that no longer
 *    exists.
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

/**
 * The extension surface's document — panes 2 and 3, in ONE document.
 *
 * A second HTML entry rather than a query string on the first, for the reason
 * `dev.html` is a second document rather than a `VITE_MOCKS=1` switch: a
 * document is a build input, so what each surface loads is decided by
 * `vite.config.ts`'s `rollupOptions.input` and is visible in `dist/`, rather than
 * being decided at runtime by a string this process happens to append.
 */
const EXTENSION_ENTRY = 'paneview.html';

/**
 * The dev server's root, which `vite.config.ts` rewrites to the fixture shell.
 * 5173 is Vite's own default and is the single entry in the documented-port
 * table ADR-0002 clause 5 refers to; it is not a port this file chose.
 */
const DEV_SERVER_URL = 'http://localhost:5173/';

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

/**
 * The preload of decision 1.
 *
 * `.cjs`, not `.js`, and the extension is the whole point. A sandboxed preload is
 * loaded into a CommonJS realm, the root `package.json` declares
 * `"type": "module"`, and a `.js` emitted anywhere in this tree is therefore an ES
 * module. The source is `electron/preload/index.cts`, which compiles to
 * `index.cjs` — the one file in the repository whose extension is a constraint
 * rather than a convention. It stopped being inert in Phase 9; see that file for
 * the one name it now exposes.
 */
const PRELOAD_SCRIPT = join(MAIN_DIRECTORY, '..', 'preload', 'index.cjs');

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
 * ============================================================================
 * THE LOCAL LOG, GITHUB ISSUE #86.
 * ============================================================================
 * `stderr` is `warn`'s whole audience, and nobody is attached to a packaged
 * application's stderr. Every entry below also goes to a size-bounded rotating
 * file under `app.getPath('logs')`, via `electron/main/diagnosticsLog.ts` — the
 * one write path both the main process and the renderer's forwarded reports
 * share. `app.getPath('logs')` is read at call time rather than cached, because
 * it is only valid once Electron is ready and every one of these listeners can
 * in principle fire before `whenReady` resolves.
 *
 * **No network call is made anywhere in this file.** This is local-file
 * observability, not telemetry, exactly as issue #86 asks: "the absence of
 * third-party telemetry is not a defect".
 * ============================================================================
 */
function logDiagnostics(entry: DiagnosticsEntry): void {
  writeDiagnosticsEntry(nodeDiagnosticsFs, app.getPath('logs'), entry);
}

/** `process.on('uncaughtException', ...)`. Failure mode: a thrown error with no listener kills the process with nothing recorded anywhere a maintainer will ever read. */
process.on('uncaughtException', (error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  warn(`uncaught exception: ${err.message}`);
  logDiagnostics({ source: 'main', kind: 'uncaughtException', message: err.message, stack: err.stack ?? null });
});

/** `process.on('unhandledRejection', ...)`. Same failure mode, for a promise nobody attached a `.catch` to. */
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  warn(`unhandled rejection: ${err.message}`);
  logDiagnostics({ source: 'main', kind: 'unhandledRejection', message: err.message, stack: err.stack ?? null });
});

/**
 * Renderer → main, one `window.onerror` or `unhandledrejection` report.
 *
 * The renderer-side listener is `src/core/ipc/reportRendererDiagnostics.ts`,
 * installed from both `src/main.tsx` (host chrome) and
 * `src/paneview/main.paneview.tsx` (the extension surface); each names its own
 * surface in the `source` field it sends, and this handler trusts nothing else
 * about the payload beyond checking it is an object — the same posture
 * `registerStoreRelay` above takes toward a message it does not read for
 * meaning, because a hostile or merely buggy renderer is exactly what a fault
 * report is likely to come from.
 */
function registerDiagnosticsChannel(): void {
  ipcMain.on('shellux:diagnostics:report', (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) {
      warn('refused a diagnostics report that was not an object.');
      return;
    }
    const record = payload as Record<string, unknown>;
    const source = record.source === 'renderer-extension' ? 'renderer-extension' : 'renderer-chrome';
    const kind = typeof record.kind === 'string' ? record.kind : 'unknown';
    const message = typeof record.message === 'string' ? record.message : String(record.message);
    const stack = typeof record.stack === 'string' ? record.stack : null;
    const filename = typeof record.filename === 'string' ? record.filename : null;
    const lineno = typeof record.lineno === 'number' ? record.lineno : null;
    const colno = typeof record.colno === 'number' ? record.colno : null;
    warn(`renderer diagnostics (${source}/${kind}): ${message}`);
    logDiagnostics({ source, kind, message, stack, filename, lineno, colno });
  });
}

/**
 * Decision 3. Serves `dist/` over `APP_SCHEME`, and says so when it cannot.
 *
 * The handler itself — path containment, the 403 and 404 bodies, and the
 * Content-Security-Policy on every response (ADR-0006 decision 5) — is built in
 * electron/main/rendererCsp.ts, because this file runs `app.whenReady()` at
 * import time and so cannot be imported by a test. What stays here is the one
 * part that needs Electron: `net.fetch` over `file:`.
 */
function registerRendererProtocol(plugins: PluginStore): void {
  protocol.handle(
    APP_SCHEME,
    createRendererHandler({
      root: RENDERER_ROOT,
      fetchFile: (target) => net.fetch(pathToFileURL(target).toString()),
      warn,
      servePlugin: createPluginRoute(plugins, warn),
    }),
  );
}

/**
 * ============================================================================
 * THE PLUGIN STORE (ADR-0006 STEP 4).
 * ============================================================================
 * `<userData>/plugins/`, per user, as decision 2 fixes. The store, the
 * `/plugins/` route and the management channels are in
 * `electron/main/plugins/`, each testable because each takes its filesystem,
 * its picker and its `ipcMain` as arguments; what stays here is the three real
 * ones. `app.getPath('userData')` is read inside `whenReady`, where it is valid.
 * ============================================================================
 */
function openPluginStore(): PluginStore {
  return createPluginStore({
    root: join(app.getPath('userData'), 'plugins'),
    fs: nodePluginStoreFs,
    warn,
    report: (message) => {
      logDiagnostics({ source: 'main', kind: 'plugin-state-quarantined', message });
    },
  });
}

/**
 * Decision 2's picker, opened by main. The renderer asks for it through
 * `shellux:plugins:install` and never supplies a path; the path this returns is
 * the only one the store is given.
 */
async function pickPluginPackage(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Install a plugin',
    properties: ['openFile'],
    filters: [{ name: 'LEAPWare plugin', extensions: ['lwplugin'] }],
  };
  const result =
    paneWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(paneWindow.window, options);
  const [path] = result.filePaths;
  return result.canceled || path === undefined ? null : path;
}

/** Decision 6's sender check, over the live window. See `electron/main/plugins/pluginIpc.ts`. */
function registerPluginChannels(plugins: PluginStore): void {
  registerPluginIpc({
    ipc: ipcMain,
    hostChrome: () => paneWindow?.contentsOf('chrome') ?? null,
    store: plugins,
    pickPackage: pickPluginPackage,
    warn,
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

/** Decision 2, the other document. Panes 2 and 3, in one renderer. */
function extensionTarget(): string {
  return app.isPackaged
    ? `${APP_ORIGIN}/${EXTENSION_ENTRY}`
    : `${DEV_SERVER_URL}${EXTENSION_ENTRY}`;
}

/** Decision 6, for the one position where there is no window to fail in. */
function reportFailure(headline: string, detail: string): void {
  warn(`${headline} — ${detail}`);
  dialog.showErrorBox('LEAPWare ShellUX could not start', `${headline}\n\n${detail}`);
}

/**
 * The one window, and both of its surfaces.
 *
 * Held so that the split channel below has something to address and so that
 * `activate` can tell "no window" from "a window that is not focused".
 */
let paneWindow: PaneWindow | null = null;

/**
 * Host chrome's report of where the user put the divider, as a fraction.
 *
 * **Registered unconditionally and validated in `setSplit`.** The renderer that
 * posts this is where plug-in code runs, so a fraction is treated exactly as a
 * store write is: refused if it is not a finite number, clamped otherwise, and
 * never trusted to name a pixel column. See `PaneWindow.setSplit`.
 *
 * The host-chrome half of this — a divider that posts as it is dragged — lands
 * with the `ShellLayout` surface split. Until then the door exists, is policed,
 * and the window opens on the default share.
 */
function registerSplitChannel(): void {
  ipcMain.on('shellux:panes:split', (_event, fraction: unknown) => {
    if (paneWindow === null) return;
    if (typeof fraction !== 'number') {
      warn(`refused a pane split of type "${typeof fraction}".`);
      return;
    }
    paneWindow.setSplit(fraction);
  });
}

/**
 * ============================================================================
 * THE STORE RELAY. MAIN CARRIES THE MESSAGES AND OWNS NONE OF THEM.
 * ============================================================================
 * The replicated store's design puts the `AuthoritativeStore` in the main
 * process, and it is not there. The reason is measured rather than deferred and
 * is written up in `electron/main/portAdapter.ts` and in ADR-0001 Amendment O:
 * **this process cannot import `src/` at all under its current compilation
 * model** — `electron/tsconfig.json` is `NodeNext` because a sandboxed preload's
 * `.cjs` emit depends on it, every relative import under `src/` is extensionless
 * because a bundler resolves the renderer, and pulling
 * `src/core/ipc/AuthoritativeStore.ts` into this program reports `TS2835` on
 * every relative import in its graph.
 *
 * So the authority sits one document away, in host chrome — the surface that
 * already owns navigation, the palette and the context bar, and the one that is
 * FATAL when it dies (see `attachDiagnostics`). The extension view holds a
 * replica. What main does between them is carry bytes:
 *
 *  - it does not read the payload, so no protocol version lives here;
 *  - it does not validate it, because `AuthoritativeStore.readWrite` does, in the
 *    module that is 100% covered and that would have to do it again anyway;
 *  - it sends to every surface EXCEPT the sender, because a replica that
 *    received its own post would double-apply it.
 *
 * **What is genuinely lost by main not being the authority**, stated rather than
 * glossed: the per-origin rate limit and the severing that goes with it now
 * protect host chrome's document from the extension view rather than protecting
 * the host process from both. A wedged host chrome is already fatal by design, so
 * the limit still guards the one boundary it was written for. Moving the store
 * here is the build-system change Amendment O records two routes to; it is not
 * this phase's, and this relay is deleted rather than migrated when it happens.
 * ============================================================================
 */
function registerStoreRelay(): void {
  ipcMain.on('shellux:store:post', (event, message: unknown) => {
    if (paneWindow === null) return;
    for (const surface of ['chrome', 'extension'] as const) {
      const contents = paneWindow.contentsOf(surface);
      // `!== event.sender` is the echo suppression, and it is here rather than in
      // the renderer because here is the only place that knows which contents
      // spoke. `isDestroyed` because a view can die between the post and the
      // relay, and `send` on dead contents throws.
      if (contents === null || contents === event.sender || contents.isDestroyed()) continue;
      contents.send('shellux:store:deliver', message);
    }
  });
}

/**
 * Tell host chrome that the extension surface has a live document again.
 *
 * Only that direction, and only that surface. Host chrome holds the authority, so
 * it is the end that has to re-attach a port and re-send a snapshot; the
 * extension view has nothing to do with the news that host chrome loaded, and it
 * cannot load without host chrome having loaded first anyway — the window is not
 * even shown until chrome's contents finish.
 */
function announceSurfaceReady(surface: PaneSurfaceId): void {
  if (surface !== 'extension' || paneWindow === null) return;
  const chrome = paneWindow.contentsOf('chrome');
  if (chrome === null || chrome.isDestroyed()) return;
  chrome.send('shellux:panes:peer-ready');
}

/**
 * Route the one host chord to the one surface that can act on it.
 *
 * **Renderer-first, and main is the router rather than the matcher.** The chord
 * was recognised by `src/core/hotkeyDispatch.ts` in whichever renderer had focus,
 * AFTER that module's suppression rules — an editable target, a composition, a
 * `defaultPrevented` — had their say. None of those rules can run in this
 * process; `electron/main/paneKeyBridge.ts` explains why at length, and that is
 * the reason the escape hatch is the only thing matched here and this is a
 * message rather than a second `before-input-event` case.
 *
 * Two things happen and both are needed. Focus moves to host chrome, because a
 * palette that opens in a view the keyboard is not in is a dialog the user cannot
 * type into — the spike measured that `Tab` does not cross a view boundary and
 * that no renderer can tell whether it holds real focus, so this is main's call
 * to make. Then host chrome is told to open it.
 */
function registerPaletteRouting(): void {
  ipcMain.on('shellux:panes:palette-request', () => {
    if (paneWindow === null) return;
    paneWindow.focusRing.request('chrome');
    const chrome = paneWindow.contentsOf('chrome');
    if (chrome === null || chrome.isDestroyed()) return;
    chrome.send('shellux:panes:palette-open');
  });
}

function openShellWindow(): void {
  const opened = openShellSurfaces({
    chromeUrl: rendererTarget(),
    extensionUrl: extensionTarget(),
    origin: rendererOrigin(),
    preload: PRELOAD_SCRIPT,
    warn,
    onSurfaceReady: announceSurfaceReady,
    onRenderProcessGone: (surface, detail) => {
      logDiagnostics({ source: 'main', kind: 'render-process-gone', message: `${surface} surface: ${detail}` });
    },
  });
  followSystemAppearance(opened);
  opened.window.on('closed', () => {
    if (paneWindow === opened) paneWindow = null;
  });
  paneWindow = opened;
}

app
  .whenReady()
  .then(() => {
    const plugins = openPluginStore();
    registerRendererProtocol(plugins);
    registerPluginChannels(plugins);
    registerSplitChannel();
    registerStoreRelay();
    registerPaletteRouting();
    registerDiagnosticsChannel();
    // Before the first window, so that the `web-contents-created` listener it
    // installs sees both views rather than only whatever is created afterwards.
    initializeUpdater();
    openShellWindow();

    // Decision 8. macOS keeps the process alive with no windows, and the dock
    // icon is how a user asks for one back. `BaseWindow`, not `BrowserWindow`:
    // this application creates none of the latter, so the old call reported zero
    // forever and would have opened a window per dock click.
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) openShellWindow();
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
