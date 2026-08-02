#!/usr/bin/env node
/**
 * ============================================================================
 * THE TOKEN GENERATOR. PLAIN NODE, NO DEPENDENCIES, NOTHING TO INSTALL.
 * ============================================================================
 * Reads `design/tokens/**` and emits either the CSS custom-property blocks for
 * all three built-in themes, or the TypeScript module the host binds against.
 *
 * USAGE
 *   node design/generate.mjs --format=css
 *   node design/generate.mjs --format=ts
 *   node design/generate.mjs --format=css path/to/output.css
 *
 * IT PRINTS TO STDOUT BY DEFAULT AND THAT IS THE INTENDED MODE. Wiring the
 * output into the build is somebody else's change; this script's job is to make
 * the artefact reproducible, not to decide where it lives. A path may be given
 * as a positional argument, and a path under `src/` is REFUSED — the generated
 * artefacts are committed by a wiring change that also adds the drift check, and
 * a generator that can quietly overwrite a source file is a generator that will.
 *
 * WHY THERE IS NO STYLE DICTIONARY HERE. `native-host-pivot.md` 3.6 names
 * Style Dictionary v4 as the transform, and that is still the right answer for
 * the wired pipeline. It is not the right answer for THIS deliverable, which has
 * to run in a working tree where `npm install` is forbidden. Every transform
 * this script performs is one Style Dictionary would perform later; nothing here
 * makes adopting it harder.
 * ============================================================================
 */

import { writeFileSync } from 'node:fs';
import {
  BUILT_IN_THEME_IDS,
  componentTokens,
  loadCore,
  loadSemantic,
  loadTheme,
  resolveTheme,
  semanticEntries,
} from './lib/resolve.mjs';

const BANNER = [
  '/*',
  ' * GENERATED FILE. DO NOT EDIT.',
  ' *',
  ' * Source:    design/tokens/core.tokens.json',
  ' *            design/tokens/semantic.json',
  ' *            design/tokens/themes/*.tokens.json',
  ' * Generator: design/generate.mjs',
  ' * Validated: design/check-contrast.mjs against design/contrast-manifest.json',
  ' *',
  ' * Every colour below is already inside the sRGB gamut: chroma was reduced at',
  ' * constant lightness and hue at generation time, so the browser has nothing',
  ' * left to gamut-map and what it paints is what the contrast checker measured.',
  ' */',
].join('\n');

/**
 * The selector list one theme's block is published under.
 *
 * Two selectors, not one. The theme id is the precise handle a theme switcher
 * writes; the short alias is what `darkMode: ['selector', '[data-theme="dark"]']`
 * in the eventual Tailwind config will look for. Publishing both means the
 * Tailwind config and the theme registry do not have to agree on a spelling.
 */
function selectorsFor(id, index) {
  const alias = { 'leapware-dark': 'dark', 'leapware-light': 'light' }[id];
  const selectors = [`[data-theme='${id}']`];
  if (alias !== undefined) selectors.push(`[data-theme='${alias}']`);
  // The first theme in the list is also the unqualified default, so a document
  // that never sets `data-theme` still has a complete token set rather than a
  // page of `var()` references resolving to nothing.
  if (index === 0) selectors.unshift(':root');
  return selectors;
}

function renderCss() {
  const core = loadCore();
  const semantic = loadSemantic();
  const entries = semanticEntries(semantic);

  const chunks = [BANNER, ''];

  chunks.push('/* Component tier. Theme-independent, host-only, never read by an extension. */');
  chunks.push(':root {');
  for (const { name, css } of componentTokens(core)) {
    chunks.push(`  ${name}: ${css};`);
  }
  chunks.push('}');
  chunks.push('');

  BUILT_IN_THEME_IDS.forEach((id, index) => {
    const theme = loadTheme(id);
    const { meta, tokens } = resolveTheme(core, semantic, theme);
    chunks.push(`/* ${meta.name} — polarity ${meta.polarity}, contrast ${theme.contrast.$value}. */`);
    chunks.push(`${selectorsFor(id, index).join(',\n')} {`);
    chunks.push(`  color-scheme: ${meta.polarity};`);

    let currentGroup = null;
    for (const entry of entries) {
      if (entry.group !== currentGroup) {
        currentGroup = entry.group;
        chunks.push(`  /* ${currentGroup} */`);
      }
      const resolved = tokens.get(entry.name);
      const trailer = resolved.hex === undefined ? '' : ` /* ${resolved.hex} */`;
      chunks.push(`  ${entry.name}: ${resolved.css};${trailer}`);
    }
    chunks.push('}');
    chunks.push('');
  });

  return chunks.join('\n');
}

function renderTs() {
  const semantic = loadSemantic();
  const entries = semanticEntries(semantic);
  const names = entries.map((entry) => entry.name);

  const quoted = names.map((name) => `  '${name}',`).join('\n');
  const union = names.map((name) => `  | '${name}'`).join('\n');

  return `${BANNER}

/**
 * The public semantic token contract.
 *
 * This is the ONLY tier an extension may read. A name here is a name that
 * cannot be removed without a breaking change, and \`normalizeTheme\` uses the
 * set below as its allowlist: a third-party theme naming anything that is not a
 * member is rejected at the door rather than reaching a stylesheet.
 */
export const THEME_SCHEMA_VERSION = ${semantic.schemaVersion};

/** Every semantic token name, in declaration order. */
export const SEMANTIC_TOKEN_NAME_LIST = Object.freeze([
${quoted}
] as const);

export type SemanticTokenName = (typeof SEMANTIC_TOKEN_NAME_LIST)[number];

/**
 * The same names as a membership set.
 *
 * \`Object.freeze\` ON A \`Set\` DOES NOT STOP \`.add()\`. That is recorded as a trap
 * in HANDOFF.md section 11 — freezing the wrong container reads as a control and
 * is not one — so the mutators are replaced on the instance BEFORE the freeze,
 * and the freeze is what stops them being replaced back. Without the first half
 * this constant would be an ordinary mutable \`Set\` wearing a reassuring word.
 */
function hardenedSet(names: readonly SemanticTokenName[]): ReadonlySet<SemanticTokenName> {
  const set = new Set<SemanticTokenName>(names);
  const refuse = (member: string) => (): never => {
    throw new Error(\`SEMANTIC_TOKEN_NAMES is immutable; \${member} is not available on it.\`);
  };
  Object.defineProperties(set, {
    add: { value: refuse('add'), writable: false, configurable: false },
    delete: { value: refuse('delete'), writable: false, configurable: false },
    clear: { value: refuse('clear'), writable: false, configurable: false },
  });
  return Object.freeze(set);
}

export const SEMANTIC_TOKEN_NAMES: ReadonlySet<SemanticTokenName> = hardenedSet(
  SEMANTIC_TOKEN_NAME_LIST,
);

/** The built-in theme ids, in the order a theme picker lists them. */
export const BUILT_IN_THEME_IDS = Object.freeze([
${BUILT_IN_THEME_IDS.map((id) => `  '${id}',`).join('\n')}
] as const);

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
`;
}

function main(argv) {
  const flags = argv.filter((argument) => argument.startsWith('--'));
  const positional = argv.filter((argument) => !argument.startsWith('--'));

  const formatFlag = flags.find((flag) => flag.startsWith('--format='));
  const format = formatFlag === undefined ? 'css' : formatFlag.slice('--format='.length);
  if (format !== 'css' && format !== 'ts') {
    process.stderr.write(`Unknown --format=${format}. Use css or ts.\n`);
    return 2;
  }

  const output = format === 'css' ? renderCss() : renderTs();

  const destination = positional[0];
  if (destination === undefined) {
    process.stdout.write(`${output}\n`);
    return 0;
  }
  if (/(^|[\\/])src([\\/]|$)/.test(destination)) {
    process.stderr.write(
      'Refusing to write into src/. Print to stdout and let the wiring change decide where the artefact lands.\n',
    );
    return 2;
  }
  writeFileSync(destination, `${output}\n`, 'utf8');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
