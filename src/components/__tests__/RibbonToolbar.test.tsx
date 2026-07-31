import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ShellStoreContext,
  createShellAPI,
  createShellStateStore,
  useShellContext,
} from '../../core/ShellAPI';
import type { ShellStateStore } from '../../core/ShellAPI';
import { makeAction } from '../../core/__tests__/fixtures';
import type { IShellAPI, RibbonAction, RibbonContext } from '../../core/types';
import { RibbonToolbar } from '../ui/RibbonToolbar';
import type { HostRibbonAction } from '../ui/RibbonToolbar';

/**
 * ============================================================================
 * THE RIBBON IS THE HOST'S FIRST RENDER BOUNDARY FOR UNTRUSTED PLUG-IN TEXT.
 * ============================================================================
 * Two of the gates below were carried into ISSUE-002 from ISSUE-001 because
 * ISSUE-001 had no call site for them:
 *
 *   - a throwing `isVisible` is treated as "not visible", reported, and the rest
 *     of the ribbon still renders;
 *   - a plug-in label reaches the DOM only as a text node.
 *
 * The second one is asserted twice on purpose. "Renders as text" is a statement
 * about one input; "there is no injection sink in the module at all" is a
 * statement about the component, and only the second survives someone adding a
 * second render path tomorrow. The source scan uses the TypeScript compiler for
 * the same reason `src/__tests__/noEventListener.test.ts` does: the module's own
 * docblock discusses the sinks it avoids, and comments are trivia to the parser
 * rather than nodes in the tree.
 * ============================================================================
 */

/** A frozen context, so a predicate cannot quietly rewrite what it was given. */
const CONTEXT: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: 'sample-ext',
  activeNavNodeId: null,
  selectedItemId: null,
  focusedPane: null,
});

/** The d-attribute of the host's fallback glyph, used for unknown icon keys. */
const FALLBACK_PATH = 'M3.5 3.5h9v9h-9z';
/** The first d-attribute of the host's "save" glyph. */
const SAVE_PATH = 'M3 3h7l3 3v7H3z';

/**
 * A `RibbonAction` built from the shared fixture.
 *
 * The fixture returns a loose record so that runtime-hostile values can be
 * substituted; the compile-time cast here is the same trade the core tests make.
 */
function action(overrides: Record<string, unknown> = {}): RibbonAction {
  return makeAction(overrides) as unknown as RibbonAction;
}

function shell(): IShellAPI {
  return createShellAPI(createShellStateStore());
}

function hostAction(overrides: Partial<HostRibbonAction> = {}): HostRibbonAction {
  return {
    id: 'host-one',
    label: 'Host One',
    icon: 'settings',
    onSelect: () => undefined,
    ...overrides,
  };
}

/** The button whose accessible name is `name`, within the trailing side. */
function contextualButtons(container: HTMLElement): HTMLButtonElement[] {
  const side = container.querySelector('[data-ribbon-side="extension"]');
  return side === null ? [] : Array.from(side.querySelectorAll('button'));
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

const RIBBON_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'RibbonToolbar.tsx');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RibbonToolbar — layout and sides', () => {
  it('puts host actions on the leading side and contextual actions on the trailing side', () => {
    const { container } = render(
      <RibbonToolbar
        hostActions={[hostAction({ id: 'host-one', label: 'Host One' })]}
        extension={{ actions: [action({ id: 'act-one', label: 'Act One' })], shell: shell() }}
        context={CONTEXT}
      />,
    );
    const host = container.querySelector('[data-ribbon-side="host"]');
    const contextual = container.querySelector('[data-ribbon-side="extension"]');
    expect(host?.textContent).toContain('Host One');
    expect(host?.textContent).not.toContain('Act One');
    expect(contextual?.textContent).toContain('Act One');
  });

  it('renders no contextual action when there is no active extension', () => {
    const { container } = render(
      <RibbonToolbar hostActions={[hostAction()]} extension={null} context={CONTEXT} />,
    );
    expect(screen.getByRole('toolbar', { name: 'Shell ribbon' })).toBeInTheDocument();
    expect(contextualButtons(container)).toHaveLength(0);
  });

  it('never wraps: the ribbon row is a single no-wrap line that scrolls on x only', () => {
    render(<RibbonToolbar hostActions={[hostAction()]} extension={null} context={CONTEXT} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Shell ribbon' });
    expect(toolbar).toHaveClass('flex-nowrap');
    // `flex-none` on the row is what stops the ribbon from being squeezed or
    // grown by the panes below it, which is the other half of "does not shift
    // the panes downward".
    expect(toolbar).toHaveClass('flex-none');
    // The y-axis is still clipped, so the row can never grow a second line into
    // the panes. The x-axis scrolls instead of clipping, which is what makes the
    // controls reachable at 320 CSS px (WCAG 1.4.10) rather than simply gone.
    //
    // CLASS TOKENS, NOT GEOMETRY. jsdom has no layout engine and no scrollbars,
    // so this asserts the declaration that produces the behaviour and cannot
    // observe the behaviour. The real measurement is a headless-Chrome hit test
    // against the compiled stylesheet, which is not runnable from here.
    expect(toolbar).toHaveClass('overflow-x-auto');
    expect(toolbar).toHaveClass('overflow-y-hidden');
    expect(toolbar).not.toHaveClass('overflow-hidden');

    // `contain: paint` stops the row's overflow reaching the VIEWPORT's
    // scrollable area. Measured in Chrome at 320px: without it `window.scrollX`
    // could be driven to 376 with no visible scrollbar to show it had moved,
    // because `body { overflow: hidden }` hides the scrollbar without stopping
    // the scroll. With it, `scrollX` stays 0 and the ribbon still scrolls.
    // Deleting this token reintroduces a silent sideways-scrolling page.
    expect(toolbar).toHaveClass('[contain:paint]');
  });

  it('keeps both ribbon sides unshrinkable, so a narrow row scrolls instead of squashing', () => {
    const { container } = render(
      <RibbonToolbar
        hostActions={[hostAction()]}
        extension={{ actions: [action({ id: 'act-one', label: 'Act One' })], shell: shell() }}
        context={CONTEXT}
      />,
    );
    // A shrinkable side would absorb the overflow by crushing its own buttons
    // and the row would never scroll, which is the failure mode this replaces.
    for (const side of ['host', 'extension']) {
      const element = container.querySelector(`[data-ribbon-side="${side}"]`);
      expect(element).toHaveClass('flex-none');
      expect(element).not.toHaveClass('overflow-hidden');
    }
  });

  it('marks an unavailable action aria-disabled rather than removing it from the tab order', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onExecute = vi.fn();
    render(
      <RibbonToolbar
        hostActions={[
          hostAction({ id: 'host-off', label: 'Host Off', isDisabled: true, onSelect }),
        ]}
        extension={{
          actions: [action({ id: 'act-one', label: 'Act One', isDisabled: true, onExecute })],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    const host = screen.getByRole('button', { name: 'Host Off' });
    const contextual = screen.getByRole('button', { name: 'Act One' });

    for (const button of [host, contextual]) {
      // `aria-disabled` announces "unavailable" without taking the control out
      // of the tab order. The native attribute did both, and "Close extension"
      // is disabled in the shell's default state — so a keyboard user could
      // never reach it to discover that it existed.
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute('disabled');
    }

    // Still focusable, which is the entire point of the change.
    await user.tab();
    expect(host).toHaveFocus();

    // And the guard, not the attribute, is what actually stops it firing.
    await user.click(host);
    await user.click(contextual);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('still runs an action that is not disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RibbonToolbar
        hostActions={[hostAction({ id: 'host-on', label: 'Host On', isDisabled: false, onSelect })]}
        extension={null}
        context={CONTEXT}
      />,
    );
    const button = screen.getByRole('button', { name: 'Host On' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('runs a host action on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RibbonToolbar
        hostActions={[hostAction({ label: 'Host One', onSelect })]}
        extension={null}
        context={CONTEXT}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Host One' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('RibbonToolbar — visibility predicates', () => {
  it('renders only the actions whose predicate returns true for this context', () => {
    const seen: RibbonContext[] = [];
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [
            action({
              id: 'act-shown',
              label: 'Shown',
              isVisible: (ctx: RibbonContext) => {
                seen.push(ctx);
                return true;
              },
            }),
            action({ id: 'act-hidden', label: 'Hidden', isVisible: () => false }),
          ],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    expect(screen.getByRole('button', { name: 'Shown' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden' })).toBeNull();
    expect(seen[0]).toBe(CONTEXT);
  });

  it('treats a non-boolean isVisible result as not visible', () => {
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [action({ id: 'act-truthy', label: 'Truthy', isVisible: () => 'yes' })],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Truthy' })).toBeNull();
  });

  it('hides an action whose isVisible predicate throws and still renders the rest', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <RibbonToolbar
        hostActions={[hostAction({ label: 'Host One' })]}
        extension={{
          actions: [
            action({
              id: 'act-detonates',
              label: 'Detonates',
              isVisible: () => {
                throw new Error('predicate refused');
              },
            }),
            action({ id: 'act-survivor', label: 'Survivor', isVisible: () => true }),
          ],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Host One' })).toBeInTheDocument();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('contains an id getter that throws while a failing isVisible predicate is being reported', () => {
    // DEFENCE IN DEPTH, AND SAY SO. `normalizeRibbonAction` stores a frozen
    // record whose `id` is a captured primitive, so nothing arriving by the
    // documented route looks like this. The props of this component are
    // `readonly RibbonAction[]` and a caller is plain JavaScript, which is the
    // same standard `ShellAPI.ts` holds its own doors to.
    //
    // The defect: the report interpolated `${action.id}` INSIDE the catch, where
    // nothing was left to catch it — so a throwing getter turned a contained
    // predicate failure into an uncontained render failure, and took the
    // original error with it. The symmetric `onExecute` getter was already
    // contained, because that access sits inside the `try`.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hostile = makeAction({
      label: 'Detonates',
      isVisible: () => {
        throw new Error('predicate refused');
      },
    });
    Object.defineProperty(hostile, 'id', {
      enumerable: true,
      get(): never {
        throw new Error('id refused');
      },
    });

    expect(() =>
      render(
        <RibbonToolbar
          hostActions={[]}
          extension={{
            actions: [
              hostile as unknown as RibbonAction,
              action({ id: 'act-survivor', label: 'Survivor' }),
            ],
            shell: shell(),
          }}
          context={CONTEXT}
        />,
      ),
    ).not.toThrow();

    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    // The report still happened, and still names a slot rather than silently
    // becoming a report about nothing.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('isVisible predicate');
  });

  it('survives a console.error that itself throws while reporting a bad predicate', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console tampered');
    });
    expect(() =>
      render(
        <RibbonToolbar
          hostActions={[]}
          extension={{
            actions: [
              action({
                id: 'act-detonates',
                label: 'Detonates',
                isVisible: () => {
                  throw new Error('predicate refused');
                },
              }),
              action({ id: 'act-survivor', label: 'Survivor', isVisible: () => true }),
            ],
            shell: shell(),
          }}
          context={CONTEXT}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
  });
});

describe('RibbonToolbar — execution', () => {
  it('hands onExecute the context and the extension shell', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const api = shell();
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: [action({ id: 'act-one', label: 'Act One', onExecute })], shell: api }}
        context={CONTEXT}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Act One' }));
    expect(onExecute).toHaveBeenCalledWith(CONTEXT, api);
  });

  it('survives an onExecute that throws, leaving the ribbon interactive', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [
            action({
              id: 'act-detonates',
              label: 'Detonates',
              onExecute: () => {
                throw new Error('handler refused');
              },
            }),
            action({ id: 'act-after', label: 'After', onExecute: after }),
          ],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    // Still mounted, still interactive: the next action runs normally.
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('contains an id getter that throws while a failing onExecute handler is being reported', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Benign while the ribbon renders, hostile afterwards. It has to be: this
    // action is VISIBLE, so `key={action.id}` reads the getter during render,
    // and that read is outside every guard. Its unguardedness is a separate
    // property of React's key protocol and is not what this case is about — the
    // defect being pinned is that the failure REPORT could itself throw.
    let armed = false;
    const hostile = makeAction({
      label: 'Detonates',
      onExecute: () => {
        throw new Error('handler refused');
      },
    });
    Object.defineProperty(hostile, 'id', {
      enumerable: true,
      get(): string {
        if (armed) {
          throw new Error('id refused');
        }
        return 'act-detonates';
      },
    });

    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: [hostile as unknown as RibbonAction], shell: shell() }}
        context={CONTEXT}
      />,
    );
    armed = true;

    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
    // Still mounted and still interactive, which is the containment the report
    // was in danger of undoing.
    expect(screen.getByRole('button', { name: 'Detonates' })).toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * THE ONE THING THIS MODULE DOES NOT CONTAIN, PINNED AS A KNOWN LIMIT.
 * ============================================================================
 * Rule 3 of the component's banner turns on the word THROWS. A predicate that
 * fails is contained. A predicate that SUCCEEDS at writing to the shell store
 * during render is not: the write notifies, `useShellContext` is a
 * `useSyncExternalStore` subscription, React re-renders, the predicate runs
 * again and writes again. Left to itself the cycle never closes — measured at
 * 240 seconds without a single test completing, and without reaching a
 * 200,000-evaluation stop.
 *
 * **Why the claim was narrowed rather than the behaviour contained.** The host
 * is not on the path. A predicate is handed the `RibbonContext` and nothing
 * else; whatever `IShellAPI` or `ShellStateStore` it writes through is a
 * reference the plug-in captured in its own closure at registration time. There
 * is no argument for this component to wrap, no handle for it to revoke and no
 * interposition point of any kind — a re-entrancy flag here could refuse to
 * RE-EVALUATE, but it cannot refuse the WRITE, and refusing to re-evaluate would
 * mean rendering the ribbon from a context the store no longer holds, which is
 * the tearing `useSyncExternalStore` exists to prevent. So the honest move is
 * ADR-0001 Amendment G's second one: narrow the sentence until a test licenses
 * it, and name the residue as the plug-in author's obligation.
 *
 * The case below therefore pins the CURRENT BEHAVIOUR as a limit rather than
 * asserting a fix. It bounds the loop from inside the predicate — the only place
 * it can be bounded from — so that the test terminates while still demonstrating
 * the re-entry that an unbounded predicate would never come back from.
 * ============================================================================
 */
describe('RibbonToolbar — the re-entrancy limit', () => {
  /** The ribbon wired to a real store, exactly as `ShellLayout` wires it. */
  function StoreBackedRibbon({
    store,
    actions,
  }: {
    readonly store: ShellStateStore;
    readonly actions: readonly RibbonAction[];
  }): ReactElement {
    const context = useShellContext();
    return (
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions, shell: createShellAPI(store) }}
        context={context}
      />
    );
  }

  it('re-evaluates a predicate that writes to the shell during render, which is a wedge this module does not contain', () => {
    // React's own diagnosis of a render-phase write arrives on `console.error`,
    // so it is captured rather than allowed to litter the run.
    const reactWarnings = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createShellStateStore();
    const writesAllowed = 3;
    let evaluations = 0;

    const writer = action({
      id: 'act-writes',
      label: 'Writes',
      isVisible: (): boolean => {
        evaluations += 1;
        if (evaluations <= writesAllowed) {
          // A plug-in author's honest mistake — "select the first row while I am
          // deciding whether to show this" — and a contract violation:
          // DEVELOPER.md says a predicate must be pure.
          store.setSelectedItem(`item-${String(evaluations)}`);
        }
        return true;
      },
    });

    render(
      <ShellStoreContext.Provider value={store}>
        <StoreBackedRibbon store={store} actions={[writer]} />
      </ShellStoreContext.Provider>,
    );

    // A CONTAINED predicate would be evaluated once per render of a tree that
    // renders once. Every write drove another render, which drove another
    // evaluation; the only reason this returns at all is that the predicate
    // stopped writing of its own accord.
    expect(evaluations).toBeGreaterThan(writesAllowed);
    expect(store.getContext().selectedItemId).toBe(`item-${String(writesAllowed)}`);
    expect(screen.getByRole('button', { name: 'Writes' })).toBeInTheDocument();

    // It is at least DIAGNOSABLE, which is the whole of the good news and is
    // worth pinning: a developer who hits this gets a named cause rather than a
    // silent hang.
    const warned = reactWarnings.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(warned).toContain('Cannot update a component');
  });
});

describe('RibbonToolbar — untrusted strings', () => {
  it('renders a markup-shaped plug-in label as a text node, not as markup', () => {
    const hostile = '<img src=x onerror="steal()">Reply';
    const { container } = render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: [action({ id: 'act-one', label: hostile })], shell: shell() }}
        context={CONTEXT}
      />,
    );
    expect(screen.getByRole('button', { name: hostile })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('truncates a very long label instead of widening the ribbon', () => {
    const long = 'L'.repeat(4000);
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: [action({ id: 'act-one', label: long })], shell: shell() }}
        context={CONTEXT}
      />,
    );
    const button = screen.getByRole('button', { name: long });
    expect(button).toHaveClass('max-w-[9rem]');
    expect(button.querySelector('span')).toHaveClass('truncate');
  });

  it('resolves a known icon key through the host table', () => {
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [action({ id: 'act-one', label: 'Act One', icon: 'save' })],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    const path = screen.getByRole('button', { name: 'Act One' }).querySelector('path');
    expect(path).toHaveAttribute('d', SAVE_PATH);
  });

  it('resolves an unknown icon key through the host fallback rather than through the key', () => {
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [
            action({ id: 'act-one', label: 'Act One', icon: 'https://example.com/pwn.svg' }),
          ],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    // The key itself reaches no attribute anywhere: no image, no link, no URL.
    expect(button.querySelector('img')).toBeNull();
    expect(button.innerHTML).not.toContain('example.com');
  });

  it('does not resolve a prototype-shaped icon key to anything inherited', () => {
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [action({ id: 'act-one', label: 'Act One', icon: '__proto__' })],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    const path = screen.getByRole('button', { name: 'Act One' }).querySelector('path');
    expect(path).toHaveAttribute('d', FALLBACK_PATH);
  });

  it('the module source contains no HTML-injection sink at all', () => {
    const words = codeWords(RIBBON_SOURCE);
    const sinks = words.filter((word) =>
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
        word,
      ),
    );
    expect(sinks).toEqual([]);
  });

  it('the module source names no URL-bearing attribute a plug-in value could reach', () => {
    // Only attributes that actually load or navigate. `action` and `data` are
    // excluded deliberately: both are ordinary words in this module — the
    // parameter name of every helper here is `action` — so including them would
    // make the rule fire on its own vocabulary rather than on a sink.
    const words = codeWords(RIBBON_SOURCE);
    const urlAttributes = words.filter((word) =>
      /^(?:href|xlinkHref|src|srcSet|formAction|poster)$/.test(word),
    );
    expect(urlAttributes).toEqual([]);
  });

  it('reports a planted sink, so the scan above cannot pass vacuously', () => {
    // The scan's own control: the same walk over a module that DOES carry a sink
    // must find it, otherwise a green result says nothing.
    const planted = ts.createSourceFile(
      'planted.tsx',
      'export const Bad = () => <div dangerouslySetInnerHTML={{ __html: label }} />;\n',
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

  it('does not report the docblock, which is why the module may discuss the sinks', () => {
    // The same reason `noEventListener.test.ts` parses instead of grepping: the
    // module's banner names `dangerouslySetInnerHTML` in prose.
    expect(readFileSync(RIBBON_SOURCE, 'utf8')).toContain('dangerouslySetInnerHTML');
  });
});

describe('RibbonToolbar — overflow', () => {
  /** Seven visible actions: three more than the inline limit. */
  function manyActions(): RibbonAction[] {
    return Array.from({ length: 7 }, (_unused, index) =>
      action({ id: `act-${index}`, label: `Action ${index}` }),
    );
  }

  it('moves actions past the inline limit into an overflow menu rather than a second row', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: manyActions(), shell: shell() }}
        context={CONTEXT}
      />,
    );
    // Four inline actions plus the overflow trigger, and nothing else.
    expect(contextualButtons(container)).toHaveLength(5);
    expect(screen.queryByRole('menu')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByRole('menuitem', { name: 'Action 6' })).toBeInTheDocument();
  });

  it('does not render an overflow trigger when everything fits', () => {
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{
          actions: [action({ id: 'act-one', label: 'Act One' })],
          shell: shell(),
        }}
        context={CONTEXT}
      />,
    );
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('counts only visible actions toward the inline limit', () => {
    const actions = [
      action({ id: 'act-0', label: 'Action 0', isVisible: () => false }),
      action({ id: 'act-1', label: 'Action 1' }),
      action({ id: 'act-2', label: 'Action 2' }),
      action({ id: 'act-3', label: 'Action 3' }),
      action({ id: 'act-4', label: 'Action 4' }),
    ];
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions, shell: shell() }}
        context={CONTEXT}
      />,
    );
    // Four visible actions after the hidden one is dropped, so no overflow.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Action 4' })).toBeInTheDocument();
  });

  it('closes the overflow menu and executes the action when a menu item is chosen', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const actions = manyActions();
    actions[6] = action({ id: 'act-6', label: 'Action 6', onExecute });
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions, shell: shell() }}
        context={CONTEXT}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Action 6' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the overflow menu when the trigger is toggled again', async () => {
    const user = userEvent.setup();
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: manyActions(), shell: shell() }}
        context={CONTEXT}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('resolves an icon key inside the menu through the same host table as the bar', async () => {
    const user = userEvent.setup();
    const actions = manyActions();
    actions[5] = action({ id: 'act-5', label: 'Action 5', icon: 'save' });
    actions[6] = action({ id: 'act-6', label: 'Action 6', icon: 'https://example.com/pwn.svg' });
    render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions, shell: shell() }}
        context={CONTEXT}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    // The bar and the menu are two SEPARATE render sites now that the menu item
    // is a Radix item rather than the same button in a different variant. Rule 2
    // in the module banner — an icon is a lookup key, never markup and never a
    // URL — has to hold at both of them, so it is asserted at both.
    const known = screen.getByRole('menuitem', { name: 'Action 5' });
    expect(known.querySelector('path')).toHaveAttribute('d', SAVE_PATH);

    const unknown = screen.getByRole('menuitem', { name: 'Action 6' });
    expect(unknown.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    expect(unknown.querySelector('img')).toBeNull();
    expect(unknown.innerHTML).not.toContain('example.com');
  });
});

/**
 * ============================================================================
 * THE MENU KEEPS THE PROMISES THE `menu` ROLE MAKES. AND ONE IT CANNOT PROVE.
 * ============================================================================
 * A `role="menu"` tells NVDA and JAWS to switch to application mode and hand the
 * arrow keys to the page. Before this suite existed the menu was a plain div
 * with the role on it and none of the behaviour behind it: focus never entered
 * it, Escape did nothing, arrows did nothing, an outside click left it open, and
 * activating an item dropped focus onto `document.body` so the next Tab
 * restarted from the top of the document. Each case below pins one of those.
 *
 * **What is NOT asserted here, and cannot be.** That the menu has any painted
 * pixels, or that a pointer at its centre reaches it rather than the pane
 * underneath. That was the worst of the eight defects — the menu was clipped to
 * zero height by two `overflow-hidden` ancestors — and every one of these cases
 * passed green while it was true, because jsdom implements no layout, no
 * clipping and no `elementFromPoint`. The fix is structural (`DropdownMenu.Portal`
 * renders under `document.body`, outside every clipping ancestor), and the only
 * honest evidence for it is a hit test in a real engine against the compiled
 * stylesheet. The nearest thing assertable from here is the portal itself, which
 * is the last case in this block — and it proves the DOM position, not the paint.
 * ============================================================================
 */
describe('RibbonToolbar — the overflow menu keyboard model', () => {
  function manyActions(): RibbonAction[] {
    return Array.from({ length: 7 }, (_unused, index) =>
      action({ id: `act-${index}`, label: `Action ${index}` }),
    );
  }

  function renderOverflow(actions: readonly RibbonAction[] = manyActions()): {
    readonly user: ReturnType<typeof userEvent.setup>;
    readonly trigger: HTMLElement;
  } {
    const user = userEvent.setup();
    render(
      <RibbonToolbar hostActions={[]} extension={{ actions, shell: shell() }} context={CONTEXT} />,
    );
    return { user, trigger: screen.getByRole('button', { name: 'More actions' }) };
  }

  it('moves focus into the menu when it opens', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    // Focus lands on the menu container, from which the arrow keys reach the
    // items. What matters is that it left the page behind rather than staying
    // on the trigger while the menu claimed to be open.
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('walks the items with the arrow keys, which is what the role promises', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Action 4' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Action 5' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Action 4' })).toHaveFocus();
  });

  it('closes on Escape and puts focus back on the trigger', async () => {
    const { user, trigger } = renderOverflow();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger after an item is activated, not to document.body', async () => {
    const onExecute = vi.fn();
    const actions = manyActions();
    actions[6] = action({ id: 'act-6', label: 'Action 6', onExecute });
    const { user, trigger } = renderOverflow(actions);
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Action 6' }));

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    // The defect this replaces: closing unmounted the focused button, focus fell
    // back to `document.body`, and the next Tab restarted from the top of the
    // document — WCAG 2.4.3.
    expect(trigger).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('closes when the pointer goes down outside it', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('advertises aria-controls only while the menu exists, so the id never dangles', async () => {
    const { user, trigger } = renderOverflow();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    expect(document.getElementById(controls as string)).toBe(screen.getByRole('menu'));

    await user.keyboard('{Escape}');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('renders the menu outside the ribbon, which is what un-clips it', async () => {
    const { container } = render(
      <RibbonToolbar
        hostActions={[]}
        extension={{ actions: manyActions(), shell: shell() }}
        context={CONTEXT}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const menu = screen.getByRole('menu');
    const toolbar = screen.getByRole('toolbar', { name: 'Shell ribbon' });
    // A DOM-POSITION assertion, not a paint assertion. The menu used to live
    // inside the toolbar, whose `overflow` clipped it to zero visible pixels;
    // it now hangs off `document.body`, which has no clipping ancestor at all.
    // jsdom can see where a node is. It cannot see whether it is painted.
    expect(toolbar.contains(menu)).toBe(false);
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('does not modally hide the rest of the shell while the menu is open', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    // Radix's modal default would set `aria-hidden` on every sibling of the
    // portal and `pointer-events: none` on the body. A toolbar overflow menu is
    // not a dialog, and the ribbon's other commands must stay reachable.
    const toolbar = screen.getByRole('toolbar', { name: 'Shell ribbon' });
    expect(toolbar).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('leaves a disabled menu item focusable, announced, and inert', async () => {
    const onExecute = vi.fn();
    const actions = manyActions();
    actions[6] = action({ id: 'act-6', label: 'Action 6', isDisabled: true, onExecute });
    const { user } = renderOverflow(actions);
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const item = screen.getByRole('menuitem', { name: 'Action 6' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.click(item);

    expect(onExecute).not.toHaveBeenCalled();
    // The menu stays open: closing would read as "the action ran".
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
