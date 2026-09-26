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
  {
    ignores: [
      'dist',
      'dist-electron',
      'coverage',
      'node_modules',
      // `npm run plugins:build`'s output (ADR-0006 step 7): emitted JS, not source.
      'dist-plugins',
    ],
  },
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
  // -------------------------------------------------------------------------
  // `TEXT_FORBIDDEN_PATTERN`/`TEXT_INVISIBLE_PATTERN` (D-56, #172), and the
  // third exception this config makes.
  //
  // `no-misleading-character-class` exists to catch a real authoring mistake:
  // writing what looks like ONE character (a base letter plus a combining
  // accent, an emoji plus a variation selector) as if it were two SEPARATE
  // alternatives inside a `[...]` class, when the source likely meant one
  // literal grapheme. That is the right rule for ordinary text.
  //
  // `TEXT_INVISIBLE_PATTERN` (in `src/core/RegistryContext.tsx`, mirrored in
  // `electron/main/plugins/hostContract.ts`) is not ordinary text: it is a
  // character class whose MEMBERS are, by design, combining marks and
  // variation selectors — U+034F COMBINING GRAPHEME JOINER, U+180B-180F the
  // Mongolian variation selectors, U+FE00-FE0F the BMP variation selectors,
  // and U+E0080-E0FFF (which covers the supplementary variation selectors,
  // U+E0100-E01EF, as part of a wider default-ignorable plane-14 range) —
  // listed as alternatives precisely
  // because each one, ALONE, must be caught and stripped for the blankness
  // check. Two of them sitting next to each other in the class's source text
  // is not a mistaken "did you mean one combined glyph" — it is the class
  // doing its job, and every "combined" pair the linter names here is two
  // members of one enumerated set, never two halves of one intended
  // character. Rewriting the class to separate every combining-class member
  // from its neighbour with a filler would not make the pattern more correct;
  // it would only hide the same shape from a future reader.
  //
  // Scoped to these two files only — the only place either pattern's source
  // lives — not to the whole codebase: a misleading character class written
  // anywhere else still fails the build. Flat config has no per-line
  // exception that is not an inline directive, and inline directives are the
  // thing this repository has zero of, so this necessarily turns the rule off
  // for these two files in full (~1600 lines each), not only for the two
  // patterns' own source text (measured: `printf 'export const R = /[❤️]/u;\n'
  // | npx eslint --stdin --stdin-filename src/core/RegistryContext.tsx` exits
  // 0). An unrelated genuine mistake of this shape written anywhere else in
  // either file would pass silently, not fail loudly — this exception buys
  // one reviewable config entry at the cost of a real, named gap, and the
  // docblocks on both patterns exist so a human reviewer checks for that by
  // hand, because the linter no longer will.
  // -------------------------------------------------------------------------
  {
    files: ['src/core/RegistryContext.tsx', 'electron/main/plugins/hostContract.ts'],
    rules: {
      'no-misleading-character-class': 'off',
    },
  },
);
