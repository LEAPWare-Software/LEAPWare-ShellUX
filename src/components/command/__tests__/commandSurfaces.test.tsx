import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShellAPI, createShellStateStore } from '../../../core/ShellAPI';
import { createCommandRegistry } from '../../../core/commands/CommandRegistry';
import type { ExtensionCommands, HostCommand } from '../../../core/commands/CommandRegistry';
import type { Command, IShellAPI, RibbonContext } from '../../../core/types';
import { CommandPalette } from '../CommandPalette';
import { ContextBar } from '../ContextBar';
import { FloatingToolbar } from '../FloatingToolbar';
import { OmniboxComposer } from '../OmniboxComposer';

/**
 * ============================================================================
 * FOUR RENDER SITES, FOUR SETS OF THE SAME GATES. NOT ONE SET AND AN ASSUMPTION.
 * ============================================================================
 * `src/core/types.ts` states the host's obligation towards untrusted plug-in
 * strings, and until this change the evidence for it was one component's test
 * file. ADR-0001 Amendment G is explicit about what that licensed: a sentence
 * about the ribbon and nothing beyond it. The ribbon is gone and there are now
 * FOUR places a plug-in string can reach the DOM, so there are four sets of these
 * cases and each one renders through its own surface.
 *
 * **The per-surface cases are written out rather than generated.** `it.each` would
 * be shorter and would produce interpolated titles, and `scripts/check-citations.mjs`
 * matches a citation against the title a test file really declares — so a
 * generated title is a citation nobody can write. Every case below is an explicit
 * `it()` whose title names its surface, and every prose site that cites one cites
 * that exact string.
 *
 * **Two different claims, and both are needed.** "Renders a markup-shaped label as
 * text" is a statement about one hostile input on one surface. "The module source
 * contains no injection sink at all" is a statement about the module, and only the
 * second survives somebody adding a second render path tomorrow. The source scan
 * uses the TypeScript compiler for the reason `src/__tests__/noEventListener.test.ts`
 * does: these modules discuss the sinks they avoid, and comments are trivia to the
 * parser rather than nodes in the tree.
 *
 * The fifth module in the source scan is `commandListItem.tsx`, and it is the one
 * that matters most: the four surfaces render no plug-in string themselves at all,
 * they hand a `CommandEntry` to that row. A sink there would be a sink on all four.
 * ============================================================================
 */

const COMMAND_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** The d-attribute of the host's fallback glyph, used for unknown icon keys. */
const FALLBACK_PATH = 'M3.5 3.5h9v9h-9z';
/** The first d-attribute of the host's "save" glyph. */
const SAVE_PATH = 'M3 3h7l3 3v7H3z';

function shell(): IShellAPI {
  return createShellAPI(createShellStateStore());
}

/** A structurally valid command, expressed loosely so hostile values fit. */
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

function contextWithSelection(): Readonly<RibbonContext> {
  return Object.freeze({
    activeExtensionId: 'sample-ext',
    activeNavNodeId: null,
    // Every surface is exercised with a live selection, because the floating
    // toolbar renders nothing without one and the other three are unaffected by
    // it. One context for four surfaces keeps the cases comparable.
    selectedItemIds: Object.freeze(['row-1']),
    selectedItemId: 'row-1',
    contextKeys: Object.freeze(Object.create(null) as Record<string, never>),
  });
}

interface SurfaceOptions {
  readonly commands: readonly Command[];
  readonly hostCommands?: readonly HostCommand[];
}

/** How one surface is put on screen with a given set of commands. */
interface Surface {
  /** The name used in every test title in this file. */
  readonly name: string;
  mount(options: SurfaceOptions): Promise<void>;
}

function registryOf(options: SurfaceOptions): ReturnType<typeof createCommandRegistry> {
  const extension: ExtensionCommands = {
    extensionId: 'sample-ext',
    commands: options.commands,
    shell: shell(),
  };
  return createCommandRegistry({
    hostCommands: options.hostCommands ?? [],
    extension,
    recentKeys: [],
  });
}

/**
 * The four surfaces, each mounted in the state where it actually shows commands.
 *
 * The palette is opened and held open — `onOpenChange` is ignored — so that a
 * case which clicks one command can go on to click another. The composer is put
 * into its command intent by typing the sigil, which is the only way a user
 * reaches its command list and therefore the only honest way to test it.
 */
const SURFACES: readonly Surface[] = [
  {
    name: 'the context bar',
    mount: async (options) => {
      render(<ContextBar registry={registryOf(options)} context={contextWithSelection()} />);
      await Promise.resolve();
    },
  },
  {
    name: 'the command palette',
    mount: async (options) => {
      render(
        <CommandPalette
          registry={registryOf(options)}
          context={contextWithSelection()}
          open
          onOpenChange={() => undefined}
        />,
      );
      await Promise.resolve();
    },
  },
  {
    name: 'the floating toolbar',
    mount: async (options) => {
      render(<FloatingToolbar registry={registryOf(options)} context={contextWithSelection()} />);
      await Promise.resolve();
    },
  },
  {
    name: 'the omnibox composer',
    mount: async (options) => {
      const user = userEvent.setup();
      render(
        <OmniboxComposer
          registry={registryOf(options)}
          context={contextWithSelection()}
          onSubmit={() => undefined}
        />,
      );
      await user.type(screen.getByRole('textbox', { name: 'Composer input' }), '>');
    },
  },
];

function surface(name: string): Surface {
  const found = SURFACES.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no surface named ${name}`);
  }
  return found;
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

function sinksIn(file: string): string[] {
  return codeWords(join(COMMAND_DIR, file)).filter((word) =>
    /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
      word,
    ),
  );
}

function urlAttributesIn(file: string): string[] {
  return codeWords(join(COMMAND_DIR, file)).filter((word) =>
    /^(?:href|xlinkHref|src|srcSet|formAction|poster)$/.test(word),
  );
}

/** The markup-shaped label used by every untrusted-string case below. */
const HOSTILE_LABEL = '<img src=x onerror="steal()">Reply';

/** A URL-shaped icon key: not a key the host publishes, and not a URL either. */
const HOSTILE_ICON = 'https://example.com/pwn.svg';

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Untrusted strings — four surfaces, three cases each                         */
/* -------------------------------------------------------------------------- */

describe('every command surface — untrusted plug-in strings', () => {
  it('the context bar renders a markup-shaped plug-in label as a text node, not as markup', async () => {
    await surface('the context bar').mount({ commands: [makeCommand({ label: HOSTILE_LABEL })] });
    expect(screen.getByRole('button', { name: HOSTILE_LABEL })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  });

  it('the command palette renders a markup-shaped plug-in label as a text node, not as markup', async () => {
    await surface('the command palette').mount({
      commands: [makeCommand({ label: HOSTILE_LABEL })],
    });
    expect(screen.getByRole('button', { name: HOSTILE_LABEL })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  });

  it('the floating toolbar renders a markup-shaped plug-in label as a text node, not as markup', async () => {
    await surface('the floating toolbar').mount({
      commands: [makeCommand({ label: HOSTILE_LABEL })],
    });
    expect(screen.getByRole('button', { name: HOSTILE_LABEL })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  });

  it('the omnibox composer renders a markup-shaped plug-in label as a text node, not as markup', async () => {
    await surface('the omnibox composer').mount({
      commands: [makeCommand({ label: HOSTILE_LABEL })],
    });
    expect(screen.getByRole('button', { name: HOSTILE_LABEL })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  });

  it('the context bar resolves an unknown icon key through the host fallback rather than through the key', async () => {
    await surface('the context bar').mount({ commands: [makeCommand({ icon: HOSTILE_ICON })] });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    expect(button.querySelector('img')).toBeNull();
    expect(button.innerHTML).not.toContain('example.com');
  });

  it('the command palette resolves an unknown icon key through the host fallback rather than through the key', async () => {
    await surface('the command palette').mount({ commands: [makeCommand({ icon: HOSTILE_ICON })] });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    expect(button.querySelector('img')).toBeNull();
    expect(button.innerHTML).not.toContain('example.com');
  });

  it('the floating toolbar resolves an unknown icon key through the host fallback rather than through the key', async () => {
    await surface('the floating toolbar').mount({
      commands: [makeCommand({ icon: HOSTILE_ICON })],
    });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    expect(button.querySelector('img')).toBeNull();
    expect(button.innerHTML).not.toContain('example.com');
  });

  it('the omnibox composer resolves an unknown icon key through the host fallback rather than through the key', async () => {
    await surface('the omnibox composer').mount({
      commands: [makeCommand({ icon: HOSTILE_ICON })],
    });
    const button = screen.getByRole('button', { name: 'Act One' });
    expect(button.querySelector('path')).toHaveAttribute('d', FALLBACK_PATH);
    expect(button.querySelector('img')).toBeNull();
    expect(button.innerHTML).not.toContain('example.com');
  });

  it('the context bar does not resolve a prototype-shaped icon key to anything inherited', async () => {
    await surface('the context bar').mount({ commands: [makeCommand({ icon: '__proto__' })] });
    expect(
      screen.getByRole('button', { name: 'Act One' }).querySelector('path'),
    ).toHaveAttribute('d', FALLBACK_PATH);
  });

  it('the command palette does not resolve a prototype-shaped icon key to anything inherited', async () => {
    await surface('the command palette').mount({ commands: [makeCommand({ icon: '__proto__' })] });
    expect(
      screen.getByRole('button', { name: 'Act One' }).querySelector('path'),
    ).toHaveAttribute('d', FALLBACK_PATH);
  });

  it('the floating toolbar does not resolve a prototype-shaped icon key to anything inherited', async () => {
    await surface('the floating toolbar').mount({ commands: [makeCommand({ icon: '__proto__' })] });
    expect(
      screen.getByRole('button', { name: 'Act One' }).querySelector('path'),
    ).toHaveAttribute('d', FALLBACK_PATH);
  });

  it('the omnibox composer does not resolve a prototype-shaped icon key to anything inherited', async () => {
    await surface('the omnibox composer').mount({ commands: [makeCommand({ icon: '__proto__' })] });
    expect(
      screen.getByRole('button', { name: 'Act One' }).querySelector('path'),
    ).toHaveAttribute('d', FALLBACK_PATH);
  });

  it('resolves a known icon key through the host table on every surface', async () => {
    for (const candidate of SURFACES) {
      await candidate.mount({ commands: [makeCommand({ icon: 'save' })] });
      expect(
        screen.getByRole('button', { name: 'Act One' }).querySelector('path'),
        `${candidate.name} must draw the host glyph`,
      ).toHaveAttribute('d', SAVE_PATH);
      cleanup();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Throwing predicates — four surfaces                                         */
/* -------------------------------------------------------------------------- */

/** A pair of commands: one whose predicate detonates, one that survives. */
function detonatingPredicate(): readonly Command[] {
  return [
    makeCommand({
      id: 'act-detonates',
      label: 'Detonates',
      isVisible: () => {
        throw new Error('predicate refused');
      },
    }),
    makeCommand({ id: 'act-survivor', label: 'Survivor' }),
  ];
}

describe('every command surface — a throwing predicate', () => {
  it('the context bar hides a command whose isVisible predicate throws and still renders the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await surface('the context bar').mount({ commands: detonatingPredicate() });
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('the command palette hides a command whose isVisible predicate throws and still renders the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await surface('the command palette').mount({ commands: detonatingPredicate() });
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(errors.mock.calls.length).toBeGreaterThan(0);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('the floating toolbar hides a command whose isVisible predicate throws and still renders the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await surface('the floating toolbar').mount({ commands: detonatingPredicate() });
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('the omnibox composer hides a command whose isVisible predicate throws and still renders the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await surface('the omnibox composer').mount({ commands: detonatingPredicate() });
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(errors.mock.calls.length).toBeGreaterThan(0);
  });

  it('treats a non-boolean isVisible result as not visible, on every surface', async () => {
    for (const candidate of SURFACES) {
      await candidate.mount({
        commands: [makeCommand({ id: 'act-truthy', label: 'Truthy', isVisible: () => 'yes' })],
      });
      expect(
        screen.queryByRole('button', { name: 'Truthy' }),
        `${candidate.name} must treat a non-boolean as not visible`,
      ).toBeNull();
      // `cleanup()` rather than emptying `document.body`: the palette is a MODAL
      // Radix dialog, and only a real unmount runs the effect that restores
      // `pointer-events` on the body. Wiping the DOM by hand leaves the next
      // surface in the loop unclickable, which reads as a component defect and is
      // not one.
      cleanup();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A report that itself throws — four surfaces                                 */
/* -------------------------------------------------------------------------- */

describe('every command surface — a report that throws', () => {
  it('the context bar survives a console.error that itself throws while reporting a bad predicate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console tampered');
    });
    await expect(
      surface('the context bar').mount({ commands: detonatingPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
  });

  it('the command palette survives a console.error that itself throws while reporting a bad predicate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console tampered');
    });
    await expect(
      surface('the command palette').mount({ commands: detonatingPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
  });

  it('the floating toolbar survives a console.error that itself throws while reporting a bad predicate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console tampered');
    });
    await expect(
      surface('the floating toolbar').mount({ commands: detonatingPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
  });

  it('the omnibox composer survives a console.error that itself throws while reporting a bad predicate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console tampered');
    });
    await expect(
      surface('the omnibox composer').mount({ commands: detonatingPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* An id getter that throws while a failure is being reported — four surfaces  */
/* -------------------------------------------------------------------------- */

/**
 * A command whose `id` cannot be read, and whose predicate throws.
 *
 * DEFENCE IN DEPTH, AND SAY SO. `normalizeCommand` stores a frozen record whose
 * `id` is a captured primitive, so nothing arriving by the documented route looks
 * like this. The declared types are `Command` and a caller is plain JavaScript,
 * which is the same standard `ShellAPI.ts` holds its own doors to.
 *
 * The defect being pinned: the report interpolated `${command.id}` INSIDE the
 * catch, where nothing was left to catch it — so a throwing getter turned a
 * contained predicate failure into an uncontained render failure and took the
 * original error with it.
 */
function hostileIdOnPredicate(): readonly Command[] {
  const hostile = {
    label: 'Detonates',
    icon: 'save',
    isVisible: () => {
      throw new Error('predicate refused');
    },
    onExecute: () => undefined,
  };
  Object.defineProperty(hostile, 'id', {
    enumerable: true,
    get(): never {
      throw new Error('id refused');
    },
  });
  return [hostile as unknown as Command, makeCommand({ id: 'act-survivor', label: 'Survivor' })];
}

/**
 * A command benign while the surface renders and hostile afterwards.
 *
 * It has to be: this command is VISIBLE, so its `id` is read while the host mints
 * the entry key, and that read is outside every guard. Its unguardedness is a
 * separate property and is not what this case is about — the defect being pinned
 * is that the failure REPORT could itself throw.
 */
function hostileIdOnHandler(): { readonly commands: readonly Command[]; arm(): void } {
  let armed = false;
  const hostile = {
    label: 'Detonates',
    icon: 'save',
    isVisible: () => true,
    onExecute: () => {
      throw new Error('handler refused');
    },
  };
  Object.defineProperty(hostile, 'id', {
    enumerable: true,
    get(): string {
      if (armed) {
        throw new Error('id refused');
      }
      return 'act-detonates';
    },
  });
  return {
    commands: [hostile as unknown as Command],
    arm: () => {
      armed = true;
    },
  };
}

describe('every command surface — an id getter that throws while a failure is reported', () => {
  it('the context bar contains an id getter that throws while a failing isVisible predicate is being reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      surface('the context bar').mount({ commands: hostileIdOnPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('isVisible predicate');
  });

  it('the command palette contains an id getter that throws while a failing isVisible predicate is being reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      surface('the command palette').mount({ commands: hostileIdOnPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Detonates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
  });

  it('the floating toolbar contains an id getter that throws while a failing isVisible predicate is being reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      surface('the floating toolbar').mount({ commands: hostileIdOnPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
  });

  it('the omnibox composer contains an id getter that throws while a failing isVisible predicate is being reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      surface('the omnibox composer').mount({ commands: hostileIdOnPredicate() }),
    ).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Survivor' })).toBeInTheDocument();
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
  });

  it('the context bar contains an id getter that throws while a failing onExecute handler is being reported', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hostile = hostileIdOnHandler();
    await surface('the context bar').mount({ commands: hostile.commands });
    hostile.arm();
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
    expect(screen.getByRole('button', { name: 'Detonates' })).toBeInTheDocument();
  });

  it('the command palette contains an id getter that throws while a failing onExecute handler is being reported', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hostile = hostileIdOnHandler();
    await surface('the command palette').mount({ commands: hostile.commands });
    hostile.arm();
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
  });

  it('the floating toolbar contains an id getter that throws while a failing onExecute handler is being reported', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hostile = hostileIdOnHandler();
    await surface('the floating toolbar').mount({ commands: hostile.commands });
    hostile.arm();
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
  });

  it('the omnibox composer contains an id getter that throws while a failing onExecute handler is being reported', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hostile = hostileIdOnHandler();
    await surface('the omnibox composer').mount({ commands: hostile.commands });
    hostile.arm();
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    expect(String(errors.mock.calls[0]?.[0])).toContain('<an id that could not be read>');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
  });
});

/* -------------------------------------------------------------------------- */
/* Throwing handlers — four surfaces                                           */
/* -------------------------------------------------------------------------- */

function detonatingHandler(after: () => void): readonly Command[] {
  return [
    makeCommand({
      id: 'act-detonates',
      label: 'Detonates',
      onExecute: () => {
        throw new Error('handler refused');
      },
    }),
    makeCommand({ id: 'act-after', label: 'After', onExecute: after }),
  ];
}

describe('every command surface — a throwing handler', () => {
  it('the context bar survives an onExecute that throws, leaving the surface interactive', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    await surface('the context bar').mount({ commands: detonatingHandler(after) });
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('the command palette survives an onExecute that throws, leaving the surface interactive', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    await surface('the command palette').mount({ commands: detonatingHandler(after) });
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('the floating toolbar survives an onExecute that throws, leaving the surface interactive', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    await surface('the floating toolbar').mount({ commands: detonatingHandler(after) });
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });

  it('the omnibox composer survives an onExecute that throws, leaving the surface interactive', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    await surface('the omnibox composer').mount({ commands: detonatingHandler(after) });
    await user.click(screen.getByRole('button', { name: 'Detonates' }));
    // Running a match clears the composer, so the sigil is retyped before the
    // second command can be reached. That is the surface behaving correctly, and
    // the case says so rather than working around it silently.
    await user.type(screen.getByRole('textbox', { name: 'Composer input' }), '>');
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
  });
});

/* -------------------------------------------------------------------------- */
/* Module-level claims: five modules, no sink in any of them                   */
/* -------------------------------------------------------------------------- */

describe('every command surface — the module source', () => {
  it('the context bar module source contains no HTML-injection sink at all', () => {
    expect(sinksIn('ContextBar.tsx')).toEqual([]);
  });

  it('the command palette module source contains no HTML-injection sink at all', () => {
    expect(sinksIn('CommandPalette.tsx')).toEqual([]);
  });

  it('the floating toolbar module source contains no HTML-injection sink at all', () => {
    expect(sinksIn('FloatingToolbar.tsx')).toEqual([]);
  });

  it('the omnibox composer module source contains no HTML-injection sink at all', () => {
    expect(sinksIn('OmniboxComposer.tsx')).toEqual([]);
  });

  it('the shared command row module source contains no HTML-injection sink at all', () => {
    // The one that matters most: the four surfaces render no plug-in string
    // themselves, they hand a `CommandEntry` to this row. A sink here is a sink on
    // all four at once.
    expect(sinksIn('commandListItem.tsx')).toEqual([]);
  });

  it('names no URL-bearing attribute a plug-in value could reach, in any of the five modules', () => {
    // Only attributes that actually load or navigate. `action` and `data` are
    // excluded deliberately: both are ordinary words in these modules, so
    // including them would make the rule fire on the vocabulary rather than on a
    // sink.
    for (const file of [
      'ContextBar.tsx',
      'CommandPalette.tsx',
      'FloatingToolbar.tsx',
      'OmniboxComposer.tsx',
      'commandListItem.tsx',
    ]) {
      expect(urlAttributesIn(file), `${file} must name no URL-bearing attribute`).toEqual([]);
    }
  });

  it('reports a planted sink, so the five scans above cannot pass vacuously', () => {
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

  it('does not report the docblocks, which is why the modules may discuss the sinks', () => {
    // The same reason `noEventListener.test.ts` parses instead of grepping: these
    // banners name `dangerouslySetInnerHTML` in prose.
    expect(readFileSync(join(COMMAND_DIR, 'commandListItem.tsx'), 'utf8')).toContain(
      'dangerouslySetInnerHTML',
    );
    expect(sinksIn('commandListItem.tsx')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The disabled guard, once, for all four                                      */
/* -------------------------------------------------------------------------- */

describe('every command surface — an unavailable command', () => {
  it('marks an unavailable command aria-disabled rather than removing it from the tab order, on every surface', async () => {
    for (const candidate of SURFACES) {
      document.body.replaceChildren();
      const onExecute = vi.fn();
      const user = userEvent.setup();
      await candidate.mount({
        commands: [makeCommand({ id: 'act-off', label: 'Act Off', isDisabled: true, onExecute })],
      });
      const button = screen.getByRole('button', { name: 'Act Off' });
      expect(button, `${candidate.name} must announce unavailability`).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // The native attribute would take it out of the tab order entirely, which
      // is audit finding 6.
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute('disabled');
      // And the GUARD, not the attribute, is what stops it firing.
      await user.click(button);
      expect(onExecute, `${candidate.name} must not run a disabled command`).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('truncates a very long label instead of widening the surface, on every surface', async () => {
    const long = 'L'.repeat(4000);
    for (const candidate of SURFACES) {
      await candidate.mount({ commands: [makeCommand({ label: long })] });
      const button = screen.getByRole('button', { name: long });
      // The full string stays reachable through `title`, which is an attribute
      // value and therefore text.
      expect(button).toHaveAttribute('title', long);
      expect(button.querySelector('span')).toHaveClass('truncate');
      cleanup();
    }
  });
});
