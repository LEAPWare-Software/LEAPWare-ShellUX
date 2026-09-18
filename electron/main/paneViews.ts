import { BaseWindow, WebContentsView, dialog, nativeTheme, shell } from 'electron';
import type { WebContents } from 'electron';
import { release } from 'node:os';
import { createFocusRing } from './focusRing.js';
import type { FocusRing, FocusableSurface } from './focusRing.js';
import { attachEscapeHatch } from './paneKeyBridge.js';
import { INITIAL_FOCUS_SURFACE, PANE_SURFACE_IDS } from './surfaces.js';
import type { PaneSurfaceId } from './surfaces.js';

/**
 * ============================================================================
 * THE PROCESS SPLIT. ONE `BaseWindow`, TWO `WebContentsView`s, ONE FOCUS RING.
 * ============================================================================
 * Phase 1 shipped a single `BrowserWindow` and said in as many words why the
 * split was not built yet: the topology was gated on an accessibility spike that
 * had not been run, and building the split before the gate meant building it
 * twice. The spike has now been built and its machine-observable half has been
 * run — `spike/topology/RESULTS.md`, Electron 43.2.0 / Chromium 150.0.7871.129 —
 * and this file is the split, in the **two-process** shape.
 *
 * `electron/main/surfaces.ts` carries the argument for two rather than three,
 * and carries the reason that choosing two is not a decision on ADR-0005: two is
 * the option that is safe under either outcome of the arm that decides it.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED FROM `BrowserWindow`, AND WHAT EACH CHANGE COSTS
 * ---------------------------------------------------------------------------
 * A `BaseWindow` is not a `BrowserWindow` with more views. Four things Phase 1
 * relied on do not exist on it, and every one of them is a way to arrive back at
 * the blank native rectangle that file's decision 6 exists to prevent:
 *
 *  1. **`window.webContents` does not exist.** Every per-contents rule — the
 *     window-open handler, `will-navigate`, `did-fail-load`, `preload-error` — is
 *     now installed per VIEW, by `lockDown` and `attachDiagnostics` below. A rule
 *     installed on the window would have been installed on nothing.
 *  2. **`ready-to-show` is never emitted.** The window is created hidden and is
 *     shown when host chrome's own contents finish loading. Waiting for BOTH
 *     views would mean an extension view that never loads keeps the whole
 *     application invisible, which trades a flash for a hang.
 *  3. **`BrowserWindow.getAllWindows()` reports zero.** The lifecycle in
 *     `index.ts` counts `BaseWindow.getAllWindows()` instead. Left uncorrected,
 *     macOS's `activate` handler would open a second window on every dock click
 *     and `window-all-closed` would never be the right question.
 *  4. **A crashed renderer is no longer the whole application.** That is the
 *     entire purchase of the split, so `render-process-gone` branches: host
 *     chrome dying is fatal exactly as it was, and the extension view dying is
 *     RELOADED, with the rail, pane 1 and the command surfaces left standing.
 *     This is the property `test:desktop` exists to prove and the reason the
 *     ADR calls it crash containment rather than isolation.
 *
 * ---------------------------------------------------------------------------
 * GEOMETRY IS MAIN'S, AND `setBounds` IS THE ONLY WRITER
 * ---------------------------------------------------------------------------
 * A `WebContentsView` has no CSS relationship to anything; its rectangle is set
 * from here and from nowhere else. `layout()` below is the single function that
 * computes both rectangles, and it runs on exactly three signals: the window
 * resizing, a view being added, and host chrome reporting a new split.
 *
 * **The split is a fraction, not a pixel column**, because the two ends measure
 * different things: host chrome knows where the user dragged a divider as a
 * proportion of its own group, and main knows the window's content size in
 * device-independent pixels. Sending pixels would make the boundary depend on
 * which end's idea of a pixel was current, which is the class of bug that only
 * appears on a display scale nobody tested on.
 *
 * ---------------------------------------------------------------------------
 * MICA IS ON THE WINDOW AND ON NOTHING ELSE
 * ---------------------------------------------------------------------------
 * Phase 1 decision 7 recorded the obligation this file inherits, in the commit
 * where it would be got wrong: **the `WebContentsView`s must not set
 * `backgroundMaterial` at all.** Microsoft's guidance is not to apply a backdrop
 * material more than once and to keep vertical panes opaque, and two views each
 * asking for Mica is precisely "more than once". So the material is requested on
 * the `BaseWindow`, both views are given an OPAQUE background colour, and the
 * material is visible where the system draws it — the title bar and the frame.
 *
 * The opaque colour is also the fallback, not a code path: Transparency-off and
 * Battery Saver are states Electron surfaces no signal for, and a material that
 * does not draw leaves a solid surface rather than a black one.
 * ============================================================================
 */

/** Windows 11 22H2. Below this build there is no Mica to ask for. */
const WINDOWS_11_22H2_BUILD = 22621;

/** Chromium's code for a navigation that was cancelled rather than failed. */
const ERR_ABORTED = -3;

/**
 * The fraction of the window's width host chrome occupies before anything has
 * been dragged.
 *
 * It is pane 1 at the pixel intent `ShellLayout`'s `PANE_PX` already expresses —
 * `navDefault` is 240px — plus the pane's own border and padding, taken against
 * the 1280px default width this window opens at. It is a starting point and not
 * a policy: the first report from host chrome replaces it, and nothing here
 * remembers it afterwards.
 *
 * **It was 0.32 while both views loaded the whole shell**, which was three panes
 * crammed into a third of the window beside three more. Host chrome draws pane 1
 * and nothing else now, and 0.32 of 1280 is 410px — past `PANE_PX.navMax` — so
 * the number that used to be too narrow for what was in it became too wide for
 * what is in it. 0.22 is 282px.
 */
const DEFAULT_CHROME_FRACTION = 0.22;

/**
 * How far the split may be driven from either edge.
 *
 * A renderer is not trusted with geometry any more than it is trusted with a
 * store write. A fraction of 0 would leave host chrome a zero-width view — no
 * rail, no navigation, and no route back to a different extension — and a
 * fraction of 1 would do the same to the extension. Both are states a user
 * cannot escape from with the mouse, so the host clamps rather than obeys.
 */
const MIN_SPLIT_FRACTION = 0.12;
const MAX_SPLIT_FRACTION = 0.8;

/** What `openShellSurfaces` needs from its caller, and nothing more. */
export interface PaneWindowOptions {
  /** The URL host chrome loads. */
  readonly chromeUrl: string;
  /** The URL the extension view loads. */
  readonly extensionUrl: string;
  /**
   * The prefix a top-level navigation must begin with to be permitted.
   *
   * One value for both views, because both are served from one origin — the
   * private scheme when packaged, the dev server otherwise. A view is not
   * permitted to navigate to the OTHER view's document either; the check is a
   * prefix test on the origin, and both documents share it.
   */
  readonly origin: string;
  /** The compiled preload both views load. */
  readonly preload: string;
  /** One diagnostic channel, so a failure reads the same wherever it came from. */
  readonly warn: (message: string) => void;
  /**
   * Called every time a surface's document finishes loading, including after a
   * reload.
   *
   * **"Including after a reload" is the whole reason it is a callback rather
   * than a promise.** `render-process-gone` reloads the extension view below, and
   * the realm that comes back is a new one with a new replicated store that has
   * never received a snapshot. A one-shot "ready" would report the first load and
   * leave every recovered view permanently stale — which looks exactly like the
   * defect the split was built to avoid rather than like a crash.
   */
  readonly onSurfaceReady?: (surface: PaneSurfaceId) => void;
  /**
   * Record that a surface's renderer process is gone, before the branch below
   * decides whether that is fatal (`chrome`) or recovered (`extension`).
   *
   * GitHub issue #86: this event previously reached `warn` — stderr, which
   * nobody reads on a packaged application — and nothing else. Optional so
   * every existing test that constructs `PaneWindowOptions` without it keeps
   * passing; `index.ts` is the only caller that supplies it.
   */
  readonly onRenderProcessGone?: (surface: PaneSurfaceId, detail: string) => void;
}

/** The handle `index.ts` holds on the running window. */
export interface PaneWindow {
  readonly window: BaseWindow;
  readonly focusRing: FocusRing;
  /** The web contents of one surface, or `null` once it has been destroyed. */
  contentsOf(surface: PaneSurfaceId): WebContents | null;
  /**
   * Record a new host-chrome share of the window's width, and re-lay out.
   *
   * Untrusted input: it arrives from a renderer. Non-finite values are refused
   * and everything else is clamped to the band above.
   */
  setSplit(fraction: number): void;
}

/** One surface's live state. */
interface PaneSurface {
  readonly id: PaneSurfaceId;
  readonly view: WebContentsView;
  /** The document this surface is meant to be showing, for a reload after a crash. */
  readonly url: string;
  destroyed: boolean;
}

/** Decision 7 of Phase 1, unchanged: whether this machine can draw the material. */
function supportsBackdropMaterial(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number(release().split('.')[2]);
  return Number.isFinite(build) && build >= WINDOWS_11_22H2_BUILD;
}

function backdropMaterial(): 'mica' | 'none' {
  return supportsBackdropMaterial() && !nativeTheme.shouldUseHighContrastColors ? 'mica' : 'none';
}

/** The opaque surface colour, following the system appearance. */
function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open the window and both views.
 *
 * The order below is deliberate and is the spike's finding 1 applied: both views
 * are created and added, and NOTHING asserts focus at that point. The focus ring
 * asserts when both views report a completed load, because that is when the
 * steal has already happened — a host that re-asserted on the line after
 * `addChildView` would re-assert too early and lose the race it was trying to
 * win.
 */
export function openShellSurfaces(options: PaneWindowOptions): PaneWindow {
  const { warn } = options;

  const window = new BaseWindow({
    width: 1280,
    height: 800,
    // The same floor Phase 1 chose, and for the same measured reason: below
    // roughly 700 CSS px `ShellLayout`'s pixel minimums stop fitting
    // simultaneously and `react-resizable-panels` warns on every render.
    minWidth: 800,
    minHeight: 600,
    backgroundColor: surfaceColor(),
    backgroundMaterial: backdropMaterial(),
    titleBarStyle: 'default',
    show: false,
  });

  let chromeFraction = DEFAULT_CHROME_FRACTION;

  const surfaces = new Map<PaneSurfaceId, PaneSurface>();

  /** Report a failure the same way in every position, and show it. */
  function reportFailure(headline: string, detail: string): void {
    warn(`${headline} — ${detail}`);
    dialog.showErrorBox('LEAPWare ShellUX could not start', `${headline}\n\n${detail}`);
  }

  /**
   * Compute and apply both rectangles.
   *
   * One function, so the two views cannot be laid out against two different
   * ideas of the window's size. `Math.round` on the boundary rather than on each
   * width, so the two rectangles ABUT exactly: rounding independently leaves a
   * one-pixel seam of window background at some window widths, which reads as a
   * rendering defect and is arithmetic.
   */
  function layout(): void {
    if (window.isDestroyed()) return;
    const { width, height } = window.getContentBounds();
    const boundary = Math.round(width * chromeFraction);
    const chrome = surfaces.get('chrome');
    const extension = surfaces.get('extension');
    if (chrome !== undefined && !chrome.destroyed) {
      chrome.view.setBounds({ x: 0, y: 0, width: boundary, height });
    }
    if (extension !== undefined && !extension.destroyed) {
      extension.view.setBounds({
        x: boundary,
        y: 0,
        width: Math.max(0, width - boundary),
        height,
      });
    }
  }

  /**
   * Every per-contents security rule from Phase 1 decision 5, installed per view.
   *
   * This is the half that a `BaseWindow` silently drops if it is not moved: with
   * no `window.webContents` there is nothing for the old call sites to attach to,
   * and a window-open handler that was never installed denies nothing.
   */
  function lockDown(contents: WebContents): void {
    contents.setWindowOpenHandler(({ url }) => {
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

    contents.on('will-navigate', (event, url) => {
      if (url.startsWith(options.origin)) return;
      event.preventDefault();
      warn(`refused a top-level navigation to ${url}`);
    });
  }

  /**
   * The diagnostics of Phase 1 decision 6, per view, with one branch added.
   *
   * **`render-process-gone` is where the split earns its cost.** Host chrome is
   * the rail, pane 1, the context bar and the palette: with it gone there is
   * nothing left that can paint and nothing a user can act on, so it is fatal
   * exactly as the single window was. The extension view is a pane, and a pane
   * that died is reloaded into the shell that survived it. That branch is the
   * difference between "an extension crash cannot take the shell down" being a
   * claim and being a behaviour.
   *
   * The reload is unconditional and is not rate-limited here, which is stated
   * rather than left to be discovered: a deterministically crashing extension
   * view will reload into its own crash. What stops that being infinite is the
   * same thing that stops a write storm — main's per-origin accounting — and
   * that lives with the authoritative store, which is not yet in this process.
   * See the ADR-0001 amendment.
   */
  function attachDiagnostics(surface: PaneSurface): void {
    const contents = surface.view.webContents;

    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === ERR_ABORTED) return;
      reportFailure(
        `Could not load ${validatedURL} for the ${surface.id} surface`,
        `${errorDescription} (${String(errorCode)})`,
      );
      // The window is created hidden. A failure before it was ever shown would
      // otherwise leave a dismissed dialog and a process with no window, which
      // on macOS does not even quit.
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    });

    contents.on('render-process-gone', (_event, details) => {
      const detail = `reason: ${details.reason}, exit code: ${String(details.exitCode)}`;
      options.onRenderProcessGone?.(surface.id, detail);
      if (surface.id === 'chrome') {
        reportFailure('The host chrome process stopped', detail);
        if (!window.isDestroyed()) window.destroy();
        return;
      }
      warn(`the extension view stopped (${detail}); reloading it.`);
      if (surface.destroyed || window.isDestroyed()) return;
      surface.view.webContents.loadURL(surface.url).catch(() => {
        /* reported by this surface's own did-fail-load handler. */
      });
    });

    contents.on('preload-error', (_event, preloadPath, error) => {
      reportFailure(
        `The preload script failed for the ${surface.id} surface`,
        `${preloadPath}\n${describeError(error)}`,
      );
    });
  }

  function createSurface(id: PaneSurfaceId, url: string): PaneSurface {
    const view = new WebContentsView({
      webPreferences: {
        preload: options.preload,
        // Phase 1 decision 1. All three, in both views, and no exceptions.
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // OPAQUE. Not a preference — see the Mica block in the banner. The alpha
    // channel is spelled out so that a reader can see it is deliberately `ff`.
    view.setBackgroundColor(`${surfaceColor()}ff`);
    const surface: PaneSurface = { id, view, url, destroyed: false };
    surfaces.set(id, surface);
    lockDown(view.webContents);
    attachDiagnostics(surface);
    return surface;
  }

  /**
   * The ring's view of a surface.
   *
   * `isFocused` is read through the web contents rather than cached, because the
   * spike's finding 2 is that the renderer cannot know and main can: a cached
   * answer would be main reproducing the renderer's blindness.
   */
  function focusable(id: PaneSurfaceId): FocusableSurface {
    return {
      id,
      focus: (): void => {
        const surface = surfaces.get(id);
        if (surface === undefined || surface.destroyed) return;
        surface.view.webContents.focus();
      },
      isFocused: (): boolean => {
        const surface = surfaces.get(id);
        if (surface === undefined || surface.destroyed) return false;
        return surface.view.webContents.isFocused();
      },
      isAlive: (): boolean => {
        const surface = surfaces.get(id);
        return surface !== undefined && !surface.destroyed;
      },
    };
  }

  const chrome = createSurface('chrome', options.chromeUrl);
  const extension = createSurface('extension', options.extensionUrl);

  const focusRing = createFocusRing({
    surfaces: PANE_SURFACE_IDS.map(focusable),
    initial: INITIAL_FOCUS_SURFACE,
    warn,
  });

  for (const surface of [chrome, extension]) {
    // `did-finish-load` and not `dom-ready`: the spike read the steal as having
    // happened once `loadFile()` had resolved, and this is the main-process event
    // for that point.
    surface.view.webContents.on('did-finish-load', () => {
      if (surface.id === 'chrome' && !window.isDestroyed() && !window.isVisible()) {
        window.show();
      }
      focusRing.noteReady(surface.id);
      options.onSurfaceReady?.(surface.id);
    });
    // The one place a view is allowed to tell the ring anything. A view that has
    // just been focused by the platform — by a click, or by the #42339 steal —
    // is a signal to check the intent, not to change it.
    surface.view.webContents.on('focus', () => {
      focusRing.reconcile();
    });
    surface.view.webContents.on('destroyed', () => {
      surface.destroyed = true;
    });
    attachEscapeHatch(surface.view.webContents, surface.id, focusRing, warn);
    window.contentView.addChildView(surface.view);
  }

  layout();

  window.on('resize', layout);

  window.on('closed', () => {
    surfaces.clear();
  });

  for (const surface of [chrome, extension]) {
    surface.view.webContents.loadURL(surface.url).catch(() => {
      /* reported by this surface's own did-fail-load handler. */
    });
  }

  return {
    window,
    focusRing,
    contentsOf(surface: PaneSurfaceId): WebContents | null {
      const held = surfaces.get(surface);
      if (held === undefined || held.destroyed) return null;
      return held.view.webContents;
    },
    setSplit(fraction: number): void {
      if (!Number.isFinite(fraction)) {
        warn(`refused a pane split of ${String(fraction)}, which is not a finite number.`);
        return;
      }
      chromeFraction = Math.min(MAX_SPLIT_FRACTION, Math.max(MIN_SPLIT_FRACTION, fraction));
      layout();
    },
  };
}

/**
 * Keep the window's material and both views' opaque colour following the system.
 *
 * The material is a Windows call and is guarded as one; the colour is not, since
 * every platform has an appearance and can change it while the window is open.
 * Both views are recoloured, because an opaque pane that stayed white through a
 * switch to a dark appearance is the most visible defect the shell can have.
 */
export function followSystemAppearance(pane: PaneWindow): void {
  const update = (): void => {
    if (pane.window.isDestroyed()) return;
    pane.window.setBackgroundColor(surfaceColor());
    if (process.platform === 'win32') pane.window.setBackgroundMaterial(backdropMaterial());
  };
  nativeTheme.on('updated', update);
  pane.window.on('closed', () => {
    nativeTheme.off('updated', update);
  });
}
