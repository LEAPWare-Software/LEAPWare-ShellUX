/**
 * ============================================================================
 * `window.onerror` AND `unhandledrejection`, FORWARDED TO THE HOST'S LOG.
 * ============================================================================
 * GitHub issue #86: "the two most common runtime failures in a React
 * application are caught by nothing and reported by nothing." A React error
 * boundary (`FaultBoundary`, `RootBoundary`) catches a throw during render; its
 * own documented limits are an async rejection and an event-handler throw,
 * which is exactly what `window.addEventListener('error', ...)` and
 * `('unhandledrejection', ...)` see instead. This module is the forwarder for
 * those two, and nothing else — it does not replace either boundary and does
 * not change what either one catches.
 *
 * **Forwarded over the existing bridge, not a new one.** `window.shelluxHost`
 * is the one door this document has into the native host — declared once in
 * `src/App.tsx`, created once by `contextBridge.exposeInMainWorld` in
 * `electron/preload/index.cts`. `diagnostics.report` is the member Issue #86
 * added there, in the same one-way, no-acknowledgement shape as
 * `panes.setSplit` and `updates.check`: a renderer states what happened, main
 * decides what to do with it, and nothing comes back.
 *
 * **This module does not extend `interface Window`.** That declaration lives in
 * `src/App.tsx`, which is a file this change does not own; re-declaring the same
 * global property with a second shape in a second file is a TypeScript error
 * (two declarations of one property must agree exactly), not a merge. So the
 * shape this file expects is a local, narrower type, read off `window` through
 * one cast at the one call site that needs it.
 *
 * **No network call.** `diagnostics.report` sends over Electron IPC to a
 * process on the same machine, exactly as `panes.setSplit` does. In a browser
 * — no `window.shelluxHost` at all — `install()` still attaches both listeners,
 * finds no bridge to forward to on every event, and does nothing further. That
 * is a guardrail against a document running with no host, not a defect: the
 * browser lane has no local log to write to and this module invents none.
 * ============================================================================
 */

/** The one member of `window.shelluxHost` this module reads, named locally. */
interface DiagnosticsBridge {
  readonly shelluxHost?: {
    readonly diagnostics?: {
      report(payload: unknown): void;
    };
  };
}

/** Which document is reporting. The main-process handler logs it verbatim. */
export type RendererSource = 'renderer-chrome' | 'renderer-extension';

function bridge(): DiagnosticsBridge['shelluxHost'] {
  return (window as unknown as DiagnosticsBridge).shelluxHost;
}

/** Best-effort send. A reporting path that can itself throw defeats its purpose. */
function send(payload: Record<string, unknown>): void {
  try {
    bridge()?.diagnostics?.report(payload);
  } catch {
    // The host is gone or the channel is gone. There is nowhere left to say so.
  }
}

function onWindowError(source: RendererSource, event: ErrorEvent): void {
  const error = event.error;
  send({
    source,
    kind: 'window.onerror',
    message: error instanceof Error ? error.message : event.message,
    stack: error instanceof Error ? (error.stack ?? null) : null,
    filename: event.filename === '' ? null : event.filename,
    lineno: event.lineno === 0 ? null : event.lineno,
    colno: event.colno === 0 ? null : event.colno,
  });
}

function onUnhandledRejection(source: RendererSource, event: PromiseRejectionEvent): void {
  const reason: unknown = event.reason;
  send({
    source,
    kind: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? (reason.stack ?? null) : null,
  });
}

/**
 * Attach both listeners for one document, and return the function that removes
 * them.
 *
 * `source` names the document making the call — `src/main.tsx` passes
 * `'renderer-chrome'`, `src/paneview/main.paneview.tsx` passes
 * `'renderer-extension'` — because the two are separate `WebContentsView`s with
 * separate crash handling in `electron/main/paneViews.ts`, and a log entry that
 * cannot say which one failed is half a report.
 */
export function installRendererDiagnostics(source: RendererSource): () => void {
  const errorListener = (event: ErrorEvent): void => onWindowError(source, event);
  const rejectionListener = (event: PromiseRejectionEvent): void => onUnhandledRejection(source, event);
  window.addEventListener('error', errorListener);
  window.addEventListener('unhandledrejection', rejectionListener);
  return () => {
    window.removeEventListener('error', errorListener);
    window.removeEventListener('unhandledrejection', rejectionListener);
  };
}
