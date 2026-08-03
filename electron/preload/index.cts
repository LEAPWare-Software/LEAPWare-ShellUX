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
 * One name — `shelluxHost` — with one member. The name is a namespace on purpose:
 * Phase 6's transport seam and Phase 7's theme injection both need a door of
 * their own, and a namespace lets them arrive as siblings rather than as three
 * unrelated globals accumulated in the order somebody needed them.
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
});
