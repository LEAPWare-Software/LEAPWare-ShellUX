import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShellAPI, createShellStateStore } from '../../../core/ShellAPI';
import { createCommandRegistry } from '../../../core/commands/CommandRegistry';
import type { HostCommand } from '../../../core/commands/CommandRegistry';
import { parseWhen } from '../../../core/commands/when';
import type { Command, IShellAPI, RibbonContext } from '../../../core/types';
import { COMMAND_ROW_CHROME, CommandButton } from '../commandListItem';
import { FloatingToolbar } from '../FloatingToolbar';
import { OMNIBOX_MATCH_LIMIT, OmniboxComposer } from '../OmniboxComposer';
import type { OmniboxSubmission } from '../OmniboxComposer';
import {
  COMMAND_SIGILS,
  INTENT_LABELS,
  OMNIBOX_INTENTS,
  commandQueryOf,
  detectIntent,
} from '../omniboxIntent';

/**
 * ============================================================================
 * THE TWO PANE-3 SURFACES. SELECTION-TRIGGERED, AND PERSISTENT.
 * ============================================================================
 * They are tested together because they are the two halves of one requirement —
 * plan requirement 4, "pane 3 must support both visualization and user input" —
 * and because they share the property that makes pane 3 different from host
 * chrome: they live inside the document the extension's view lives in.
 *
 * The security cases for both surfaces are in `commandSurfaces.test.tsx`, which
 * runs the same set against all four. What is here is what only these two do.
 * ============================================================================
 */

function shell(): IShellAPI {
  return createShellAPI(createShellStateStore());
}

function contextOf(overrides: Partial<RibbonContext> = {}): Readonly<RibbonContext> {
  return Object.freeze({
    activeExtensionId: 'sample-ext',
    activeNavNodeId: null,
    selectedItemIds: Object.freeze([]),
    selectedItemId: null,
    contextKeys: Object.freeze(Object.create(null) as Record<string, never>),
    ...overrides,
  });
}

const SELECTED = contextOf({
  selectedItemIds: Object.freeze(['row-1']),
  selectedItemId: 'row-1',
});

function makeCommand(overrides: Record<string, unknown> = {}): Command {
  const when = overrides['when'];
  return {
    id: 'act-one',
    label: 'Act One',
    icon: 'save',
    isVisible: () => true,
    onExecute: () => undefined,
    ...overrides,
    ...(typeof when === 'string' ? { whenExpression: parseWhen(when, 'when') } : {}),
  } as unknown as Command;
}

function registryOf(
  commands: readonly Command[],
  hostCommands: readonly HostCommand[] = [],
): ReturnType<typeof createCommandRegistry> {
  return createCommandRegistry({
    hostCommands,
    extension: { extensionId: 'sample-ext', commands, shell: shell() },
    recentKeys: [],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FloatingToolbar — selection-triggered, pane 3 only', () => {
  it('renders nothing at all when there is no selection', () => {
    const { container } = render(
      <FloatingToolbar registry={registryOf([makeCommand()])} context={contextOf()} />,
    );
    // `null`, not an empty labelled region: an empty box with a border is a
    // control the user has to learn to ignore, and a labelled region containing
    // nothing is noise a screen reader still announces.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when a selection exists but no command wants this surface', () => {
    const { container } = render(
      <FloatingToolbar
        registry={registryOf([makeCommand({ surfaces: ['context-bar'] })])}
        context={SELECTED}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('appears with a selection and disappears when the selection is cleared', () => {
    const commands = [makeCommand({ label: 'Reply' })];
    const { rerender, container } = render(
      <FloatingToolbar registry={registryOf(commands)} context={SELECTED} />,
    );
    expect(screen.getByRole('toolbar', { name: 'Selection commands' })).toBeInTheDocument();
    rerender(<FloatingToolbar registry={registryOf(commands)} context={contextOf()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never shows a host command, because a selection is a plug-in concept', () => {
    render(
      <FloatingToolbar
        registry={registryOf(
          [makeCommand({ label: 'Reply' })],
          [{ id: 'host-one', label: 'Host One', icon: 'settings', onSelect: () => undefined }],
        )}
        context={SELECTED}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Host One' })).toBeNull();
  });

  it('runs a command through the same guarded route every other surface uses', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(
      <FloatingToolbar
        registry={registryOf([makeCommand({ label: 'Reply', onExecute })])}
        context={SELECTED}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute.mock.calls[0]?.[0]).toBe(SELECTED);
  });

  it('honours a when that reads the selection, so it supplements rather than duplicates', () => {
    render(
      <FloatingToolbar
        registry={registryOf([
          makeCommand({ id: 'sel', label: 'Selective', when: 'selectedItemId != null' }),
          makeCommand({ id: 'nav', label: 'Nav only', when: 'activeNavNodeId != null' }),
        ])}
        context={SELECTED}
      />,
    );
    expect(screen.getByRole('button', { name: 'Selective' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nav only' })).toBeNull();
  });
});

describe('the shared command row — the surface-agnostic half', () => {
  it('renders without any surface layout class at all, because the class is optional', () => {
    // Every shipping surface passes a layout class, so the no-class path is
    // reachable only from a caller that does not — which is exactly the fifth
    // surface this row exists to be ready for. Asserted rather than left as an
    // untaken branch: the row must be renderable with nothing but a command.
    const registry = registryOf([makeCommand({ label: 'Bare' })]);
    const entry = registry.listForSurface('palette', contextOf())[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    render(<CommandButton entry={entry} />);
    const button = screen.getByRole('button', { name: 'Bare' });
    // The shared chrome is still there; only the surface-specific half is absent.
    expect(button).toHaveClass('min-h-6');
    expect(button.className).toContain(COMMAND_ROW_CHROME);
  });
});

describe('detectIntent — the one definition of what the user meant', () => {
  it('covers every intent it declares, so a new one cannot arrive untested', () => {
    // The exhaustiveness pin's runtime half. A fourth intent added to the union
    // fails here until it has a case below.
    expect([...OMNIBOX_INTENTS].sort()).toEqual(['ask', 'command', 'filter']);
    for (const intent of OMNIBOX_INTENTS) {
      expect(INTENT_LABELS[intent]).not.toBe('');
    }
  });

  it('reads a sigil as a command, whichever sigil it is', () => {
    for (const sigil of COMMAND_SIGILS) {
      expect(detectIntent(`${sigil}archive`)).toBe('command');
      // Leading whitespace must not silently change what a sigil means.
      expect(detectIntent(`   ${sigil}archive`)).toBe('command');
    }
  });

  it('reads a leading or trailing question mark as a question', () => {
    expect(detectIntent('?what is this')).toBe('ask');
    expect(detectIntent('what is this?')).toBe('ask');
  });

  it('reads anything else as a filter, including the empty string', () => {
    expect(detectIntent('')).toBe('filter');
    expect(detectIntent('   ')).toBe('filter');
    expect(detectIntent('unread')).toBe('filter');
    // The default has to be the harmless one: an empty `command` would mean "run
    // something" with nothing named.
  });

  it('strips the sigil from the command query and leaves everything else alone', () => {
    expect(commandQueryOf('>archive now')).toBe('archive now');
    expect(commandQueryOf('/ archive')).toBe('archive');
    expect(commandQueryOf('  plain text  ')).toBe('plain text');
  });
});

describe('OmniboxComposer — the intent is labelled before submit', () => {
  function renderComposer(
    commands: readonly Command[] = [],
    onSubmit: (submission: OmniboxSubmission) => void = () => undefined,
  ): { readonly user: ReturnType<typeof userEvent.setup>; readonly input: HTMLElement } {
    const user = userEvent.setup();
    render(
      <OmniboxComposer registry={registryOf(commands)} context={contextOf()} onSubmit={onSubmit} />,
    );
    return { user, input: screen.getByRole('textbox', { name: 'Composer input' }) };
  }

  it('shows the detected intent in words while the user types, before anything is submitted', async () => {
    const { user, input } = renderComposer();
    expect(screen.getByText('Filter')).toBeInTheDocument();
    await user.type(input, '>arch');
    expect(screen.getByText('Command')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'why?');
    expect(screen.getByText('Ask')).toBeInTheDocument();
  });

  it('announces the intent politely, because it changes under the user own typing', async () => {
    const { user, input } = renderComposer();
    await user.type(input, '>x');
    const chip = document.querySelector('[data-omnibox-intent]');
    expect(chip).toHaveAttribute('aria-live', 'polite');
    expect(chip).toHaveAttribute('data-omnibox-intent', 'command');
  });

  it('hands a filter and a question to the caller, with the raw text trimmed', async () => {
    const submissions: OmniboxSubmission[] = [];
    const { user, input } = renderComposer([], (submission) => {
      submissions.push(submission);
    });
    await user.type(input, '  unread  {Enter}');
    await user.type(input, 'why?{Enter}');
    expect(submissions).toEqual([
      { intent: 'filter', text: 'unread' },
      { intent: 'ask', text: 'why?' },
    ]);
    // The box clears after a submission, so the next thing typed is a new thought.
    expect(input).toHaveValue('');
  });

  it('submits through the form, so Enter needs no key handler in src/', async () => {
    const submissions: OmniboxSubmission[] = [];
    const { user, input } = renderComposer([], (submission) => {
      submissions.push(submission);
    });
    // The submit BUTTON is the same path Enter takes, which is the property that
    // makes a native form submission the right mechanism: one handler, two ways in.
    await user.type(input, 'unread');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submissions).toEqual([{ intent: 'filter', text: 'unread' }]);
  });

  it('submits nothing at all for an empty box', async () => {
    const onSubmit = vi.fn();
    const { user } = renderComposer([], onSubmit);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lists matching commands under the box once the intent is a command', async () => {
    const { user, input } = renderComposer([
      makeCommand({ id: 'a', label: 'Archive' }),
      makeCommand({ id: 'b', label: 'Reply' }),
    ]);
    expect(document.querySelector('[data-omnibox-matches]')).toBeNull();
    await user.type(input, '>arch');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('bounds how many matches it lists', async () => {
    const { user, input } = renderComposer(
      Array.from({ length: OMNIBOX_MATCH_LIMIT + 3 }, (_unused, index) =>
        makeCommand({ id: `c${String(index)}`, label: `Command ${String(index)}` }),
      ),
    );
    await user.type(input, '>');
    expect(
      document.querySelector('[data-omnibox-matches]')?.querySelectorAll('button'),
    ).toHaveLength(OMNIBOX_MATCH_LIMIT);
  });

  it('runs the first match on submit, and never hands a command to the caller', async () => {
    const onSubmit = vi.fn();
    const onExecute = vi.fn();
    const { user, input } = renderComposer(
      [makeCommand({ id: 'a', label: 'Archive', onExecute })],
      onSubmit,
    );
    await user.type(input, '>arch{Enter}');
    expect(onExecute).toHaveBeenCalledTimes(1);
    // A command NEVER reaches `onSubmit`. It runs through the registry, which is
    // what keeps every route to a plug-in handler on the guarded path.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('runs nothing on submit when the command intent matches nothing', async () => {
    const onSubmit = vi.fn();
    const { user, input } = renderComposer([makeCommand({ label: 'Archive' })], onSubmit);
    await user.type(input, '>zzz{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    // The text stays, because clearing it would throw away what the user typed in
    // response to a match they never got.
    expect(input).toHaveValue('>zzz');
  });

  it('runs nothing on submit when the first match is disabled', async () => {
    const onExecute = vi.fn();
    const { user, input } = renderComposer([
      makeCommand({ id: 'a', label: 'Archive', isDisabled: true, onExecute }),
    ]);
    await user.type(input, '>arch{Enter}');
    expect(onExecute).not.toHaveBeenCalled();
    expect(input).toHaveValue('>arch');
  });

  it('clears the box when a listed match is clicked, exactly as submitting one does', async () => {
    const onExecute = vi.fn();
    const { user, input } = renderComposer([makeCommand({ label: 'Archive', onExecute })]);
    await user.type(input, '>arch');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('');
  });

  it('offers only commands that asked for this surface', async () => {
    const { user, input } = renderComposer([
      makeCommand({ id: 'a', label: 'Everywhere' }),
      makeCommand({ id: 'b', label: 'Bar only', surfaces: ['context-bar'] }),
    ]);
    await user.type(input, '>');
    expect(screen.getByRole('button', { name: 'Everywhere' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bar only' })).toBeNull();
  });
});
