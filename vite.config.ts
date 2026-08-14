import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ---------------------------------------------------------------------------
  // RELATIVE ASSET PATHS, BECAUSE THERE IS NO DEPLOYMENT TARGET TO BE ABSOLUTE
  // AGAINST.
  //
  // `base` is a TOP-LEVEL Vite option, not a member of `build`, which is why it
  // sits here rather than in the block below. Written inside `build` it would be
  // ignored and the default would go on applying silently, which is the worst
  // shape a configuration mistake has.
  //
  // That default — `'/'` — is what made `dist/index.html` emit `/assets/…`, an
  // absolute path that resolves only when the bundle is served from a domain
  // root. Nothing in this repository says where it is served from: there is no
  // Pages configuration, no gh-pages workflow and no deploy job anywhere, and
  // `HANDOFF.md` records the state as no observability, no sourcemaps, no deploy
  // story while separately flagging the absolute asset paths as a 404 on any
  // subpath deployment. `'./'` is the one value that is correct at a domain root
  // AND at any subpath depth, and it names no host — which is not merely tidy:
  // `npm run check:portability` FAILS on a hardcoded network host in a tracked
  // non-Markdown file, so a base carrying an origin could not be committed here
  // at all.
  //
  // THE LIMIT, stated rather than glossed. A relative path resolves against the
  // DOCUMENT's URL, not against the site root, so `'./'` breaks the moment a
  // client-side router serves a deep URL such as `/a/b/` out of the same
  // `index.html`: the assets would be looked for under `/a/b/assets/`. There is
  // no router in this shell today — the extension model is compile-time only,
  // with no dynamic import and no deep URL to serve — so the case does not
  // arise. The day it does, this value has to be revisited rather than inherited.
  // ---------------------------------------------------------------------------
  base: './',
  server: {
    port: 5173,
  },
  build: {
    // Vite's default is `false`, so a production stack trace pointed into
    // minified nonsense with no way back to a source line. `FaultBoundary`
    // reports every contained failure through `console.error`, and a report whose
    // frames name a mangled bundle is a fraction of the report it looks like.
    sourcemap: true,
    // The BUNDLE's syntax floor, which was never declared before this line.
    //
    // `tsconfig.json` sets `"target": "ES2022"`, and that governs TypeScript's
    // EMIT only — it says nothing to the bundler. Vite's own default is
    // `'modules'`, an esbuild baseline of roughly Chrome 87 / Firefox 78 /
    // Safari 14 / Edge 88, and `package.json` carries no `browserslist` either,
    // so the two halves of the pipeline were quietly targeting two different
    // languages. Naming `'es2022'` makes the bundle agree with the TypeScript
    // target instead of silently differing from it.
    //
    // It DOCUMENTS the floor that already exists rather than creating a new one.
    // Full ES2022 syntax support lands in Chrome 94, Edge 94, Firefox 93 and
    // Safari 15.4, which is the same floor this codebase already imposes at
    // runtime.
    //
    // And it is a SYNTAX setting, so be exact about what it does not reach: a
    // runtime library API is neither downlevelled nor polyfilled by `target`.
    // Whatever library floor the source has, this line leaves it exactly where it
    // was — raising or lowering one is a separate change, not a side effect of
    // declaring the syntax target.
    target: 'es2022',
  },
});
