import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // `dist-electron` joins `dist` for the same reason `dist` is here: it is
  // compiler output, not source. `npm run build:desktop` writes emitted `.js` and
  // `.js.map` into it, and `npm run lint` runs with `--max-warnings 0` — so
  // whether a generated artifact happens to trip a rule today is not a question
  // this repository should be leaving to chance on a lane it does not own.
  { ignores: ['dist', 'dist-electron', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    // `cts` is in this glob for one file and one reason. A sandboxed Electron
    // preload is loaded into a CommonJS realm, and this repository's root
    // `package.json` declares `"type": "module"`, so the preload's source carries
    // the `.cts` extension to force a `.cjs` emit — see electron/preload/index.cts.
    // A glob that stopped at `ts` would have let the one file with a hand-written
    // module-format constraint be the one file the linter never read.
    files: ['**/*.{ts,tsx,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Mirror tsconfig's noUnusedLocals/noUnusedParameters, which already
      // treat a leading underscore as "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // -------------------------------------------------------------------------
  // Build scripts. Plain Node ESM rather than TypeScript, so the block above does
  // not match them and they would otherwise be parsed with no rules at all.
  // `scripts/check-portability.mjs` is the script that enforces ADR-0002, and
  // "unchecked" is the wrong state for the thing doing the checking to be in.
  // -------------------------------------------------------------------------
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  // -------------------------------------------------------------------------
  // The native host. TypeScript, so the `**/*.{ts,tsx}` block above already
  // matches it and supplies its rules — but that block also supplies
  // `globals.browser`, which is the wrong environment for a main process. These
  // files run in Electron's main process under Node: there is no `document`, no
  // `window` and no `localStorage`, and `process` is a global rather than an
  // undeclared name. `electron/tsconfig.json` makes exactly the same statement to
  // the compiler with `lib: ["ES2023"]` and `types: ["node"]`, and this block is
  // that statement made to the linter. Overriding `globals` alone is enough; the
  // rules from the block above are inherited and are not restated here.
  // -------------------------------------------------------------------------
  {
    files: ['electron/**/*.{ts,cts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // -------------------------------------------------------------------------
  // The sandboxed preload, and the second exception this config makes.
  //
  // `@typescript-eslint/no-require-imports` exists to keep CommonJS imports out
  // of ES modules, and it is right about every other file in this repository.
  // This one file is a CommonJS module BY REQUIREMENT and not by accident: a
  // sandboxed Electron preload is loaded into a CommonJS realm, `sandbox: true`
  // is not negotiable, and `verbatimModuleSyntax` forbids ESM `import ... from`
  // syntax in a CommonJS file precisely so that a file cannot be written in one
  // shape and emitted in another. `import electron = require('electron')` is the
  // only spelling that satisfies all three, so the rule and the constraint are in
  // direct conflict and the constraint wins.
  //
  // Scoped to `*.cts` under `electron/preload/`, which is the one place the
  // constraint applies. A `require` anywhere else - including elsewhere under
  // `electron/` - still fails the build. Stated in config rather than as an
  // inline `eslint-disable`, for the reason the block below gives at length:
  // this repository has zero inline suppressions and that is a defended
  // invariant.
  // -------------------------------------------------------------------------
  {
    files: ['electron/preload/**/*.cts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // -------------------------------------------------------------------------
  // The two React context modules, and the one exception this config makes.
  //
  // `react-refresh/only-export-components` protects a dev-server convenience: a
  // module that exports something other than a component cannot be hot-replaced,
  // so editing it costs a full reload instead of a patched update. The five
  // exports named below trip it, and all five are correct where they are. A React
  // context module publishes its provider component and the hooks that read it
  // from one place - that co-location is the whole point of the pattern, and it is
  // what makes `useRegistry` importable from `./RegistryContext` rather than from
  // some second file whose only reason to exist is a bundler nicety.
  //
  // `npm run lint` runs with `--max-warnings 0`, so this rule is now a build gate
  // and the exception has to be stated somewhere. It is stated *here*, in config,
  // and not with an `eslint-disable` comment at the call site: this repository has
  // zero inline suppressions and that is a defended invariant. A config entry is
  // reviewable in one place, cannot drift silently onto an unrelated line, and
  // fails loudly if one of these exports is renamed - whereas an inline directive
  // would go stale in silence.
  //
  // The names are listed individually rather than switched off wholesale, so a
  // *new* non-component export in either file still fails the build and has to be
  // argued for on purpose. The accepted cost is bounded and known: editing either
  // file triggers a full reload during development.
  // -------------------------------------------------------------------------
  {
    files: ['src/core/ActivationContext.tsx', 'src/core/RegistryContext.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            // src/core/ActivationContext.tsx
            'useActivation',
            'useExtensionActivation',
            // src/core/RegistryContext.tsx
            'useRegistry',
            'useRegistryRevision',
            'validateBlueprint',
            // `clampMetricValue` is the sixth, and it is argued for rather than
            // waved through. A `NavigationMetric.value` is reached by TWO doors —
            // the registration door in this file and `IShellAPI.setNavMetric` at
            // runtime — and the clamp/reject asymmetry between them is a rule, not
            // an implementation detail: out of range is corrected, non-finite is
            // refused. Two copies of that rule would drift exactly the way two
            // copies of `isVisible` would, which is the argument ADR-0001
            // Amendment J Decision 1 makes for extracting a guard BEFORE adding a
            // second route to it. It lives here rather than in a module of its own
            // because it reports through this file's `describeType`, and moving it
            // out would mean exporting that too — a wider surface bought to close a
            // narrower one. The accepted cost is unchanged: this file already
            // triggers a full dev reload because of `validateBlueprint`.
            'clampMetricValue',
            // `normalizeNavigationTree` is the seventh, for `clampMetricValue`'s
            // reason exactly: a navigation tree is reached by TWO doors — `register`
            // and `IShellAPI.setNavigationTree` (ADR-0006 decision 8) — and the
            // decision is that the second runs the first's validator, bounds
            // included, rather than a copy of it. It reports through this file's
            // `describeType` and walks with its private `normalizeNavigationNode`.
            'normalizeNavigationTree',
          ],
        },
      ],
    },
  },
);
