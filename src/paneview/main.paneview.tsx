import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PaneViewShell } from './PaneViewShell';
import { createReplicaStore } from '../core/ipc/ReplicaStore';
import type { PortLike } from '../core/ipc/PortLike';
import type { ShellStateStore } from '../core/ShellAPI';
import '../index.css';

/**
 * The bootstrap for the extension surface, `paneview.html`.
 *
 * Deliberately the same shape as `src/main.tsx` and `src/dev/main.dev.tsx`, down
 * to `StrictMode`. Dropping it here would make the surface that actually runs
 * plug-in code the one surface whose double-invoked effects nobody exercises —
 * and `DatabasePlugin`'s 200ms interval and both remotes' mount-time
 * `setSelectedItem` are exactly what a second realm should be running against.
 *
 * See `src/paneview/PaneViewShell.tsx` for what this surface is.
 *
 * ---------------------------------------------------------------------------
 * IT ADAPTS THE TRANSPORT ITSELF RATHER THAN IMPORTING HOST CHROME'S ADAPTER
 * ---------------------------------------------------------------------------
 * `src/App.tsx` holds the mirror of the ten lines below, for the chrome document.
 * Sharing them would mean this entry point importing the module that defines host
 * chrome's whole component tree, and that is a worse trade than it looks:
 * `src/__tests__/crossDocumentIdref.test.ts` walks the import graph of each
 * document to decide which ids each one can mint, and it is deliberately
 * pessimistic — a module merely REACHABLE from an entry counts, whether or not
 * the bundler emits it. Ten lines of adapter is a smaller thing to state twice
 * than a document boundary is to blur.
 *
 * The two copies cannot drift silently either: both satisfy `PortLike`, which is
 * one declaration in one place, and its docblock is where the drop-not-queue
 * semantics that make `onmessage` read at DELIVERY time are argued.
 */

/** What main knows this renderer as. `originOf('extension')` derives the same. */
const EXTENSION_ORIGIN = '__view:extension__';

/** The transport the preload exposes, or `null` outside the native host. */
function hostTransport(): NonNullable<NonNullable<Window['shelluxHost']>['transport']> | null {
  return window.shelluxHost?.transport ?? null;
}

/**
 * Attach this document's replica to the host's transport.
 *
 * **Called at module scope, for the reason `src/App.tsx` gives**: `StrictMode`
 * below double-invokes effects, and attaching from one would give this document
 * two replicas posting under one origin — spending one rate-limit budget and
 * suppressing each other's echoes.
 *
 * `undefined` when there is no host, which is `paneview.html` opened in a browser
 * tab. Nothing does that on purpose; the panes then render against a local store
 * and show no extension, which is honest rather than a second whole shell.
 */
function attachReplica(): ShellStateStore | undefined {
  const transport = hostTransport();
  if (transport === null) {
    return undefined;
  }
  const seam: PortLike = {
    postMessage: (message: unknown): void => {
      transport.postMessage(message);
    },
    onmessage: null,
  };
  // `seam.onmessage` rather than a captured handler: it is `null` here and is
  // installed by `createReplicaStore` on the next line, so reading it at delivery
  // is what makes the store's own handler the one that runs.
  transport.onMessage((message) => {
    seam.onmessage?.(message);
  });
  return createReplicaStore({ port: seam, origin: EXTENSION_ORIGIN });
}

const container = document.getElementById('root');

if (container === null) {
  throw new Error('ShellUX extension surface: #root container is missing from paneview.html');
}

const store = attachReplica();

createRoot(container).render(
  <StrictMode>
    <PaneViewShell store={store} />
  </StrictMode>,
);
