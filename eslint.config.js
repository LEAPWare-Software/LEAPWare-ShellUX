import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
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
          ],
        },
      ],
    },
  },
);
