import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootBoundary, requestReload } from '../error/RootBoundary';
import { ShellHostProvider } from '../../core/ActivationContext';

/**
 * ============================================================================
 * THE ROOT BOUNDARY IS THE LAST THING BETWEEN A THROW ABOVE `ShellLayout` AND A
 * BLANK NATIVE WINDOW.
 * ============================================================================
 * The register mirrors `src/components/__tests__/FaultBoundary.test.tsx`,
 * because the discipline is the same one applied one tier up. Where a case here
 * differs from its sibling there, the difference is the point:
 *
 *   - The containment case uses a REAL provider failing in a REAL way —
 *     `ShellHostProvider` rendered without `ExtensionRegistryProvider` above it,
 *     which is the exact "a boundary never catches a parent" gap this component
 *     exists for — rather than a synthetic throwing child.
 *   - There is no retry case, because there is no retry. There is a case
 *     asserting the bound is zero instead.
 *
 * React writes its own diagnostics to `console.error` whenever a boundary
 * catches, so `console.error` is stubbed for the whole file. The cases that are
 * ABOUT reporting install their own stub over the top and say so.
 *
 * `codeWords` is duplicated from `FaultBoundary.test.tsx` rather than imported:
 * importing from a test file re-registers that file's whole suite inside this
 * one.
 * ============================================================================
 */

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'error', 'RootBoundary.tsx');

/** A child that throws whatever it is handed, counting its own renders. */
let boomRenders = 0;
function Boom({ thrown }: { readonly thrown: unknown }): ReactElement {
  boomRenders += 1;
  throw thrown;
}

/** A child that renders normally, so a healthy subtree is distinguishable. */
function Healthy(): ReactElement {
  return <div data-testid="healthy">healthy</div>;
}

/** Every identifier, string literal and template chunk in a module's CODE. */
function codeWords(path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const words: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      words.push(node.text);
    }
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      words.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return words;
}

/**
 * Relative luminance, per WCAG 2.2. Accepts the `rgb(r, g, b)` spelling jsdom
 * normalises an inline hex colour to, and the hex spelling itself.
 */
function relativeLuminance(colour: string): number {
  const numbers = colour.startsWith('#')
    ? [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16))
    : (colour.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  if (numbers.length !== 3) {
    throw new Error(`Not a colour this helper can read: ${colour}`);
  }
  const [red, green, blue] = numbers.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG contrast ratio between two colours, order-independent. */
function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

beforeEach(() => {
  // React's own "The above error occurred in…" diagnostic, not this module's.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  boomRenders = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RootBoundary — containment above the shell', () => {
  it('renders its children untouched while nothing throws', () => {
    render(
      <RootBoundary>
        <Healthy />
      </RootBoundary>,
    );
    expect(screen.getByTestId('healthy')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('contains a provider that throws in its own render, and announces the failure', () => {
    // The real gap, reproduced with real production code and no synthetic
    // thrower: `ShellHostProvider` calls `useRegistry` on its first line, which
    // throws when `ExtensionRegistryProvider` is not above it. That throw happens
    // in a PROVIDER's own render — above every `FaultBoundary` in `ShellLayout`,
    // which is precisely the position no boundary in the tree used to occupy.
    render(
      <RootBoundary>
        <ShellHostProvider>
          <Healthy />
        </ShellHostProvider>
      </RootBoundary>,
    );
    const surface = screen.getByRole('alert');
    expect(surface).toHaveTextContent('The application could not start.');
    expect(surface.querySelector('[data-root-message]')).toHaveTextContent(
      'useRegistry must be called inside an <ExtensionRegistryProvider>.',
    );
    // The subtree is gone rather than half-rendered.
    expect(screen.queryByTestId('healthy')).toBeNull();
  });

  it('gives the fallback a real heading, because no other heading is left on the page', () => {
    render(
      <RootBoundary>
        <Boom thrown={new Error('root exploded')} />
      </RootBoundary>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'The application could not start.' }),
    ).toBeInTheDocument();
  });

  it('renders no element from the failed subtree in the fallback', () => {
    render(
      <RootBoundary>
        <Boom thrown={new Error('boom')} />
      </RootBoundary>,
    );
    const surface = screen.getByRole('alert');
    expect(surface.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(surface.querySelector('img')).toBeNull();
    expect(surface.querySelector('a')).toBeNull();
    expect(surface.querySelector('iframe')).toBeNull();
  });

  it('owns both sides of the contrast pair inline, so it is legible with no stylesheet', () => {
    // The fallback may render before any stylesheet has loaded and before any
    // theme has been applied, so a foreground colour alone would be a claim about
    // a background this component does not control. Asserting the PAIR is what
    // makes "legible on a light OR a dark page" true rather than aspirational,
    // and the ratio is COMPUTED from the declared colours rather than taken from
    // the number in the docblock — a palette change that broke §1.4.3 while
    // leaving both properties declared would otherwise pass.
    render(
      <RootBoundary>
        <Boom thrown={new Error('unstyled')} />
      </RootBoundary>,
    );
    const surface = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: 'Reload' });
    for (const element of [surface, button]) {
      const background = element.style.backgroundColor;
      const foreground = element.style.color;
      // Both halves declared. A missing background is the failure this case is
      // really about: it hands the contrast question to whatever is behind.
      expect(background).not.toBe('');
      expect(foreground).not.toBe('');
      // WCAG 2.2 Success Criterion 1.4.3 Contrast (Minimum), Level AA.
      expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5);
    }
    // The border is a non-text boundary, so §1.4.11 asks 3:1 of it rather than
    // 4.5:1. Read off the shorthand, which jsdom expands.
    expect(contrastRatio(surface.style.backgroundColor, surface.style.borderColor)).toBeGreaterThan(
      3,
    );
    // No stylesheet means the user agent's focus ring is the only focus
    // indicator there is, so nothing here may suppress it.
    expect(button.style.outline).toBe('');
  });
});

describe('RootBoundary — reading a hostile thrown value', () => {
  it('survives an error whose message getter throws, and shows host text instead', () => {
    const armed = new Error('never read');
    Object.defineProperty(armed, 'message', {
      get() {
        throw new Error('detonated while being read');
      },
    });
    render(
      <RootBoundary>
        <Boom thrown={armed} />
      </RootBoundary>,
    );
    // `getDerivedStateFromError` stored the value and read nothing off it, so
    // the only read happened in `render`, under guard. React's own dev-mode
    // diagnostics read `error.message` before this boundary sees the value, so
    // what arrives may already be the getter's own throw — which is exactly why
    // the static reads nothing.
    expect(screen.getByRole('alert')).toHaveTextContent('The application could not start.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('survives a thrown value that is not an Error at all', () => {
    render(
      <RootBoundary>
        <Boom thrown={{ looks: 'like an error' }} />
      </RootBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The failure reported no readable message.');
  });

  it('survives a thrown null, which is legal and is not the same as nothing thrown', () => {
    // The state boxes the thrown value for this case: stored bare, a thrown
    // `null` would be indistinguishable from "no error latched" and the fallback
    // would never appear.
    render(
      <RootBoundary>
        <Boom thrown={null} />
      </RootBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The failure reported no readable message.');
  });
});

describe('RootBoundary — recovery', () => {
  it('reaches the reload control by keyboard alone, and activates it with the keyboard', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(
      <RootBoundary>
        <Boom thrown={new Error('needs a reload')} />
      </RootBoundary>,
    );

    const button = screen.getByRole('button', { name: 'Reload' });
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks the host environment to reload when the control is pressed', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(
      <RootBoundary>
        <Boom thrown={new Error('needs a reload')} />
      </RootBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('survives a location.reload that itself throws', () => {
    // `window.location` is no more the host's object than the code that threw.
    // A refused reload must leave the fallback standing rather than throw inside
    // a click handler at the root, where nothing would catch it.
    vi.stubGlobal('location', {
      reload() {
        throw new Error('reload refused');
      },
    });
    expect(() => {
      requestReload();
    }).not.toThrow();
  });

  it('offers exactly one control, and it says Reload rather than Retry', () => {
    // Not a copy of `FaultBoundary`, on purpose. What threw is a provider's own
    // render, so there is no state below to preserve and a remount in place
    // would rebuild the registry and the host store empty — a reload that lies
    // about itself. "Retry" would name an operation this component cannot do.
    render(
      <RootBoundary>
        <Boom thrown={new Error('unrecoverable in place')} />
      </RootBoundary>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Reload');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('never retries the failed subtree on its own — the bound is zero', async () => {
    render(
      <RootBoundary>
        <Boom thrown={new Error('deterministic')} />
      </RootBoundary>,
    );
    // A deterministic throw plus an automatic retry is an unbounded render loop
    // that pins a core, and at the root there is nothing left to contain it. So
    // the child is not rendered again at all — not after a tick, not after a
    // timer, not ever without a fresh document. Counted rather than asserted in
    // prose.
    const settled = boomRenders;
    expect(settled).toBeGreaterThan(0);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(boomRenders).toBe(settled);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('RootBoundary — reporting', () => {
  it('reports under its own marker, so the tier that caught is identifiable', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = new Error('reportable at the root');
    render(
      <RootBoundary>
        <Boom thrown={thrown} />
      </RootBoundary>,
    );
    const ours = reported.mock.calls.filter(
      (call) => call[0] === 'RootBoundary contained a failure above the shell.',
    );
    expect(ours).toHaveLength(1);
    // Passed as its own argument rather than interpolated, so no `toString`,
    // `valueOf` or `Symbol.toPrimitive` runs on the way into the log.
    expect(ours[0]?.[1]).toBe(thrown);
    // A distinct marker from the pane-level boundary's.
    expect(ours[0]?.[0]).not.toBe('FaultBoundary contained a failure.');
  });

  it('survives a console.error that itself throws', () => {
    // Armed for THIS module's report only. React's dev build writes its own
    // diagnostics through the same function during the same commit, outside
    // anything this component can guard, so a blanket thrower would be testing
    // React's error path rather than this one's.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (args[0] === 'RootBoundary contained a failure above the shell.') {
        throw new Error('console replaced by a thrower');
      }
    });
    render(
      <RootBoundary>
        <Boom thrown={new Error('contained anyway')} />
      </RootBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('contained anyway');
  });
});

describe('RootBoundary — the source, and the limits it must keep stating', () => {
  it('the outermost fallback reaches no markup sink of any kind', () => {
    const sinks = codeWords(SOURCE).filter((word) =>
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
        word,
      ),
    );
    expect(sinks).toEqual([]);
  });

  it('the outermost fallback names no URL-bearing attribute at all', () => {
    const urlAttributes = codeWords(SOURCE).filter((word) =>
      /^(?:href|xlinkHref|src|srcSet|formAction|poster|action)$/.test(word),
    );
    expect(urlAttributes).toEqual([]);
  });

  it('reports a planted sink, so the two scans above cannot pass vacuously', () => {
    const planted = ts.createSourceFile(
      'planted.tsx',
      'export const Bad = () => <a href={u} dangerouslySetInnerHTML={{ __html: m }} />;\n',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && /^(?:dangerouslySetInnerHTML|href)$/.test(node.text)) {
        found.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(planted);
    expect(found).toEqual(expect.arrayContaining(['dangerouslySetInnerHTML', 'href']));
  });

  it('invents no Electron API, because none is wired up yet', () => {
    // A fallback that called through a preload bridge that does not exist would
    // throw a `TypeError` in the one place a throw has nowhere to go.
    const words = codeWords(SOURCE);
    for (const invented of ['ipcRenderer', 'electron', 'electronAPI', 'require', 'process']) {
      expect(words).not.toContain(invented);
    }
  });

  it('documents in both the source and DEVELOPER.md what the root boundary cannot catch', () => {
    // The limits must be stated in the source doc comment AND in `DEVELOPER.md`.
    // A limit documented in one place and quietly dropped from the other is how
    // overselling gets back in.
    const source = readFileSync(SOURCE, 'utf8').toLowerCase();
    const guide = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'DEVELOPER.md'),
      'utf8',
    ).toLowerCase();
    // The first four are the sibling convention, and on their own they would be
    // VACUOUS here: every one of them already appears in both files on
    // `FaultBoundary`'s account, so a list of only those is satisfied by prose
    // that never mentions the root tier at all. Measured rather than assumed —
    // "module scope" was tried and rejected for exactly this reason, since
    // `DEVELOPER.md` says it in four unrelated places. The last three were each
    // checked to occur ONLY in the root-tier limit list, in both files, so
    // deleting that list from either one fails this case.
    for (const limit of [
      'event handler',
      'settimeout',
      'promise rejection',
      'server-side',
      // Not "App's own render body": both files spell it "`App`'s", with a
      // backtick inside the possessive.
      'own render body',
      'createroot(...).render(...)',
      'no boundary above',
    ]) {
      expect(source).toContain(limit);
      expect(guide).toContain(limit);
    }
  });
});
