import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
 * during `vite build`, so no build output is affected. `index.html` remains the
 * only build input — `build.rollupOptions.input` is still at its default — so
 * `dist/` contains exactly what it contained before this plugin existed, and
 * `dev.html`, `src/dev/main.dev.tsx` and `src/mocks/` are still unreachable from
 * anything a user installs.
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
});
