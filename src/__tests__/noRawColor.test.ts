import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * NO RAW COLOUR, NOWHERE UNDER `src/`. NO `dark:` VARIANT, ANYWHERE AT ALL.
 * ============================================================================
 * Before the token migration the shell spelled 118 colour literals across seven
 * modules, all from one Tailwind family, with 51 `dark:` variants beside them.
 * Both numbers are now zero, and a number that is zero today and unenforced is a
 * number that is three next month. This file is the enforcement.
 *
 * It is modelled on `src/__tests__/noEventListener.test.ts` deliberately, down
 * to the parser, the both-directions allowlist and the planted controls. That
 * file's argument for each of those choices applies here unchanged, so it is not
 * restated; what follows is only what is different.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, EXACTLY
 * ---------------------------------------------------------------------------
 * Every `.ts`/`.tsx` file under `src/` that is not itself a test is parsed with
 * the TypeScript compiler, and the test fails if any *code* position — an
 * identifier, a property name, a JSX attribute name, or a string or template
 * literal — contains:
 *
 *  1. A raw Tailwind palette colour: `neutral-200`, `bg-white`, `text-black`,
 *     or the `theme(colors.neutral.400)` form.
 *  2. A CSS colour literal: `#rrggbb`, `rgb(…)`, `hsl(…)`, or a bare `oklch(…)`
 *     that is not reading a custom property.
 *  3. A `dark:` variant, outside `DARK_VARIANT_ALLOWLIST`, which is EMPTY.
 *  4. An opacity modifier on a token colour — `bg-surface-pane/50`.
 *
 * ---------------------------------------------------------------------------
 * (4) IS NOT PEDANTRY. IT IS THE ONE FAILURE MODE NOTHING ELSE CAN SEE.
 * ---------------------------------------------------------------------------
 * Tailwind's opacity modifiers need a colour it can split into channels.
 * `tailwind.config.js` maps every token to a bare `var(--x)`, because
 * `design/generate.mjs` emits complete `oklch()` functions rather than the
 * components the `<alpha-value>` channel form needs — the full argument, with
 * the compiler output that settled it, is in that file's banner.
 *
 * Measured consequence, on the pinned Tailwind: `bg-surface-pane/50` compiles
 * to **no rule at all**. Not a wrong colour, not a build warning — an absent
 * declaration and an element that keeps whatever it inherited. The class is in
 * the DOM, so `toHaveClass` passes; jsdom loads no stylesheet, so nothing there
 * notices; and the browser lane would only catch it on an element somebody
 * thought to screenshot. This case is the only thing in the repository that
 * fails on it, which is why it is here rather than in a comment.
 *
 * ---------------------------------------------------------------------------
 * WHY THE `dark:` ALLOWLIST IS EMPTY AND SHOULD STAY EMPTY
 * ---------------------------------------------------------------------------
 * `noEventListener.test.ts` narrowed rather than deleted, because a listener was
 * genuinely needed. The opposite happened here: `darkMode` is still configured —
 * `['selector', '[data-theme="dark"]']`, which Phase 7 needs — and there is
 * nothing left for a variant to say, because a colour is now a token whose VALUE
 * swaps on `[data-theme]`. `dark:border-neutral-800` beside
 * `border-border-default` would be an override of a value that already changed.
 *
 * That is the answer to issue #67. The 51 variants were not made testable; they
 * were removed, because the honest reading of "exercised by nothing whatsoever"
 * is that they were doing nothing, not that they were untested.
 *
 * **The known future member is named rather than left to be discovered.** The
 * shadow tier is genuinely appearance-conditional: `design/README.md` "Honest
 * limits" item 6 records that `--shadow-overlay` and `--shadow-popover` are
 * black at fixed alphas in every theme, which elevates nothing on a near-black
 * pane. The right fix is in `design/`, so the shadow gets a per-theme value like
 * every other token. The wrong fix is a hand-written `dark:shadow-[…]` here,
 * which would put a colour outside the pipeline where `scripts/check-tokens.mjs`
 * cannot measure it — and this file would reject it, which is the point.
 *
 * An entry added to the allowlist below is a line in a diff a reviewer has to
 * approve, and it is exact in both directions: a listed module that stops
 * spelling what its entry claims fails as a stale exemption.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT ASSERTED
 * ---------------------------------------------------------------------------
 * A colour assembled from parts (`'bg-' + family + '-200'`), a colour arriving
 * through an inline `style` object computed at runtime, or a colour inside a
 * dependency `src/` merely imports would all pass. This is a guardrail against
 * the ordinary way a colour gets written, not a proof that none can exist, and
 * per ADR-0001 Amendment G that limit is stated here rather than glossed. The
 * planted-violation cases fix what "the ordinary way" covers.
 *
 * It also says nothing about whether a token is the RIGHT one for a surface.
 * `bg-status-danger` on a pane passes every rule below. Values are measured by
 * `scripts/check-tokens.mjs`, the compiled stylesheet by `e2e/theme.spec.ts`,
 * and the mapping from role to surface is a design review — see the honest-loss
 * comment in `src/core/theme/tokenClasses.ts`.
 *
 * `tailwind.config.js` is NOT scanned here, because it is not under `src/`. A
 * literal written there is caught by `check-tokens`' SHAPE rule instead, which
 * requires every colour key to be exactly `var(--<key>)`.
 * ============================================================================
 */

/** `src/`, resolved from this file's own location rather than from the cwd. */
const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Tailwind's default palette families, spelled out rather than matched as
 * `\w+-\d00`.
 *
 * The narrow form matters: `grid-cols-12`, `max-w-[9rem]` and `z-50` are not
 * colours, and a rule that reported them would be turned off within a week.
 * `white` and `black` are included because they are colours with no numeric
 * step and were both live in this shell — `bg-white` on the pane and on the
 * overflow menu — which a `-\d00` pattern would have missed entirely.
 */
const PALETTE_FAMILY =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|' +
  'cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** Every utility prefix that takes a colour. */
const COLOR_UTILITY =
  'bg|text|border|ring|ring-offset|outline|divide|shadow|fill|stroke|from|via|to|' +
  'placeholder|caret|accent|decoration';

/**
 * A raw palette colour written as a Tailwind class, in any variant position.
 *
 * `(?:^|[\s:])` rather than a word boundary, because a variant prefix ends in a
 * colon and `dark:hover:bg-neutral-800` has to be caught by the same rule that
 * catches `bg-neutral-800`.
 */
const RAW_PALETTE_CLASS = new RegExp(
  `(?:^|[\\s:])(?:${COLOR_UTILITY})-(?:(?:${PALETTE_FAMILY})-(?:50|[1-9]00|950)|white|black)(?:\\b|$)`,
);

/**
 * Tailwind's `theme()` helper reaching into the palette.
 *
 * A rule of its own, because this is the spelling that hid from every colour
 * scan in this repository until the migration: four occurrences of
 * `shadow-[inset_2px_0_0_0_theme(colors.neutral.400)]` across two modules and
 * one test, none of which a `neutral-400` search finds. `var(--token)` is the
 * permitted spelling inside an arbitrary value.
 */
const THEME_PALETTE_CALL = /theme\(\s*colors\./;

/**
 * A CSS colour literal, in any of the spellings a stylesheet accepts.
 *
 * `oklch(` is matched only when it is NOT immediately reading a custom property,
 * so `oklch(var(--x) / 50%)` — which a future relative-colour experiment might
 * legitimately want — is distinguishable from a baked-in `oklch(60% 0.01 264)`.
 */
const CSS_COLOR_LITERAL =
  /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b|\brgba?\(|\bhsla?\(|\boklch\(\s*(?!var\()|\blab\(|\blch\(/;

/** Any `dark:` variant, in any position in a class list. */
const DARK_VARIANT = /(?:^|[\s"'`])dark:/;

/**
 * An opacity modifier on a colour utility — `bg-surface-pane/50`.
 *
 * Anchored on the utility prefix so that `w-1/2`, `max-h-[calc(100%/3)]` and a
 * date string in a literal are not colour utilities and are not reported.
 */
const OPACITY_MODIFIER = new RegExp(`(?:^|[\\s:])(?:${COLOR_UTILITY})-[a-z0-9-]+/(?:\\d{1,3}|\\[)`);

/** The union, used only by the planted-violation control below. */
const FORBIDDEN = [
  RAW_PALETTE_CLASS,
  THEME_PALETTE_CALL,
  CSS_COLOR_LITERAL,
  DARK_VARIANT,
  OPACITY_MODIFIER,
];

/**
 * The modules permitted a `dark:` variant, and the exact spellings each may
 * contain.
 *
 * EMPTY, and meant to stay empty. See the banner for the one candidate that
 * exists — the shadow tier — and for why it belongs in `design/` instead.
 */
const DARK_VARIANT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({});

/**
 * The modules permitted a CSS colour literal, and the exact spellings each may
 * contain.
 *
 * ONE ENTRY, FOR THE ONE SURFACE A TOKEN CANNOT REACH. `RootBoundary` is the
 * last thing between a throw above `ShellLayout` and a blank window, and its
 * decision 3 states the case: it must render legibly when the reason nothing
 * works is that nothing loaded. `var(--surface-pane)` resolves to nothing if the
 * stylesheet 404s on a subpath deployment or an Electron `file://` load with a
 * bad asset path, and an unstyled fallback is black-on-transparent text of
 * unknown size on a page of unknown colour. So that component owns BOTH sides of
 * its contrast pair as literals, inline, and depends on no stylesheet at all.
 *
 * **That exemption is not on trust.** `RootBoundary.test.tsx` — "owns both sides
 * of the contrast pair inline, so it is legible with no stylesheet" — computes
 * the ratio from these declared colours rather than from a number in a comment,
 * which is a stronger check than anything the token pipeline applies to a
 * `var()`. The literals here are the *inputs* to a live measurement, not
 * unreviewed colour.
 *
 * Exact in both directions: adding a sixth literal to that component fails as an
 * unreviewed widening, and removing one fails as a stale entry.
 */
const CSS_COLOR_LITERAL_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'components/error/RootBoundary.tsx': Object.freeze(['#111827', '#ffffff', '1px solid #4b5563']),
});

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly word: string;
  readonly rule: string;
}

/** The named rules, so a failure says which one fired rather than only where. */
const RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['raw-palette-class', RAW_PALETTE_CLASS],
  ['theme-palette-call', THEME_PALETTE_CALL],
  ['css-colour-literal', CSS_COLOR_LITERAL],
  ['dark-variant', DARK_VARIANT],
  ['opacity-modifier', OPACITY_MODIFIER],
]);

/**
 * The text a node contributes to the scan, or `undefined` for a node that
 * carries none. Comments reach neither branch: the parser keeps them as trivia,
 * which is what lets every docblock in `src/` go on quoting the literals this
 * change removed.
 */
function codeWordOf(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return undefined;
}

/** Every code word in one module matching any of `rules`. */
function scanFindings(
  file: string,
  text: string,
  rules: ReadonlyArray<readonly [string, RegExp]> = RULES,
): Finding[] {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const word = codeWordOf(node);
    if (word !== undefined) {
      for (const [rule, pattern] of rules) {
        if (pattern.test(word)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push({ file, line: line + 1, word, rule });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/** The same scan, flattened for a readable failure message. */
function scanSource(
  file: string,
  text: string,
  rules: ReadonlyArray<readonly [string, RegExp]> = RULES,
): string[] {
  return scanFindings(file, text, rules).map(
    (finding) => `${finding.file}:${finding.line} [${finding.rule}] ${finding.word.trim()}`,
  );
}

/** Whether a repository-relative POSIX path is a test rather than a module. */
function isTestPath(path: string): boolean {
  return path.split('/').includes('__tests__') || /\.(?:test|spec)\.tsx?$/.test(path);
}

/** Every non-test `.ts`/`.tsx` file under `src/`, as paths relative to `src/`. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') {
          continue;
        }
        walk(full);
        continue;
      }
      const path = relative(SRC_ROOT, full).split(sep).join('/');
      if (!/\.tsx?$/.test(path) || isTestPath(path)) {
        continue;
      }
      found.push(path);
    }
  };
  walk(SRC_ROOT);
  return found.sort();
}

/** One module's text, read relative to `src/`. */
function read(file: string): string {
  return readFileSync(join(SRC_ROOT, file), 'utf8');
}

/**
 * The modules that carried colour before the migration, plus the one that owns
 * it now.
 *
 * Named so that a walk which silently found nothing — a renamed directory, a
 * throwing `readdirSync` swallowed somewhere — cannot make the scan pass by
 * scanning an empty list. This is the same control `noEventListener.test.ts`
 * uses and it earns its place twice over here: every case below is a filter over
 * a harvest, and a filter over nothing is green.
 */
const KNOWN_MODULES = [
  'components/error/FaultBoundary.tsx',
  'components/error/RootBoundary.tsx',
  'components/layout/PaneWrapper.tsx',
  'components/layout/ShellLayout.tsx',
  'components/shared/VirtualizedList.tsx',
  'components/ui/RibbonToolbar.tsx',
  'core/theme/tokenClasses.ts',
  'core/theme/tokens.generated.ts',
  'mocks/DatabasePlugin.tsx',
  'mocks/MailPlugin.tsx',
];

describe('src/ — every colour is a token, and no dark: variant survives', () => {
  it('visits every module under src/, so an empty scan cannot pass vacuously', () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(KNOWN_MODULES));
  });

  it('finds no raw palette colour or theme() call in any module, with no exemptions at all', () => {
    // No allowlist mechanism for these two, deliberately. A Tailwind class is
    // only meaningful when the stylesheet loaded, so the argument that earns
    // `RootBoundary` its inline-literal exemption cannot be made for a class.
    const findings = sourceFiles().flatMap((file) =>
      scanSource(file, read(file), [
        ['raw-palette-class', RAW_PALETTE_CLASS],
        ['theme-palette-call', THEME_PALETTE_CALL],
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('finds no CSS colour literal in any module outside the one-entry allowlist', () => {
    const findings = sourceFiles()
      .filter((file) => !Object.hasOwn(CSS_COLOR_LITERAL_ALLOWLIST, file))
      .flatMap((file) => scanSource(file, read(file), [['css-colour-literal', CSS_COLOR_LITERAL]]));
    expect(findings).toEqual([]);
  });

  it('holds the colour-literal allowlist to the exact spellings its one module contains', () => {
    // Exact in BOTH directions. A listed module that grows a literal its entry
    // does not name fails as an unreviewed widening — which is what stops the
    // last-resort fallback quietly becoming a second, untokenised design system
    // — and one that stops spelling what its entry claims fails as stale.
    expect(Object.keys(CSS_COLOR_LITERAL_ALLOWLIST)).toEqual([
      'components/error/RootBoundary.tsx',
    ]);
    const modules = new Set(sourceFiles());
    for (const [file, permitted] of Object.entries(CSS_COLOR_LITERAL_ALLOWLIST)) {
      expect(modules.has(file)).toBe(true);
      const spellings = scanFindings(file, read(file), [
        ['css-colour-literal', CSS_COLOR_LITERAL],
      ]).map((finding) => finding.word);
      expect([...new Set(spellings)].sort()).toEqual([...permitted]);
    }
  });

  it('finds no dark: variant in any module outside the allowlist, which is empty', () => {
    // ISSUE-67. Both halves matter: the allowlist has no members, and the scan
    // over every module that is not a member comes back clean. Either alone
    // would be satisfiable by the other being wrong.
    expect(Object.keys(DARK_VARIANT_ALLOWLIST)).toEqual([]);
    const findings = sourceFiles()
      .filter((file) => !Object.hasOwn(DARK_VARIANT_ALLOWLIST, file))
      .flatMap((file) => scanSource(file, read(file), [['dark-variant', DARK_VARIANT]]));
    expect(findings).toEqual([]);
  });

  it('holds the dark-variant allowlist to the exact spellings each listed module contains', () => {
    // Exact in BOTH directions, so the exemption cannot rot in either. Vacuous
    // while the allowlist is empty, and that is deliberate: the machinery has to
    // already exist and already be correct on the day somebody adds the shadow
    // entry, or it will be written under time pressure and written loosely.
    const modules = new Set(sourceFiles());
    for (const [file, permitted] of Object.entries(DARK_VARIANT_ALLOWLIST)) {
      expect(modules.has(file)).toBe(true);
      const spellings = scanFindings(file, read(file), [['dark-variant', DARK_VARIANT]]).map(
        (finding) => finding.word,
      );
      expect([...new Set(spellings)].sort()).toEqual([...permitted]);
    }
  });

  it('finds no opacity modifier on a token colour, which would compile to nothing', () => {
    const findings = sourceFiles().flatMap((file) =>
      scanSource(file, read(file), [['opacity-modifier', OPACITY_MODIFIER]]),
    );
    expect(findings).toEqual([]);
  });

  it('reports a planted colour, however it is spelled', () => {
    const planted: [string, string][] = [
      ['class.tsx', 'export const Pane = () => <div className="border border-neutral-200" />;\n'],
      ['white.tsx', 'export const Pane = () => <div className="bg-white p-1" />;\n'],
      ['variant.tsx', 'export const Pane = () => <div className="dark:bg-neutral-900" />;\n'],
      [
        'stacked.tsx',
        'export const Pane = () => <div className="dark:hover:border-neutral-800" />;\n',
      ],
      [
        'themeCall.tsx',
        'export const Row = () =>\n' +
          '  <div className="shadow-[inset_2px_0_0_0_theme(colors.neutral.500)]" />;\n',
      ],
      ['hex.ts', 'export const BRAND = "#7e8085";\n'],
      ['rgb.ts', 'export const BRAND = "rgb(126 128 133)";\n'],
      ['oklch.ts', 'export const BRAND = "oklch(60% 0.0076 264)";\n'],
      ['style.tsx', 'export const Dot = () => <span style={{ color: "#ff0000" }} />;\n'],
      [
        'template.ts',
        'const tone = "muted";\nexport const cls = `text-neutral-500 ${tone}`;\n',
      ],
      // THE SILENT ONE. This compiles to no rule whatsoever against a bare
      // `var()` colour, so it is the single planted case that nothing else in
      // the repository — not the type checker, not jsdom, not the build — can
      // see. Measured on Tailwind 3.4.19 before this rule was written.
      ['opacity.tsx', 'export const Pane = () => <div className="bg-surface-pane/50" />;\n'],
      ['opacityArbitrary.tsx', 'export const Pane = () => <div className="text-text-muted/[.62]" />;\n'],
    ];

    for (const [file, source] of planted) {
      expect(scanSource(file, source), `${file} should have been reported`).not.toEqual([]);
    }
  });

  it('does not report the token spellings the shell actually uses', () => {
    // The other half of the planted control, and the half that stops the rules
    // being satisfied by reporting everything. Every string here is live in
    // `src/` today.
    const clean: [string, string][] = [
      ['pane.tsx', 'export const C = "border border-border-default bg-surface-pane";\n'],
      ['muted.tsx', 'export const C = "text-[11px] text-text-muted";\n'],
      [
        'rule.tsx',
        'export const C = "aria-[current]:shadow-[inset_2px_0_0_0_var(--border-selected)]";\n',
      ],
      ['divider.tsx', 'export const C = "bg-control-divider hover:bg-control-divider-hover";\n'],
      ['sizes.tsx', 'export const C = "w-40 h-8 z-50 max-w-[9rem] grid-cols-12 basis-1/2";\n'],
      ['radix.tsx', 'export const C = "max-h-[var(--radix-dropdown-menu-content-available-height)]";\n'],
      ['transparent.tsx', 'export const C = "border-transparent text-current";\n'],
      // A colour-shaped word that is not a colour. `text-white-paper` is not a
      // palette utility and neither is a hex-looking string with seven digits.
      ['nearMiss.ts', 'export const ID = "1234567";\nexport const C = "text-balance";\n'],
    ];

    for (const [file, source] of clean) {
      expect(scanSource(file, source), `${file} should be clean`).toEqual([]);
    }
  });

  it('does not report a comment, which is why the docblocks may quote what they removed', () => {
    // Every module touched by the migration argues, in prose, about the exact
    // literals it no longer contains — `border-neutral-200` at 1.26:1,
    // `dark:text-neutral-400` and why it existed. A text scan would fail on the
    // sentences that describe the property, which is why this is a parse.
    const prose =
      '/**\n' +
      ' * `border-neutral-200` measured 1.26:1 and `dark:text-neutral-400` patched\n' +
      ' * `#737373` on the dark pane. Neither survives; see `theme(colors.neutral.500)`.\n' +
      ' */\n' +
      '// Not here either: bg-white, rgb(0 0 0), oklch(60% 0.01 264), bg-surface-pane/50.\n' +
      'export const usesTokensOnly = true;\n';
    expect(scanSource('prose.ts', prose)).toEqual([]);
  });

  it('names every rule in its failure message, so a violation says which one fired', () => {
    // A finding that only reports a location makes the reader re-derive the
    // rule from the string, and the five rules here overlap enough that the
    // derivation is often wrong.
    expect(RULES.map(([name]) => name)).toEqual([
      'raw-palette-class',
      'theme-palette-call',
      'css-colour-literal',
      'dark-variant',
      'opacity-modifier',
    ]);
    expect(FORBIDDEN).toHaveLength(RULES.length);
    expect(scanSource('one.ts', 'export const C = "bg-neutral-50";\n')).toEqual([
      'one.ts:1 [raw-palette-class] bg-neutral-50',
    ]);
  });
});
