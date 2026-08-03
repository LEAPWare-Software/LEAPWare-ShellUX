/**
 * ============================================================================
 * TESTS FOR scripts/check-tokens.mjs — AND, MOSTLY, PROOF THAT IT BITES.
 * ============================================================================
 * A contrast gate that passes is the least interesting thing a contrast gate
 * can do. `design/README.md` says the checker there was "confirmed to bite" by
 * reverting one curve step and reproducing a known-failing ratio exactly; this
 * file does the same job for the gate that reads the SHIPPED stylesheet, and it
 * does it with **deliberately-failing themes** rather than with a green run and
 * a hopeful sentence.
 *
 * WHY IT IMPORTS RATHER THAN SPAWNS, WHICH IS THE OPPOSITE OF ITS NEIGHBOUR.
 * `check-portability.test.mjs` runs its subject as a subprocess, with a written
 * reason: that checker is a script that exits, and three of its rules only mean
 * anything against a real git index and a real filesystem. Neither applies here.
 * `checkTokens` was written as a pure function over stylesheet TEXT precisely so
 * that §10's second caller — `normalizeTheme`, validating an untrusted theme at
 * load time — can reuse it, and testing the function is testing the thing that
 * caller will use. The CLI is exercised end to end once, at the bottom.
 *
 * WHY THE FIXTURES ARE DERIVED FROM THE REAL STYLESHEET RATHER THAN WRITTEN OUT.
 * A hand-written 67-token fixture is a second copy of the contract, and it rots
 * the first time a token is added: the suite would go on proving that the gate
 * catches a failure in a stylesheet the shell stopped shipping years ago. Every
 * fixture below is the real generated CSS with ONE surgical edit, so a fixture
 * cannot drift from the artefact it is standing in for, and the edit is the only
 * difference the assertions can be reacting to.
 *
 * Node's own test runner. No dependency, for the same reason the checker has
 * none.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_ARTEFACTS,
  MANIFEST_PATH,
  TOKEN_CSS_PATH,
  checkDrift,
  checkTokens,
  loadTailwindColors,
  parseTokenCss,
} from '../check-tokens.mjs';

const CSS = readFileSync(TOKEN_CSS_PATH, 'utf8');
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/** The checker over the real artefacts, with an optional edit to the CSS. */
function run(edit = (text) => text, tailwindColors = null) {
  return checkTokens({ css: edit(CSS), manifest: MANIFEST, tailwindColors });
}

/** Replace one declaration's value, asserting that the declaration existed. */
function repoint(text, token, from, to) {
  const before = `${token}: ${from}`;
  assert.ok(text.includes(before), `fixture is stale: ${before} is no longer in the stylesheet`);
  return text.replace(before, `${token}: ${to}`);
}

/** Every failure mentioning `needle`, so an assertion names what it wants. */
function matching(failures, needle) {
  return failures.filter((failure) => failure.includes(needle));
}

describe('check-tokens — the shipped stylesheet, measured', () => {
  it('passes on the committed stylesheet, in all three themes', () => {
    const result = run();
    assert.deepEqual(result.failures, []);
    // The counts are asserted, not just the emptiness. A checker that parsed
    // nothing produces an empty failure list too, and that is the shape every
    // vacuous pass in this repository has taken.
    assert.equal(result.themes.length, 3);
    assert.equal(result.colourTokens, 65);
    assert.ok(result.measurements > 400, `only ${result.measurements} measurements`);
  });

  it('reads the colour from the printed oklch, which is all a browser is given', () => {
    const { themes } = parseTokenCss(CSS);
    // `design/README.md`'s recorded anchors, re-derived here from the stylesheet
    // rather than copied from the token JSON. If the generator's transform ever
    // moved a value, this is where the shipped artefact would say so.
    assert.equal(themes.get('leapware-light').get('--surface-pane').hex, '#ffffff');
    assert.equal(themes.get('leapware-dark').get('--surface-pane').hex, '#171717');
    assert.equal(themes.get('leapware-light').get('--border-default').hex, '#7e8085');
    assert.equal(themes.get('leapware-light').get('--text-muted').hex, '#5c5f64');
  });

  it('exempts the two focus-ring lengths by type instead of measuring them', () => {
    // `--focus-ring-width` and `--focus-ring-offset-width` are members of the
    // semantic contract and are not colours. A naive "every semantic token
    // needs a manifest row" rule fails on them, and a rule that quietly skipped
    // whatever it could not parse would be the type-size hole all over again.
    // They are classified by VALUE — not `oklch(...)`, therefore not a colour —
    // and so they can neither be measured nor reported as unreviewed.
    const { themes } = parseTokenCss(CSS);
    const light = themes.get('leapware-light');
    assert.equal(light.has('--focus-ring-width'), false);
    assert.equal(light.has('--focus-ring'), true);
  });
});

describe('check-tokens — deliberately-failing themes, so it cannot pass vacuously', () => {
  it('fails a theme whose muted text stops clearing 4.5:1', () => {
    // THE CENTRAL CONTROL. `--text-muted` is `#5c5f64` at 6.41:1 on the light
    // pane, and `design/README.md` records that 4.5:1 alone would have permitted
    // roughly `#767676` — the extra weight is bought to keep it legible on
    // `--surface-subtle`, where it measures 4.67:1 with under four percent of
    // headroom. Lightening it is therefore the smallest realistic regression
    // anybody could introduce, and the gate has to catch it.
    const result = run((text) =>
      repoint(text, '--text-muted', 'oklch(48.5% 0.009 264)', 'oklch(72% 0.009 264)'),
    );
    const failed = matching(result.failures, '--text-muted');
    assert.ok(failed.length > 0, 'a washed-out muted text passed the gate');
    assert.ok(
      failed.some((failure) => failure.includes('leapware-light')),
      `expected a light-theme failure, got: ${failed.join(' | ')}`,
    );
    assert.ok(failed.some((failure) => failure.includes('required 4.50')));
  });

  it('fails the hairline restored to the weight this change replaced', () => {
    // `border-neutral-200` on white measures 1.26:1, and reverting the curve
    // step to its lightness is how `design/README.md` confirmed its own checker
    // bit. Reproduced here against the stylesheet: `--border-default` moved to
    // roughly `#e5e5e5` must fail 3:1, and must fail it on the pane, the app
    // background and the sunken plot well, because the manifest declares all
    // three and the binding constraint is the lowest of them.
    const result = run((text) =>
      repoint(text, '--border-default', 'oklch(60% 0.0076 264)', 'oklch(91.4% 0 264)'),
    );
    const failed = matching(result.failures, '--border-default');
    assert.ok(failed.length >= 3, `expected several surfaces to fail, got ${failed.length}`);
    assert.ok(failed.some((failure) => failure.includes('--surface-pane')));
    assert.ok(failed.some((failure) => failure.includes('required 3.00')));
  });

  it('fails a chart palette whose series stop being distinguishable', () => {
    // The 66 pairwise separations are the constraint no WCAG criterion covers,
    // and the one `design/README.md` says consumed the most redesign. Moving
    // series 9 onto series 4's hue and lightness collapses the distance to
    // roughly zero, and the floor of 12 dE2000 has to notice.
    const result = run((text) =>
      repoint(text, '--chart-9', 'oklch(61.8% 0.16 272)', 'oklch(42.1% 0.16 300)'),
    );
    const failed = matching(result.failures, 'dE2000');
    assert.ok(failed.length > 0, 'two identical chart series passed the separation floor');
    assert.ok(failed.some((failure) => failure.includes('--chart-9')));
  });

  it('fails a theme block that has gone missing entirely', () => {
    const result = run((text) => text.replace("[data-theme='leapware-high-contrast']", '.unused'));
    assert.ok(matching(result.failures, 'MISSING THEME').length === 1);
    assert.ok(result.failures[0].includes('leapware-high-contrast'));
  });

  it('fails a stylesheet with no theme blocks at all, rather than reporting nothing', () => {
    // The vacuous pass in its purest form: measure zero rows over zero themes
    // and return an empty failure list. Named as a failure instead.
    const result = run(() => ':root { --unrelated: 1px; }\n');
    assert.ok(matching(result.failures, 'EMPTY').length === 1);
    assert.equal(result.measurements, 0);
  });

  it('fails a theme that quietly defines fewer tokens than its siblings', () => {
    const result = run((text) =>
      text.replace('  --status-info-subtle: oklch(27.2% 0.0203 232); /* #1d292f */\n', ''),
    );
    assert.ok(matching(result.failures, 'INCOMPLETE').length > 0);
    assert.ok(result.failures.some((failure) => failure.includes('--status-info-subtle')));
  });

  it('fails a colour that no manifest row reviews, and a row naming no colour', () => {
    // Exact in both directions, which is the property an allowlist normally
    // loses first. A new colour with no declared pair is UNREVIEWED; a row for a
    // colour the stylesheet dropped is STALE.
    const unreviewed = run((text) =>
      repoint(
        text,
        '--surface-app',
        'oklch(97.4% 0.0009 264); /* #f6f6f7 */',
        'oklch(97.4% 0.0009 264); /* #f6f6f7 */\n  --surface-invented: oklch(50% 0 264);',
      ),
    );
    // Planted in the reference theme, so it is reviewed against the manifest and
    // reported as UNREVIEWED. Planted in any other theme it is reported as
    // UNDECLARED by the cross-theme comparison instead — two different failures
    // for the same mistake, and neither of them is silence.
    assert.ok(
      matching(unreviewed.failures, 'UNREVIEWED').length === 1,
      `a colour nobody declared a pair for passed: ${unreviewed.failures.join(' | ')}`,
    );
    assert.ok(unreviewed.failures.some((failure) => failure.includes('--surface-invented')));

    const stale = checkTokens({
      css: CSS,
      manifest: {
        ...MANIFEST,
        rows: [
          ...MANIFEST.rows,
          {
            foreground: '--gone-away',
            background: '--surface-pane',
            minimum: 4.5,
            criterion: 'fixture',
            metric: 'wcag2-contrast',
          },
        ],
      },
    });
    assert.ok(matching(stale.failures, 'STALE').length === 1);
    assert.ok(stale.failures.some((failure) => failure.includes('--gone-away')));
  });

  it('fails an annotation that disagrees with the colour a browser would paint', () => {
    // One 8-bit step is tolerated, because the generator annotates the hex it
    // resolved at full precision and prints the OKLCH rounded. Two is not: that
    // is the generator's two spellings of one colour disagreeing, and the
    // comment is what a reviewer reads while the function is what ships.
    const result = run((text) =>
      text.replace('--surface-pane: oklch(100% 0 264); /* #ffffff */', '--surface-pane: oklch(100% 0 264); /* #f0f0f0 */'),
    );
    assert.ok(matching(result.failures, 'ANNOTATION').length > 0);
  });
});

describe('check-tokens — parity with the Tailwind colour map', () => {
  it('accepts the committed config, which maps every colour token and nothing else', async () => {
    const colors = await loadTailwindColors();
    assert.ok(colors !== null);
    assert.equal(Object.keys(colors).length, 65);
    assert.deepEqual(run((text) => text, colors).failures, []);
  });

  it('fails a token with no utility, and a utility naming no token', async () => {
    const colors = await loadTailwindColors();

    const orphanToken = { ...colors };
    delete orphanToken['border-default'];
    assert.ok(matching(run((t) => t, orphanToken).failures, 'NO UTILITY').length === 1);

    const orphanUtility = { ...colors, 'surface-imaginary': 'var(--surface-imaginary)' };
    assert.ok(matching(run((t) => t, orphanUtility).failures, 'DEAD UTILITY').length === 1);
  });

  it('fails a utility whose value is a literal rather than a var()', async () => {
    // The check that stops the token pipeline being bypassed at the last step.
    // `noRawColor.test.ts` scans `src/`, and `tailwind.config.js` is not in
    // `src/`, so a hex written here would otherwise reach the stylesheet with
    // nothing looking at it.
    const colors = { ...(await loadTailwindColors()), 'surface-pane': '#ffffff' };
    const failures = matching(run((t) => t, colors).failures, 'SHAPE');
    assert.equal(failures.length, 1);
    assert.ok(failures[0].includes('surface-pane'));
  });
});

describe('check-tokens — drift between the generator and its committed output', () => {
  it('finds both committed artefacts identical to what the generator emits today', () => {
    assert.equal(GENERATED_ARTEFACTS.length, 2);
    assert.deepEqual(checkDrift(), []);
  });

  it('reports a stale artefact, and names the line it first differs at', () => {
    // The control the drift check needs to not be decorative. Pointed at this
    // test file — which the generator certainly does not emit — the comparison
    // has to fail, and it has to say WHERE, because "the generated file is
    // stale" with no location gets ignored twice and then regenerated blindly.
    const failures = checkDrift([{ path: fileURLToPath(import.meta.url), format: 'css' }]);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^DRIFT /);
    assert.match(failures[0], /at line 1:/);
  });

  it('reports a generator that failed, rather than reading its empty output as agreement', () => {
    // The exit status is checked BEFORE the comparison, and this is the case
    // that proves it. `design/generate.mjs` rejects an unknown format with exit
    // 2 and an empty stdout; compare that stdout against an empty file and the
    // two are equal, so a drift check that only diffed strings would report a
    // dead generator as "no drift" — and would go on doing so after the
    // generator stopped working entirely.
    //
    // Asserted as `GENERATOR` specifically, not as `GENERATOR|DRIFT`: the looser
    // form passes whichever branch ran and therefore proves neither.
    const failures = checkDrift([{ path: TOKEN_CSS_PATH, format: 'not-a-format' }]);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^GENERATOR /);
    assert.match(failures[0], /exited 2/);
  });
});

describe('check-tokens — the command', () => {
  it('exits zero and reports the counts it measured', () => {
    const result = spawnSync(process.execPath, ['scripts/check-tokens.mjs'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /check-tokens: OK/);
    assert.match(result.stdout, /495 measurements over 3 themes/);
    // The limits are printed on every green run, not buried in a docblock,
    // because the gap between "the declared pairs pass" and "this is
    // accessible" is where every over-wide claim in this repository began.
    assert.match(result.stdout, /not an accessibility audit/);
  });
});
