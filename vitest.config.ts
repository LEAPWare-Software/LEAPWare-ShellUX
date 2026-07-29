import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scoped to src/core/** deliberately: the 100% gate below is only
      // meaningful if it covers code that actually exists today. Widen the
      // include list as each later ISSUE lands its own tests.
      include: ['src/core/**/*.{ts,tsx}'],
      exclude: ['src/core/**/__tests__/**'],
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
