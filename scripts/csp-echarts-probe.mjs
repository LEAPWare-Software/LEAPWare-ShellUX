/**
 * ============================================================================
 * THE ECHARTS TOOLTIP UNDER CANDIDATE STYLE POLICIES. ADR-0006 STEP 1.
 * ============================================================================
 * Written first, when the packaged smoke did not yet activate the Database
 * fixture and so drew no chart. The smoke now does (`scripts/csp-smoke.mjs`,
 * `driveFixtures`), and its strict-policy run is the application-level
 * measurement; this probe is kept as the isolated one, because it separates
 * the two `style-src` sub-directives, which the smoke does not. It measures
 * directly: ECharts' own browser build, an axis-trigger tooltip shown with
 * `showTip`, in an Electron renderer with the shipping switches, served over a
 * privileged scheme with each candidate policy. Prints one JSON line per policy.
 *
 *     npx electron scripts/csp-echarts-probe.mjs
 *
 * NOT part of `npm run verify`. Throwaway-shaped, kept because the policy in
 * `electron/main/rendererCsp.ts` cites its result and a citation needs something
 * to re-run. It measures `echarts/dist/echarts.min.js`, not the application's
 * bundle — the same library at the same version, not the same bytes.
 * ============================================================================
 */
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ECHARTS = readFileSync(createRequire(import.meta.url).resolve('echarts/dist/echarts.min.js'), 'utf8');

const CANDIDATES = [
  "default-src 'self'; style-src 'self'",
  "default-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'",
  "default-src 'self'; style-src 'self' 'unsafe-inline'",
];

const FILES = {
  '/': ['text/html', '<!doctype html><html><head><script src="/counter.js"></script><script src="/echarts.js"></script></head><body><div id="c"></div><script src="/app.js"></script></body></html>'],
  '/counter.js': ['text/javascript', "globalThis.__v = []; document.addEventListener('securitypolicyviolation', (e) => globalThis.__v.push(e.effectiveDirective));"],
  '/app.js': ['text/javascript', "const host = document.getElementById('c'); host.style.width = '600px'; host.style.height = '300px'; const chart = echarts.init(host, null, { renderer: 'canvas' }); chart.setOption({ tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: ['a', 'b', 'c'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [1, 2, 3] }] }); setTimeout(() => chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 }), 300);"],
  '/echarts.js': ['text/javascript', ECHARTS],
};

protocol.registerSchemesAsPrivileged([{ scheme: 'probe', privileges: { standard: true, secure: true } }]);

/** One host per candidate, so no response is ever reused across two policies. */
async function measure(candidate, index) {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadURL(`probe://p${String(index)}/`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const violations = await window.webContents.executeJavaScript('globalThis.__v');
  const tooltipShown = await window.webContents.executeJavaScript("document.querySelector('#c div[style*=\"z-index\"]') !== null");
  window.destroy();
  const byDirective = {};
  for (const directive of violations) byDirective[directive] = (byDirective[directive] ?? 0) + 1;
  return { policy: candidate, tooltipShown, violations: violations.length, byDirective };
}

// Each probe window is destroyed before the next opens; without this listener
// Electron's default quits the application when the first one goes.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  protocol.handle('probe', (request) => {
    const url = new URL(request.url);
    const file = FILES[url.pathname];
    const policy = CANDIDATES[Number(url.host.slice(1))];
    if (file === undefined || policy === undefined) return new Response('Not found', { status: 404 });
    return new Response(file[1], { headers: { 'content-type': file[0], 'content-security-policy': policy } });
  });
  for (const [index, candidate] of CANDIDATES.entries()) {
    process.stdout.write(`${JSON.stringify(await measure(candidate, index))}\n`);
  }
  app.quit();
});
