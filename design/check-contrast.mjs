#!/usr/bin/env node
/**
 * ============================================================================
 * THE CONTRAST CHECKER. PLAIN NODE, NO DEPENDENCIES, NOTHING TO INSTALL.
 * ============================================================================
 * Resolves every semantic token for every built-in theme and validates every
 * row of `design/contrast-manifest.json` against it.
 *
 * USAGE
 *   node design/check-contrast.mjs              # validate, exit non-zero on failure
 *   node design/check-contrast.mjs --table      # also print the measured table
 *   node design/check-contrast.mjs --self-test  # check the maths, then validate
 *
 * IT IS EXACT IN BOTH DIRECTIONS, AND THAT IS THE WHOLE POINT.
 *
 *   - A semantic colour token with NO manifest row fails as UNREVIEWED. A token
 *     nobody wrote a pair for has not been judged safe; it has not been judged
 *     at all, and a checker that stayed silent about it would be reporting the
 *     absence of evidence as evidence of absence.
 *   - A manifest row naming a token that does not exist fails as STALE. A row
 *     that measures nothing passes vacuously, which is the failure mode
 *     HANDOFF.md section 11 records as "a green test is not a test".
 *   - A contrast row whose BACKGROUND nothing in `src/` paints fails as
 *     UNPAINTED (GitHub #111). All twelve chart series were validated against
 *     `--surface-sunken` while nothing painted it: the series sat on
 *     `--surface-pane`, and the palette search had been optimised against the
 *     unpainted one. A pair measured on a background the product never draws
 *     measures nothing. Backgrounds of UI that does not exist yet are exempt by
 *     NAME, with a reason, in `UNBUILT_BACKGROUNDS` — and an exemption that has
 *     since gained a painter fails as STALE EXEMPTION, so the list cannot
 *     quietly outlive its reasons.
 *
 * CONTRAST IS A RELATION, NOT A PROPERTY. There is no such thing as an
 * accessible colour — only an accessible PAIR — which is why the manifest
 * declares pairs and why a token appears in as many rows as it has real
 * backgrounds. `--text-muted` carries six.
 *
 * WHAT THIS DOES NOT MEASURE, stated so nothing here is read wider than it is:
 *
 *   - It measures WCAG 2.x ratios. It does not compute APCA, and a passing run
 *     is not a claim that a pair reads well, only that it clears the ratio the
 *     manifest declares. Where APCA reasoning drove a value it did so through a
 *     decision recorded in design/README.md, not through a computation here.
 *   - It measures the BUILT-IN themes. It cannot validate a third-party theme,
 *     because nothing in `src/` runs this code — see design/README.md, "The gap
 *     between this manifest and the plan".
 *   - UNPAINTED is a GUARDRAIL, not an integrity control. It asks whether
 *     `src/` references the background the way a painter would — a Tailwind
 *     colour utility (`bg-surface-sunken`), `var(--surface-sunken)`, or the
 *     quoted name `'--surface-sunken'` — with comments stripped first. It does
 *     NOT check that the background is painted UNDER the row's foreground, and
 *     a reference in dead code satisfies it. It catches "no painter at all",
 *     which is what #111 was, and nothing narrower. CIEDE2000 rows compare two
 *     series, not a series with a background, and are out of its scope.
 *   - It runs as the second half of `npm run tokens:check` (after
 *     `scripts/check-tokens.mjs`, a different checker), so in `verify` and in
 *     `ci.yml` on three operating systems. It ran by hand only until the change
 *     that repaired #111.
 *   - It measures colour, not rendering. Anti-aliasing, sub-pixel positioning,
 *     font weight and a translucent ancestor all change what a user actually
 *     sees, and none of them is visible to a resolver reading JSON.
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, deltaE2000, deltaE2000Lab, hexToRgb } from './lib/color.mjs';
import {
  BUILT_IN_THEME_IDS,
  DESIGN_ROOT,
  loadCore,
  loadManifest,
  loadSemantic,
  loadTheme,
  resolveTheme,
  semanticEntries,
} from './lib/resolve.mjs';

const PASS = 'PASS';
const FAIL = 'FAIL';

/**
 * Manifest backgrounds that nothing paints YET, each with its reason. An entry
 * is a decision, not an oversight: the row stays in the manifest because the
 * pair is reviewed ahead of the UI that will paint it. Remove the entry in the
 * change that builds that UI — STALE EXEMPTION makes that the only option.
 */
const UNBUILT_BACKGROUNDS = Object.freeze({
  '--accent-solid': 'The primary-button fill. No primary button is built yet.',
  '--accent-solid-hover': 'The primary-button hover fill. No primary button is built yet.',
  '--accent-subtle': 'The accent wash behind a current item. Not built yet.',
  '--status-danger-subtle': 'The tinted background of a danger block. Not built yet.',
  '--status-warning-subtle': 'The tinted background of a warning block. Not built yet.',
  '--status-success-subtle': 'The tinted background of a success block. Not built yet.',
  '--status-info-subtle': 'The tinted background of an info block. Not built yet.',
  '--focus-ring-offset':
    'The inner half of the two-tone focus ring. tailwind.config.js maps it as the default ring-offset colour, and no ring-offset utility is used yet.',
});

/** The text of every file under `src/` that can paint: not generated, not a test. */
function paintingSources() {
  const root = join(DESIGN_ROOT, '..', 'src');
  /** @type {string[]} */
  const texts = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path);
      } else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(generated|test)\./.test(entry.name)) {
        // Comments stripped, so a docblock NAMING a background is not a painter.
        // The line-comment rule skips `://`, so a URL inside a string survives.
        texts.push(
          readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        );
      }
    }
  };
  walk(root);
  return texts.join('\n');
}

/** Whether `source` references `token` the way a painter would. */
function isPainted(source, token) {
  const bare = token.slice(2);
  return new RegExp(
    `(?<![\\w-])[a-z-]+-${bare}(?![\\w-])|var\\(--${bare}\\)|['"\`]--${bare}['"\`]`,
  ).test(source);
}

/**
 * Verify the maths against values this repository already publishes, and
 * against the CIEDE2000 reference data.
 *
 * The four contrast cases are quoted from README.md and from the docblocks in
 * `ShellLayout.tsx` and `PaneWrapper.tsx`. Checking against numbers somebody
 * else measured is the only self-test worth having: a converter checked against
 * its own output is checked against nothing.
 */
function selfTest() {
  /** @type {{what: string, got: number, want: number, tolerance: number}[]} */
  const cases = [
    // README.md: "a 2px leading rule at neutral-500 (4.74:1 on white ...)"
    { what: 'contrast #737373 on #ffffff', got: contrastRatio(hexToRgb('#737373'), hexToRgb('#ffffff')), want: 4.74, tolerance: 0.01 },
    // ShellLayout.tsx: "neutral-400 in dark (7.85:1 on neutral-950)"
    { what: 'contrast #a3a3a3 on #0a0a0a', got: contrastRatio(hexToRgb('#a3a3a3'), hexToRgb('#0a0a0a')), want: 7.85, tolerance: 0.01 },
    // ShellLayout.tsx EmptyPane: "4.18:1, under the 4.5:1 ..."
    { what: 'contrast #737373 on #0a0a0a', got: contrastRatio(hexToRgb('#737373'), hexToRgb('#0a0a0a')), want: 4.18, tolerance: 0.01 },
    // ShellLayout.tsx: "the border-neutral-200 beside it 1.26:1"
    { what: 'contrast #e5e5e5 on #ffffff', got: contrastRatio(hexToRgb('#e5e5e5'), hexToRgb('#ffffff')), want: 1.26, tolerance: 0.01 },
    { what: 'contrast #000000 on #ffffff', got: contrastRatio(hexToRgb('#000000'), hexToRgb('#ffffff')), want: 21.0, tolerance: 1e-9 },
    { what: 'deltaE2000 of a colour with itself', got: deltaE2000(hexToRgb('#336699'), hexToRgb('#336699')), want: 0, tolerance: 1e-9 },
    // Sharma, Wu & Dalal (2005), table 1 — pairs 1, 2, 3, 8 and 25.
    { what: 'CIEDE2000 reference pair 1', got: deltaE2000Lab({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }), want: 2.0425, tolerance: 0.0002 },
    { what: 'CIEDE2000 reference pair 2', got: deltaE2000Lab({ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }), want: 2.8615, tolerance: 0.0002 },
    { what: 'CIEDE2000 reference pair 3', got: deltaE2000Lab({ L: 50, a: 2.8361, b: -74.02 }, { L: 50, a: 0, b: -82.7485 }), want: 3.4412, tolerance: 0.0002 },
    // Pairs 9 and 11 differ only in the fourth decimal of one b component and
    // are the cases that separate a correct mean-hue convention from a
    // plausible-looking one: they straddle the 0/360 discontinuity and land on
    // opposite branches of it. An implementation that gets pair 9 right and
    // pair 11 wrong has the wrong convention and passes every ordinary colour.
    { what: 'CIEDE2000 reference pair 9', got: deltaE2000Lab({ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0009 }), want: 7.1792, tolerance: 0.0002 },
    { what: 'CIEDE2000 reference pair 11', got: deltaE2000Lab({ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0011 }), want: 7.2195, tolerance: 0.0002 },
    { what: 'CIEDE2000 reference pair 25', got: deltaE2000Lab({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }), want: 27.1492, tolerance: 0.0002 },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const ok = Math.abs(testCase.got - testCase.want) <= testCase.tolerance;
    if (!ok) failed += 1;
    process.stdout.write(
      `  ${ok ? PASS : FAIL}  ${testCase.what}: got ${testCase.got.toFixed(4)}, want ${testCase.want}\n`,
    );
  }
  return failed;
}

/** Resolve all three themes once. */
function resolveAll() {
  const core = loadCore();
  const semantic = loadSemantic();
  return {
    core,
    semantic,
    themes: BUILT_IN_THEME_IDS.map((id) => resolveTheme(core, semantic, loadTheme(id))),
  };
}

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

function main(argv) {
  const wantsTable = argv.includes('--table');

  if (argv.includes('--self-test')) {
    process.stdout.write('Self-test: colour maths against published values.\n');
    const failures = selfTest();
    process.stdout.write('\n');
    if (failures > 0) {
      process.stderr.write(`${failures} self-test case(s) failed. Not proceeding.\n`);
      return 1;
    }
  }

  const { core, semantic, themes } = resolveAll();
  const manifest = loadManifest();
  const entries = semanticEntries(semantic);

  /** @type {string[]} */
  const failures = [];

  // ---------------------------------------------------------------------
  // Exactness, direction one: a manifest row naming a token that does not
  // exist. Checked before any measurement, because a stale row measures
  // nothing and would otherwise pass by being skipped.
  // ---------------------------------------------------------------------
  const declared = new Set(entries.map((entry) => entry.name));
  for (const [index, row] of manifest.rows.entries()) {
    for (const side of ['foreground', 'background']) {
      if (!declared.has(row[side])) {
        failures.push(
          `STALE   manifest row ${index} names ${row[side]} as its ${side}, and semantic.json declares no such token.`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Exactness, direction two: a semantic colour token with no row at all.
  // Non-colour tokens are exempt BY TYPE and the exemption is printed, not
  // assumed: a dimension has no contrast and pretending to measure one
  // would be the vacuous-pass failure in a different costume.
  // ---------------------------------------------------------------------
  const covered = new Set();
  for (const row of manifest.rows) {
    covered.add(row.foreground);
    covered.add(row.background);
  }
  const dimensionTokens = [];
  for (const entry of entries) {
    if (entry.type !== 'color') {
      dimensionTokens.push(entry.name);
      continue;
    }
    if (!covered.has(entry.name)) {
      failures.push(
        `UNREVIEWED  ${entry.name} (${entry.group}) appears in no manifest row. A token nobody declared a pair for has not been reviewed.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Exactness, direction three (GitHub #111): a contrast row measured on a
  // background nothing paints. Reported once per background, not per row.
  // ---------------------------------------------------------------------
  const source = paintingSources();
  const backgrounds = new Set(
    manifest.rows.filter((row) => row.metric !== 'deltaE2000').map((row) => row.background),
  );
  for (const background of [...backgrounds].sort()) {
    if (!declared.has(background)) continue; // already reported as STALE
    const painted = isPainted(source, background);
    const exempt = Object.hasOwn(UNBUILT_BACKGROUNDS, background);
    if (!painted && !exempt) {
      failures.push(
        `UNPAINTED  ${background} is the background of a manifest row and nothing in src/ paints it. ` +
          'A pair measured on a background the product never draws measures nothing.',
      );
    } else if (painted && exempt) {
      failures.push(
        `STALE EXEMPTION  ${background} is in UNBUILT_BACKGROUNDS ("${UNBUILT_BACKGROUNDS[background]}") and src/ now paints it. Remove the entry.`,
      );
    }
  }
  for (const background of Object.keys(UNBUILT_BACKGROUNDS)) {
    if (!backgrounds.has(background)) {
      failures.push(
        `STALE EXEMPTION  ${background} is in UNBUILT_BACKGROUNDS and is the background of no contrast row.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Measurement, every row, every theme.
  // ---------------------------------------------------------------------
  /** @type {{theme: string, row: object, value: number}[]} */
  const measured = [];
  for (const theme of themes) {
    for (const [index, row] of manifest.rows.entries()) {
      const value = measure(row, theme.tokens);
      if (value === null) continue; // already reported as STALE
      measured.push({ theme: theme.meta.id, row, value });
      if (value + 1e-9 < row.minimum) {
        const unit = row.metric === 'deltaE2000' ? 'dE2000' : ':1';
        const suffix = row.metric === 'deltaE2000' ? '' : ':1';
        failures.push(
          `${theme.meta.id}\n` +
            `          ${row.foreground} on ${row.background}\n` +
            `          measured ${value.toFixed(2)}${suffix}, required ${row.minimum.toFixed(2)}${suffix} (${unit})\n` +
            `          criterion: ${row.criterion}\n` +
            `          values:    ${theme.tokens.get(row.foreground).hex} on ${theme.tokens.get(row.background).hex}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Report.
  // ---------------------------------------------------------------------
  const colourTokens = entries.filter((entry) => entry.type === 'color').length;
  process.stdout.write(
    `Semantic tokens: ${entries.length} (${colourTokens} colour, ${dimensionTokens.length} not contrast-bearing).\n`,
  );
  process.stdout.write(`Not contrast-bearing, exempt by type: ${dimensionTokens.join(', ')}\n`);
  process.stdout.write(
    `Manifest rows: ${manifest.rows.length}. Themes: ${themes.map((theme) => theme.meta.id).join(', ')}.\n`,
  );
  process.stdout.write(
    `Contrast backgrounds: ${backgrounds.size}. Exempt as unbuilt UI: ${Object.keys(UNBUILT_BACKGROUNDS).join(', ')}.\n`,
  );
  process.stdout.write(`Measurements: ${measured.length}.\n\n`);

  if (wantsTable) {
    for (const theme of themes) {
      process.stdout.write(`--- ${theme.meta.name} (${theme.meta.id}) ---\n`);
      for (const row of manifest.rows) {
        const value = measure(row, theme.tokens);
        if (value === null) continue;
        const ok = value + 1e-9 >= row.minimum;
        process.stdout.write(
          `  ${ok ? 'ok  ' : 'FAIL'} ${value.toFixed(2).padStart(6)} / ${row.minimum.toFixed(2).padStart(5)}  ` +
            `${row.foreground} on ${row.background}${row.role === undefined ? '' : `  [${row.role}]`}\n`,
        );
      }
      process.stdout.write('\n');
    }
  }

  if (failures.length === 0) {
    process.stdout.write('All rows pass, in every built-in theme.\n');
    // A green run says exactly this and no more. Printed rather than left for a
    // reader to infer, because the gap between the two is where every
    // over-wide accessibility claim in this repository has come from.
    process.stdout.write(
      'That is a statement about the pairs the manifest declares, in the three\n' +
        'built-in themes, measured as WCAG 2.x ratios and CIEDE2000 distances. It is\n' +
        'not an accessibility audit and it is not a conformance claim.\n',
    );
    return 0;
  }

  process.stderr.write(`${failures.length} failure(s):\n\n`);
  for (const failure of failures) {
    process.stderr.write(`  FAIL  ${failure}\n\n`);
  }
  return 1;
}

process.exitCode = main(process.argv.slice(2));
