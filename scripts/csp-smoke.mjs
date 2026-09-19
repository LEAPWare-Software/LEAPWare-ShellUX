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
 * WHAT IS DRIVEN. Host chrome: the palette is opened (Ctrl+K). The extension
 * surface: `src/paneview/PaneViewShell.tsx` registers the Mail and Database
 * fixtures in the production `paneview.html` bundle, but host chrome's registry
 * is empty, so pane 1 offers nothing to click and nothing activates them. The
 * smoke activates each through the surface's own controller (see
 * `driveFixtures`), hovers the Database chart until its tooltip shows, and drags
 * a divider with the pointer. Each step's outcome is recorded in `driven`.
 *
 * LIMITS. Nothing else is interacted with: no row selection, no command, no
 * drawer, no theme switch. Windows only.
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

/**
 * One positive control: run `expression`, which the policy must refuse, and
 * report how much EACH of the three counters rose. All three must rise by
 * exactly one (F2 of the review of 02dd98b): a counter that does not move for a
 * known violation is blind, and its zero above means nothing.
 */
async function control(session, expression) {
  const snapshot = async () => ({
    events: await evaluate(session, 'globalThis.__cspViolations.length'),
    logRefusals: refusals(session).length,
    auditIssues: auditIssues(session),
  });
  const before = await snapshot();
  await evaluate(session, expression);
  await sleep(500);
  const after = await snapshot();
  return {
    events: after.events - before.events,
    logRefusals: after.logRefusals - before.logRefusals,
    auditIssues: after.auditIssues - before.auditIssues,
  };
}

/** Host chrome's own chord, as a real key event through the shipping dispatch path. */
async function openPalette(session) {
  for (const type of ['keyDown', 'keyUp']) {
    await session.send('Input.dispatchKeyEvent', {
      type, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2,
    });
  }
  await sleep(1000);
  return { paletteOpen: await evaluate(session, "document.querySelector('[role=dialog]') !== null") };
}

/**
 * Bring the extension surface's two registered fixtures to the foreground.
 *
 * `src/paneview/PaneViewShell.tsx` registers Mail and Database in the production
 * `paneview.html` bundle, but nothing activates them: activation follows the
 * replicated `activeExtensionId`, host chrome writes it from pane 1, and host
 * chrome's registry is empty, so there is nothing in pane 1 to click. So this
 * reaches the surface's own activation controller the way ADR-0001 Amendment E
 * says any code in the document can — by walking React fibers from the root —
 * and calls `activate`. That is the smoke acting as hostile page code on
 * purpose; it is not a route the application offers.
 */
const ACTIVATE = (id) => `(() => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  while (stack.length > 0) {
    const fiber = stack.pop();
    if (fiber === null || fiber === undefined) continue;
    const value = fiber.memoizedProps && fiber.memoizedProps.value;
    if (value && typeof value.activate === 'function' && typeof value.blur === 'function') {
      const result = value.activate(${JSON.stringify(id)});
      return { found: true, ok: result && result.ok === true };
    }
    stack.push(fiber.sibling, fiber.child);
  }
  return { found: false, ok: false };
})()`;

async function mouse(session, type, x, y, buttons) {
  await session.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}

/** An ECharts tooltip: a `z-index` div with text in it that is laid out and not hidden. */
const TOOLTIP_VISIBLE = `[...document.querySelectorAll('div[style*="z-index"]')].some((d) => {
  const style = getComputedStyle(d);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && d.innerText.trim().length > 0;
})`;

async function driveFixtures(session) {
  const mail = await evaluate(session, ACTIVATE('mail'));
  await sleep(1500);
  const mailCanvas = await evaluate(session, "document.querySelectorAll('canvas').length");
  const mailText = await evaluate(session, 'document.body.innerText.slice(0, 120)');
  const database = await evaluate(session, ACTIVATE('inventory-db'));
  await sleep(2500);
  // Every chart the Database fixture drew, hovered in turn across a grid of
  // points, until one shows its axis tooltip — ECharts writes that tooltip as
  // HTML with `style` attributes, the `style-src-attr` case.
  const canvases = await evaluate(session, `[...document.querySelectorAll('canvas')].map((c) => {
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })`);
  let tooltipShown = false;
  for (const [index] of canvases.entries()) {
    const box = await evaluate(session, `(() => {
      const c = document.querySelectorAll('canvas')[${String(index)}];
      c.scrollIntoView({ block: 'center' });
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    for (const fy of [0.3, 0.5, 0.7]) {
      for (let step = 1; step <= 8 && !tooltipShown; step++) {
        await mouse(session, 'mouseMoved', box.x + (box.width * step) / 9, box.y + box.height * fy, 0);
        await sleep(150);
        tooltipShown = await evaluate(session, TOOLTIP_VISIBLE);
      }
    }
    if (tooltipShown) break;
  }
  const handle = await evaluate(session, `(() => {
    const h = document.querySelector('[data-panel-resize-handle-id], [role=separator]');
    if (h === null) return null;
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  let dragged = false;
  if (handle !== null) {
    const before = await evaluate(session, "document.querySelector('[data-panel-resize-handle-id], [role=separator]').getAttribute('aria-valuenow')");
    await mouse(session, 'mouseMoved', handle.x, handle.y, 0);
    await mouse(session, 'mousePressed', handle.x, handle.y, 1);
    for (let step = 1; step <= 6; step++) {
      await mouse(session, 'mouseMoved', handle.x - step * 15, handle.y, 1);
      await sleep(60);
    }
    // Counted while the drag is still held, when the cursor <style> exists.
    await sleep(300);
    await mouse(session, 'mouseReleased', handle.x - 90, handle.y, 1);
    await sleep(300);
    const after = await evaluate(session, "document.querySelector('[data-panel-resize-handle-id], [role=separator]').getAttribute('aria-valuenow')");
    dragged = before !== after;
  }
  const databaseText = await evaluate(session, 'document.body.innerText.slice(0, 120)');
  return { mail, mailText, mailCanvas, database, databaseText, canvases: canvases.length, tooltipShown, handleFound: handle !== null, dragged };
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

  const driven = surface === 'chrome' ? await openPalette(session) : await driveFixtures(session);

  const afterReload = {
    events: await evaluate(session, 'globalThis.__cspViolations'),
    logRefusals: refusals(session),
    auditIssues: auditIssues(session),
    driven,
  };

  const header = await evaluate(
    session,
    "fetch(location.href).then((r) => r.headers.get('content-security-policy'))",
  );

  const inlineScript = await control(session, `
    const s = document.createElement('script');
    s.textContent = 'globalThis.__inlineRan = true';
    document.head.appendChild(s);
    null`);
  inlineScript.inlineScriptRan = await evaluate(session, 'globalThis.__inlineRan === true');
  const dataImage = await control(session, `
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    document.body.appendChild(img);
    null`);

  session.close();
  return { surface, url: target.url, header, firstLoad, afterReload, controls: { inlineScript, dataImage } };
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
    // Every counter must rise by exactly one for every control.
    controlsRegistered: !r.controls.inlineScript.inlineScriptRan &&
      [r.controls.inlineScript, r.controls.dataImage].every(
        (c) => c.events === 1 && c.logRefusals === 1 && c.auditIssues === 1,
      ),
    driven: r.afterReload.driven,
  }));
  // A zero only counts if the driven steps happened: an activation that silently
  // failed would measure an empty surface and pass (review finding R1).
  const drove = (s) =>
    s.surface === 'chrome'
      ? s.driven?.paletteOpen === true
      : s.driven?.mail?.ok === true && s.driven?.database?.ok === true && s.driven?.tooltipShown === true && s.driven?.dragged === true;
  const ok = summary.every((s) => s.headerPresent && s.violations === 0 && s.controlsRegistered && drove(s));
  process.stdout.write(`${JSON.stringify({ ok, summary, results }, null, 2)}\n`);
  exitCode = ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`csp-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  child.kill();
}
process.exit(exitCode);
