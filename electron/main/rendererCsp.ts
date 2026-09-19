import { join, sep } from 'node:path';
import { isPluginRequest } from './plugins/pluginRoute.js';

/**
 * ============================================================================
 * THE RENDERER'S CONTENT-SECURITY-POLICY, AND THE SCHEME HANDLER THAT SENDS IT.
 * ============================================================================
 * ADR-0006 decision 5, implementation step 1. Until this file the shell sent no
 * Content-Security-Policy at all — measured by grep in ADR-0006's "What exists
 * today", and shown by spike case E, where a script from a second origin loads
 * with nothing to refuse it.
 *
 * **Why the handler lives here rather than in `index.ts`.** `index.ts` registers
 * the scheme and runs `app.whenReady()` at import time, so nothing in it can be
 * imported by a test. The handler is built here from three injected parts — the
 * renderer root, a file fetcher and a warning sink — and `index.ts` passes the
 * real ones (`net.fetch` over `file:`). The case in
 * `electron/__tests__/rendererCsp.test.ts` drives the same function with a
 * fetcher that reads the repository's own HTML entries from disk.
 *
 * **The header goes on EVERY response the scheme sends, not only on the ones
 * this file decides are HTML.** A browser ignores the header on a script, a
 * stylesheet or an image, so sending it there costs a few hundred bytes and
 * nothing else; deciding "is this a document" by extension or by MIME type is a
 * classification that could be wrong, and a wrong answer would be a document
 * with no policy. Not classifying removes that failure mode rather than testing
 * for it. The 403 and 404 bodies carry it too.
 *
 * **What is tested, and what is only measured.** The suite shows that every
 * response this handler builds carries the header. *Tests:*
 * `electron/__tests__/rendererCsp.test.ts` — "every HTML response the scheme
 * serves carries the policy", "puts the policy on a script and a stylesheet
 * too", and "puts the policy on the 403 and 404 responses too, and warns for
 * each". It cannot show that Chromium enforces it; that is
 * measured, not tested: spike case D (`spike/plugin-host/README.md`, its table), and
 * the two positive controls in
 * `scripts/csp-smoke.mjs` — an inline `<script>` that did not run and a `data:`
 * image that was refused, on both surfaces of the packaged app. The policy is
 * NOT a boundary between two pieces of code in one document (ADR-0001
 * Amendment E), and the dev server (`npm run dev`, `dev.html`) sends none;
 * ADR-0006 decision 5 states that and it is still true.
 * ============================================================================
 */

/**
 * The policy, one directive per entry so a diff names the directive it changes.
 *
 * The first six are ADR-0006 decision 5 verbatim. The last three are ours:
 *
 * - `style-src 'self' 'unsafe-inline'` — **`'unsafe-inline'` is measured
 *   necessary, for styles only.** ADR-0006 left `style-src` to be measured, and
 *   the first measurement was `style-src 'self'`. Two things the shell ships
 *   break under it, one per CSP sub-directive:
 *     - `style-src-elem`: opening the command palette in the PACKAGED app raised
 *       one violation. Attributed by reading the bundle (the report carries no
 *       sample): Radix Dialog's scroll lock (`react-remove-scroll-bar`, via
 *       `react-style-singleton`) inserts a `<style>` element whose text carries
 *       the measured scrollbar width, so no hash can name it. Recorded by
 *       `scripts/csp-smoke.mjs`; every run is in
 *       `docs/measurements/csp-2026-09-18.json`.
 *     - `style-src-attr`: an ECharts axis tooltip writes its markup as HTML with
 *       `style="…"` attributes. In the PACKAGED app, with `style-src 'self'`,
 *       the driven sequence (both fixtures activated, the Database chart
 *       hovered, a divider dragged) raised 21 `style-src-attr` and 1
 *       `style-src-elem` violation on the extension surface; the one
 *       `style-src-elem` was recorded while the drag was held, when the drag's
 *       cursor `<style>` exists, not during the hover. Standalone (`scripts/csp-echarts-probe.mjs`, ECharts' own
 *       browser build): 13 under `style-src 'self'`, 13 with only
 *       `style-src-elem` relaxed, 0 under this directive.
 *   What the grant admits is injected CSS; what CSS could use to send anything
 *   anywhere is `img-src`, `font-src` and `connect-src`, and each is `'self'`.
 *   *Tests:* same file — "allows no 'unsafe-eval', 'unsafe-inline' only for
 *   styles, and no source beyond 'self' and 'none'".
 *   React `style` props are not the reason: they write through the CSSOM
 *   (`element.style.x = …`), which `style-src` does not govern.
 * - `img-src 'self'`, `font-src 'self'` — implied by `default-src` already;
 *   written out so the policy reads without CSP's fallback rules. The packaged
 *   smoke recorded no image or font violation on either surface.
 *
 * Absent on purpose: `'unsafe-inline'` for scripts, `'unsafe-eval'` anywhere,
 * and any network origin. Opening one is a deployment-wide change to this list
 * (ADR-0006 decision 5).
 */
export const RENDERER_CSP_DIRECTIVES: readonly string[] = Object.freeze([
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
]);

/** The header value, as sent. */
export const RENDERER_CSP = RENDERER_CSP_DIRECTIVES.join('; ');

/** The document the bare path serves: host chrome. */
export const RENDERER_ENTRY = 'index.html';

/**
 * The absolute path a request under the scheme names, or `null` when it names
 * something outside `root`.
 *
 * Moved here unchanged from `electron/main/index.ts` (decision 3 there). The
 * containment test is `startsWith(root + separator)`, not a prefix test on the
 * root alone: `dist-extra` starts with `dist` and is a different directory.
 * `join` normalises `..` away before the comparison, so a traversal attempt is
 * compared in its resolved form rather than its written one.
 */
export function resolveRendererFile(root: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    // A malformed URL or a malformed percent-escape. Neither names a file.
    return null;
  }
  const relative = pathname.replace(/^\/+/, '');
  const target = join(root, relative === '' ? RENDERER_ENTRY : relative);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/**
 * The same response with the policy added.
 *
 * A new `Response` rather than `response.headers.set`, because the headers of a
 * response that came out of `fetch` are immutable and `set` throws on them.
 */
export function withRendererCsp(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', RENDERER_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export interface RendererHandlerOptions {
  /** Root of the built renderer. Every served path must normalise inside it. */
  readonly root: string;
  /** Fetch one file by absolute path. Rejects when there is nothing to serve. */
  readonly fetchFile: (absolutePath: string) => Promise<Response>;
  /** The host's diagnostic channel. */
  readonly warn: (message: string) => void;
  /**
   * The `/plugins/` route (ADR-0006 decision 5, `electron/main/plugins/pluginRoute.ts`).
   * When given, every request `isPluginRequest` claims goes here and never to
   * `fetchFile`, and its response carries the policy like every other. *Tests:*
   * `electron/__tests__/pluginScheme.test.ts` — "serves only the entry of an
   * installed, enabled, compatible plugin".
   */
  readonly servePlugin?: (requestUrl: string) => Response;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The scheme handler of `electron/main/index.ts` decision 3: serves the renderer
 * root, refuses anything outside it, says so when an asset is missing — and puts
 * the policy on every one of those responses.
 */
export function createRendererHandler(options: RendererHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (options.servePlugin !== undefined && isPluginRequest(request.url)) {
      return withRendererCsp(options.servePlugin(request.url));
    }
    const target = resolveRendererFile(options.root, request.url);
    if (target === null) {
      options.warn(`refused a request that resolves outside the renderer root: ${request.url}`);
      return withRendererCsp(new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }));
    }
    // Only the fetch is inside the `try`. A failure of `withRendererCsp` itself
    // is not a missing asset, and reporting it as one would send a reader
    // looking for a file that exists; it rejects, and `protocol.handle` fails
    // the request, which is the honest outcome for a response with no policy.
    let fetched: Response;
    try {
      fetched = await options.fetchFile(target);
    } catch (error) {
      // The white-screen case: the document loaded and one of its assets did
      // not. No load-failure event fires for this, so this line is the only
      // place it is ever visible.
      options.warn(`renderer asset not found: ${request.url} (${describeError(error)})`);
      return withRendererCsp(new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    }
    return withRendererCsp(fetched);
  };
}
