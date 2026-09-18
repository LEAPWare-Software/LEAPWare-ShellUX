# ADR-0006 plugin-host spike — THROWAWAY

**Nothing here is part of the shipping application.** No file under `spike/` is
imported by `src/`, by `electron/`, or by any stage of `npm run verify`. Delete this
directory when `docs/adr/0006-runtime-plugin-host.md` is accepted or rejected.

## The question

Can the extension surface — a document served over the app's own privileged scheme, the
shape `electron/main/index.ts` decision 3 gives `paneview.html` — dynamically
`import()` a separately built ES-module plugin bundle, have the bundle's `react`
import resolve to a module **the host** serves (one shared module instance), and do
it under a Content-Security-Policy?

## Run it

```
npx electron spike/plugin-host
```

Writes `results.json` beside `main.cjs` and exits; no window is shown. Every renderer
carries the shipping switches: `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`.

## Results — Electron 43.2.0 / Chromium 150.0.7871.129, win32, 2026-09-18

Raw output: `results.json`. One run; each case is deterministic resolution
behaviour, not a timing measurement.

| Case | Plugin served from | Document CSP | Outcome |
|---|---|---|---|
| A | same scheme and origin, `/plugins/p1/…` | `script-src 'self'` + import-map hash | **loads**, shared module identical, relative chunk loads |
| B | second privileged scheme, `corsEnabled: false` | `script-src 'self' <scheme>:` | **refused by CORS**: "Cross origin requests are only supported for protocol schemes: chrome, …, http, https, spike-plugin-cors" |
| C | second scheme, `corsEnabled: true`, `Access-Control-Allow-Origin` sent | `script-src 'self' <scheme>:` | **loads**, shared module identical |
| D | as C | `script-src 'self'` only | **refused by CSP**: `script-src-elem blocked spike-plugin-cors` |
| E | as C | **none** (today's shipping state) | **loads**; Electron prints its "Insecure Content-Security-Policy" warning |
| F | same origin | `script-src 'self'`, import map NOT hashed | **fails**: the inline import map is blocked by CSP, so `react` does not resolve |
| G | same origin, `react` rewritten at build time to `/shared/react.js` | `script-src 'self'`, no import map | **loads**, shared module identical |

## What this settles, and what it does not

- **Settles:** a same-origin path under the existing scheme needs no CORS and no CSP
  entry beyond `'self'` (A, G). A second scheme works only with `corsEnabled` plus an
  `Access-Control-Allow-Origin` header plus a CSP source for it (B, C, D) — three
  extra moving parts that buy nothing, because a module's code runs in the realm of
  the **document** that imported it, whatever URL it came from.
- **Settles:** an inline import map costs a CSP hash that must be regenerated on every
  change to the map (F). A build-time specifier rewrite costs nothing at the CSP (G).
- **Settles:** the shipping application sets **no CSP at all** today. Measured by grep
  over `*.html`, `*.ts`, `*.tsx`, `*.cts`, `*.yml`, `*.md` outside `node_modules` and
  `dist` for `Content-Security-Policy`, `csp` and `onHeadersReceived`: zero hits.
  Case E shows what that admits.
- **Does NOT settle:** that real React hooks work across the boundary. The "shared
  React" here is a sentinel object; what was measured is that host and plugin receive
  **the same module instance**, which is the precondition, not the property. A real
  Vite build emitting `/shared/react.js` as a stable entry that shares its chunk with
  `paneview.html`'s entry is ADR-0006 step 2's test to write.
- **Does NOT settle:** anything about packaged-app paths, `asar`, or `userData`. The
  handler here serves strings from memory.
