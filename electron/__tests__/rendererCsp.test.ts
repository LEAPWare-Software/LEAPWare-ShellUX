import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RENDERER_CSP,
  RENDERER_CSP_DIRECTIVES,
  createRendererHandler,
  resolveRendererFile,
  withRendererCsp,
} from '../main/rendererCsp';

/**
 * ============================================================================
 * THE SCHEME HANDLER, DRIVEN WITH THE REPOSITORY'S OWN HTML — NOT WITH ELECTRON.
 * ============================================================================
 * ADR-0006 implementation step 1. `createRendererHandler` is the function
 * `electron/main/index.ts` passes to `protocol.handle`; the only part replaced
 * here is the fetcher, which reads from disk with `node:fs` instead of
 * `net.fetch` over `file:`. The root is the repository root, so the documents
 * served are the real `index.html` and `paneview.html` — and `dev.html`, which
 * the scheme never serves in a package but which costs nothing to include.
 *
 * **What this does NOT show**, stated because it is the half that matters: that
 * Chromium enforces the header, and that the built application runs under it
 * without a violation. Neither is observable here. The first is spike case D
 * (`spike/plugin-host/README.md`, its table);
 * the second is `scripts/csp-smoke.mjs` against the packaged application, whose
 * recorded runs are in `docs/measurements/csp-2026-09-18.json`.
 * ============================================================================
 */

// `dirname` over the file path, as `ShellLayoutIcons.test.tsx` does: under
// Vitest's transform `fileURLToPath(new URL('../..', import.meta.url))` threw
// "The URL must be of scheme file" when this file first ran.
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Every HTML document at the repository root — the build inputs and `dev.html`. */
const HTML_ENTRIES = readdirSync(REPO_ROOT).filter((name) => name.endsWith('.html'));

function diskFetcher(absolutePath: string): Promise<Response> {
  // Rejects on a missing file, which is what `net.fetch` does too.
  return Promise.resolve().then(
    () => new Response(readFileSync(absolutePath), { status: 200, headers: { 'content-type': 'text/html' } }),
  );
}

function handler(warnings: string[] = []): (request: Request) => Promise<Response> {
  return createRendererHandler({
    root: REPO_ROOT,
    fetchFile: diskFetcher,
    warn: (message) => warnings.push(message),
  });
}

describe('rendererCsp: the Content-Security-Policy on the shellux:// scheme', () => {
  it('every HTML response the scheme serves carries the policy', async () => {
    // Guard against a vacuous pass: the loop below must have documents to visit.
    expect(HTML_ENTRIES).toEqual(expect.arrayContaining(['index.html', 'paneview.html']));

    const serve = handler();
    const urls = [
      'shellux://renderer/',
      'shellux://renderer',
      ...HTML_ENTRIES.map((name) => `shellux://renderer/${name}`),
      ...HTML_ENTRIES.map((name) => `shellux://renderer/${name}?reload=1#pane-2`),
    ];
    for (const url of urls) {
      const response = await serve(new Request(url));
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-security-policy'), url).toBe(RENDERER_CSP);
      // It is the document, not an error body that happens to carry a header.
      expect(await response.text(), url).toMatch(/^<!doctype html>/i);
    }
  });

  it('puts the policy on a script and a stylesheet too', async () => {
    // Not classifying by type is the design (see rendererCsp.ts); this pins it,
    // with real non-HTML files from the tree and their real content types.
    const serve = createRendererHandler({
      root: REPO_ROOT,
      fetchFile: (absolutePath) =>
        Promise.resolve(
          new Response(readFileSync(absolutePath), {
            status: 200,
            headers: { 'content-type': absolutePath.endsWith('.css') ? 'text/css' : 'text/javascript' },
          }),
        ),
      warn: () => undefined,
    });
    for (const path of ['postcss.config.js', 'src/index.css']) {
      const response = await serve(new Request(`shellux://renderer/${path}`));
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).not.toContain('html');
      expect(response.headers.get('content-security-policy'), path).toBe(RENDERER_CSP);
    }
  });

  it('puts the policy on the 403 and 404 responses too, and warns for each', async () => {
    const warnings: string[] = [];
    const serve = handler(warnings);

    const refused = await serve(new Request('shellux://renderer/..%2f..%2fetc%2fpasswd'));
    expect(refused.status).toBe(403);
    expect(refused.headers.get('content-security-policy')).toBe(RENDERER_CSP);

    const missing = await serve(new Request('shellux://renderer/no-such-document.html'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-security-policy')).toBe(RENDERER_CSP);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('outside the renderer root');
    expect(warnings[1]).toContain('renderer asset not found');
  });

  it('wraps a fetch response whose headers are immutable, keeping its status and content type', async () => {
    // A `data:` fetch yields a response with an immutable header guard — the
    // shape `net.fetch` returns — on which `headers.set` would throw.
    const fetched = await fetch('data:text/html,<p>x</p>');
    expect(() => fetched.headers.set('x-probe', '1')).toThrow();

    const wrapped = withRendererCsp(fetched);
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get('content-type')).toContain('text/html');
    expect(wrapped.headers.get('content-security-policy')).toBe(RENDERER_CSP);
    expect(await wrapped.text()).toBe('<p>x</p>');
  });

  it("allows no 'unsafe-eval', 'unsafe-inline' only for styles, and no source beyond 'self' and 'none'", () => {
    expect(RENDERER_CSP).not.toContain('unsafe-eval');
    for (const directive of RENDERER_CSP_DIRECTIVES) {
      const [name, ...sources] = directive.split(' ');
      // 'unsafe-inline' is measured necessary for styles and nothing else; see
      // the docblock on RENDERER_CSP_DIRECTIVES for the two measurements.
      const allowed = name === 'style-src' ? ["'self'", "'none'", "'unsafe-inline'"] : ["'self'", "'none'"];
      for (const source of sources) expect(allowed, directive).toContain(source);
    }
    // ADR-0006 decision 5's six directives, each present.
    for (const required of [
      "default-src 'self'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "connect-src 'self'",
    ]) {
      expect(RENDERER_CSP_DIRECTIVES).toContain(required);
    }
  });
});

describe('rendererCsp: resolveRendererFile, moved unchanged from index.ts', () => {
  const root = join(REPO_ROOT, 'dist');

  it('serves the host chrome entry for the bare path', () => {
    expect(resolveRendererFile(root, 'shellux://renderer/')).toBe(join(root, 'index.html'));
  });

  it('refuses a traversal, a sibling directory sharing the prefix, and a malformed escape', () => {
    expect(resolveRendererFile(root, 'shellux://renderer/..%2f..%2fpackage.json')).toBeNull();
    expect(resolveRendererFile(root, 'shellux://renderer/..%2fdist-extra%2fx.js')).toBeNull();
    expect(resolveRendererFile(root, 'shellux://renderer/%E0%A4%A')).toBeNull();
  });

  it('resolves each /shared/ module to the file the build emits under the renderer root', () => {
    // ADR-0006 step 2: `vite.config.ts` emits `shared/<name>.js` unhashed into
    // `dist/`, and the scheme needs no route of its own to serve them. Path
    // arithmetic only: that the packaged asar holds the files is not shown here.
    for (const name of ['react', 'react-jsx-runtime', 'sdk']) {
      expect(resolveRendererFile(root, `shellux://renderer/shared/${name}.js`)).toBe(join(root, 'shared', `${name}.js`));
    }
  });
});
