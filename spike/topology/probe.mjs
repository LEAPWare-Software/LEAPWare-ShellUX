/*
 * ============================================================================
 * ADR-0005 PANE TOPOLOGY SPIKE — THE MEASURABLE ARMS.
 * ============================================================================
 *
 * Run:  node spike/topology/probe.mjs
 *
 * NOT A TEST, and deliberately not one. It is not under `e2e/` so Playwright's
 * `testDir` never collects it, it is not under `src/` so vitest never collects
 * it, and it asserts nothing — a spike that fails a build when reality turns out
 * to be interesting is a spike that gets deleted instead of read. It launches
 * the throwaway host in `main.cjs` once per assembly, records what the Chrome
 * DevTools Protocol and the main process can see, and writes results.json.
 *
 * Playwright is used for `_electron.launch` only. Every measurement is taken by
 * `electronApp.evaluate`, which runs in the spike host's own main process; the
 * probe bodies live in main.cjs so that nothing has to survive serialisation.
 *
 * FIVE LAUNCHES:
 *
 *   views                     option A's boundary.
 *   views + arm D flag        the same, relaunched with
 *                             --enable-features=AccessibilityTreeForViews, which
 *                             ADR-0005's gate names as arm D.
 *   iframes                   one WebContents, two documents. Separates
 *                             "document boundary" from "view boundary".
 *   divs                      one WebContents, one document. The control.
 *   views-deferred            electron/electron#42339.
 *
 * The window must be visible and OS-foreground while this runs. main.cjs throws
 * out of every focus arm when it is not, rather than recording a false negative.
 */

import { _electron as electron } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results.json');

/** Arm D's switch, from ADR-0005's gate table. Disabled by default in Chromium. */
const ACCESSIBILITY_TREE_FOR_VIEWS = '--enable-features=AccessibilityTreeForViews';

async function runOne(label, { mode, switches = [] }) {
  const application = await electron.launch({ args: [...switches, HERE, `--mode=${mode}`] });
  const record = { label, mode, switches, arms: {} };
  try {
    await application.evaluate(async () => {
      // The host publishes `__spike` at module scope, but a launch that is slow
      // to reach that line would otherwise be reported as a probe failure.
      for (let attempt = 0; attempt < 100 && !globalThis.__spike; attempt += 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      await globalThis.__spike.ready;
      return true;
    });

    record.playwrightWindowCount = application.windows().length;
    record.environment = await application.evaluate(() => globalThis.__spike.probes.environment());

    const arms = [
      ['accessibilityTrees', () => globalThis.__spike.probes.accessibilityTrees()],
      ['crossDocumentReferences', () => globalThis.__spike.probes.crossDocumentReferences()],
      ['tabTraversal', () => globalThis.__spike.probes.tabTraversal()],
      ['activeElementAcrossClick', () => globalThis.__spike.probes.activeElementAcrossClick()],
      ['addChildViewFocusSteal', () => globalThis.__spike.probes.addChildViewFocusSteal()],
    ];

    for (const [name, body] of arms) {
      try {
        record.arms[name] = await application.evaluate(body);
      } catch (error) {
        // Recorded, never swallowed. A missing measurement and a negative one
        // are different findings and must not read the same.
        record.arms[name] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  } finally {
    await application.close().catch(() => {
      /* the host may already be gone; closing twice is not a finding. */
    });
  }
  return record;
}

const PLAN = [
  ['views', { mode: 'views' }],
  ['views-armD', { mode: 'views', switches: [ACCESSIBILITY_TREE_FOR_VIEWS] }],
  ['iframes', { mode: 'iframes' }],
  ['divs', { mode: 'divs' }],
  ['views-deferred', { mode: 'views-deferred' }],
];

/**
 * Which view holds keyboard focus immediately after startup, repeated.
 *
 * The first pass of this probe recorded view 1 focused on one run and view 2 on
 * the next, from an identical binary and an identical `main.cjs`. That is not a
 * detail: the host adds two child views and then has no defined answer to "which
 * one is the user typing into". Repeating it is what turns an anecdote into a
 * measurement.
 */
const STARTUP_FOCUS_REPEATS = 5;

async function startupFocus() {
  const observations = [];
  for (let attempt = 0; attempt < STARTUP_FOCUS_REPEATS; attempt += 1) {
    const application = await electron.launch({ args: [HERE, '--mode=views'] });
    try {
      const report = await application.evaluate(async () => {
        for (let poll = 0; poll < 100 && !globalThis.__spike; poll += 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        }
        await globalThis.__spike.ready;
        return globalThis.__spike.probes.focusReport();
      });
      observations.push({
        windowIsFocused: report.windowIsFocused,
        focusedWebContentsIds: report.views
          .filter((view) => view.webContentsIsFocused)
          .map((view) => view.webContentsId),
        documentsReportingHasFocus: report.documentsReportingHasFocus,
      });
    } finally {
      await application.close().catch(() => {
        /* already gone. */
      });
    }
  }
  return observations;
}

const runs = [];
for (const [label, options] of PLAN) {
  process.stdout.write(`spike/topology: running ${label}\n`);
  try {
    runs.push(await runOne(label, options));
  } catch (error) {
    runs.push({ label, ...options, error: error instanceof Error ? error.message : String(error) });
  }
}

process.stdout.write(`spike/topology: running startup-focus x${STARTUP_FOCUS_REPEATS}\n`);
const startupFocusObservations = await startupFocus();

const output = { measuredAt: new Date().toISOString(), runs, startupFocus: startupFocusObservations };
writeFileSync(RESULTS, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`spike/topology: wrote results.json (${runs.length} runs)\n`);
