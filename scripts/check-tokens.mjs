#!/usr/bin/env node
/**
 * ============================================================================
 * THE TOKEN GATE. IT READS THE STYLESHEET THE SHELL SHIPS, NOT THE JSON IT
 * WAS BUILT FROM.
 * ============================================================================
 * `design/check-contrast.mjs` resolves `design/tokens/*.json` in memory and
 * measures the result. That is the right gate for the token SOURCE, and it is
 * the wrong one for the shell, because it never opens the file a browser
 * actually loads. Everything between the source and the stylesheet — the
 * generator's OKLCH formatting, the gamut mapping it bakes in, the theme
 * selectors it emits, and the fact that `src/styles/tokens.generated.css` is a
 * COMMITTED artefact that can drift from its generator — is invisible to it.
 *
 * So this script starts from `src/styles/tokens.generated.css` and re-measures
 * every pair `design/contrast-manifest.json` declares, in every theme block the
 * stylesheet contains. A generator that emitted a colour the source never
 * described fails here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * IT REUSES `design/lib/`'S MATHS. IT DOES NOT REIMPLEMENT IT.
 * ---------------------------------------------------------------------------
 * `design/README.md` states the reason `lib/` exists at all: if the generator's
 * OKLCH-to-sRGB conversion and the checker's ever disagreed, the checker would
 * be measuring a stylesheet nobody ships and every green run would mean nothing.
 * A third implementation in this file would reintroduce exactly that, one layer
 * further out. `contrastRatio`, `deltaE2000`, `hexToRgb` and `resolveOklch` are
 * imported, and `design/check-contrast.mjs --self-test` is what validates them
 * against published CIEDE2000 references and this repository's own recorded
 * ratios. This file adds no colour science and is not entitled to any.
 *
 * ---------------------------------------------------------------------------
 * FOUR CHECKS, AND EACH IS EXACT IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * 1. MEASUREMENT. Every manifest row, in every theme block in the stylesheet.
 * 2. STALE / UNREVIEWED. A manifest row naming a token the stylesheet does not
 *    define fails as STALE; a colour token in the stylesheet that appears in no
 *    manifest row fails as UNREVIEWED. An allowlist that only grows in one
 *    direction is not a guardrail.
 * 3. SELF-CONSISTENCY. Every declaration is `oklch(...)` with a `/* #rrggbb *\/`
 *    annotation beside it, and the annotation is RE-DERIVED here rather than
 *    trusted. The generator writes both; if its own two spellings of one colour
 *    disagree, the comment is the one a human reads and the function is the one
 *    a browser paints, and that divergence has to fail.
 * 4. TAILWIND PARITY. Every colour token has a `theme.extend.colors` key in
 *    `tailwind.config.js`, and every such key names a token that exists. This is
 *    the check that catches "a token was added to the contract and no utility
 *    was ever generated for it", which nothing else in the repository can see.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ALSO AN EXPORTED FUNCTION
 * ---------------------------------------------------------------------------
 * §10 of the pivot plan requires `normalizeTheme` to refuse a third-party theme
 * against the same manifest at load time: one rule, one implementation, two
 * callers. `checkTokens` therefore takes stylesheet TEXT and returns findings
 * rather than printing and exiting. The CLI at the bottom is one of the two
 * callers, not the module's shape.
 *
 * **What a green run does NOT say**, stated here because `design/README.md` is
 * careful about it and a second gate is exactly where an over-wide claim gets
 * made: it says the declared pairs clear the declared numbers in the three
 * built-in themes, measured on 8-bit quantised sRGB. It says nothing about a
 * third-party theme, nothing about rendering — anti-aliasing, font weight, a
 * translucent ancestor and Windows 11 Mica all change what a user sees and none
 * is visible to a script reading text — nothing about colour-vision deficiency,
 * and nothing about any WCAG criterion that is not about contrast.
 *
 * Zero dependencies, plain Node, LF, no absolute path, no network. Same register
 * as `scripts/check-portability.mjs`.
 * ============================================================================
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contrastRatio, deltaE2000, hexToRgb, resolveOklch } from '../design/lib/color.mjs';

/** The repository root, resolved from this file rather than from the cwd. */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The stylesheet the shell ships. Committed, not built on demand. */
export const TOKEN_CSS_PATH = join(REPO_ROOT, 'src', 'styles', 'tokens.generated.css');
/** The declared pairs. Owned by `design/`, read-only from here. */
export const MANIFEST_PATH = join(REPO_ROOT, 'design', 'contrast-manifest.json');
/** The utility map, checked for parity with the token set. */
export const TAILWIND_CONFIG_PATH = join(REPO_ROOT, 'tailwind.config.js');

/**
 * The theme ids the stylesheet is expected to carry, and the selector each is
 * recognised by.
 *
 * Recognised by an EXPLICIT list rather than by scraping every `[data-theme=…]`
 * the file contains, so that a generator which silently stopped emitting the
 * high-contrast block fails as a missing theme instead of passing by measuring
 * two themes very thoroughly.
 */
export const EXPECTED_THEMES = Object.freeze([
  'leapware-light',
  'leapware-dark',
  'leapware-high-contrast',
]);

/** `--name: value;`, with the generator's hex annotation if it carried one. */
const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(#[0-9a-f]{3,8})\s*\*\/)?\s*$/i;

/** `oklch(<l>% <c> <h>)`, which is the only colour form the generator emits. */
const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** A `[data-theme='id']` in a selector list. */
const THEME_SELECTOR = /\[data-theme=['"]([a-z0-9-]+)['"]\]/gi;

/**
 * The stylesheet, as theme id to token name to resolved colour.
 *
 * A block whose selector list names several themes contributes to each of them,
 * which is how `:root, [data-theme='leapware-light'], [data-theme='light']`
 * populates the light theme and the `light` alias from one source of truth.
 * Non-colour declarations — the two focus-ring widths, and the whole component
 * tier on the bare `:root` block — are carried in `lengths` instead, so that a
 * later check can say "exempt by type" rather than silently skipping them.
 */
export function parseTokenCss(text) {
  /** @type {Map<string, Map<string, {value: string, hex: string, annotated: string | null}>>} */
  const themes = new Map();
  /** @type {Map<string, string>} */
  const lengths = new Map();
  /** @type {string[]} */
  const problems = [];

  // Comments are stripped BEFORE blocks are split, except the trailing hex
  // annotation, which is read off each declaration line first. The generator's
  // banner contains braces in prose and a naive split would treat it as a rule.
  const withoutBanner = text.replace(/\/\*(?![^\n]*#[0-9a-f]{3,8}\s*\*\/)[\s\S]*?\*\//g, '\n');

  const blocks = withoutBanner.split('}');
  for (const block of blocks) {
    const brace = block.indexOf('{');
    if (brace === -1) {
      continue;
    }
    const selector = block.slice(0, brace);
    const body = block.slice(brace + 1);

    /** @type {string[]} */
    const ids = [];
    THEME_SELECTOR.lastIndex = 0;
    let match;
    while ((match = THEME_SELECTOR.exec(selector)) !== null) {
      ids.push(match[1]);
    }

    for (const line of body.split('\n')) {
      const declaration = DECLARATION.exec(line);
      if (declaration === null) {
        continue;
      }
      const [, name, rawValue, annotated] = declaration;
      const value = rawValue.trim();
      const oklch = OKLCH.exec(value);

      if (oklch === null) {
        // A length, a font stack, a shadow, a duration. Not contrast-bearing.
        // Recorded rather than dropped, so the exemption is countable.
        if (ids.length === 0) {
          lengths.set(name, value);
        } else {
          for (const id of ids) {
            lengths.set(`${id} ${name}`, value);
          }
        }
        continue;
      }

      const resolved = resolveOklch({
        l: Number(oklch[1]) / 100,
        c: Number(oklch[2]),
        h: Number(oklch[3]),
      });

      // CHECK 3. The generator writes the colour twice — as the function a
      // browser paints and as the hex a human reads — and this is where the two
      // are held to each other. Trusting the comment would make the comment the
      // measurement, which is the failure mode this whole file exists to avoid.
      //
      // ONE 8-BIT STEP PER CHANNEL IS TOLERATED, AND THAT TOLERANCE IS MEASURED
      // RATHER THAN GUESSED. The generator annotates the hex of the colour it
      // resolved at full precision, then prints the OKLCH ROUNDED — two decimals
      // of lightness, four of chroma. Re-deriving from the printed string is the
      // honest thing to do, because the printed string is all a browser gets,
      // and it lands within one quantisation step. Exactly one token in the
      // shipped set is affected today: `--status-danger-subtle` in the dark
      // theme, `#312321` from the printed value against `#322321` annotated.
      // A wider divergence means the two halves of the generator disagree about
      // a colour, which is not a rounding artefact and fails.
      if (annotated !== undefined && annotated !== null) {
        const declared = hexToRgb(annotated);
        const painted = hexToRgb(resolved.hex);
        const drift = Math.max(...declared.map((value, index) => Math.abs(value - painted[index])));
        if (drift > 1) {
          problems.push(
            `ANNOTATION  ${name}${ids.length === 0 ? '' : ` in ${ids[0]}`} is declared ` +
              `${value}, which a browser paints as ${resolved.hex}, but is annotated ` +
              `${annotated.toLowerCase()} — ${drift} steps apart, past the one step ` +
              'that rounding the printed OKLCH can account for.',
          );
        }
      }

      for (const id of ids) {
        let tokens = themes.get(id);
        if (tokens === undefined) {
          tokens = new Map();
          themes.set(id, tokens);
        }
        tokens.set(name, {
          value,
          hex: resolved.hex,
          annotated: annotated === undefined ? null : annotated,
        });
      }
    }
  }

  return { themes, lengths, problems };
}

/** One manifest row, measured in one theme, or `null` when a token is missing. */
function measure(row, tokens) {
  const foreground = tokens.get(row.foreground);
  const background = tokens.get(row.background);
  if (foreground === undefined || background === undefined) {
    return null;
  }
  if (row.metric === 'deltaE2000') {
    return deltaE2000(hexToRgb(foreground.hex), hexToRgb(background.hex));
  }
  return contrastRatio(hexToRgb(foreground.hex), hexToRgb(background.hex));
}

/**
 * Validate a token stylesheet against a manifest, and optionally against the
 * Tailwind colour map.
 *
 * Takes TEXT, not a path, so the same function serves the CLI below, the
 * `node --test` suite beside it, and — per §10 of the pivot plan — a future
 * `normalizeTheme` running it over an untrusted theme at load time.
 *
 * Returns findings rather than printing, and never throws for a bad stylesheet:
 * a malformed theme is a finding, because a validator that crashes on hostile
 * input is a denial of service rather than a gate.
 */
export function checkTokens({ css, manifest, tailwindColors = null, expectedThemes = EXPECTED_THEMES }) {
  /** @type {string[]} */
  const failures = [];
  const { themes, problems } = parseTokenCss(css);
  failures.push(...problems);

  for (const id of expectedThemes) {
    if (!themes.has(id)) {
      failures.push(`MISSING THEME  the stylesheet defines no block for ${id}.`);
    }
  }

  const present = expectedThemes.filter((id) => themes.has(id));
  // A run over zero themes is a run that measures nothing and reports nothing.
  // Named as a failure rather than left to be inferred from a suspiciously
  // short report, because this is the vacuous pass in its purest form.
  if (present.length === 0) {
    failures.push('EMPTY  no expected theme block was found, so nothing was measured.');
    return { failures, measurements: 0, themes: [], colourTokens: 0 };
  }

  // The token set is taken from the FIRST present theme and every other theme
  // is held to it, so a theme that quietly omits half the contract fails as a
  // difference rather than passing by having fewer things to measure.
  const reference = themes.get(present[0]);
  const colourNames = [...reference.keys()].sort();

  for (const id of present.slice(1)) {
    const names = [...themes.get(id).keys()].sort();
    const missing = colourNames.filter((name) => !names.includes(name));
    const extra = names.filter((name) => !colourNames.includes(name));
    for (const name of missing) {
      failures.push(`INCOMPLETE  ${id} defines no ${name}, which ${present[0]} does.`);
    }
    for (const name of extra) {
      failures.push(`UNDECLARED  ${id} defines ${name}, which ${present[0]} does not.`);
    }
  }

  // CHECK 2, direction one: a row naming a token the stylesheet never defines.
  // Evaluated before any measurement, because a stale row measures nothing and
  // would otherwise pass by being skipped.
  const defined = new Set(colourNames);
  for (const [index, row] of manifest.rows.entries()) {
    for (const side of ['foreground', 'background']) {
      if (!defined.has(row[side])) {
        failures.push(
          `STALE  manifest row ${index} names ${row[side]} as its ${side}, ` +
            'and the generated stylesheet defines no such colour.',
        );
      }
    }
  }

  // CHECK 2, direction two: a colour in the stylesheet that no row reviews.
  const covered = new Set();
  for (const row of manifest.rows) {
    covered.add(row.foreground);
    covered.add(row.background);
  }
  for (const name of colourNames) {
    if (!covered.has(name)) {
      failures.push(
        `UNREVIEWED  ${name} is a colour in the shipped stylesheet and appears in no ` +
          'manifest row. A colour nobody declared a pair for has not been reviewed.',
      );
    }
  }

  // CHECK 1. Every row, every theme.
  let measurements = 0;
  for (const id of present) {
    const tokens = themes.get(id);
    for (const row of manifest.rows) {
      const value = measure(row, tokens);
      if (value === null) {
        continue; // Already reported as STALE.
      }
      measurements += 1;
      // The same 1e-9 slack `design/check-contrast.mjs` uses, so a value sitting
      // exactly on its floor is not failed by a float representation.
      if (value + 1e-9 < row.minimum) {
        const unit = row.metric === 'deltaE2000' ? ' dE2000' : ':1';
        failures.push(
          `${id}: ${row.foreground} on ${row.background} measured ` +
            `${value.toFixed(2)}${unit}, required ${row.minimum.toFixed(2)}${unit} ` +
            `(${row.criterion}) — values ${tokens.get(row.foreground).hex} on ` +
            `${tokens.get(row.background).hex}`,
        );
      }
    }
  }

  // CHECK 4. Tailwind parity, exact in both directions.
  if (tailwindColors !== null) {
    const utilities = new Set(Object.keys(tailwindColors).map((key) => `--${key}`));
    for (const name of colourNames) {
      if (!utilities.has(name)) {
        failures.push(
          `NO UTILITY  ${name} is a colour token with no key in tailwind.config.js, ` +
            'so no utility class can ever reference it.',
        );
      }
    }
    for (const utility of utilities) {
      if (!defined.has(utility)) {
        failures.push(
          `DEAD UTILITY  tailwind.config.js declares ${utility.slice(2)}, and the ` +
            'generated stylesheet defines no such colour.',
        );
      }
    }
    for (const [key, value] of Object.entries(tailwindColors)) {
      // The shape is load-bearing and is not a style preference. A colour spelt
      // any other way either bakes a literal into the config — which
      // `src/__tests__/noRawColor.test.ts` cannot see, because it does not scan
      // this file — or uses the `<alpha-value>` channel form, which cannot work
      // against a generator that emits complete `oklch()` functions. The
      // reasoning is in `tailwind.config.js`'s own banner.
      if (value !== `var(--${key})`) {
        failures.push(
          `SHAPE  tailwind.config.js maps ${key} to ${String(value)}; the only ` +
            `permitted form is var(--${key}).`,
        );
      }
    }
  }

  return { failures, measurements, themes: present, colourTokens: colourNames.length };
}

/**
 * The two committed artefacts and the generator invocation each comes from.
 *
 * They are committed rather than built, because README's acceptance test is
 * `npm ci && npm run verify` with **no local setup**, and an artefact produced
 * only at build time would falsify it — a fresh clone would have a stylesheet
 * with no `:root` in it until somebody ran a step the acceptance test says they
 * do not have to run. Committing it moves the risk from "missing" to "stale",
 * and this is what makes stale a failure rather than a slow rot.
 */
export const GENERATED_ARTEFACTS = Object.freeze([
  { path: join(REPO_ROOT, 'src', 'styles', 'tokens.generated.css'), format: 'css' },
  { path: join(REPO_ROOT, 'src', 'core', 'theme', 'tokens.generated.ts'), format: 'ts' },
]);

/**
 * Re-run the generator and compare its output with what is committed.
 *
 * **In memory rather than through a scratch directory, deliberately.** Writing
 * the regenerated text to a temporary path and shelling out to `diff` would add
 * a filesystem round trip whose only observable effect is line-ending noise —
 * this repository checks out LF on every platform via `.gitattributes`, and a
 * temporary file written by a different tool need not — plus a platform-specific
 * invocation that ADR-0002's `platform-only-invocation` rule exists to forbid.
 * Comparing the strings is the same comparison with fewer ways to be wrong, and
 * both sides are normalised to LF first so that a developer whose editor rewrote
 * the committed file gets a real answer rather than a whole-file mismatch.
 *
 * The report names the first differing line, because "the generated file is
 * stale" with no location is a message that gets ignored twice and then
 * regenerated blindly.
 */
export function checkDrift(artefacts = GENERATED_ARTEFACTS) {
  /** @type {string[]} */
  const failures = [];
  for (const artefact of artefacts) {
    const generator = join(REPO_ROOT, 'design', 'generate.mjs');
    const run = spawnSync(process.execPath, [generator, `--format=${artefact.format}`], {
      encoding: 'utf8',
    });
    if (run.status !== 0) {
      failures.push(
        `GENERATOR  design/generate.mjs --format=${artefact.format} exited ` +
          `${String(run.status)}: ${(run.stderr ?? '').trim()}`,
      );
      continue;
    }
    const fresh = run.stdout.split('\r\n').join('\n');
    const committed = readFileSync(artefact.path, 'utf8').split('\r\n').join('\n');
    if (fresh === committed) {
      continue;
    }
    const freshLines = fresh.split('\n');
    const committedLines = committed.split('\n');
    let line = 0;
    while (
      line < freshLines.length &&
      line < committedLines.length &&
      freshLines[line] === committedLines[line]
    ) {
      line += 1;
    }
    failures.push(
      `DRIFT  ${artefact.path.slice(REPO_ROOT.length + 1).split('\\').join('/')} differs from ` +
        `design/generate.mjs --format=${artefact.format} at line ${line + 1}:\n` +
        `           committed: ${committedLines[line] ?? '<end of file>'}\n` +
        `           generated: ${freshLines[line] ?? '<end of file>'}`,
    );
  }
  return failures;
}

/** Load `theme.extend.colors` out of the Tailwind config, or `null`. */
export async function loadTailwindColors(path = TAILWIND_CONFIG_PATH) {
  const module = await import(pathToFileURL(path).href);
  const colors = module.default?.theme?.extend?.colors;
  return colors === undefined ? null : colors;
}

/** Read the three inputs off disk and validate them, drift included. */
export async function checkTokensFromDisk() {
  const result = checkTokens({
    css: readFileSync(TOKEN_CSS_PATH, 'utf8'),
    manifest: JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
    tailwindColors: await loadTailwindColors(),
  });
  return { ...result, failures: [...checkDrift(), ...result.failures] };
}

async function main() {
  const result = await checkTokensFromDisk();
  if (result.failures.length > 0) {
    process.stderr.write(`check-tokens: ${result.failures.length} failure(s).\n\n`);
    for (const failure of result.failures) {
      process.stderr.write(`  ${failure}\n`);
    }
    process.stderr.write('\n');
    return 1;
  }
  process.stdout.write(
    `check-tokens: OK — ${result.colourTokens} colour tokens, ${result.measurements} ` +
      `measurements over ${result.themes.length} themes, read from the generated stylesheet.\n`,
  );
  process.stdout.write(
    `  Both committed artefacts match design/generate.mjs, so neither has gone stale.\n`,
  );
  process.stdout.write(
    '  This says the declared pairs clear the declared numbers in the built-in themes,\n' +
      '  on 8-bit sRGB. It is not an accessibility audit and it says nothing about\n' +
      '  rendering, colour-vision deficiency, or any third-party theme.\n',
  );
  return 0;
}

// Only when run as a program. Imported by the test suite beside it, and — per
// §10 — by `normalizeTheme` later, neither of which wants a process exit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
