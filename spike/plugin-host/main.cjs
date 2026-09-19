'use strict';
/*
 * ============================================================================
 * ADR-0006 PLUGIN-HOST SPIKE — THROWAWAY. NOT PART OF THE SHIPPING APPLICATION.
 * ============================================================================
 *
 * Nothing under `spike/` is imported by `src/`, by `electron/`, or by any stage of
 * `npm run verify`. Delete this directory when ADR-0006 moves to `Accepted` or is
 * rejected.
 *
 * ONE QUESTION, ASKED SEVEN WAYS: can a document served over the app's own privileged
 * scheme — the shape `electron/main/index.ts` decision 3 gives `paneview.html` —
 * dynamically `import()` a separately built ES-module plugin bundle, have that
 * bundle's bare `react` specifier resolve to a module the HOST serves (so host and
 * plugin share one module instance), and do it under a Content-Security-Policy?
 *
 * Every renderer here carries the shipping switches — `contextIsolation: true`,
 * `sandbox: true`, `nodeIntegration: false` — because a measurement against a
 * differently configured renderer is a measurement of a different renderer.
 *
 * Run from the repository root:   npx electron spike/plugin-host
 * It writes `results.json` beside this file and exits. Nothing is shown.
 */

const { app, BrowserWindow, protocol } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const HOST = 'shellux-spike'; // stands in for the shipping `shellux` scheme
const PLUGIN_NOCORS = 'spike-plugin-nocors'; // second scheme, corsEnabled: false
const PLUGIN_CORS = 'spike-plugin-cors'; // second scheme, corsEnabled: true

protocol.registerSchemesAsPrivileged([
  { scheme: HOST, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: PLUGIN_NOCORS, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: PLUGIN_CORS,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** The host's "shared React": a sentinel object the host puts on globalThis. */
const SHARED_REACT = 'export default globalThis.__hostReact;\n';

/** A plugin bundle: an entry that imports the bare specifier and a relative chunk. */
const PLUGIN_ENTRY =
  "import React from 'react';\n" +
  "import { chunkValue } from './chunk.js';\n" +
  'export const sameReact = React === globalThis.__hostReact && React !== undefined;\n' +
  'export const chunk = chunkValue;\n';
const PLUGIN_CHUNK = "export const chunkValue = 'chunk-loaded';\n";

/** The same bundle with its bare specifier rewritten at BUILD time to a host path: no import map. */
const PLUGIN_ENTRY_REWRITTEN = PLUGIN_ENTRY.replace("from 'react'", "from '/shared/react.js'");

const IMPORT_MAP = JSON.stringify({ imports: { react: `${HOST}://renderer/shared/react.js` } });
const IMPORT_MAP_HASH = `'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'`;

/** The document's own module script: import the plugin and report. */
function caseScript(pluginUrl) {
  return (
    'globalThis.__hostReact = { host: true };\n' +
    'const violations = [];\n' +
    "document.addEventListener('securitypolicyviolation', (e) => {\n" +
    '  violations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);\n' +
    '});\n' +
    `import(${JSON.stringify(pluginUrl)})\n` +
    '  .then((m) => { window.__result = { loaded: true, sameReact: m.sameReact, chunk: m.chunk, violations }; })\n' +
    '  .catch((e) => { window.__result = { loaded: false, error: String(e), violations }; });\n'
  );
}

/**
 * Each case: which scheme the plugin comes from, what CSP header the document
 * carries (null = none, which is the shipping state today), and whether the
 * plugin response carries `Access-Control-Allow-Origin`.
 */
const CASES = {
  'A-same-scheme-path': { plugin: `${HOST}://renderer/plugins/p1/entry.js`, csp: `default-src 'self'; script-src 'self' ${IMPORT_MAP_HASH}` },
  'B-second-scheme-nocors': { plugin: `${PLUGIN_NOCORS}://p1/entry.js`, csp: `default-src 'self'; script-src 'self' ${PLUGIN_NOCORS}: ${IMPORT_MAP_HASH}` },
  'C-second-scheme-cors': { plugin: `${PLUGIN_CORS}://p1/entry.js`, csp: `default-src 'self'; script-src 'self' ${PLUGIN_CORS}: ${IMPORT_MAP_HASH}`, acao: true },
  'D-second-scheme-cors-csp-omits-it': { plugin: `${PLUGIN_CORS}://p1/entry.js`, csp: `default-src 'self'; script-src 'self' ${IMPORT_MAP_HASH}`, acao: true },
  'E-no-csp-at-all': { plugin: `${PLUGIN_CORS}://p1/entry.js`, csp: null, acao: true },
  'G-build-time-rewrite-no-importmap': { plugin: `${HOST}://renderer/plugins/p2/entry.js`, csp: "default-src 'self'; script-src 'self'", noImportMap: true },
  'F-inline-importmap-not-hashed': { plugin: `${HOST}://renderer/plugins/p1/entry.js`, csp: `default-src 'self'; script-src 'self'` },
};

function js(body, extra = {}) {
  return new Response(body, { headers: { 'content-type': 'text/javascript', ...extra } });
}

function pluginHandler(acaoFor) {
  return (request) => {
    const { pathname } = new URL(request.url);
    const extra = acaoFor(request) ? { 'access-control-allow-origin': `${HOST}://renderer` } : {};
    if (pathname === '/entry.js') return js(PLUGIN_ENTRY, extra);
    if (pathname === '/chunk.js') return js(PLUGIN_CHUNK, extra);
    return new Response('Not found', { status: 404 });
  };
}

function registerHandlers() {
  protocol.handle(HOST, (request) => {
    const url = new URL(request.url);
    const name = url.searchParams.get('case');
    if (url.pathname === '/doc.html') {
      const c = CASES[name];
      const headers = { 'content-type': 'text/html' };
      if (c.csp !== null) headers['content-security-policy'] = c.csp;
      const html =
        '<!doctype html><html><head>' +
        (c.noImportMap ? '' : `<script type="importmap">${IMPORT_MAP}</script>`) +
        `<script type="module" src="/case.js?case=${name}"></script>` +
        '</head><body></body></html>';
      return new Response(html, { headers });
    }
    if (url.pathname === '/case.js') return js(caseScript(CASES[name].plugin));
    if (url.pathname === '/shared/react.js') return js(SHARED_REACT);
    if (url.pathname === '/plugins/p1/entry.js') return js(PLUGIN_ENTRY);
    if (url.pathname === '/plugins/p1/chunk.js') return js(PLUGIN_CHUNK);
    if (url.pathname === '/plugins/p2/entry.js') return js(PLUGIN_ENTRY_REWRITTEN);
    if (url.pathname === '/plugins/p2/chunk.js') return js(PLUGIN_CHUNK);
    return new Response('Not found', { status: 404 });
  });
  protocol.handle(PLUGIN_NOCORS, pluginHandler(() => false));
  protocol.handle(PLUGIN_CORS, pluginHandler(() => true));
}

async function runCase(name) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const consoleLines = [];
  win.webContents.on('console-message', (event) => {
    consoleLines.push(String(event.message ?? '').slice(0, 300));
  });
  let loadError = null;
  try {
    await win.loadURL(`${HOST}://renderer/doc.html?case=${name}`);
  } catch (error) {
    // Recorded, not fatal. In the recorded run it stayed null for every case; the
    // one ERR_FAILED seen while writing the spike was the app quitting between
    // cases (fixed by the window-all-closed handler below), not a refusal.
    loadError = String(error.message ?? error).slice(0, 200);
  }
  let result = null;
  for (let i = 0; i < 50 && result === null; i += 1) {
    result = await win.webContents.executeJavaScript('window.__result ?? null');
    if (result === null) await new Promise((r) => setTimeout(r, 100));
  }
  win.destroy();
  return { case: name, csp: CASES[name].csp, loadError, result: result ?? { timedOut: true }, console: consoleLines };
}

// Destroying a case's window must not quit the app before the next case runs.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  registerHandlers();
  const out = {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    platform: process.platform,
    measuredAt: new Date().toISOString(),
    cases: [],
  };
  for (const name of Object.keys(CASES)) {
    out.cases.push(await runCase(name));
  }
  writeFileSync(join(__dirname, 'results.json'), `${JSON.stringify(out, null, 2)}\n`);
  app.quit();
});
