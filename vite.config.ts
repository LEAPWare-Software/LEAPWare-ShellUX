import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

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
 * `src/dev/main.dev.tsx` and `src/mocks/` remain unreachable from anything a
 * user installs, because neither build input references them.
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

export default defineConfig({
  plugins: [react(), serveFixtureAtRoot()],
  server: {
    port: 5173,
  },
  build: {
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
      },
    },
  },
});
