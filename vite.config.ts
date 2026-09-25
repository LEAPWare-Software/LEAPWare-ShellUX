import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { RENDERER_CSP } from './electron/main/rendererCsp.js';
import { SHARED_MODULES, sharedModuleSource } from './src/sdk/sharedModules.js';

/**
 * Serve the fixture shell at `/` on the DEV SERVER ONLY.
 *
 * `src/App.tsx` registers no extension, so `npm run dev` used to open an empty
 * three-pane frame: no navigation entries, no rows, no contextual actions. A
 * reader following README's Getting Started saw a shell with nothing in it and
 * had to be told separately to open a second URL. That is the whole of GitHub
 * issue #39 — "nobody has ever run the app" — on the developer's side.
 *
 * **What this does and does not change.** It rewrites the request for `/` to
 * `dev.html` before Vite's own HTML middleware sees it. It is installed under
 * `configureServer`, which Vite calls for `vite` and `vite preview` and never
 * during `vite build`, so no build output is affected. `dev.html`,
 * `src/dev/main.dev.tsx` and the three plugins' source under `plugins/`
 * remain unreachable from anything a user installs, because neither build
 * input references them.
 *
 * **This banner used to say "`index.html` remains the only build input", and
 * that sentence is now false and has been rewritten rather than left standing.**
 * Phase 7's process split gives the shell a second document — `paneview.html`,
 * the extension surface holding panes 2 and 3 — and a second document has to be
 * BUILT, or the packaged application has a second `WebContentsView` with nothing
 * to load into it. `build.rollupOptions.input` is therefore declared below with
 * two entries. The property the old sentence was really defending is unchanged
 * and is now defended by the list rather than by the default: `dev.html` is not
 * in it.
 *
 * **`/index.html` still serves the production shell**, unrewritten, so the empty
 * registry is still reachable on the dev server by name. This is a rewrite of one
 * path, not a replacement of one document with another.
 *
 * **No environment variable, and that is the point.** ADR-0002 forbids a
 * local-environment dependency without a working default, and `.gitignore`
 * records that nothing in this repository reads one. `src/dev/DevShell.tsx`
 * rejected a `VITE_MOCKS=1` switch for the same reason and reached for a second
 * HTML document instead; this reaches for a dev-server middleware, which is the
 * same argument applied to which document `/` resolves to. There is no flag to
 * set, no mode to remember, and no way for a mock to reach a production bundle.
 */
function serveFixtureAtRoot(): Plugin {
  return {
    name: 'leapware-shellux:serve-fixture-at-root',
    // `serve` alone. `vite build` never invokes this hook, so the production
    // input set is untouched by construction rather than by convention.
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // Exactly `/`, with or without a query string. `/index.html` is
        // deliberately NOT rewritten: the production shell stays reachable by
        // its own name on the same server.
        if (req.url === '/' || req.url?.startsWith('/?') === true) {
          req.url = '/dev.html';
        }
        next();
      });
    },
  };
}

/**
 * The build-input name prefix, and the URL path, of ADR-0006's shared modules.
 * An entry whose name starts with it is emitted as `<name>.js` with no hash.
 */
const SHARED_PREFIX = 'shared/';

/**
 * Serve `/shared/<name>.js` on the DEV SERVER, from the source module that
 * the build emits under that name.
 *
 * The request is rewritten to the module's source path before Vite's own
 * transform middleware sees it, so Vite serves it the way it serves any source
 * module: its `react` import resolves to the one pre-bundled React every other
 * module on the page gets. `apply: 'serve'`, so `vite build` never runs it; in a
 * build the same URLs are real files (`build.rollupOptions` below). Only the
 * three names in `SHARED_MODULES` (`src/sdk/sharedModules.ts`) are rewritten; anything else under `/shared/`
 * falls through to Vite's own 404.
 */
function serveSharedModules(): Plugin {
  return {
    name: 'leapware-shellux:serve-shared-modules',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const match = /^\/shared\/([a-z-]+)\.js(?:\?.*)?$/.exec(req.url ?? '');
        const source = match?.[1] === undefined ? undefined : sharedModuleSource(match[1]);
        if (source !== undefined) req.url = `/${source}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveFixtureAtRoot(), serveSharedModules()],
  resolve: {
    alias: {
      // ADR-0006 step 7. `dev.html` imports the three plugins' SOURCE directly
      // (`src/dev/DevShell.tsx`), and their source names the host only through
      // `@shellux/sdk` — the bare specifier decision 3 and decision 5 give a
      // plugin, never a relative path into `src/core/`. On the DEV SERVER this
      // alias is what resolves it, to the same `src/sdk/index.ts` the built
      // `/shared/sdk.js` module is one of the shared build inputs for below.
      // `npm run plugins:build` (`scripts/build-plugins.mjs`) does NOT reuse this
      // config: it marks `@shellux/sdk` EXTERNAL and rewrites it to
      // `/shared/sdk.js` in the emitted `.lwplugin` bundle, which is the whole
      // point of decision 5's build-time rewrite — an alias here would inline a
      // second copy instead.
      '@shellux/sdk': fileURLToPath(new URL('src/sdk/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  // -------------------------------------------------------------------------
  // `vite preview` SERVES THE BUILD THE WAY THE PACKAGED APP'S SCHEME DOES:
  // one origin, and the renderer's Content-Security-Policy on every response.
  //
  // The policy is imported from `electron/main/rendererCsp.ts`, not restated,
  // so this server cannot send a different one. The browser lane
  // (`playwright.config.ts`) builds and previews on this port to load
  // `/shared/*.js` from a real build under `script-src 'self'` — ADR-0006 step
  // 2. What it is not: the `shellux:` scheme handler. That handler's path
  // resolution and headers are tested in `electron/__tests__/rendererCsp.test.ts`;
  // this server is Vite's static server with the same header, nothing more.
  // The dev server above still sends no policy (ADR-0006 decision 5).
  // -------------------------------------------------------------------------
  preview: {
    port: 4173,
    strictPort: true,
    headers: { 'Content-Security-Policy': RENDERER_CSP },
  },
  build: {
    // ---------------------------------------------------------------------
    // GITHUB ISSUE #85, THE ELECTRON HALF. THE SAFARI HALF IS MOOT FOR THIS
    // APPLICATION AND IS NOT ADDRESSED HERE — see the commit message.
    //
    // No `build.target` and no `browserslist` meant the output syntax level
    // was whatever esbuild's own default happened to be, and nothing in the
    // repository recorded what runtime this bundle is built for. This
    // application ships inside one Electron binary — `electron/main/index.ts`
    // serves the renderer over a private scheme, never `file://` and never an
    // arbitrary browser — so the correct target is not a browserslist guess,
    // it is the exact Chromium that binary embeds.
    //
    // MEASURED, not recalled: `node_modules/electron/package.json` reports
    // `"version": "43.2.0"`, and running that exact binary
    // (`npx electron <script>` printing `process.versions`) reported
    // `"chrome":"150.0.7871.129"`. `chrome150` is that measurement, not the
    // Safari 15.4 floor `Object.hasOwn` at `src/core/ShellAPI.ts:1183` would
    // need for a browser deployment — this repository has exactly one shipped
    // runtime and this target is that runtime's.
    // ---------------------------------------------------------------------
    target: 'chrome150',
    // GitHub issue #86: no `build.sourcemap` meant a production stack trace
    // named minified symbols with nothing to de-minify them against.
    // `electron-builder.yml`'s `files` list excludes every `*.map` from the
    // packaged asar, so this is a build artefact for a developer reading a
    // crash log locally, never something the shipped application carries.
    sourcemap: true,
    rollupOptions: {
      // ---------------------------------------------------------------------
      // TWO DOCUMENTS, LISTED RATHER THAN DEFAULTED.
      //
      // `index.html` is host chrome and `paneview.html` is the extension
      // surface — the two `WebContentsView`s of the two-process topology, one
      // build input each. Declaring the list rather than relying on the default
      // is what makes `dev.html`'s exclusion a statement instead of a
      // side-effect: a third root document added tomorrow is not shipped unless
      // somebody adds it here, which is a line in a diff.
      //
      // Written with `fileURLToPath(new URL(...))` rather than `__dirname`
      // because this config is an ES module, and with a URL rather than a
      // string join because `platform-only-path-separator` in
      // `scripts/check-portability.mjs` is right about backslashes.
      // ---------------------------------------------------------------------
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        paneview: fileURLToPath(new URL('paneview.html', import.meta.url)),
        // -------------------------------------------------------------------
        // THE THREE SHARED MODULES — ADR-0006 decision 5, step 2.
        //
        // A plugin built on its own imports `react`, `react/jsx-runtime` and
        // `@shellux/sdk` as `/shared/react.js`, `/shared/react-jsx-runtime.js`
        // and `/shared/sdk.js`. Listing them here, in the SAME build as the two
        // documents, is what makes them the host's instances rather than
        // copies: the bundler emits one React and every entry that imports it
        // reaches that one. `output.entryFileNames` below gives exactly these
        // three a stable, unhashed name; `preserveEntrySignatures` keeps their
        // exports, which Vite otherwise drops from every entry because an HTML
        // entry has none to keep.
        // -------------------------------------------------------------------
        ...Object.fromEntries(
          [...SHARED_MODULES].map(([name, source]) => [
            `${SHARED_PREFIX}${name}`,
            fileURLToPath(new URL(source, import.meta.url)),
          ]),
        ),
      },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunk) =>
          chunk.name.startsWith(SHARED_PREFIX) ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
