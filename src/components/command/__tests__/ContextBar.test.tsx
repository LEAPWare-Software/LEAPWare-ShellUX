import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ShellStoreContext,
  createShellAPI,
  createShellStateStore,
  useShellContext,
} from '../../../core/ShellAPI';
import type { ShellStateStore } from '../../../core/ShellAPI';
import { createCommandRegistry } from '../../../core/commands/CommandRegistry';
import type { HostCommand } from '../../../core/commands/CommandRegistry';
import type { Command, IShellAPI, RibbonContext } from '../../../core/types';
import { CONTEXT_BAR_HEIGHT_PX, ContextBar, INLINE_ACTION_LIMIT } from '../ContextBar';

/**
 * ============================================================================
 * THE CONTEXT BAR CARRIES THE RIBBON'S AUDIT FIXES, AND THESE ARE THE CASES.
 * ============================================================================
 * The 2026-07-31 accessibility audit found eight blockers. Six of them lived in
 * the ribbon; this file is where those six are held now that the ribbon is gone.
 * Every case below is named against `ContextBar.tsx`'s own enumeration of them,
 * so a fix that is quietly dropped is a failing case with a name that says which
 * finding it was.
 *
 * The remaining two findings are shell-wide — the contrast half of finding 7 and
 * the badge/divider naming of finding 8 — and stay in
 * `src/components/__tests__/ShellLayout.test.tsx`, where they always were.
 *
 * **What is NOT asserted here, and cannot be.** That the overflow menu has any
 * painted pixels, or that a pointer at its centre reaches it rather than the pane
 * underneath. That was the worst of the eight — the menu was clipped to zero
 * height by two `overflow-hidden` ancestors — and every keyboard-model case here
 * would have passed green while it was true, because jsdom implements no layout,
 * no clipping and no `elementFromPoint`. The fix is structural and the nearest
 * assertable thing is the portal itself, which proves the DOM position and not
 * the paint. The measurement lives in `e2e/context-bar.spec.ts`.
 * ============================================================================
 */

const CONTEXT: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: 'sample-ext',
  activeNavNodeId: null,
  selectedItemIds: Object.freeze([]),
  selectedItemId: null,
  contextKeys: Object.freeze(Object.create(null) as Record<string, never>),
});

function shell(): IShellAPI {
  return createShellAPI(createShellStateStore());
}

function makeCommand(overrides: Record<string, unknown> = {}): Command {
  return {
    id: 'act-one',
    label: 'Act One',
    icon: 'save',
    isVisible: () => true,
    onExecute: () => undefined,
    ...overrides,
  } as unknown as Command;
}

function hostCommand(overrides: Partial<HostCommand> = {}): HostCommand {
  return {
    id: 'host-one',
    label: 'Host One',
    icon: 'settings',
    onSelect: () => undefined,
    ...overrides,
  };
}

function renderBar(options: {
  readonly commands?: readonly Command[];
  readonly hostCommands?: readonly HostCommand[];
  readonly extensionActive?: boolean;
  readonly context?: Readonly<RibbonContext>;
} = {}): ReturnType<typeof render> {
  const commands = options.commands ?? [];
  const registry = createCommandRegistry({
    hostCommands: options.hostCommands ?? [],
    extension:
      options.extensionActive === false
        ? null
        : { extensionId: 'sample-ext', commands, shell: shell() },
    recentKeys: [],
  });
  return render(<ContextBar registry={registry} context={options.context ?? CONTEXT} />);
}

/** Every button on the trailing side. */
function contextualButtons(container: HTMLElement): HTMLButtonElement[] {
  const side = container.querySelector('[data-command-side="extension"]');
  return side === null ? [] : Array.from(side.querySelectorAll('button'));
}

/** Seven visible commands: three more than the inline limit. */
function manyCommands(): Command[] {
  return Array.from({ length: 7 }, (_unused, index) =>
    makeCommand({ id: `act-${String(index)}`, label: `Action ${String(index)}` }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContextBar — layout and sides', () => {
  it('puts host commands on the leading side and contextual commands on the trailing side', () => {
    const { container } = renderBar({
      hostCommands: [hostCommand({ id: 'host-one', label: 'Host One' })],
      commands: [makeCommand({ id: 'act-one', label: 'Act One' })],
    });
    const host = container.querySelector('[data-command-side="host"]');
    const contextual = container.querySelector('[data-command-side="extension"]');
    expect(host?.textContent).toContain('Host One');
    expect(host?.textContent).not.toContain('Act One');
    expect(contextual?.textContent).toContain('Act One');
  });

  it('renders no contextual command when there is no active extension', () => {
    const { container } = renderBar({ hostCommands: [hostCommand()], extensionActive: false });
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(contextualButtons(container)).toHaveLength(0);
  });

  it('declares the 32px height the plan specifies, rather than growing to its content', () => {
    renderBar({ hostCommands: [hostCommand()] });
    const bar = screen.getByRole('toolbar', { name: 'Shell commands' });
    expect(CONTEXT_BAR_HEIGHT_PX).toBe(32);
    expect(bar.style.minHeight).toBe('32px');
  });

  it('never wraps: the bar is a single no-wrap line that scrolls on x only', () => {
    renderBar({ hostCommands: [hostCommand()] });
    const bar = screen.getByRole('toolbar', { name: 'Shell commands' });
    expect(bar).toHaveClass('flex-nowrap');
    // `flex-none` on the row is what stops the bar being squeezed or grown by the
    // panes below it, which is the other half of "does not shift the panes down".
    expect(bar).toHaveClass('flex-none');
    // The y-axis stays clipped, so the row can never grow a second line into the
    // panes. The x-axis scrolls instead of clipping, which is what makes every
    // control reachable at 320 CSS px (WCAG 1.4.10) rather than simply gone.
    //
    // CLASS TOKENS, NOT GEOMETRY. jsdom has no layout engine and no scrollbars,
    // so this asserts the declaration that produces the behaviour and cannot
    // observe the behaviour. The real measurement is a headless-Chrome hit test
    // against the compiled stylesheet, in `e2e/context-bar.spec.ts`.
    expect(bar).toHaveClass('overflow-x-auto');
    expect(bar).toHaveClass('overflow-y-hidden');
    expect(bar).not.toHaveClass('overflow-hidden');

    // `contain: paint` stops the row's overflow reaching the VIEWPORT's
    // scrollable area. Measured in Chrome at 320px: without it `window.scrollX`
    // could be driven to 376 with no visible scrollbar to show it had moved,
    // because `body { overflow: hidden }` hides the scrollbar without stopping
    // the scroll. Deleting this token reintroduces a silent sideways-scrolling page.
    expect(bar).toHaveClass('[contain:paint]');
  });

  it('keeps both sides unshrinkable, so a narrow row scrolls instead of squashing', () => {
    const { container } = renderBar({
      hostCommands: [hostCommand()],
      commands: [makeCommand()],
    });
    for (const side of ['host', 'extension']) {
      const element = container.querySelector(`[data-command-side="${side}"]`);
      expect(element).toHaveClass('flex-none');
      expect(element).not.toHaveClass('overflow-hidden');
    }
  });

  it('runs a host command on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBar({ hostCommands: [hostCommand({ label: 'Host One', onSelect })] });
    await user.click(screen.getByRole('button', { name: 'Host One' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('leaves a host command that is not disabled announced as available', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBar({
      hostCommands: [hostCommand({ label: 'Host On', isDisabled: false, onSelect })],
    });
    const button = screen.getByRole('button', { name: 'Host On' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('hands onExecute the context and the extension shell', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const api = shell();
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: {
        extensionId: 'sample-ext',
        commands: [makeCommand({ onExecute })],
        shell: api,
      },
      recentKeys: [],
    });
    render(<ContextBar registry={registry} context={CONTEXT} />);
    await user.click(screen.getByRole('button', { name: 'Act One' }));
    expect(onExecute).toHaveBeenCalledWith(CONTEXT, api);
  });
});

describe('ContextBar — advertised shortcuts', () => {
  it('advertises a chord-bearing command with aria-keyshortcuts, in key values rather than display spelling', () => {
    renderBar({
      commands: [makeCommand({ hotkey: { key: 'k', ctrl: true, shift: true } })],
    });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+K');
    // The display spelling would be a malformed attribute value. Asserted in the
    // negative too, so substituting `describeHotkey` fails here.
    expect(button.getAttribute('aria-keyshortcuts')).not.toContain('Ctrl');
  });

  it('omits aria-keyshortcuts entirely from a command that declares no chord', () => {
    renderBar({ commands: [makeCommand()] });
    expect(screen.getByRole('button', { name: 'Act One' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });

  it('omits aria-keyshortcuts from a disabled command, because the chord will not fire', () => {
    renderBar({
      commands: [makeCommand({ isDisabled: true, hotkey: { key: 'k', ctrl: true } })],
    });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('advertises a chord on an overflow menu item too', async () => {
    const user = userEvent.setup();
    const commands = manyCommands();
    commands[6] = makeCommand({
      id: 'act-6',
      label: 'Action 6',
      hotkey: { key: 'arrowdown', alt: true },
    });
    commands[5] = makeCommand({
      id: 'act-5',
      label: 'Action 5',
      isDisabled: true,
      hotkey: { key: 'j', ctrl: true },
    });
    renderBar({ commands });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    // The bar and the menu are two separate render sites; the rule holds at both,
    // including the disabled omission.
    expect(screen.getByRole('menuitem', { name: 'Action 6' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+ArrowDown',
    );
    expect(screen.getByRole('menuitem', { name: 'Action 5' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });

  it('never advertises a chord on a host command', () => {
    // `HostCommand` carries no `hotkey` field at all, and the dispatcher walks the
    // foreground extension's commands and nothing else. A host command announcing
    // a shortcut would be advertising something with no declaration behind it.
    renderBar({ hostCommands: [hostCommand()], extensionActive: false });
    expect(screen.getByRole('button', { name: 'Host One' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });
});

describe('ContextBar — overflow', () => {
  it('moves commands past the inline limit into an overflow menu rather than a second row', async () => {
    const user = userEvent.setup();
    const { container } = renderBar({ commands: manyCommands() });
    expect(INLINE_ACTION_LIMIT).toBe(4);
    // Four inline commands plus the overflow trigger, and nothing else.
    expect(contextualButtons(container)).toHaveLength(INLINE_ACTION_LIMIT + 1);
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
    renderBar({ commands: [makeCommand()] });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('counts only visible commands toward the inline limit', () => {
    renderBar({
      commands: [
        makeCommand({ id: 'act-0', label: 'Action 0', isVisible: () => false }),
        makeCommand({ id: 'act-1', label: 'Action 1' }),
        makeCommand({ id: 'act-2', label: 'Action 2' }),
        makeCommand({ id: 'act-3', label: 'Action 3' }),
        makeCommand({ id: 'act-4', label: 'Action 4' }),
      ],
    });
    // Four visible commands after the hidden one is dropped, so no overflow. A
    // command hidden by its predicate must not occupy an inline slot and push a
    // visible one into the menu.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Action 4' })).toBeInTheDocument();
  });

  it('does not count host commands toward the contextual inline limit', () => {
    // The two sides are separate projections of one registry. A shell with three
    // host commands and four contextual ones must not overflow the fourth.
    renderBar({
      hostCommands: [
        hostCommand({ id: 'h1', label: 'H1' }),
        hostCommand({ id: 'h2', label: 'H2' }),
        hostCommand({ id: 'h3', label: 'H3' }),
      ],
      commands: manyCommands().slice(0, 4),
    });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('closes the overflow menu and executes the command when a menu item is chosen', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const commands = manyCommands();
    commands[6] = makeCommand({ id: 'act-6', label: 'Action 6', onExecute });
    renderBar({ commands });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Action 6' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the overflow menu when the trigger is toggled again', async () => {
    const user = userEvent.setup();
    renderBar({ commands: manyCommands() });
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('resolves an icon key inside the menu through the same host table as the bar', async () => {
    const user = userEvent.setup();
    const commands = manyCommands();
    commands[5] = makeCommand({ id: 'act-5', label: 'Action 5', icon: 'save' });
    commands[6] = makeCommand({
      id: 'act-6',
      label: 'Action 6',
      icon: 'https://example.com/pwn.svg',
    });
    renderBar({ commands });
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    // The bar and the menu are two SEPARATE render sites, because the menu item is
    // a Radix item rather than the same button in a different variant. The rule —
    // an icon is a lookup key, never markup and never a URL — has to hold at both.
    expect(screen.getByRole('menuitem', { name: 'Action 5' }).querySelector('path')).toHaveAttribute(
      'd',
      'M3 3h7l3 3v7H3z',
    );
    const unknown = screen.getByRole('menuitem', { name: 'Action 6' });
    expect(unknown.querySelector('path')).toHaveAttribute('d', 'M3.5 3.5h9v9h-9z');
    expect(unknown.querySelector('img')).toBeNull();
    expect(unknown.innerHTML).not.toContain('example.com');
  });
});

/**
 * ============================================================================
 * THE MENU KEEPS THE PROMISES THE `menu` ROLE MAKES. AUDIT FINDINGS 1–5.
 * ============================================================================
 * A `role="menu"` tells NVDA and JAWS to switch to application mode and hand the
 * arrow keys to the page. Before the ribbon's own suite existed the menu was a
 * plain div with the role on it and none of the behaviour behind it: focus never
 * entered it, Escape did nothing, arrows did nothing, an outside click left it
 * open, and activating an item dropped focus onto `document.body` so the next Tab
 * restarted from the top of the document. Each case below pins one of those, and
 * they are carried across unchanged because the defects were.
 * ============================================================================
 */
describe('ContextBar — the overflow menu keyboard model', () => {
  function renderOverflow(commands: readonly Command[] = manyCommands()): {
    readonly user: ReturnType<typeof userEvent.setup>;
    readonly trigger: HTMLElement;
    readonly container: HTMLElement;
  } {
    const user = userEvent.setup();
    const { container } = renderBar({ commands });
    return { user, trigger: screen.getByRole('button', { name: 'More actions' }), container };
  }

  it('moves focus into the menu when it opens', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    // Focus lands on the menu container, from which the arrow keys reach the
    // items. What matters is that it left the page behind rather than staying on
    // the trigger while the menu claimed to be open.
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
    const commands = manyCommands();
    commands[6] = makeCommand({ id: 'act-6', label: 'Action 6', onExecute });
    const { user, trigger } = renderOverflow(commands);
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

  it('renders the menu outside the context bar, which is what un-clips it', async () => {
    const { user, container } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const menu = screen.getByRole('menu');
    const bar = screen.getByRole('toolbar', { name: 'Shell commands' });
    // A DOM-POSITION assertion, not a paint assertion. The menu used to live
    // inside the toolbar, whose `overflow` clipped it to zero visible pixels; it
    // now hangs off `document.body`, which has no clipping ancestor at all. jsdom
    // can see where a node is. It cannot see whether it is painted.
    expect(bar.contains(menu)).toBe(false);
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('does not modally hide the rest of the shell while the menu is open', async () => {
    const { user } = renderOverflow();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    // Radix's modal default would set `aria-hidden` on every sibling of the portal
    // and `pointer-events: none` on the body. A toolbar overflow menu is not a
    // dialog, and the bar's other commands must stay reachable. The command
    // palette makes the OPPOSITE choice, deliberately; see its own suite.
    const bar = screen.getByRole('toolbar', { name: 'Shell commands' });
    expect(bar).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('leaves a disabled menu item focusable, announced, and inert', async () => {
    const onExecute = vi.fn();
    const commands = manyCommands();
    commands[6] = makeCommand({
      id: 'act-6',
      label: 'Action 6',
      isDisabled: true,
      onExecute,
    });
    const { user } = renderOverflow(commands);
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    const item = screen.getByRole('menuitem', { name: 'Action 6' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.click(item);

    expect(onExecute).not.toHaveBeenCalled();
    // The menu stays open: closing would read as "the command ran".
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('gives every context-bar control a 24px minimum target, in the menu as well as on the bar', async () => {
    const { user, container } = renderOverflow();
    for (const button of container.querySelectorAll('button')) {
      expect(button).toHaveClass('min-h-6');
    }
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveClass('min-h-6');
    }
  });
});

/**
 * ============================================================================
 * THE ONE THING THIS SURFACE DOES NOT CONTAIN, PINNED AS A KNOWN LIMIT.
 * ============================================================================
 * The guards turn on the word THROWS. A predicate that fails is contained. A
 * predicate that SUCCEEDS at writing to the shell store during render is not: the
 * write notifies, `useShellContext` is a `useSyncExternalStore` subscription,
 * React re-renders, the predicate runs again and writes again. Left to itself the
 * cycle never closes.
 *
 * **Why the claim is narrowed rather than the behaviour contained.** The host is
 * not on the path. A predicate is handed the `RibbonContext` and nothing else;
 * whatever handle it writes through is a reference the plug-in captured in its own
 * closure at registration. There is no argument to wrap and no handle to revoke —
 * a re-entrancy flag could refuse to RE-EVALUATE, but it cannot refuse the WRITE,
 * and refusing to re-evaluate would mean rendering from a context the store no
 * longer holds, which is the tearing `useSyncExternalStore` exists to prevent.
 *
 * The case below pins CURRENT BEHAVIOUR as a limit rather than asserting a fix. It
 * bounds the loop from inside the predicate — the only place it can be bounded
 * from — so the test terminates while still demonstrating the re-entry.
 * ============================================================================
 */
describe('ContextBar — the re-entrancy limit', () => {
  function StoreBackedBar({
    store,
    commands,
  }: {
    readonly store: ShellStateStore;
    readonly commands: readonly Command[];
  }): ReactElement {
    const context = useShellContext();
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: { extensionId: 'sample-ext', commands, shell: createShellAPI(store) },
      recentKeys: [],
    });
    return <ContextBar registry={registry} context={context} />;
  }

  it('re-evaluates a predicate that writes to the shell during render, which is a wedge this module does not contain', () => {
    // React's own diagnosis of a render-phase write arrives on `console.error`, so
    // it is captured rather than allowed to litter the run.
    const reactWarnings = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createShellStateStore();
    const writesAllowed = 3;
    let evaluations = 0;

    const writer = makeCommand({
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
        <StoreBackedBar store={store} commands={[writer]} />
      </ShellStoreContext.Provider>,
    );

    // A CONTAINED predicate would be evaluated once per render of a tree that
    // renders once. Every write drove another render, which drove another
    // evaluation; the only reason this returns at all is that the predicate
    // stopped writing of its own accord.
    expect(evaluations).toBeGreaterThan(writesAllowed);
    expect(store.getContext().selectedItemId).toBe(`item-${String(writesAllowed)}`);
    expect(screen.getByRole('button', { name: 'Writes' })).toBeInTheDocument();

    // It is at least DIAGNOSABLE, which is the whole of the good news and is worth
    // pinning: a developer who hits this gets a named cause rather than a hang.
    const warned = reactWarnings.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warned).toContain('Cannot update a component');
  });
});
