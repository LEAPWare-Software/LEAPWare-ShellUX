import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaultBoundary, describeFault } from '../error/FaultBoundary';

/**
 * ============================================================================
 * THE BOUNDARY IS THE LAST THING BETWEEN A THROWING PLUG-IN AND A BLANK SHELL.
 * ============================================================================
 * Every case here is one of ISSUE-004's adversarial edge cases, and the mapping
 * is deliberate rather than incidental:
 *
 *   "a plug-in that throws inside the FaultBoundary fallback itself"
 *       → "renders no plug-in element in the fallback" plus the source scan.
 *         The fallback has nothing of the plug-in's in it, so there is nothing
 *         there to throw; that is a structural answer, and it is asserted as one.
 *   "a plug-in that throws on every retry, producing a retry loop"
 *       → "stops offering a retry after three consecutive failures" and
 *         "never retries on its own".
 *   "rapid extension switching while a fetch or render is in flight"
 *       → "clears a latched error when resetKey changes".
 *
 * React writes its own diagnostics to `console.error` whenever a boundary
 * catches, so `console.error` is stubbed for the whole file. The cases that are
 * ABOUT reporting install their own stub over the top and say so.
 * ============================================================================
 */

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'error', 'FaultBoundary.tsx');

/** A child that throws whatever it is handed, counting its own renders. */
let boomRenders = 0;
function Boom({ thrown }: { readonly thrown: unknown }): ReactElement {
  boomRenders += 1;
  throw thrown;
}

/** A child whose throwing is driven by a prop, so it can fail more than once. */
function Volatile({ explode }: { readonly explode: boolean }): ReactElement {
  if (explode) {
    throw new Error('volatile child');
  }
  return <div data-testid="volatile">volatile is fine</div>;
}

/** A child that renders normally, so a healthy subtree is distinguishable. */
function Healthy(): ReactElement {
  return <div data-testid="healthy">healthy</div>;
}

/**
 * A child that decides ONCE, when it mounts, whether to throw.
 *
 * The decision is captured into `useState`, so it survives a re-render and does
 * NOT survive a remount. That is what makes it able to tell the two apart: flip
 * the module flag, and only a genuine remount produces a different answer.
 */
let flakyShouldThrow = true;
function Flaky(): ReactElement {
  const [capturedAtMount] = useState(() => flakyShouldThrow);
  if (capturedAtMount) {
    throw new Error('flaky child');
  }
  return <div data-testid="recovered">recovered</div>;
}

interface HarnessProps {
  readonly resetKey?: string | null;
  readonly extensionId?: string | null;
  readonly variant?: 'pane' | 'row';
  readonly children: ReactNode;
}

function Harness({
  resetKey = null,
  extensionId = 'sample-ext',
  variant,
  children,
}: HarnessProps): ReactElement {
  return (
    <FaultBoundary
      boundaryLabel="The List pane"
      extensionId={extensionId}
      resetKey={resetKey}
      variant={variant}
    >
      {children}
    </FaultBoundary>
  );
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

beforeEach(() => {
  // React's own "The above error occurred in…" diagnostic, not this module's.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  flakyShouldThrow = true;
  boomRenders = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FaultBoundary — containment', () => {
  it('renders its children untouched while nothing throws', () => {
    render(
      <Harness>
        <Healthy />
      </Harness>,
    );
    expect(screen.getByTestId('healthy')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('degrades a throwing child to a host surface naming the surface and the extension', () => {
    render(
      <Harness>
        <Boom thrown={new Error('the view exploded')} />
      </Harness>,
    );
    const surface = screen.getByRole('alert');
    expect(surface).toHaveTextContent('The List pane could not be displayed.');
    expect(surface.querySelector('[data-fault-extension]')).toHaveTextContent('sample-ext');
    expect(surface.querySelector('[data-fault-message]')).toHaveTextContent('the view exploded');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('names no extension when the failing surface is host-owned', () => {
    render(
      <Harness extensionId={null}>
        <Boom thrown={new Error('host code failed')} />
      </Harness>,
    );
    expect(screen.getByRole('alert').querySelector('[data-fault-extension]')).toBeNull();
  });

  it('renders no plug-in element in the fallback', () => {
    render(
      <Harness>
        <Boom thrown={new Error('boom')} />
      </Harness>,
    );
    // The plug-in's own markup is gone entirely: the fallback is built from
    // host elements only, which is why nothing of the plug-in's can throw in it.
    expect(screen.queryByTestId('healthy')).toBeNull();
    const surface = screen.getByRole('alert');
    expect(surface.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(surface.querySelector('img')).toBeNull();
    expect(surface.querySelector('a')).toBeNull();
  });

  it('shows a one-line fallback with no control at all in the row variant', () => {
    const { container } = render(
      <Harness variant="row">
        <Boom thrown={new Error('row exploded')} />
      </Harness>,
    );
    const row = container.querySelector('[data-fault-boundary="row"]');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('The List pane could not be displayed. row exploded');
    // No `role="alert"` and no button: this fallback renders inside a
    // `role="option"` element, where either would break the listbox pattern.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FaultBoundary — reading a hostile thrown value', () => {
  it('survives an error whose message getter throws, and shows host text instead', () => {
    const armed = new Error('never read');
    Object.defineProperty(armed, 'message', {
      get() {
        throw new Error('detonated while being read');
      },
    });

    // Two claims, and they need separate evidence. THIS module's read of the
    // message is guarded, which is what `describeFault` answers directly:
    expect(describeFault(armed)).toBe('The failure reported no readable message.');

    // And the shell still stands. React's *own* dev-mode diagnostics read
    // `error.message` before this boundary ever sees the value, so what reaches
    // `getDerivedStateFromError` in a render may already be the getter's own
    // throw rather than the armed object — which is exactly why this component
    // stores the value and reads nothing off it in that static.
    render(
      <Harness>
        <Boom thrown={armed} />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The List pane could not be displayed.');
  });

  it('survives a thrown value that is not an Error at all', () => {
    render(
      <Harness>
        <Boom thrown={{ looks: 'like an error' }} />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The failure reported no readable message.');
  });

  it('shows a directly thrown string, which is a legal thing to throw', () => {
    render(
      <Harness>
        <Boom thrown="a bare string" />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('a bare string');
  });

  it('never stringifies the thrown value', () => {
    // `String()`, template interpolation and `+` all consult these three. A
    // fallback that reached any of them would run plug-in code inside the host's
    // error path, where a second throw is unrecoverable.
    const detonator = () => {
      throw new Error('stringified');
    };
    const hostile = {
      toString: detonator,
      valueOf: detonator,
      [Symbol.toPrimitive]: detonator,
    };
    expect(describeFault(hostile)).toBe('The failure reported no readable message.');
  });

  it('survives a value whose prototype lookup is trapped', () => {
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('instanceof detonated');
        },
      },
    );
    expect(describeFault(trapped)).toBe('The failure reported no readable message.');
  });

  it('falls back to host text for an Error whose message is not a string', () => {
    const odd = new Error('placeholder');
    Object.defineProperty(odd, 'message', { value: 42 });
    expect(describeFault(odd)).toBe('The failure reported no readable message.');
  });

  it('falls back to host text for an empty message rather than showing a blank line', () => {
    expect(describeFault(new Error('   '))).toBe('The failure reported no readable message.');
  });

  it('truncates a message too long to be shown, and marks that it did', () => {
    const long = 'x'.repeat(5000);
    const described = describeFault(new Error(long));
    expect(described).toHaveLength(241);
    expect(described.endsWith('…')).toBe(true);
  });
});

describe('FaultBoundary — retry', () => {
  it('retries by remounting the subtree rather than re-rendering it', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <Flaky />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // `Flaky` captured `true` into state when it mounted. Only a fresh mount
    // reads the flag again; a re-render keeps the captured value and throws.
    flakyShouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('remounts the subtree when resetKey changes even with nothing thrown', () => {
    // The generation key earns its place HERE. On the retry path React has
    // already discarded the failed subtree, so children would mount fresh
    // anyway; on this path nothing was unmounted, and the key is the only thing
    // that makes the switch a remount rather than a re-render with stale state.
    flakyShouldThrow = false;
    const { rerender } = render(
      <Harness resetKey="ext-a">
        <Flaky />
      </Harness>,
    );
    expect(screen.getByTestId('recovered')).toBeInTheDocument();

    flakyShouldThrow = true;
    rerender(
      <Harness resetKey="ext-b">
        <Flaky />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stops offering a retry after three consecutive failures', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <Boom thrown={new Error('always')} />
      </Harness>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retried 3 times without success. Switch extension, or reload the shell.',
    );
  });

  it('never retries on its own', async () => {
    render(
      <Harness>
        <Boom thrown={new Error('always')} />
      </Harness>,
    );
    // An automatic retry against a deterministically throwing subtree is an
    // unbounded render loop, so the child is not rendered again at all until a
    // human presses the button. Counted rather than asserted in prose.
    const settled = boomRenders;
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    expect(boomRenders).toBe(settled);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('clears the failure count when a retry succeeds', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Harness>
        <Volatile explode />
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    // Two consecutive failures banked. One more without a success in between
    // would withdraw the button.

    rerender(
      <Harness>
        <Volatile explode={false} />
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('volatile')).toBeInTheDocument();

    // The count restarts, so the bound is CONSECUTIVE failures rather than
    // failures over the boundary's lifetime. Two more failures therefore still
    // leave the button standing, where a lifetime count would have removed it.
    rerender(
      <Harness>
        <Volatile explode />
      </Harness>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('clears a latched error when resetKey changes', () => {
    const { rerender } = render(
      <Harness resetKey="ext-a">
        <Boom thrown={new Error('extension A failed')} />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <Harness resetKey="ext-b">
        <Healthy />
      </Harness>,
    );
    expect(screen.getByTestId('healthy')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('FaultBoundary — reporting', () => {
  it('reports the contained failure without interpolating anything into it', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = new Error('reportable');
    render(
      <Harness>
        <Boom thrown={thrown} />
      </Harness>,
    );
    const ours = reported.mock.calls.filter(
      (call) => call[0] === 'FaultBoundary contained a failure.',
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]?.[1]).toEqual({ label: 'The List pane', extensionId: 'sample-ext' });
    expect(ours[0]?.[2]).toBe(thrown);
  });

  it('survives a console.error that itself throws', () => {
    // Armed for THIS module's report only. React's dev build writes its own
    // diagnostics through the same function during commit, outside anything
    // this component can guard, so a blanket thrower would be testing React's
    // error path rather than this one's. The claim being pinned is precise: the
    // call in `report` cannot turn containment into an escape.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (args[0] === 'FaultBoundary contained a failure.') {
        throw new Error('console replaced by a thrower');
      }
    });
    render(
      <Harness>
        <Boom thrown={new Error('contained anyway')} />
      </Harness>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('contained anyway');
  });
});

describe('FaultBoundary — the source, and the limits it must keep stating', () => {
  it('the module source contains no HTML-injection sink at all', () => {
    const sinks = codeWords(SOURCE).filter((word) =>
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
        word,
      ),
    );
    expect(sinks).toEqual([]);
  });

  it('the module source names no URL-bearing attribute a plug-in value could reach', () => {
    const urlAttributes = codeWords(SOURCE).filter((word) =>
      /^(?:href|xlinkHref|src|srcSet|formAction|poster)$/.test(word),
    );
    expect(urlAttributes).toEqual([]);
  });

  it('reports a planted sink, so the scan above cannot pass vacuously', () => {
    const planted = ts.createSourceFile(
      'planted.tsx',
      'export const Bad = () => <div dangerouslySetInnerHTML={{ __html: message }} />;\n',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && /dangerouslySetInnerHTML/.test(node.text)) {
        found.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(planted);
    expect(found.length).toBeGreaterThan(0);
  });

  it('documents in both the source and DEVELOPER.md what a boundary cannot catch', () => {
    // ISSUE-004's Definition of Done requires the limits to be stated in the
    // source doc comment AND in `DEVELOPER.md`. A limit that is documented in
    // one place and quietly dropped from the other is how the overselling that
    // Amendment G exists to stop gets back in.
    const source = readFileSync(SOURCE, 'utf8');
    const guide = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'DEVELOPER.md'),
      'utf8',
    );
    for (const limit of ['event handler', 'settimeout', 'promise rejection', 'server-side']) {
      expect(source.toLowerCase()).toContain(limit);
      expect(guide.toLowerCase()).toContain(limit);
    }
  });
});
