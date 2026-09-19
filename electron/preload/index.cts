/**
 * ============================================================================
 * THE PRELOAD, AND THE FIRST CONTRACT IT CARRIES.
 * ============================================================================
 *
 * This file was empty for the whole of Phase 1, and the reason was written down
 * rather than left implied: `contextBridge.exposeInMainWorld` is a contract, and
 * Phase 1 had nothing to put behind such a door. Phase 9 does. The updater lives
 * in the main process — it must, because only the main process can replace the
 * application on disk and relaunch it — and the surface it is offered on is the
 * command palette, which lives in the renderer. One name crosses the boundary,
 * and this is where it is declared.
 *
 * THE EXTENSION OF THIS FILE IS LOAD-BEARING, AND IT COST A COMPILER FLAG TO
 * LEARN IT.
 *
 * `sandbox: true` is not negotiable (electron/main/index.ts decision 1), and a
 * sandboxed preload script **cannot be an ES module** — Electron loads it into a
 * CommonJS realm. The repository's root `package.json` declares
 * `"type": "module"`, so an emitted `.js` file anywhere in this tree is an ES
 * module by default, which is exactly the wrong answer here. While this file was
 * empty it sidestepped the collision by containing no `import` and no `export` at
 * all: a script is valid under either module system, and `moduleDetection:
 * "legacy"` in electron/tsconfig.json is what stopped TypeScript from emitting an
 * `export {};` that would have made it a module anyway.
 *
 * **The first line of real code ended the sidestep, and the previous version of
 * this file said in as many words what whoever wrote that line had to do.** The
 * answer is the source extension: a `.cts` file emits `.cjs`, and a `.cjs` file
 * is CommonJS whatever the nearest `package.json` says. That is why the import
 * below is written `import electron = require('electron')` — `verbatimModuleSyntax`
 * rejects ESM `import ... from` syntax in a CommonJS file, correctly, because
 * emitting one shape while writing another is how this class of bug survives
 * review. `PRELOAD_SCRIPT` in electron/main/index.ts names `index.cjs`, and
 * `preload-error` reports it if that arithmetic is ever wrong.
 *
 * WHAT IS EXPOSED, AND WHAT DELIBERATELY IS NOT.
 *
 * One name — `shelluxHost` — with two members. The name is a namespace on
 * purpose, and the second member is the proof it was the right call: `panes`
 * arrived in Phase 7 as a sibling of `updates` rather than as a second unrelated
 * global accumulated in the order somebody needed it. The transport seam and the
 * theme injection are the next two, and they arrive the same way.
 *
 * `updates` offers four things and no more: read the current state, ask for a
 * check, ask for a restart, and subscribe. There is **no way to ask this bridge
 * to download from a different feed, and no way to pass it a URL.** The feed is
 * decided at packaging time, is written into `app-update.yml` inside the
 * application's own resources, and is not reachable from the renderer at all.
 * That is the whole reason the update check does not live in the renderer: a
 * renderer that could name its own update source is a renderer that can be
 * persuaded to install something. The bridge moves *state outward* and *two
 * intents inward*, and the intents carry no arguments.
 *
 * THE INITIAL STATE IS `idle`, NOT `null`, AND THAT IS A DELIBERATE CHOICE.
 * A renderer asking "is the host there?" and a renderer asking "has the host said
 * anything yet?" are different questions, and answering both with `null` merges
 * them. The absence of `window.shelluxHost` answers the first — that is the
 * browser lane, where there is no host at all. Once the object exists, the state
 * is always a real state, and `idle` is a true description of an updater that has
 * not yet been asked anything. No race, and no window in which the palette can
 * show the wrong thing because a message has not landed yet.
 *
 * A LISTENER THAT THROWS IS CONTAINED HERE. `ipcRenderer.on` is a main-world
 * callback; an exception escaping it is unhandled, and the renderer that
 * subscribed is not the one that would see the report. The same reasoning as
 * `isVisible` in src/core/command.ts: a guarded call at the one place every
 * subscriber funnels through, so a bad subscriber cannot take the delivery loop
 * down for the good ones.
 * ============================================================================
 */

import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

/**
 * The four channel names, spelled once. `shellux:` prefixed for the same reason
 * the private scheme in electron/main/index.ts is: a name that cannot collide
 * with a framework channel or with anything a later phase adds.
 */
const CHANNEL = {
  /** Main → renderer, whenever the updater's state changes. */
  changed: 'shellux:updates:changed',
  /** Renderer → main, "check now". No payload. */
  check: 'shellux:updates:check',
  /** Renderer → main, "quit and install what was downloaded". No payload. */
  restart: 'shellux:updates:restart',
  /**
   * Renderer → main, "the divider moved; host chrome now wants this share".
   *
   * The payload is a FRACTION of the window's width and never a pixel column.
   * The two ends measure different things — the renderer knows a proportion of
   * its own group, main knows a content size in device-independent pixels — and
   * sending pixels would make the boundary depend on whose idea of a pixel was
   * current. Main clamps and refuses; see `PaneWindow.setSplit`.
   */
  split: 'shellux:panes:split',
  /**
   * Renderer → main, one replicated-store message for the OTHER surface.
   *
   * Main is a relay on this channel and nothing else: it does not read the
   * payload, does not validate it and holds no store. See the transport block
   * below for why the authority is in host chrome's document rather than in main,
   * and `electron/main/portAdapter.ts` for the measurement that put it there.
   */
  storePost: 'shellux:store:post',
  /** Main → renderer, one replicated-store message from the other surface. */
  storeDeliver: 'shellux:store:deliver',
  /**
   * Main → host chrome, "the extension surface has finished loading".
   *
   * The reason this exists is the crash-containment branch in
   * `electron/main/paneViews.ts`: an extension view that died is RELOADED, and a
   * reloaded view is a brand-new realm with a brand-new replica that has never
   * seen a `resync`. Without this signal the shell would come back looking
   * correct and be permanently stale — panes 2 and 3 alive, and the selection in
   * pane 1 never reaching them again. Host chrome re-attaches the port when it
   * arrives, which re-sends the snapshot.
   */
  peerReady: 'shellux:panes:peer-ready',
  /**
   * Renderer → main, "this chord is host chrome's and I am not host chrome".
   *
   * **The renderer decides, and main only routes.** `before-input-event` in
   * `electron/main/paneKeyBridge.ts` fires before DOM handling and carries
   * neither a target nor `defaultPrevented`, so main cannot tell a chord aimed at
   * the shell from the same chord aimed at the omnibox composer the user is
   * typing in. `src/core/hotkeyDispatch.ts` can, and already does — so the
   * suppression rules stay where they are and what crosses is the intent that
   * survived them. That is the difference between an escape hatch and a keyboard
   * layer, and it is why this is a separate channel from the one in
   * `paneKeyBridge.ts` rather than a second chord in it.
   */
  paletteRequest: 'shellux:panes:palette-request',
  /** Main → host chrome, "open the palette; another surface asked for it". */
  paletteOpen: 'shellux:panes:palette-open',
  /**
   * Renderer → main, one `window.onerror` or `unhandledrejection` report.
   *
   * GitHub issue #86. One-way, exactly as `updates.check` is: the renderer
   * reports and never learns whether the write succeeded, because a reporting
   * channel that could fail loudly back into the page it is reporting from is
   * the wrong place to put a second failure.
   */
  diagnosticsReport: 'shellux:diagnostics:report',
} as const;

/** Mirrors `UpdateState` in electron/main/updater.ts. Structured-clone shaped. */
interface UpdateState {
  readonly status: string;
  readonly version: string | null;
  readonly detail: string | null;
}

const INITIAL: UpdateState = { status: 'idle', version: null, detail: null };

let latest: UpdateState = INITIAL;

const listeners = new Set<(state: UpdateState) => void>();

ipcRenderer.on(CHANNEL.changed, (_event: unknown, state: UpdateState) => {
  latest = state;
  // A copy, so a listener that unsubscribes during delivery does not mutate the
  // set being iterated.
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch (error) {
      try {
        console.error('shelluxHost.updates: a subscriber threw. It is not called again for this delivery.', error);
      } catch {
        // Reporting is best-effort. Delivering to the remaining subscribers is not.
      }
    }
  }
});

/**
 * ============================================================================
 * THE TRANSPORT DOOR. TWO DOCUMENTS, ONE REPLICATED STORE.
 * ============================================================================
 * `src/core/ipc/` implements the replicated store the two-process topology needs
 * — `AuthoritativeStore`, `ReplicaStore` and the `PortLike` seam between them —
 * and every one of those modules is inside the 100% coverage gate. What is
 * exposed here is the transport underneath them, and it is deliberately as thin
 * as the update door: a `postMessage` outward, a subscription inward, and no way
 * to name a peer, a channel or a surface.
 *
 * **`onMessage` rather than a settable `onmessage`, and that is a constraint
 * rather than a preference.** `PortLike` in `src/core/ipc/PortLike.ts` wants a
 * property a consumer assigns to; `contextBridge` copies the object it is given
 * into the main world, so a property assigned on the far side would be assigned
 * on a copy nobody reads. A subscribe function crosses the bridge intact, so the
 * bridge offers one and the four-line adapter that turns it back into a
 * `PortLike` lives in `src/App.tsx`, in the realm that consumes it.
 *
 * **Nothing is imported from `src/` to describe these shapes**, for the reason
 * `electron/main/portAdapter.ts` sets out at length: this file is CommonJS under
 * `NodeNext`, `src/`'s relative imports are extensionless, and an import would be
 * `TS2835` on the whole graph. The members are restated structurally and are two
 * lines each.
 *
 * A listener that throws is contained exactly as the update door's are, and for
 * the identical reason.
 */
const transportListeners = new Set<(message: unknown) => void>();
const peerReadyListeners = new Set<() => void>();
const paletteListeners = new Set<() => void>();

/** Deliver to a snapshot of the set, so an unsubscribing listener is safe. */
function deliver<T>(listeners: Set<(value: T) => void>, value: T, what: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      try {
        console.error(`shelluxHost.transport: a ${what} subscriber threw. It is not called again for this delivery.`, error);
      } catch {
        // Reporting is best-effort. Delivering to the remaining subscribers is not.
      }
    }
  }
}

ipcRenderer.on(CHANNEL.storeDeliver, (_event: unknown, message: unknown) => {
  deliver(transportListeners, message, 'message');
});

ipcRenderer.on(CHANNEL.peerReady, () => {
  deliver(peerReadyListeners, undefined, 'peer-ready');
});

ipcRenderer.on(CHANNEL.paletteOpen, () => {
  deliver(paletteListeners, undefined, 'palette');
});

contextBridge.exposeInMainWorld('shelluxHost', {
  updates: {
    getState: (): UpdateState => latest,
    check: (): void => {
      ipcRenderer.send(CHANNEL.check);
    },
    restart: (): void => {
      ipcRenderer.send(CHANNEL.restart);
    },
    subscribe: (listener: (state: UpdateState) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
  /**
   * The geometry door, and the second member of the namespace.
   *
   * **It moves an intent outward and carries no authority.** A renderer cannot
   * set a rectangle, cannot address the other view, and cannot learn where the
   * other view is; it can say what share of the window its own divider is at,
   * and main decides what that means. That asymmetry is the same one the update
   * door has — state outward, intents inward, no arguments that name a resource
   * — and it is why `setBounds` is called in exactly one function in exactly one
   * process.
   */
  panes: {
    setSplit: (fraction: number): void => {
      ipcRenderer.send(CHANNEL.split, fraction);
    },
    /**
     * Hand one host chord to whichever surface owns the palette.
     *
     * No argument, exactly as `updates.check` takes none: the door moves an
     * INTENT and never names a resource. There is one host chord
     * (`HOST_CHORDS` in `src/core/hotkeyDispatch.ts` holds one entry), so a
     * parameter here would be a name a renderer could invent.
     */
    requestPalette: (): void => {
      ipcRenderer.send(CHANNEL.paletteRequest);
    },
    onPaletteRequest: (listener: () => void): (() => void) => {
      paletteListeners.add(listener);
      return () => {
        paletteListeners.delete(listener);
      };
    },
  },
  /**
   * The fault-report door. GitHub issue #86.
   *
   * One method, no return value, no acknowledgement — the same shape as
   * `panes.setSplit`: the renderer states an intent and main decides what to do
   * with it. `payload` crosses structured-clone as-is; main is the one that
   * decides which fields it trusts, in `registerDiagnosticsChannel` in
   * `electron/main/index.ts`.
   */
  diagnostics: {
    report: (payload: unknown): void => {
      ipcRenderer.send(CHANNEL.diagnosticsReport, payload);
    },
  },
  /** The replicated store's transport. See the block above this call. */
  transport: {
    postMessage: (message: unknown): void => {
      ipcRenderer.send(CHANNEL.storePost, message);
    },
    onMessage: (listener: (message: unknown) => void): (() => void) => {
      transportListeners.add(listener);
      return () => {
        transportListeners.delete(listener);
      };
    },
    onPeerReady: (listener: () => void): (() => void) => {
      peerReadyListeners.add(listener);
      return () => {
        peerReadyListeners.delete(listener);
      };
    },
  },
});
