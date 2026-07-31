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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
      ],
      exclude: [
        'src/core/**/__tests__/**',
        'src/components/**/__tests__/**',
        'src/hooks/**/__tests__/**',
      ],
      all: true,
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
