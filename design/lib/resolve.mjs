/**
 * ============================================================================
 * THE RESOLVER. TOKEN JSON + ONE THEME -> RESOLVED COLOURS.
 * ============================================================================
 * Imported by BOTH `design/generate.mjs` and `design/check-contrast.mjs`, for
 * the reason `lib/color.mjs` gives: a checker that resolves tokens differently
 * from the generator is a checker that measures a stylesheet nobody ships.
 *
 * The resolution order is fixed and is the only order that makes a theme's
 * curve override and its contrast multiplier compose predictably:
 *
 *   1. Take the curve for the theme's polarity from `core.tokens.json`.
 *   2. Apply the theme's own per-step curve overrides, if it declares any.
 *   3. Apply the theme's contrast multiplier to every step's DISTANCE FROM
 *      STEP 1, which leaves step 1 — the pane background — fixed by
 *      construction. A theme cannot raise its own contrast by moving the
 *      background out from under everything else.
 *   4. Clamp lightness into [0, 1], then gamut-map chroma into sRGB.
 *
 * Steps 2 and 3 in that order, not the other way round: an override that were
 * applied after the multiplier would be a value the theme could not predict the
 * effect of, because it would depend on a number declared elsewhere in the same
 * file.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatOklch, resolveOklch } from './color.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DESIGN_ROOT = join(HERE, '..');
export const TOKENS_ROOT = join(DESIGN_ROOT, 'tokens');

/** The three themes this repository ships, in the order every report lists them. */
export const BUILT_IN_THEME_IDS = Object.freeze([
  'leapware-light',
  'leapware-dark',
  'leapware-high-contrast',
]);

const STEPS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

export function loadCore() {
  return readJson(join(TOKENS_ROOT, 'core.tokens.json'));
}

export function loadSemantic() {
  return readJson(join(TOKENS_ROOT, 'semantic.json'));
}

export function loadManifest() {
  return readJson(join(DESIGN_ROOT, 'contrast-manifest.json'));
}

export function loadTheme(id) {
  return readJson(join(TOKENS_ROOT, 'themes', `${id}.tokens.json`));
}

/** The `$extensions` block a theme carries its identity in. */
export function themeMeta(theme) {
  const meta = theme?.$extensions?.['com.leapware.shellux.theme'];
  if (meta === undefined) {
    throw new Error('Theme file carries no com.leapware.shellux.theme extension block.');
  }
  return meta;
}

/** Every semantic token in declaration order, flattened out of its group. */
export function semanticEntries(semantic) {
  const entries = [];
  for (const [groupName, group] of Object.entries(semantic.groups)) {
    for (const [name, token] of Object.entries(group)) {
      if (name.startsWith('$')) continue;
      entries.push({ group: groupName, name, ...token });
    }
  }
  return entries;
}

/**
 * The lightness and chroma curve for one theme, after overrides and contrast.
 *
 * Returns `{ lightness: {1..12}, chromaShape: {1..12} }`.
 */
function buildCurve(core, theme) {
  const meta = themeMeta(theme);
  const polarity = meta.polarity;
  const base = core.curve[polarity];
  if (base === undefined) {
    throw new Error(`Theme ${meta.id} declares unknown polarity ${String(polarity)}.`);
  }

  const lightness = {};
  const chromaShape = {};
  for (const step of STEPS) {
    lightness[step] = base.lightness[String(step)].$value;
    chromaShape[step] = base.chroma[String(step)].$value;
  }

  // 2. Theme curve overrides.
  const overrides = theme.curve?.lightness;
  if (overrides !== undefined) {
    for (const step of STEPS) {
      const override = overrides[String(step)];
      if (override !== undefined && typeof override.$value === 'number') {
        lightness[step] = override.$value;
      }
    }
  }
  const chromaOverrides = theme.curve?.chroma;
  if (chromaOverrides !== undefined) {
    for (const step of STEPS) {
      const override = chromaOverrides[String(step)];
      if (override !== undefined && typeof override.$value === 'number') {
        chromaShape[step] = override.$value;
      }
    }
  }

  // 3. Contrast multiplier, about step 1.
  const contrast = theme.contrast?.$value ?? 1;
  const anchor = lightness[1];
  for (const step of STEPS) {
    lightness[step] = Math.min(1, Math.max(0, anchor + (lightness[step] - anchor) * contrast));
  }

  return { lightness, chromaShape, polarity, contrast };
}

/** One twelve-step ramp at a hue and chroma scale, gamut-mapped. */
function buildRamp(curve, hue, chromaScale) {
  const ramp = {};
  for (const step of STEPS) {
    ramp[step] = resolveOklch({
      l: curve.lightness[step],
      c: curve.chromaShape[step] * chromaScale,
      h: hue,
    });
  }
  return ramp;
}

/**
 * Every ramp and every chart colour for one theme.
 *
 * Chart series are NOT put through the contrast multiplier. A categorical
 * palette darkened uniformly loses CIEDE2000 separation while gaining WCAG
 * contrast, which trades the harder constraint for the easier one; the series
 * are instead authored per polarity and validated pairwise. That is a decision,
 * and it is recorded here rather than left to be inferred from the absence of a
 * multiplication.
 */
export function buildPalette(core, theme) {
  const curve = buildCurve(core, theme);

  const ramps = {
    gray: buildRamp(curve, theme.base.hue.$value, theme.base.chroma.$value),
    accent: buildRamp(curve, theme.accent.hue.$value, theme.accent.chroma.$value),
  };
  for (const status of ['danger', 'warning', 'success', 'info']) {
    const declared = theme.status?.[status] ?? core.status[status];
    ramps[status] = buildRamp(curve, declared.hue.$value, declared.chroma.$value);
  }

  const lightnessKey = curve.polarity === 'dark' ? 'lightnessDark' : 'lightnessLight';
  const series = {};
  for (const index of STEPS) {
    const declared = core.chart.series[String(index)];
    series[index] = resolveOklch({
      l: declared[lightnessKey].$value,
      c: declared.chroma.$value,
      h: declared.hue.$value,
    });
  }

  const chart = {
    series,
    sequentialFrom: ramps.accent[core.chart.sequential.fromStep.$value],
    sequentialTo: ramps.accent[core.chart.sequential.toStep.$value],
    divergingLow: ramps.danger[core.chart.diverging.step.$value],
    divergingMid: ramps.gray[core.chart.diverging.midStep.$value],
    divergingHigh: ramps.info[core.chart.diverging.step.$value],
  };

  return { curve, ramps, chart };
}

/** A component-tier token's value, flattened to the CSS text it becomes. */
function componentValueToCss(token) {
  switch (token.$type) {
    case 'dimension':
      return `${token.$value.value}${token.$value.unit}`;
    case 'duration':
      return `${token.$value.value}${token.$value.unit}`;
    case 'cubicBezier':
      return `cubic-bezier(${token.$value.join(', ')})`;
    case 'fontFamily':
      return token.$value
        .map((family) => (/^[A-Za-z-]+$/.test(family) ? family : `'${family}'`))
        .join(', ');
    case 'shadow': {
      const layers = Array.isArray(token.$value) ? token.$value : [token.$value];
      return layers
        .map((layer) => {
          const [r, g, b] = layer.color.components;
          const rgb = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${layer.color.alpha})`;
          return `${layer.offsetX.value}${layer.offsetX.unit} ${layer.offsetY.value}${layer.offsetY.unit} ${layer.blur.value}${layer.blur.unit} ${layer.spread.value}${layer.spread.unit} ${rgb}`;
        })
        .join(', ');
    }
    default:
      throw new Error(`Component token has unsupported $type ${String(token.$type)}.`);
  }
}

/** Every component-tier token as `{ name, css }`, in declaration order. */
export function componentTokens(core) {
  const out = [];
  for (const [name, token] of Object.entries(core.component)) {
    if (name.startsWith('$')) continue;
    out.push({ name: `--${name}`, css: componentValueToCss(token) });
  }
  return out;
}

/**
 * Resolve one semantic token against a palette.
 *
 * Returns `{ name, type, group, role, hex, rgb, css }` for a colour, or
 * `{ name, type: 'dimension', css }` for a dimension. `hex` is absent for a
 * dimension, which is what `check-contrast.mjs` keys its type filter on.
 */
export function resolveSemanticToken(entry, palette, core) {
  if (entry.type === 'dimension') {
    const componentName = entry.source.component;
    const token = core.component[componentName];
    if (token === undefined) {
      throw new Error(`${entry.name} names component token ${componentName}, which does not exist.`);
    }
    return { ...entry, css: componentValueToCss(token) };
  }

  const source = entry.source;
  let resolved;
  if (source.ramp !== undefined) {
    const ramp = palette.ramps[source.ramp];
    if (ramp === undefined) {
      throw new Error(`${entry.name} names ramp ${source.ramp}, which does not exist.`);
    }
    resolved = ramp[source.step];
    if (resolved === undefined) {
      throw new Error(`${entry.name} names step ${String(source.step)}, which is outside 1..12.`);
    }
  } else if (source.chart === 'series') {
    resolved = palette.chart.series[source.index];
    if (resolved === undefined) {
      throw new Error(`${entry.name} names chart series ${String(source.index)}, which does not exist.`);
    }
  } else if (source.chart === 'sequential') {
    resolved = source.end === 'from' ? palette.chart.sequentialFrom : palette.chart.sequentialTo;
  } else if (source.chart === 'diverging') {
    const stops = {
      low: palette.chart.divergingLow,
      mid: palette.chart.divergingMid,
      high: palette.chart.divergingHigh,
    };
    resolved = stops[source.stop];
    if (resolved === undefined) {
      throw new Error(`${entry.name} names diverging stop ${String(source.stop)}, which does not exist.`);
    }
  } else {
    throw new Error(`${entry.name} has a source this resolver does not understand.`);
  }

  return {
    ...entry,
    hex: resolved.hex,
    rgb: resolved.rgb,
    clipped: resolved.clipped,
    css: formatOklch(resolved.oklch),
  };
}

/** Every semantic token resolved for one theme, keyed by name. */
export function resolveTheme(core, semantic, theme) {
  const palette = buildPalette(core, theme);
  const resolved = new Map();
  for (const entry of semanticEntries(semantic)) {
    resolved.set(entry.name, resolveSemanticToken(entry, palette, core));
  }
  return { meta: themeMeta(theme), palette, tokens: resolved };
}
