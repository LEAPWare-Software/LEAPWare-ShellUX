import { useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShellAPI, createShellStateStore } from '../../../core/ShellAPI';
import { createCommandRegistry } from '../../../core/commands/CommandRegistry';
import type { HostCommand } from '../../../core/commands/CommandRegistry';
import { parseWhen } from '../../../core/commands/when';
import type { Command, IShellAPI, RibbonContext } from '../../../core/types';
import { CommandPalette } from '../CommandPalette';

/**
 * ============================================================================
 * BROWSABLE ON AN EMPTY QUERY. THAT IS THE ARGUMENT FOR DELETING THE RIBBON.
 * ============================================================================
 * A ribbon's real job is DISCOVERY, and a search-only palette regresses on it —
 * you cannot search for a verb whose name you do not know. So the first block of
 * cases here is about the empty query: recents, suggestions, and every offered
 * command grouped by category, all present before a single character is typed.
 * If those go, the ribbon's deletion loses its justification.
 *
 * The second block is the containment claim, at this render site: the palette
 * shows the foreground extension, the host, and the switch-extension verb.
 *
 * The third is the honest-roles claim. There is no `listbox`, no
 * `aria-activedescendant` and no arrow-key model, and that is deliberate rather
 * than missing — see the component banner, and audit finding 3 for what happens
 * when a role promises an interaction model nobody implemented.
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

const CONTEXT = contextOf();

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

function hostCommand(overrides: Partial<HostCommand> = {}): HostCommand {
  return {
    id: 'host-one',
    label: 'Host One',
    icon: 'settings',
    onSelect: () => undefined,
    ...overrides,
  };
}

interface PaletteOptions {
  readonly commands?: readonly Command[];
  readonly hostCommands?: readonly HostCommand[];
  readonly recentKeys?: readonly string[];
  readonly context?: Readonly<RibbonContext>;
  readonly extensionActive?: boolean;
}

function renderPalette(options: PaletteOptions = {}): ReturnType<typeof render> {
  const registry = createCommandRegistry({
    hostCommands: options.hostCommands ?? [],
    extension:
      options.extensionActive === false
        ? null
        : {
            extensionId: 'sample-ext',
            commands: options.commands ?? [],
            shell: shell(),
          },
    recentKeys: options.recentKeys ?? [],
  });
  return render(
    <CommandPalette
      registry={registry}
      context={options.context ?? CONTEXT}
      open
      onOpenChange={() => undefined}
    />,
  );
}

/** The rows inside one named section. */
function section(label: string): HTMLElement {
  const found = document.querySelector(`[data-palette-section="${label}"]`);
  if (found === null) {
    throw new Error(`no palette section named ${label}`);
  }
  return found as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette — browsable on an empty query', () => {
  it('lists every offered command grouped by category before anything is typed', () => {
    renderPalette({
      hostCommands: [hostCommand({ id: 'host-view', label: 'Host View', category: 'view' })],
      commands: [
        makeCommand({ id: 'act-file', label: 'Filed', category: 'file' }),
        makeCommand({ id: 'act-loose', label: 'Loose' }),
      ],
    });
    // Grouped, in the host's own category order, with the uncategorised bucket
    // last. This is the ribbon's discovery affordance, and it is the entire
    // argument for deleting the ribbon.
    expect(within(section('File')).getByRole('button', { name: 'Filed' })).toBeInTheDocument();
    expect(within(section('View')).getByRole('button', { name: 'Host View' })).toBeInTheDocument();
    expect(
      within(section('Uncategorised')).getByRole('button', { name: 'Loose' }),
    ).toBeInTheDocument();
  });

  it('lists recents first, before the categories', () => {
    renderPalette({
      commands: [
        makeCommand({ id: 'act-a', label: 'Alpha', category: 'file' }),
        makeCommand({ id: 'act-b', label: 'Beta', category: 'file' }),
      ],
      recentKeys: ['ext:sample-ext:act-b'],
    });
    expect(within(section('Recent')).getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-palette-section]'),
    ).map((element) => element.dataset['paletteSection']);
    expect(sections[0]).toBe('Recent');
  });

  it('lists commands suggested by the current selection', () => {
    renderPalette({
      context: contextOf({
        selectedItemIds: Object.freeze(['row-1']),
        selectedItemId: 'row-1',
      }),
      commands: [
        makeCommand({ id: 'act-sel', label: 'Selective', when: 'selectedItemId != null' }),
        makeCommand({ id: 'act-plain', label: 'Plain' }),
      ],
    });
    const suggested = section('For the current selection');
    expect(within(suggested).getByRole('button', { name: 'Selective' })).toBeInTheDocument();
    expect(within(suggested).queryByRole('button', { name: 'Plain' })).toBeNull();
  });

  it('draws no empty section, so a block with nothing in it never appears', () => {
    renderPalette({ commands: [makeCommand({ label: 'Only' })] });
    expect(document.querySelector('[data-palette-section="Recent"]')).toBeNull();
    expect(
      document.querySelector('[data-palette-section="For the current selection"]'),
    ).toBeNull();
  });

  it('hides a command the guards refuse, so browsing shows no more than any other surface', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPalette({
      commands: [
        makeCommand({ id: 'act-shown', label: 'Shown' }),
        makeCommand({ id: 'act-pred', label: 'Predicate', isVisible: () => false }),
        makeCommand({ id: 'act-when', label: 'Whenned', when: 'contextKeys.ready' }),
        makeCommand({
          id: 'act-throws',
          label: 'Throws',
          isVisible: () => {
            throw new Error('predicate refused');
          },
        }),
      ],
      recentKeys: ['ext:sample-ext:act-pred', 'ext:sample-ext:act-when'],
    });
    expect(screen.getByRole('button', { name: 'Shown' })).toBeInTheDocument();
    for (const hidden of ['Predicate', 'Whenned', 'Throws']) {
      expect(screen.queryByRole('button', { name: hidden })).toBeNull();
    }
    // ...and the recents block does not smuggle either of them back in.
    expect(document.querySelector('[data-palette-section="Recent"]')).toBeNull();
    // REPORTED ONCE PER PROJECTION, NOT ONCE PER RENDER, and that is stated rather
    // than smoothed over. The palette asks the registry four questions —
    // `listForSurface`, `recents`, `suggestedFor` and `listByCategory` — and each
    // one runs the filter, so a throwing predicate is reported once per question.
    // That is the honest cost of "every projection goes through the same guards":
    // memoising the filter would make the count prettier and would put a cache
    // between a predicate and the context it is contracted to be a pure function
    // of. A predicate that is pure does not care how often it is called; one that
    // is not already wedges the shell for a different reason.
    expect(errors.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of errors.mock.calls) {
      expect(String(call[0])).toContain('act-throws');
    }
  });
});

describe('CommandPalette — searching', () => {
  it('replaces the browse blocks with results once a query is typed', async () => {
    const user = userEvent.setup();
    renderPalette({
      commands: [
        makeCommand({ id: 'act-a', label: 'Archive', category: 'file' }),
        makeCommand({ id: 'act-b', label: 'Reply', category: 'file' }),
      ],
      recentKeys: ['ext:sample-ext:act-b'],
    });
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'arch');
    expect(document.querySelector('[data-palette-section="File"]')).toBeNull();
    expect(document.querySelector('[data-palette-section="Recent"]')).toBeNull();
    expect(within(section('Results')).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(section('Results')).queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    const user = userEvent.setup();
    renderPalette({ commands: [makeCommand({ label: 'Archive' })] });
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), '  ARCH  ');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    const user = userEvent.setup();
    renderPalette({ commands: [makeCommand({ label: 'Archive' })] });
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'zzz');
    expect(screen.getByText('No command matches that.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('compares the query against a plug-in label without ever interpolating it', async () => {
    // The label is untrusted and is used as a COMPARISON operand only. A markup
    // query finds the markup-shaped label and still renders it as text.
    const user = userEvent.setup();
    const hostile = '<img src=x onerror="steal()">Reply';
    renderPalette({ commands: [makeCommand({ label: hostile })] });
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), '<img');
    expect(screen.getByRole('button', { name: hostile })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('CommandPalette — running a command', () => {
  /** The palette wired to real open state, as `ShellLayout` wires it. */
  function ControlledPalette({ commands }: { readonly commands: readonly Command[] }): ReactElement {
    const [open, setOpen] = useState(true);
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: { extensionId: 'sample-ext', commands, shell: shell() },
      recentKeys: [],
    });
    return (
      <CommandPalette registry={registry} context={CONTEXT} open={open} onOpenChange={setOpen} />
    );
  }

  it('runs the command and closes the palette', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(<ControlledPalette commands={[makeCommand({ label: 'Archive', onExecute })]} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes even when the handler threw, rather than leaving a modal over a failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ControlledPalette
        commands={[
          makeCommand({
            label: 'Archive',
            onExecute: () => {
              throw new Error('handler refused');
            },
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('forgets the query when it closes, so the next visit opens browsable again', async () => {
    const user = userEvent.setup();
    function Reopenable(): ReactElement {
      const [open, setOpen] = useState(true);
      const registry = createCommandRegistry({
        hostCommands: [],
        extension: {
          extensionId: 'sample-ext',
          commands: [makeCommand({ label: 'Archive', category: 'file' })],
          shell: shell(),
        },
        recentKeys: [],
      });
      return (
        <>
          <button type="button" onClick={() => { setOpen(true); }}>
            Open
          </button>
          <CommandPalette
            registry={registry}
            context={CONTEXT}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    render(<Reopenable />);
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'zzz');
    expect(screen.getByText('No command matches that.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // A query left behind would reopen the palette already filtered by whatever
    // was typed before, which reads as "the palette is broken, it shows nothing".
    expect(screen.getByRole('searchbox', { name: 'Search commands' })).toHaveValue('');
    expect(section('File')).toBeInTheDocument();
  });
});

describe('CommandPalette — the dialog', () => {
  it('is modal, unlike the context bar menu, because while it is open it IS the interaction', () => {
    renderPalette({ commands: [makeCommand()] });
    // Radix's modal default, kept here and overridden on the context bar. The two
    // surfaces differ because the two situations do: an overflow menu that hid the
    // navigation tree from assistive technology would be lying about what the user
    // is doing; a palette that did not would be lying the other way.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe('none');
  });

  it('carries an accessible name and a description, so the dialog is not an unlabelled box', () => {
    renderPalette({ commands: [makeCommand()] });
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
    expect(
      screen.getByText('Search every command available right now, or browse them by category.'),
    ).toBeInTheDocument();
  });

  it('claims no listbox, grid or menu role', () => {
    // AUDIT FINDING 3, APPLIED FORWARD. The old overflow menu carried `role="menu"`
    // with none of a menu's behaviour behind it, and screen readers switched to
    // application mode over a page that ignored the arrow keys. This surface
    // therefore claims only what it implements.
    renderPalette({ commands: [makeCommand()] });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelector('[aria-activedescendant]')).toBeNull();
  });

  it('walks every palette row with Tab, because nothing here claims an arrow-key model', async () => {
    const user = userEvent.setup();
    renderPalette({
      commands: [
        makeCommand({ id: 'act-a', label: 'Alpha' }),
        makeCommand({ id: 'act-b', label: 'Beta' }),
      ],
    });
    const query = screen.getByRole('searchbox', { name: 'Search commands' });
    query.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
  });

  it('is portalled out of its parent, so no ancestor overflow can clip it', () => {
    const { container } = renderPalette({ commands: [makeCommand()] });
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});

describe('CommandPalette — containment at the render site', () => {
  it('shows the foreground extension, the host, and the switch-extension verb, and nothing else', () => {
    renderPalette({
      hostCommands: [
        hostCommand({ id: 'host-one', label: 'Host One' }),
        hostCommand({ id: 'host-switch-extension', label: 'Switch extension' }),
      ],
      commands: [makeCommand({ id: 'act-one', label: 'Foreground One' })],
    });
    const keys = Array.from(document.querySelectorAll('[data-command-key]')).map(
      (element) => element.getAttribute('data-command-key'),
    );
    // Every key is either host-owned or namespaced to the ONE extension the
    // registry was built over. There is no fourth shape a key could take, because
    // there is no fourth source.
    expect(new Set(keys)).toEqual(
      new Set(['host:host-one', 'host:host-switch-extension', 'ext:sample-ext:act-one']),
    );
  });

  it('shows only host commands when no extension is in the foreground', () => {
    renderPalette({
      hostCommands: [hostCommand({ id: 'host-one', label: 'Host One' })],
      extensionActive: false,
    });
    const keys = Array.from(document.querySelectorAll('[data-command-key]')).map(
      (element) => element.getAttribute('data-command-key'),
    );
    expect(keys).toEqual(['host:host-one']);
  });

  it('drops a recent key belonging to an extension that is not in the foreground', () => {
    renderPalette({
      commands: [makeCommand({ id: 'reply', label: 'Reply' })],
      // Carried over from a session where a different extension was foreground.
      // The id collides with a live one; the namespaced key does not.
      recentKeys: ['ext:crm:reply'],
    });
    expect(document.querySelector('[data-palette-section="Recent"]')).toBeNull();
  });
});
