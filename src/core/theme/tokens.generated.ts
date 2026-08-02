/*
 * GENERATED FILE. DO NOT EDIT.
 *
 * Source:    design/tokens/core.tokens.json
 *            design/tokens/semantic.json
 *            design/tokens/themes/*.tokens.json
 * Generator: design/generate.mjs
 * Validated: design/check-contrast.mjs against design/contrast-manifest.json
 *
 * Every colour below is already inside the sRGB gamut: chroma was reduced at
 * constant lightness and hue at generation time, so the browser has nothing
 * left to gamut-map and what it paints is what the contrast checker measured.
 */

/**
 * The public semantic token contract.
 *
 * This is the ONLY tier an extension may read. A name here is a name that
 * cannot be removed without a breaking change, and `normalizeTheme` uses the
 * set below as its allowlist: a third-party theme naming anything that is not a
 * member is rejected at the door rather than reaching a stylesheet.
 */
export const THEME_SCHEMA_VERSION = 1;

/** Every semantic token name, in declaration order. */
export const SEMANTIC_TOKEN_NAME_LIST = Object.freeze([
  '--surface-app',
  '--surface-pane',
  '--surface-raised',
  '--surface-overlay',
  '--surface-sunken',
  '--surface-hover',
  '--surface-selected',
  '--surface-subtle',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-on-accent',
  '--text-disabled',
  '--text-link',
  '--text-danger',
  '--text-warning',
  '--text-success',
  '--border-subtle',
  '--border-hover',
  '--border-default',
  '--border-selected',
  '--border-strong',
  '--border-focus',
  '--control-divider',
  '--control-divider-hover',
  '--focus-ring',
  '--focus-ring-offset',
  '--focus-ring-width',
  '--focus-ring-offset-width',
  '--accent-subtle',
  '--accent-border',
  '--accent-solid',
  '--accent-solid-hover',
  '--accent-text',
  '--status-danger',
  '--status-warning',
  '--status-success',
  '--status-info',
  '--status-danger-subtle',
  '--status-warning-subtle',
  '--status-success-subtle',
  '--status-info-subtle',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
  '--chart-9',
  '--chart-10',
  '--chart-11',
  '--chart-12',
  '--chart-grid',
  '--chart-axis',
  '--chart-label',
  '--chart-tooltip-bg',
  '--chart-tooltip-text',
  '--chart-crosshair',
  '--chart-sequential-from',
  '--chart-sequential-to',
  '--chart-diverging-low',
  '--chart-diverging-mid',
  '--chart-diverging-high',
  '--chart-positive',
  '--chart-negative',
] as const);

export type SemanticTokenName = (typeof SEMANTIC_TOKEN_NAME_LIST)[number];

/**
 * The same names as a membership set.
 *
 * `Object.freeze` ON A `Set` DOES NOT STOP `.add()`. That is recorded as a trap
 * in HANDOFF.md section 11 — freezing the wrong container reads as a control and
 * is not one — so the mutators are replaced on the instance BEFORE the freeze,
 * and the freeze is what stops them being replaced back. Without the first half
 * this constant would be an ordinary mutable `Set` wearing a reassuring word.
 */
function hardenedSet(names: readonly SemanticTokenName[]): ReadonlySet<SemanticTokenName> {
  const set = new Set<SemanticTokenName>(names);
  const refuse = (member: string) => (): never => {
    throw new Error(`SEMANTIC_TOKEN_NAMES is immutable; ${member} is not available on it.`);
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
  'leapware-light',
  'leapware-dark',
  'leapware-high-contrast',
] as const);

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];

