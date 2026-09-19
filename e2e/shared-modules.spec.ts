import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RENDERER_CSP } from '../electron/main/rendererCsp';
import { PREVIEW_URL } from '../playwright.config';

/**
 * ============================================================================
 * ONE REACT: THE ONE `/shared/react.js` SERVES IS THE ONE THE SURFACE RENDERS WITH.
 * ============================================================================
 * ADR-0006 decision 5 and implementation step 2. A plugin built on its own has
 * `react` rewritten to `/shared/react.js`. If that URL served a second copy of
 * React, every hook the plugin called would read a dispatcher no renderer ever
 * set, and fail. Spike case G showed one module instance with a sentinel object
 * standing in for React; this is the same question asked of real React, in the
 * real build, in a real browser — jsdom never sees an emitted chunk.
 *
 * **How "the React instance the surface renders with" is observed.** React DOM
 * announces itself to `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` when it loads, if
 * one exists, and hands over `currentDispatcherRef`: the very object of the
 * React package it was bundled against through which every hook call is
 * dispatched. An init script installs a minimal hook before any page script
 * runs, and records what it is handed. A hook call made through
 * `/shared/react.js` reaches the surface's renderer exactly when
 * `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher`
 * of that module is that same object — which is what is compared.
 *
 * **"A module importing".** The importer is a real ES module with a static
 * `import` of `/shared/react.js`, served same-origin under `/__e2e__/` by
 * `page.route` — the shape of a rewritten plugin bundle — not an expression
 * evaluated in the page.
 *
 * **Two servers.** The build previewed with the renderer's CSP
 * (`vite.config.ts`, `preview.headers`) — the case the ADR names, since it is
 * the bundler's chunking that decides it; and the dev server, where
 * `vite.config.ts`'s `serveSharedModules` answers the same URL from source.
 *
 * **What this does NOT show.** It is Chromium over HTTP, not Electron over the
 * `shellux:` scheme: that the packaged app serves `/shared/*.js` from its asar
 * is not measured here. And it shows the dispatcher is shared, not that a
 * plugin's component renders — no plugin is loaded until step 6.
 * ============================================================================
 */

/** What the init script records, read back after the page has rendered. */
interface Observation {
  readonly renderers: number;
  readonly sameDispatcher: readonly boolean[];
  readonly sharedVersion: string;
  readonly rendererVersions: readonly string[];
  readonly violations: readonly string[];
}

/** The module standing in for a rewritten plugin bundle. */
const IMPORTER_PATH = '/__e2e__/plugin.js';
const IMPORTER_SOURCE = "import * as React from '/shared/react.js';\nexport default React;\n";

/**
 * Installed before any page script. A devtools hook with only what React DOM
 * 18 calls: `inject`, the commit callbacks, and `supportsFiber`. Also counts
 * CSP violations, so a module refused by the policy cannot pass as an absent one.
 */
function installProbe(): void {
  const probe = window as unknown as Record<string, unknown>;
  const renderers: unknown[] = [];
  const violations: string[] = [];
  probe['__e2eRenderers'] = renderers;
  probe['__e2eViolations'] = violations;
  probe['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer: unknown): number {
      renderers.push(renderer);
      return renderers.length;
    },
    onScheduleFiberRoot(): void {},
    onCommitFiberRoot(): void {},
    onCommitFiberUnmount(): void {},
    onPostCommitFiberRoot(): void {},
    checkDCE(): void {},
  };
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });
}

async function observe(page: Page, origin: string): Promise<Observation> {
  await page.addInitScript(installProbe);
  await page.route(`${origin}${IMPORTER_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: IMPORTER_SOURCE }),
  );
  const response = await page.goto(`${origin}/paneview.html`);
  expect(response?.ok()).toBe(true);
  // The surface has rendered: React DOM has committed something into #root.
  await expect(page.locator('#root > *').first()).toBeAttached();

  return page.evaluate(async (importerUrl) => {
    const probe = window as unknown as Record<string, unknown>;
    const imported = (await import(/* @vite-ignore */ importerUrl)) as {
      default: {
        version: string;
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: unknown };
      };
    };
    const shared = imported.default;
    const renderers = probe['__e2eRenderers'] as ReadonlyArray<{ currentDispatcherRef: unknown; version: string }>;
    return {
      renderers: renderers.length,
      sameDispatcher: renderers.map(
        (renderer) =>
          renderer.currentDispatcherRef ===
          shared.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher,
      ),
      sharedVersion: shared.version,
      rendererVersions: renderers.map((renderer) => renderer.version),
      violations: [...(probe['__e2eViolations'] as readonly string[])],
    };
  }, `${origin}${IMPORTER_PATH}`);
}

/** One React DOM renderer on the surface, and its dispatcher is the shared module's. */
function expectOneReact(observed: Observation): void {
  expect(observed.renderers).toBe(1);
  expect(observed.sameDispatcher).toEqual([true]);
  expect(observed.rendererVersions).toEqual([observed.sharedVersion]);
  expect(observed.violations).toEqual([]);
}

test.describe('the built application, previewed under the renderer CSP', () => {
  test('a module importing /shared/react.js receives the React instance the extension surface renders with', async ({
    page,
  }) => {
    // The label "under the renderer CSP" is checked, not assumed.
    const served = await page.request.get(`${PREVIEW_URL}/paneview.html`);
    expect(served.headers()['content-security-policy']).toBe(RENDERER_CSP);
    const shared = await page.request.get(`${PREVIEW_URL}/shared/react.js`);
    expect(shared.status()).toBe(200);
    expect(shared.headers()['content-type']).toContain('javascript');

    expectOneReact(await observe(page, PREVIEW_URL));
  });
});

test.describe('the dev server', () => {
  test('a module importing /shared/react.js receives the React instance the extension surface renders with', async ({
    page,
    baseURL,
  }) => {
    expectOneReact(await observe(page, baseURL ?? ''));
  });

  test('serves each of the three /shared/ modules as script, and no other name under /shared/', async ({
    request,
  }) => {
    for (const name of ['react', 'react-jsx-runtime', 'sdk']) {
      const response = await request.get(`/shared/${name}.js`);
      expect(response.status(), name).toBe(200);
      expect(response.headers()['content-type'], name).toContain('javascript');
    }
    // Vite's SPA fallback answers an unknown path with the HTML shell and a 200,
    // so "not served" reads as "not served as script": a module import of it
    // fails on the MIME type.
    const unknown = await request.get('/shared/react-dom.js');
    expect(unknown.headers()['content-type']).not.toContain('javascript');
  });
});
