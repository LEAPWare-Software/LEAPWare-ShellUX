#!/usr/bin/env node
/**
 * ============================================================================
 * `npm run plugins:build` — ONE `.lwplugin` PER PLUGIN UNDER `plugins/*`.
 * ============================================================================
 * ADR-0006 decision 1 (the package format), decision 3 (`hostApiVersion`) and
 * decision 4 (`sha512`), implementation step 7: "Move the three plugins to
 * `plugins/*`, `plugins:build`, delete `FIXTURE_EXTENSIONS`". This is the build.
 *
 * For every directory under `plugins/` carrying a `plugin.json`, it:
 *
 *   1. Bundles that plugin's source with Vite/Rollup into ONE ES module,
 *      `bundle.js` — decision 1's "one bundle, not a file tree" — marking
 *      `react`, `react/jsx-runtime` and `@shellux/sdk` EXTERNAL and rewriting
 *      those three specifiers to `/shared/react.js`, `/shared/react-jsx-
 *      runtime.js` and `/shared/sdk.js` (decision 5's build-time rewrite, the
 *      same one `vite.config.ts` documents and `e2e/shared-modules.spec.ts`
 *      measures for the host's own two documents).
 *   2. Hashes the emitted bytes (`sha512`, base64) and assembles the manifest
 *      decision 1 defines: `id`, `version`, `hostApiVersion`, `title`, `icon?`,
 *      `entry: "bundle.js"`, `sha512`.
 *   3. Writes `dist-plugins/<id>.lwplugin` — one UTF-8 JSON document,
 *      `{ format: "lwplugin/1", manifest, bundle: <base64> }` — the exact shape
 *      `electron/main/plugins/pluginPackage.ts`'s `parsePluginPackage` reads,
 *      unchanged; this script does not reimplement that validator, and does not
 *      call it either. This script has no `--verify` flag. Checking a built
 *      `.lwplugin` against the real validator is, today, a separate, manual
 *      step run outside this file (see the PR that added this script for the
 *      command and its output) — not something `npm run plugins:build` does
 *      for you. That gap is `plugin:check` (ADR-0006 decision 10 / step 8),
 *      which has not landed yet.
 *
 * ---------------------------------------------------------------------------
 * `hostApiVersion` COMES FROM THE SDK BARREL'S OWN SOURCE, READ AS TEXT
 * ---------------------------------------------------------------------------
 * `src/sdk/index.ts` exports `HOST_API_VERSION` as a TypeScript module; this
 * script is plain Node ESM (`scripts/` glob in `eslint.config.js`) and does
 * not run it through a compiler to import it. So the constant is read the way
 * `electron/main/plugins/hostContract.ts` is: MIRRORED, from the same file, by a
 * pattern narrow enough that a change to the constant's own line either matches
 * or fails loudly — never silently reads a stale value. That mirror is a
 * **guardrail** in this repository's vocabulary (ADR-0006's dated note under
 * decision 3, step 3): it makes an edit to one side without the other loud, at
 * the moment this script runs, and does not stop a hand edit to both sides
 * together. `EXTENSION_ID_PATTERN` and `RESERVED_IDS` are mirrored the same way,
 * from `src/core/RegistryContext.tsx`'s published values (`types.ts` only
 * references them in prose), restated here rather than parsed, because a
 * plugin's `id` has to be validated before a byte is written and this
 * script has no compiled `electron/main/plugins/hostContract.js` to import from
 * (that only exists after `npm run build:desktop`, which this script does not
 * require).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCRIPT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not install anything, does not touch `<userData>/plugins/`, and does
 * not attach anything to a GitHub Release — ADR-0006 decision 2's install
 * sources and the release-asset step are main-process and CI concerns
 * respectively, both out of scope here. It does not run `plugin:check`
 * (ADR-0006 decision 10 / step 8), which has not landed yet, and it does not
 * check its own output against `pluginPackage.ts`'s validator either — see
 * the note under "3." above.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');
const OUT_DIR = join(REPO_ROOT, 'dist-plugins');

/** Mirrors `src/sdk/index.ts`'s own `HOST_API_VERSION` export. See the banner. */
function readHostApiVersion() {
  const source = readFileSync(join(REPO_ROOT, 'src', 'sdk', 'index.ts'), 'utf8');
  const match = /export const HOST_API_VERSION = '([^']+)';/.exec(source);
  if (match === null) {
    throw new Error(
      'build-plugins: could not read HOST_API_VERSION out of src/sdk/index.ts; ' +
        'its declaration no longer matches the pattern this script mirrors it with.',
    );
  }
  return match[1];
}

/** Mirrors `src/core/RegistryContext.tsx`'s published `EXTENSION_ID_PATTERN`. See the banner. */
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Mirrors the registry's `RESERVED_IDS` (`src/core/RegistryContext.tsx`). */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

/** Base64 SHA-512 of `bytes` — the same digest `pluginPackage.ts`'s `sha512Base64` computes. */
function sha512Base64(bytes) {
  return createHash('sha512').update(bytes).digest('base64');
}

/** Every directory directly under `plugins/` that carries a `plugin.json`. */
function pluginDirectories() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(PLUGINS_DIR, entry.name, 'plugin.json')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * `plugin.json`: this script's OWN build metadata for one plugin — `id`,
 * `version`, `title`, an optional `icon`, and `source` (the entry file, relative
 * to the plugin's own directory). It is deliberately not decision 1's manifest
 * shape: `entry` there is fixed to `bundle.js` and `hostApiVersion`/`sha512` are
 * computed by this script, not authored, so giving this file the same field
 * names would read as though a packager could set them by hand.
 */
function readPluginConfig(name) {
  const dir = join(PLUGINS_DIR, name);
  const config = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  for (const key of ['id', 'version', 'title', 'source']) {
    if (typeof config[key] !== 'string' || config[key].length === 0) {
      throw new Error(`build-plugins: plugins/${name}/plugin.json is missing a "${key}" string`);
    }
  }
  if (config.icon !== undefined && typeof config.icon !== 'string') {
    throw new Error(`build-plugins: plugins/${name}/plugin.json's "icon" must be a string when present`);
  }
  if (!EXTENSION_ID_PATTERN.test(config.id) || RESERVED_IDS.has(config.id)) {
    throw new Error(`build-plugins: plugins/${name}/plugin.json's id ${JSON.stringify(config.id)} is not a valid extension id`);
  }
  return { dir, ...config };
}

/**
 * Bundle one plugin's source into `bundle.js`, decision 5's build-time rewrite
 * applied: `react`, `react/jsx-runtime` and `@shellux/sdk` external, and their
 * import specifiers rewritten to the three `/shared/*.js` URLs the packaged
 * scheme and the dev server both serve those modules at.
 */
async function bundlePlugin(config) {
  const entry = join(config.dir, config.source);
  const outDir = join(OUT_DIR, `.build-${config.id}`);
  await build({
    root: REPO_ROOT,
    configFile: false,
    logLevel: 'warn',
    plugins: [react()],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'chrome150',
      minify: false,
      write: true,
      rollupOptions: {
        input: entry,
        external: ['react', 'react/jsx-runtime', '@shellux/sdk'],
        output: {
          format: 'es',
          entryFileNames: 'bundle.js',
          codeSplitting: false,
          paths: {
            react: '/shared/react.js',
            'react/jsx-runtime': '/shared/react-jsx-runtime.js',
            '@shellux/sdk': '/shared/sdk.js',
          },
        },
      },
    },
  });
  const bytes = readFileSync(join(outDir, 'bundle.js'));
  rmSync(outDir, { recursive: true, force: true });
  return new Uint8Array(bytes);
}

/** Assemble and write one `.lwplugin`, decision 1's exact shape. */
function writePackage(config, bundleBytes, hostApiVersion) {
  const manifest = {
    id: config.id,
    version: config.version,
    hostApiVersion,
    title: config.title,
    ...(config.icon === undefined ? {} : { icon: config.icon }),
    entry: 'bundle.js',
    sha512: sha512Base64(bundleBytes),
  };
  const pkg = {
    format: 'lwplugin/1',
    manifest,
    bundle: Buffer.from(bundleBytes).toString('base64'),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${config.id}.lwplugin`);
  writeFileSync(outPath, JSON.stringify(pkg));
  return outPath;
}

async function main() {
  const hostApiVersion = readHostApiVersion();
  const names = pluginDirectories();
  if (names.length === 0) {
    throw new Error('build-plugins: no plugin under plugins/* carries a plugin.json');
  }
  for (const name of names) {
    const config = readPluginConfig(name);
    const bundleBytes = await bundlePlugin(config);
    const outPath = writePackage(config, bundleBytes, hostApiVersion);
    console.log(
      `build-plugins: wrote ${outPath} (${String(bundleBytes.byteLength)} bytes, bundle sha512 ${sha512Base64(bundleBytes).slice(0, 12)}…)`,
    );
  }
}

await main();
