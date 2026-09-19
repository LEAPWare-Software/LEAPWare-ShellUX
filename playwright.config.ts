import { defineConfig, devices } from '@playwright/test';

/**
 * The browser lane.
 *
 * The whole automated suite runs in jsdom, which has **no layout engine**: every
 * `getBoundingClientRect` is 0x0, nothing is ever clipped by an ancestor, and a
 * pointer never hit-tests. Two of the worst defects this project has had were
 * geometric, and the jsdom suite was green through both — a ribbon overflow menu
 * clipped out of existence by two `overflow-hidden` ancestors while six tests
 * asserted it worked, and a "survives a divider drag in flight" test that never
 * started a drag because a 0x0 rect cannot intersect a 12px hit area. This lane
 * exists so those two classes of defect are reproducible by the repository
 * rather than by a throwaway session.
 *
 * **This config is deliberately not wired into `npm run verify`.** The acceptance
 * test in README.md is "a fresh clone on a different operating system runs
 * `npm ci && npm run verify` with no local setup and no edits", and Playwright
 * needs `npx playwright install` — a browser download that is outside `npm ci`
 * and outside `package-lock.json`. Chaining it in would make that sentence false.
 * The lane is `npm run test:browser`, with its own CI workflow.
 *
 * **Chromium only, on purpose.** The two defects above are layout and hit-testing
 * defects, not engine-compatibility defects: they reproduce in any engine with a
 * layout pass, so a second and third browser would re-run identical assertions
 * for three times the CI minutes and three times the download. Adding WebKit or
 * Firefox is worth doing when there is a rendering difference this project
 * actually cares about; adding them reflexively before then buys nothing.
 *
 * **No environment variable is read here, and that is deliberate.** ADR-0002
 * forbids a local-environment dependency without a working default, and
 * `.gitignore` records that nothing in this repository reads an environment
 * variable at all. `webServer.reuseExistingServer` is left unset so that
 * Playwright applies its own default rather than this file growing a
 * `process.env.CI` read of its own.
 */

/** Vite's default dev-server port, and the only port this repository documents. */
const PORT = 5173;

const BASE_URL = `http://localhost:${PORT}`;

/**
 * Vite's default `vite preview` port, fixed with `strictPort` in `vite.config.ts`.
 * Exported so a spec that needs the built application names the same server.
 */
export const PREVIEW_URL = 'http://localhost:4173';

export default defineConfig({
  // `e2e/` sits at the repository root rather than under `src/`, so that
  // `vitest.config.ts`'s `include` of `src/**/*.{test,spec}.{ts,tsx}` never picks
  // these up and `src/__tests__/noEventListener.test.ts` — which walks `src/` from
  // its own location — never scans them. A Playwright spec would fail under jsdom
  // and would trip the listener scan, and neither would be a real finding.
  testDir: './e2e',

  // Capped rather than left at Playwright's default of half the CPU count.
  // Every worker drives a full Chromium against one shared Vite dev server, and
  // on a developer machine that is already running an editor and a type-checker
  // the default oversubscribes: the observed failure is a worker dying with
  // STATUS_STACK_BUFFER_OVERRUN part-way through a run, which reads as a flaky
  // test and is not one. Two workers keeps the suite under a minute while
  // leaving the result the same on a busy laptop and on an idle CI runner.
  workers: 2,

  use: {
    baseURL: BASE_URL,
    // On failure, not on success: a trace per passing test is a large artifact
    // nobody opens. These are what make a red CI run diagnosable without a local
    // reproduction.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Vite, on the documented port, started and waited for by Playwright rather
  // than by a script the reader has to remember to run first.
  //
  // The second server is a BUILD, previewed. ADR-0006 step 2's case is about
  // what the bundler emits — `/shared/react.js` sharing one React with
  // `paneview.html`'s entry — and the dev server does not emit anything, so a
  // dev-server pass alone would answer a different question. `vite build`
  // without `tsc` because `npm run verify` owns the type check; the build is
  // otherwise the one `npm run build` produces, into the same `dist/`. The
  // preview server sends the renderer's Content-Security-Policy
  // (`vite.config.ts`, `preview.headers`).
  webServer: [
    {
      command: 'npm run dev',
      url: BASE_URL,
      timeout: 120_000,
    },
    {
      command: 'npx vite build && npx vite preview',
      url: `${PREVIEW_URL}/paneview.html`,
      timeout: 180_000,
    },
  ],
});
