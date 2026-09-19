#!/usr/bin/env node
/**
 * ============================================================================
 * THE PACKAGED-APP CSP SMOKE. ADR-0006 IMPLEMENTATION STEP 1.
 * ============================================================================
 * Launches a packaged LEAPWare ShellUX with Chromium's remote-debugging switch,
 * attaches to both surfaces over the DevTools protocol, and records every
 * Content-Security-Policy violation each one raises. Prints one JSON document to
 * stdout and exits non-zero if a surface is missing, the header is missing, a
 * violation was recorded, or a positive control failed to register.
 *
 *     npm run verify:desktop
 *     node scripts/csp-smoke.mjs "release/win-unpacked/LEAPWare ShellUX.exe"
 *
 * NOT part of `npm run verify` and not run in CI: it needs a packaged
 * application, which `npm ci` does not produce (the same reason the browser
 * lane is outside `verify`). The path to the executable is an argument because
 * it differs per platform.
 *
 * **Nothing is added to the application for this.** No hook in main and no
 * environment read (`electron/main/index.ts` decision 2): `--remote-debugging-port`
 * is a Chromium switch the packaged binary already accepts. Port 0 lets Chromium
 * choose, and the endpoint is read from the "DevTools listening on" line.
 *
 * THREE INDEPENDENT COUNTS PER SURFACE, because a smoke that reports zero must
 * be able to report non-zero:
 *
 *   1. `Log` entries whose text names the Content Security Policy — Chromium's
 *      own console report of a violation.
 *   2. `Audits` issues of code `ContentSecurityPolicyIssue`.
 *      Both are read once straight after attaching, as `firstLoad`: the protocol
 *      documents `Log.enable` and `Audits.enable` as sending what was collected
 *      before them. That replay is the protocol's word, NOT checked by a control
 *      here; the reload in 3 is what does not depend on it.
 *   3. `securitypolicyviolation` events, counted by a listener installed with
 *      `Page.addScriptToEvaluateOnNewDocument` and then a reload, so the
 *      listener exists before the document's own scripts run.
 *
 * Then TWO POSITIVE CONTROLS per surface, after the counts are taken: an inline
 * `<script>` (`script-src`) and a `data:` image (`img-src`), each of which the
 * policy must refuse. Each must raise exactly one more event. A control that
 * raises none means the counter is blind and the zero above it means nothing.
 * (A `style` attribute is not a control: `style-src` carries `'unsafe-inline'`,
 * measured necessary — see `electron/main/rendererCsp.ts`.)
 *
 * LIMITS. The packaged application registers no extensions (`index.ts`
 * decision 4), so the extension surface is measured empty and no chart is drawn.
 * The palette is opened (Ctrl+K) so host chrome's dialog layer is exercised;
 * nothing else is interacted with. A violation that only a populated pane or a
 * hovered chart tooltip would raise is not observable by this run.
 * ============================================================================
 */
import { spawn } from 'node:child_process';

const exe = process.argv[2];
if (exe === undefined) {
  process.stderr.write('usage: node scripts/csp-smoke.mjs <path to packaged executable>\n');
  process.exit(2);
}

const SETTLE_MS = 3000;
const LAUNCH_TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function launch() {
  const child = spawn(exe, ['--remote-debugging-port=0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // The host and port come from Chromium's own line, not from this file.
  const endpoint = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('no DevTools listening line within the launch timeout')), LAUNCH_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => reject(new Error(`application exited early with code ${String(code)}`)));
  });
  return { child, endpoint };
}

async function pageTargets(endpoint) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const list = await fetch(`http://${endpoint}/json/list`).then((r) => r.json());
    const pages = list.filter((t) => t.type === 'page' && t.url.startsWith('shellux://'));
    if (pages.length >= 2) return pages;
    await sleep(250);
  }
  throw new Error('did not find two shellux:// page targets');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id !== undefined) {
      const entry = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(`${entry.method}: ${data.error.message}`));
      else entry.resolve(data.result);
    } else {
      events.push(data);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  return { opened, send, events, close: () => socket.close() };
}

const COUNTER = `
  globalThis.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    globalThis.__cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample });
  });
`;

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.result.value;
}

function refusals(session) {
  return session.events
    .filter((e) => e.method === 'Log.entryAdded' && /Content Security Policy/i.test(e.params.entry.text))
    .map((e) => e.params.entry.text);
}

function auditIssues(session) {
  return session.events.filter(
    (e) => e.method === 'Audits.issueAdded' && e.params.issue.code === 'ContentSecurityPolicyIssue',
  ).length;
}

async function measure(target, surface) {
  const session = connect(target.webSocketDebuggerUrl);
  await session.opened;
  await session.send('Log.enable');
  await session.send('Audits.enable');
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  await sleep(500);
  const firstLoad = { logRefusals: refusals(session), auditIssues: auditIssues(session) };

  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNTER });
  session.events.length = 0;
  await session.send('Page.reload', { ignoreCache: true });
  await sleep(SETTLE_MS);

  if (surface === 'chrome') {
    // Host chrome's own chord. `Input.dispatchKeyEvent` reaches the page as a
    // real key event, so the palette opens through the shipping dispatch path.
    for (const type of ['keyDown', 'keyUp']) {
      await session.send('Input.dispatchKeyEvent', {
        type, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2,
      });
    }
    await sleep(1000);
  }

  const afterReload = {
    events: await evaluate(session, 'globalThis.__cspViolations'),
    logRefusals: refusals(session),
    auditIssues: auditIssues(session),
    paletteOpen: surface === 'chrome' ? await evaluate(session, "document.querySelector('[role=dialog]') !== null") : null,
  };

  const header = await evaluate(
    session,
    "fetch(location.href).then((r) => r.headers.get('content-security-policy'))",
  );

  const before = afterReload.events.length;
  await evaluate(session, `
    const s = document.createElement('script');
    s.textContent = 'globalThis.__inlineRan = true';
    document.head.appendChild(s);
    null`);
  await sleep(300);
  const scriptControl = {
    raised: (await evaluate(session, 'globalThis.__cspViolations.length')) - before,
    inlineScriptRan: await evaluate(session, 'globalThis.__inlineRan === true'),
  };
  const beforeImage = await evaluate(session, 'globalThis.__cspViolations.length');
  await evaluate(session, `
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    document.body.appendChild(img);
    null`);
  await sleep(300);
  const imageControl = {
    raised: (await evaluate(session, 'globalThis.__cspViolations.length')) - beforeImage,
  };

  session.close();
  return { surface, url: target.url, header, firstLoad, afterReload, controls: { inlineScript: scriptControl, dataImage: imageControl } };
}

const { child, endpoint } = launch();
let exitCode = 1;
try {
  const targets = await pageTargets(await endpoint);
  const chrome = targets.find((t) => t.url.endsWith('/index.html'));
  const extension = targets.find((t) => t.url.endsWith('/paneview.html'));
  if (chrome === undefined || extension === undefined) throw new Error(`unexpected targets: ${targets.map((t) => t.url).join(', ')}`);
  // Extension first: reloading host chrome is the one that re-establishes the
  // store, and the extension surface is reloaded by main when chrome asks.
  const results = [await measure(extension, 'extension'), await measure(chrome, 'chrome')];
  const summary = results.map((r) => ({
    surface: r.surface,
    headerPresent: typeof r.header === 'string' && r.header.length > 0,
    violations:
      r.firstLoad.logRefusals.length + r.firstLoad.auditIssues + r.afterReload.events.length +
      r.afterReload.logRefusals.length + r.afterReload.auditIssues,
    controlsRegistered: r.controls.inlineScript.raised === 1 && !r.controls.inlineScript.inlineScriptRan &&
      r.controls.dataImage.raised === 1,
  }));
  const ok = summary.every((s) => s.headerPresent && s.violations === 0 && s.controlsRegistered);
  process.stdout.write(`${JSON.stringify({ ok, summary, results }, null, 2)}\n`);
  exitCode = ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`csp-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  child.kill();
}
process.exit(exitCode);
