#!/usr/bin/env node
/**
 * ============================================================================
 * HOW `design/contrast-manifest.json` WAS PRODUCED.
 * ============================================================================
 * `node design/lib/build-manifest.mjs` rewrites the manifest from the
 * declarations below.
 *
 * The manifest is a COMMITTED ARTEFACT and this script is not part of any
 * pipeline: `check-contrast.mjs` reads the JSON, never this file. It exists
 * because sixty-six pairwise chart rows written by hand are sixty-six chances
 * to transpose a pair, and because a reader who wants to know why a row exists
 * should be able to read the rule that emitted it rather than reverse-engineer
 * it from the output.
 *
 * Editing this file and not re-running it leaves the two out of step, and
 * nothing detects that. That is a real limit and it is recorded in
 * design/README.md rather than papered over.
 * ============================================================================
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_ROOT } from './resolve.mjs';

const TEXT = 'WCAG 2.2 1.4.3 Contrast (Minimum), Level AA';
const NONTEXT = 'WCAG 2.2 1.4.11 Non-text Contrast, Level AA';
const DECOR =
  'Exempt from WCAG 2.2 1.4.11 - decorative, and never the sole means of perceiving anything. The minimum below is a legibility floor of our own, not a criterion.';
const INACTIVE = 'Exempt from WCAG 2.2 1.4.3 - inactive user interface component.';
const SEPARATION =
  'LEAPWare categorical separation - no WCAG criterion covers whether two series in one legend can be told apart.';

/** Every surface that can sit under reading text. */
const READING_SURFACES = [
  '--surface-pane',
  '--surface-app',
  '--surface-raised',
  '--surface-overlay',
  '--surface-sunken',
  '--surface-hover',
  '--surface-selected',
  '--surface-subtle',
];

/** The CIEDE2000 floor for two categorical series. A judgement, not a standard. */
const SERIES_FLOOR = 12;

const rows = [];

function add(foreground, background, minimum, criterion, extra = {}) {
  rows.push({ foreground, background, minimum, criterion, metric: 'wcag2-contrast', ...extra });
}

function separation(foreground, background, minimum, note) {
  rows.push({
    foreground,
    background,
    minimum,
    criterion: SEPARATION,
    metric: 'deltaE2000',
    ...(note === undefined ? {} : { note }),
  });
}

// -- Text -------------------------------------------------------------------
for (const background of READING_SURFACES) add('--text-primary', background, 4.5, TEXT);
// --text-muted is the single most-used colour in the shell (23 sites) and the
// one an accessibility audit already caught once in dark mode. Every surface.
for (const background of READING_SURFACES) add('--text-muted', background, 4.5, TEXT);
add('--text-secondary', '--surface-pane', 4.5, TEXT);
add('--text-secondary', '--surface-app', 4.5, TEXT);
add('--text-secondary', '--surface-selected', 4.5, TEXT);
add('--text-link', '--surface-pane', 4.5, TEXT);
add('--text-link', '--surface-app', 4.5, TEXT);
add('--text-danger', '--surface-pane', 4.5, TEXT);
add('--text-danger', '--status-danger-subtle', 4.5, TEXT);
add('--text-warning', '--surface-pane', 4.5, TEXT);
add('--text-warning', '--status-warning-subtle', 4.5, TEXT);
add('--text-success', '--surface-pane', 4.5, TEXT);
add('--text-success', '--status-success-subtle', 4.5, TEXT);
add('--text-on-accent', '--accent-solid', 4.5, TEXT);
add('--text-on-accent', '--accent-solid-hover', 4.5, TEXT);
add('--text-disabled', '--surface-pane', 1.8, INACTIVE, {
  role: 'inactive',
  note: 'The 1.8 floor is ours. WCAG exempts a disabled control, but a control nobody can see is a control nobody knows exists; it must still read as present and unavailable.',
});

// -- Borders ----------------------------------------------------------------
add('--border-default', '--surface-pane', 3.0, NONTEXT, {
  note: 'THE live 1.4.11 fix. Today border-neutral-200 on white measures 1.26:1.',
});
add('--border-default', '--surface-app', 3.0, NONTEXT);
add('--border-default', '--surface-raised', 3.0, NONTEXT);
add('--border-default', '--surface-overlay', 3.0, NONTEXT);
add('--border-default', '--surface-sunken', 3.0, NONTEXT);
add('--border-selected', '--surface-pane', 3.0, NONTEXT, {
  note: 'Drawn across the boundary of the pane and the selected fill, so it is measured against both.',
});
add('--border-selected', '--surface-selected', 3.0, NONTEXT);
add('--border-strong', '--surface-pane', 4.5, NONTEXT, {
  note: 'Held above 1.4.11 deliberately. This token exists to read as heavier than --border-default, and a 3:1 floor would permit them to be equal.',
});
add('--border-strong', '--surface-raised', 4.5, NONTEXT);
add('--border-focus', '--surface-overlay', 3.0, NONTEXT);
add('--border-focus', '--surface-pane', 3.0, NONTEXT);
add('--border-subtle', '--surface-pane', 1.25, DECOR, { role: 'decorative' });
add('--border-subtle', '--surface-sunken', 1.2, DECOR, { role: 'decorative' });
add('--border-hover', '--surface-pane', 2.0, DECOR, {
  role: 'decorative',
  note: 'Hover is not a state 1.4.11 requires to be perceivable. The 2.0 floor is ours, because the current hover border measures 1.26:1 and therefore does not exist.',
});

// -- Controls ---------------------------------------------------------------
add('--control-divider', '--surface-pane', 3.0, NONTEXT, {
  note: 'A divider is a control, not a pane border. It has a pane on each side and the app background behind the group.',
});
add('--control-divider', '--surface-app', 3.0, NONTEXT);
add('--control-divider-hover', '--surface-pane', 3.0, NONTEXT);
add('--control-divider-hover', '--surface-app', 3.0, NONTEXT);

// -- Focus ------------------------------------------------------------------
add('--focus-ring', '--focus-ring-offset', 3.0, NONTEXT, {
  note: 'The two-tone ring: the outer ring against its own opaque inner ring. This pair is what survives a chart canvas painted underneath the focused element.',
});
for (const background of [
  '--surface-pane',
  '--surface-app',
  '--surface-raised',
  '--surface-overlay',
  '--surface-sunken',
  '--surface-selected',
  '--surface-subtle',
]) {
  add('--focus-ring', background, 3.0, NONTEXT);
}

// -- Accent -----------------------------------------------------------------
add('--accent-solid', '--surface-pane', 3.0, NONTEXT);
add('--accent-border', '--surface-pane', 3.0, NONTEXT);
add('--accent-text', '--surface-pane', 4.5, TEXT);
add('--accent-text', '--accent-subtle', 4.5, TEXT);
add('--text-primary', '--accent-subtle', 4.5, TEXT);

// -- Status -----------------------------------------------------------------
for (const name of ['danger', 'warning', 'success', 'info']) {
  add(`--status-${name}`, '--surface-pane', 3.0, NONTEXT);
  add(`--status-${name}`, '--surface-sunken', 3.0, NONTEXT);
  add('--text-primary', `--status-${name}-subtle`, 4.5, TEXT);
}

// -- Charts -----------------------------------------------------------------
for (let index = 1; index <= 12; index += 1) {
  add(`--chart-${index}`, '--surface-sunken', 3.0, NONTEXT, {
    note: 'A data mark is meaningful graphical information, not decoration.',
  });
}
add('--chart-axis', '--surface-sunken', 3.0, NONTEXT);
add('--chart-label', '--surface-sunken', 4.5, TEXT);
add('--chart-crosshair', '--surface-sunken', 3.0, NONTEXT);
add('--chart-grid', '--surface-sunken', 1.2, DECOR, {
  role: 'decorative',
  note: 'A gridline restates a value the axis already carries. One heavy enough to clear 3:1 competes with the data it is there to help read.',
});
add('--chart-tooltip-text', '--chart-tooltip-bg', 4.5, TEXT);
add('--chart-tooltip-bg', '--surface-sunken', 3.0, NONTEXT);
add('--chart-sequential-to', '--surface-sunken', 3.0, NONTEXT);
add('--chart-sequential-from', '--surface-sunken', 1.3, DECOR, {
  role: 'decorative',
  note: 'The low end of a sequential scale is SUPPOSED to sit near the background. Requiring contrast of it would destroy the scale it belongs to.',
});
add('--chart-diverging-low', '--surface-sunken', 3.0, NONTEXT);
add('--chart-diverging-mid', '--surface-sunken', 3.0, NONTEXT);
add('--chart-diverging-high', '--surface-sunken', 3.0, NONTEXT);
add('--chart-positive', '--surface-sunken', 3.0, NONTEXT);
add('--chart-negative', '--surface-sunken', 3.0, NONTEXT);

// All 66 pairs, not the 11 adjacent ones: a legend puts series 1 beside series 7.
for (let a = 1; a <= 12; a += 1) {
  for (let b = a + 1; b <= 12; b += 1) {
    separation(`--chart-${a}`, `--chart-${b}`, SERIES_FLOOR);
  }
}
separation(
  '--chart-positive',
  '--chart-negative',
  20,
  'Sign is the one encoding a user cannot afford to misread, so it carries a higher floor than a categorical pair. It must still never be the ONLY encoding of sign.',
);

const manifest = {
  $description:
    'Declared contrast and separation pairs. CONTRAST IS A RELATION, NOT A PROPERTY OF ONE TOKEN, so this file declares pairs rather than annotating colours. Every semantic colour token must appear in at least one row: design/check-contrast.mjs fails a token with no row as UNREVIEWED and a row naming a token that does not exist as STALE, so the file is exact in both directions and cannot rot quietly in either.',
  schemaVersion: 1,
  $generatedBy: 'design/lib/build-manifest.mjs',
  $notes: {
    decorative:
      'A row carrying "role" records an EXEMPTION rather than assuming one. The minimum on such a row is a legibility floor of our own choosing and is not a WCAG threshold; the criterion field says so in words.',
    seriesSeparation: `The twelve chart series are checked pairwise - all 66 pairs, not the 11 adjacent ones - because a legend puts series 1 next to series 7. The floor of ${SERIES_FLOOR} CIEDE2000 is a judgement, not a standard.`,
    whatAPassMeans:
      'That the declared pairs clear the declared numbers in the three built-in themes. Nothing about a third-party theme, nothing about rendering, and nothing about APCA.',
  },
  deltaE2000SeriesFloor: SERIES_FLOOR,
  rows,
};

writeFileSync(join(DESIGN_ROOT, 'contrast-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote design/contrast-manifest.json — ${rows.length} rows.\n`);
