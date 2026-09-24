import type { ReactElement, ReactNode } from 'react';
import { RootBoundary } from './components/error/RootBoundary';
import { ShellLayout } from './components/layout/ShellLayout';
import type { ShellSurface } from './components/layout/ShellLayout';
import { ShellHostProvider } from './core/ActivationContext';
import { createAuthoritativeStore } from './core/ipc/AuthoritativeStore';
import { createReplicaStore } from './core/ipc/ReplicaStore';
import type { PortLike } from './core/ipc/PortLike';
import type { OriginViolation } from './core/ipc/protocol';
import { ExtensionRegistryProvider } from './core/RegistryContext';
import type { ShellStateStore } from './core/ShellAPI';
import type { HostUpdateState } from './core/updates/hostUpdates';

/**
 * ============================================================================
 * WHICH SURFACE A DOCUMENT IS, AND WHAT ITS STORE IS PLUGGED INTO.
 * ============================================================================
 * Phase 7 gave the desktop host two `WebContentsView`s and therefore two
 * documents. Everything that decides *which half of the shell a document draws*
 * and *what its shell store is connected to* is in the two exported functions
 * below, and the three entry points — `src/main.tsx`, `src/dev/main.dev.tsx`,
 * `src/paneview/main.paneview.tsx` — call one of them and do nothing else about
 * the split.
 *
 * **It lives in this file because this file is what host chrome IS**, and
 * because it is the one module both host-chrome entry points already share: the
 * production document renders `App`, and the fixture document renders `App` with
 * two plug-ins registered. A third module beside them would be a second place to
 * look for one decision.
 *
 * **The extension document does NOT import this one.** It attaches its own
 * replica, over its own ten-line adapter, in `src/paneview/main.paneview.tsx` —
 * which states why at that end. Sharing the adapter would put host chrome's whole
 * component tree in the extension document's import graph, and
 * `src/__tests__/crossDocumentIdref.test.ts` reads that graph pessimistically on
 * purpose.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SURFACE IS DECIDED BY THE PRESENCE OF A HOST AND NOT BY A FLAG
 * ---------------------------------------------------------------------------
 * `index.html` is two things: the production browser SPA, and host chrome's
 * document inside the desktop window. `dev.html` is likewise the browser-lane
 * fixture and, on the dev server, what the chrome view actually loads. Neither
 * can be told apart from the other by its own name.
 *
 * What *can* tell them apart is whether there is a native host beside the
 * document — `window.shelluxHost`, the same signal `src/hooks/useHostUpdates.ts`
 * already reads, put there by a preload that only exists inside the window. A
 * document with a host beside it is one of two surfaces and draws its half; a
 * document alone in a browser tab is the whole shell and draws all of it.
 *
 * That rule is what keeps the browser lane — 51 Playwright specs, every unit
 * test, and every reader following README's Getting Started — on `'full'`
 * without one of them naming a surface. **No environment variable and no query
 * string**, which is ADR-0002 clause 6 and the argument `vite.config.ts` and
 * `src/dev/DevShell.tsx` both make about `VITE_MOCKS`: there is nothing to set
 * and nothing to remember.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE AUTHORITY LIVES, AND WHY IT IS NOT IN MAIN
 * ---------------------------------------------------------------------------
 * `src/core/ipc/` implements the replicated store the way the design wanted it:
 * an `AuthoritativeStore` with one truth, per-origin rate limiting and a commit
 * broadcast, and a `ReplicaStore` per renderer that applies optimistically and
 * converges on the commits. All of it is inside the 100% coverage gate, and none
 * of it is rebuilt here.
 *
 * The one thing that moved is *which process the authority runs in*. It was to
 * be main. Main cannot import `src/` at all under its current compilation
 * model — `electron/tsconfig.json` is `NodeNext`, `src/`'s relative imports are
 * extensionless, and the graph reports `TS2835` on every one of them. That is
 * measured, it is written up in `electron/main/portAdapter.ts` and ADR-0001
 * Amendment O, and fixing it is a build-system change rather than a shell one.
 *
 * So the authority runs in **host chrome's document**: the surface that already
 * owns navigation, the palette and the context bar, and the one whose death is
 * already fatal to the whole window (`attachDiagnostics` in
 * `electron/main/paneViews.ts`). Main is a relay between the two views and reads
 * nothing it carries.
 *
 * **Host chrome talks to its own authority over an in-document `MessageChannel`
 * rather than reaching into it**, and that is deliberate rather than ceremonial.
 * `AuthoritativeStore` is not a `ShellStateStore` — its one write door is
 * `dispatch`, precisely so that a host cannot acquire a write handle that does
 * not broadcast. Giving host chrome a replica of its own means the two documents
 * are the same kind of thing, run the same code path, and converge by the same
 * rule; the alternative would have been a second write door with a second set of
 * semantics, in the file that is hardest to test.
 *
 * The cost is that host chrome's own writes commit on a task rather than
 * synchronously. Nothing reads through the commit: `ReplicaStore` applies every
 * accepted write to its local store **before** it posts, so a click in pane 1 is
 * visible in pane 1's own render immediately and the round trip only decides
 * ordering. That is the same guarantee the extension view has.
 * ============================================================================
 */

/**
 * What main knows each surface as, on the wire.
 *
 * The same two strings `originOf` in `electron/main/surfaces.ts` derives, and
 * they are spelled the way `MAIN_ORIGIN` in `src/core/ipc/protocol.ts` is: for
 * the reason given there, `EXTENSION_ID_PATTERN` admits neither `_` nor `:`, so
 * no registry-valid extension id can collide with one of them.
 */
const CHROME_ORIGIN = '__view:chrome__';
const EXTENSION_ORIGIN = '__view:extension__';

/**
 * The transport the preload exposes. Restated here because the preload cannot
 * import `src/` either; `electron/preload/index.cts` carries the argument.
 *
 * `onMessage` is a subscription rather than a settable `onmessage` because
 * `contextBridge` copies the object it publishes, so a property assigned on this
 * side would be assigned on a copy the host never reads.
 */
interface HostPaneTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onPeerReady(listener: () => void): () => void;
}

/**
 * THE WHOLE OF `window.shelluxHost`, DECLARED ONCE.
 *
 * It lived in `src/hooks/useHostUpdates.ts` while the updater was the only thing
 * behind the bridge. It is here now because there are three members and two
 * readers, and TypeScript merges `interface Window` across files but not one
 * PROPERTY declared twice with two shapes — so a second module declaring its own
 * half of `shelluxHost` is a compile error rather than a merge. The mirror of
 * this object is `contextBridge.exposeInMainWorld` in
 * `electron/preload/index.cts`, which is the only thing that ever creates it.
 */
declare global {
  interface Window {
    readonly shelluxHost?: {
      readonly updates?: {
        getState(): HostUpdateState;
        check(): void;
        restart(): void;
        subscribe(listener: (state: HostUpdateState) => void): () => void;
      };
      readonly panes?: {
        setSplit(fraction: number): void;
        requestPalette(): void;
        onPaletteRequest(listener: () => void): () => void;
      };
      readonly transport?: HostPaneTransport;
    };
  }
}

/** The transport, or `null` when this document is not running inside the host. */
function hostTransport(): HostPaneTransport | null {
  return window.shelluxHost?.transport ?? null;
}

/**
 * A `PortLike` over the preload's transport.
 *
 * Four lines, and the same four `adaptMessagePort` in
 * `electron/main/portAdapter.ts` is: forward `postMessage`, read `onmessage` at
 * DELIVERY time rather than capturing it, and start listening. Reading the
 * handler at delivery is what gives `PortLike`'s documented drop-not-queue
 * semantics — a message that arrives before anybody installed a handler is
 * discarded, which is the honest model of a document that has not finished
 * booting.
 */
function adaptTransport(transport: HostPaneTransport): PortLike {
  const seam: PortLike = {
    postMessage: (message: unknown): void => {
      transport.postMessage(message);
    },
    onmessage: null,
  };
  transport.onMessage((message) => {
    seam.onmessage?.(message);
  });
  return seam;
}

/** A browser `MessagePort` as a `PortLike`. Assigning `onmessage` starts it. */
function adaptMessagePort(port: MessagePort): PortLike {
  const seam: PortLike = {
    postMessage: (message: unknown): void => {
      port.postMessage(message);
    },
    onmessage: null,
  };
  port.onmessage = (event): void => {
    seam.onmessage?.(event.data);
  };
  return seam;
}

/**
 * Report a misbehaving replica. The host action §5 names for a storm is to
 * reload the pane, which this document cannot do — so it says so, loudly, on the
 * one channel a developer running the shell will actually see.
 */
function reportViolation(violation: OriginViolation): void {
  console.error('ShellUX transport: a surface posted something the authority refused.', violation);
}

/** What this document needs to render itself, and nothing more. */
interface HostSurfaceWiring {
  /** Which half of the shell this document draws. See `ShellSurface`. */
  readonly surface: ShellSurface;
  /**
   * The store to hand `ShellHostProvider`, or `undefined` for the local default.
   *
   * `undefined` is the browser lane and is not a degraded mode: a document with
   * no second document beside it replicates to nobody, and a plain
   * `createShellStateStore()` is the exact description of that.
   */
  readonly store: ShellStateStore | undefined;
}

/**
 * Wire the host-chrome document.
 *
 * **Called at module scope, never from an effect.** Both documents render under
 * `StrictMode`, whose double-invoked effects would open the channel twice and
 * leave two authorities disagreeing — a defect that presents as "selection
 * sometimes does not cross", which is the worst shape of bug on this seam.
 */
function wireHostChrome(): HostSurfaceWiring {
  const transport = hostTransport();
  if (transport === null) {
    return { surface: 'full', store: undefined };
  }

  const authority = createAuthoritativeStore({ now: Date.now, onViolation: reportViolation });

  // Host chrome's own replica FIRST. `connect` posts its opening `resync` before
  // it returns and `PortLike` drops rather than queues, so a replica created
  // after the connect would miss the snapshot it renders from.
  const loopback = new MessageChannel();
  const store = createReplicaStore({ port: adaptMessagePort(loopback.port2), origin: CHROME_ORIGIN });
  authority.connect(adaptMessagePort(loopback.port1), CHROME_ORIGIN);

  // The extension view. Re-attached on every load of that document rather than
  // once: `render-process-gone` reloads it, and the realm that comes back has a
  // replica that has never had a snapshot. Detaching first also returns the
  // origin's rate-limit budget, so a pane that was severed for storming gets a
  // clean one when it is replaced.
  //
  // **ONE SEAM, RE-CONNECTED — not a new seam each time, which is what this was
  // and which leaked.** `adaptTransport` registers a listener with the preload
  // and discards the unsubscribe, so a fresh seam per reattach left the previous
  // one subscribed for the life of the document: after the first extension-view
  // reload every inbound message would be delivered twice, and once more per
  // reload after that. It converged rather than corrupting — every
  // `StoreOperation` carries an absolute value, so applying one twice lands on
  // the same context — which is exactly why it would not have been noticed.
  //
  // Reusing the seam is correct rather than merely cheaper, and it depends on a
  // property of `AuthoritativeStore.connect` worth naming: it ASSIGNS
  // `port.onmessage` and its disconnect sets it back to `null`. So the second
  // `connect` replaces the first handler on the same object, and there is never
  // a moment with two live handlers on one seam.
  const extensionSeam = adaptTransport(transport);
  let detach = authority.connect(extensionSeam, EXTENSION_ORIGIN);
  transport.onPeerReady(() => {
    detach();
    detach = authority.connect(extensionSeam, EXTENSION_ORIGIN);
  });

  return { surface: 'chrome', store };
}

/**
 * ==========================================================================
 * THE WIRING RUNS ONCE, AT MODULE SCOPE, AND IS NOT EXPORTED.
 * ==========================================================================
 * **Module scope rather than an effect**, because it opens a channel and
 * attaches a port, and both documents render under `StrictMode` — an effect
 * would do it twice and leave two authorities disagreeing about one context,
 * which presents as "selection sometimes does not cross" rather than as an
 * error.
 *
 * **Not exported**, because a module that exports a component and a function is
 * a module Fast Refresh cannot reload, and because there is nothing for a caller
 * to decide: the answer comes from whether a native host is beside this
 * document, and every consumer of this file is in the same document as it. Both
 * entry points render `<App />` and get the right surface without naming one,
 * which is the property that keeps the browser lane on `'full'` by construction.
 *
 * In a browser tab it is `{ surface: 'full', store: undefined }` and evaluating
 * it does nothing at all.
 */
const HOST_WIRING: HostSurfaceWiring = wireHostChrome();

/**
 * The host surface: the root boundary, the two providers, then the shell.
 *
 * **`RootBoundary` is outermost, and it has to be.** `ShellLayout` wraps every
 * pane and the ribbon in a `FaultBoundary`, but a boundary never catches itself
 * or a parent — so a throw in either provider's own render, or in `ShellLayout`'s
 * own render above its inner boundaries, unmounted the entire React root and left
 * an empty `#root`. In a browser that is a white page; under the Electron host
 * this project is becoming, it is a blank native window with no address bar and
 * nothing for a user to report.
 *
 * **What is still above it, stated rather than left to be discovered:** this
 * function's own render body, and everything in `src/main.tsx`. A throw at module
 * scope happens during import evaluation, before React runs at all, so no
 * boundary anywhere can see it. This body is a bare `return` today, which is why
 * that band is narrow — but it is not empty, and it is not covered.
 *

 * Order is not a preference. `ShellHostProvider` resolves blueprints through the
 * registry and watches the registry's revision so that unregistering an
 * extension revokes its handle, so it must sit INSIDE
 * `ExtensionRegistryProvider`. Inverting the two throws
 * "useRegistry must be called inside an <ExtensionRegistryProvider>" at mount.
 *
 * Nothing is registered here. The shell renders with an empty registry — no
 * extensions, no active extension, an empty ribbon on the trailing side and
 * three valid panes — and the mock extensions that fill it are ISSUE-005.
 *
 * **Persistence is deliberately not composed here, and this file used to be
 * named as one of the two that did not consume it.** `ShellLayout` takes an
 * optional `engine` prop and falls back to `getDefaultHydrationEngine()`, the
 * process-wide engine over `localStorage`; passing that same singleton down from
 * here would add an import and change nothing at runtime. What DOES belong here
 * is the fact that there is exactly one of them: two engines over one storage
 * entry would be two views of the layout that never observe each other's writes,
 * which is the same reasoning `ShellHostProvider` uses for owning one store. A
 * second shell in one page is the case the prop exists for, and there is not one.
 * *Tests:* `src/__tests__/App.test.tsx` — "restores a layout the shell persisted
 * through the process-wide engine, with nothing wired up here".
 */
export interface AppProps {
  /**
   * Which half of the shell this document draws.
   *
   * Defaults to what `wireHostChrome` decided for THIS document, which is the
   * answer in both real callers. It stays a prop so that a test can render one
   * surface without a host beside it.
   */
  readonly surface?: ShellSurface | undefined;
  /**
   * The shell store. Defaults to the replica `wireHostChrome` attached, or to
   * `undefined` — a local store — in a browser tab. See
   * `ShellHostProviderProps.store`.
   */
  readonly store?: ShellStateStore | undefined;
  /**
   * Rendered INSIDE both providers and above the shell.
   *
   * The slot exists for one caller and one reason: `src/dev/DevShell.tsx`
   * registers two plug-ins the way a plug-in registers itself, which is from a
   * component that must be under `ExtensionRegistryProvider`. Before this slot
   * that file re-declared the whole provider stack to get one component into the
   * middle of it — a second copy of an order whose docblock says at length that
   * inverting it throws at mount.
   */
  readonly children?: ReactNode;
  /**
   * Forwarded to `ExtensionRegistryProvider`. True only for a document that
   * hosts plugin code — one whose registry's `register` may legitimately be
   * asked to hold a blueprint's `lifecycle` hooks. Defaults to `false`: this
   * document's registry may hold plugin data but must never be asked to run
   * a plugin's lifecycle. See ADR-0006 decision 6's amendment for issue #183.
   */
  readonly runsPluginCode?: boolean | undefined;
}

export default function App({
  surface = HOST_WIRING.surface,
  store = HOST_WIRING.store,
  children,
  runsPluginCode = false,
}: AppProps = {}): ReactElement {
  return (
    <RootBoundary>
      <ExtensionRegistryProvider runsPluginCode={runsPluginCode}>
        <ShellHostProvider store={store}>
          {children}
          <ShellLayout surface={surface} />
        </ShellHostProvider>
      </ExtensionRegistryProvider>
    </RootBoundary>
  );
}
