import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ---------------------------------------------------------------------------
  // Resolve dependencies the way the BROWSER bundle will, not the way Node
  // would.
  //
  // This is not a preference. `react-resizable-panels` ships two different
  // builds behind an export map, and the `node` one has the entire
  // window-splitter behaviour compiled out — no keyboard resizing, and no
  // `aria-valuemin`/`aria-valuenow` on the separator. Vitest runs in Node, so
  // without these conditions every divider test would have been asserting
  // against a build that ships to nobody, and the two ISSUE-002 requirements
  // that depend on it — keyboard-operable dividers, and a non-zero minimum so a
  // divider dragged to the edge leaves no 0px void — would have passed
  // vacuously. Measured, not assumed: the node build contains zero occurrences
  // of `aria-valuemin` and the browser build contains it.
  //
  // `ssr.resolve.conditions` is the half that matters, because Vitest processes
  // node_modules through Vite's SSR pipeline; the client list is set to match so
  // that an inlined dependency resolves identically.
  // ---------------------------------------------------------------------------
  resolve: {
    conditions: ['browser', 'development', 'module', 'import', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['browser', 'development', 'module', 'import', 'default'],
    },
  },
  test: {
    environment: 'jsdom',
    server: {
      deps: {
        // Processed by Vite rather than required straight from Node, so the
        // conditions above are the ones that decide which build is loaded.
        inline: ['react-resizable-panels'],
      },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // -----------------------------------------------------------------------
    // TWO ROOTS, AND THE SECOND ONE IS PHASE 7's.
    //
    // `electron/**` was outside this list for six phases and correctly so: it
    // was a window and a preload, neither of which has a unit worth testing
    // without Electron running. Phase 7 put three testable things there — the
    // focus ring's arbitration, the `MessagePortMain` adapter, and the scan that
    // replaces `src/__tests__/noEventListener.test.ts` for a directory that file
    // has never visited — and a test nothing runs is not a test.
    //
    // These run under jsdom like everything else. None of them touches a DOM;
    // the environment is shared because a second environment for three files
    // would be configuration nobody reads. **Coverage is deliberately NOT
    // widened to match**: the 100% gate below still covers `src/core/**`,
    // `src/components/**` and `src/hooks/**` only, so `electron/**` is tested
    // rather than gated — and those are not the same word.
    // -----------------------------------------------------------------------
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scoped deliberately: the 100% gate below is only meaningful if it covers
      // code that actually exists today. Widen the include list as each later
      // ISSUE lands its own tests — `src/components/**` was added by ISSUE-002,
      // whose Definition of Done requires the gate to pass for the shell layout,
      // the pane wrapper and the ribbon.
      include: [
        'src/core/**/*.{ts,tsx}',
        'src/components/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}',
        // ADR-0006 step 2: the SDK barrel, the shared-module entries and the
        // bump rule. A widening: plugin-facing code is gated from the commit
        // that creates it.
        'src/sdk/**/*.{ts,tsx}',
        // ADR-0006 step 3: the package validator and the `hostApiVersion`
        // rule. The first `electron/**` root under the gate, and a widening:
        // every main-process module that reads a plugin is gated from the
        // commit that creates it. Its tests live in `electron/__tests__/`,
        // outside this root, so no exclude is needed.
        'electron/main/plugins/**/*.ts',
      ],
      exclude: [
        'src/core/**/__tests__/**',
        'src/components/**/__tests__/**',
        'src/hooks/**/__tests__/**',
        'src/sdk/**/__tests__/**',
      ],
      // `all: true` was removed here when vitest 4 removed the option itself.
      //
      // **This is not a relaxation, and the difference is worth stating because
      // it looks like one.** Under vitest 2 the flag was what made an untested
      // module count against the gate at 0% rather than being silently absent
      // from the report — deleting it there would have let a whole uncovered
      // file disappear. Vitest 4 made that the default: every file matching
      // `include` above is instrumented whether or not a test imports it, so the
      // flag became a no-op and then an error.
      //
      // The property the gate depends on is therefore unchanged, and it is
      // checked rather than assumed — see the coverage figures in `verify`,
      // which still report every module under the three included roots.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
