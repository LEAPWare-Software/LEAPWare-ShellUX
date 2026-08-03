import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShellAPI, createShellStateStore } from '../../ShellAPI';
import type { IShellAPI, Command, RibbonContext } from '../../types';
import { COMMAND_CATEGORIES, COMMAND_SURFACES } from '../../types';
import { parseWhen } from '../when';
import {
  MAX_RECENT_COMMANDS,
  MAX_RECENT_KEY_LENGTH,
  UNCATEGORISED_LABEL,
  createCommandRegistry,
  withRecent,
} from '../CommandRegistry';
import type { CommandEntry, ExtensionCommands, HostCommand } from '../CommandRegistry';

/**
 * ============================================================================
 * ONE FILTER, FOUR PROJECTIONS, AND THE CASES THAT PROVE IT IS ONE.
 * ============================================================================
 * The registry's whole value is that a command hidden on one surface is hidden on
 * every surface, so the visibility cases below are written to walk **every
 * projection** rather than to pick one. A case that only checked
 * `listForSurface('palette')` would pass unchanged if `recents` grew its own
 * filter, which is the exact drift this module exists to prevent.
 *
 * The containment case is the load-bearing one and it is deliberately structural:
 * it asserts that the module offers no *parameter* through which a second
 * extension could arrive, because a filter can be removed by one line and a
 * missing parameter cannot.
 * ============================================================================
 */

const REGISTRY_SOURCE = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'CommandRegistry.ts',
);

/** A frozen context, so nothing under test can quietly rewrite what it was given. */
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

/**
 * A normalised command, as the registry would have stored it.
 *
 * `whenExpression` is built through `parseWhen` rather than hand-shaped, because
 * a hand-shaped tree would let these cases pass against an evaluator the real
 * parser could never produce input for.
 */
function command(overrides: Partial<Command> & { readonly id: string }): Command {
  const when = overrides.when;
  return Object.freeze({
    label: `Label ${overrides.id}`,
    icon: 'save',
    isVisible: () => true,
    onExecute: () => undefined,
    ...overrides,
    ...(when === undefined ? {} : { whenExpression: parseWhen(when, 'when') }),
  }) as Command;
}

function shell(): IShellAPI {
  return createShellAPI(createShellStateStore());
}

function extensionOf(commands: readonly Command[], extensionId = 'sample-ext'): ExtensionCommands {
  return { extensionId, commands, shell: shell() };
}

function hostCommand(overrides: Partial<HostCommand> & { readonly id: string }): HostCommand {
  return {
    label: `Host ${overrides.id}`,
    icon: 'settings',
    onSelect: () => undefined,
    ...overrides,
  };
}

/** Every entry every projection offers, keyed by the projection's name. */
function everyProjection(
  registry: ReturnType<typeof createCommandRegistry>,
  context: Readonly<RibbonContext>,
): Map<string, readonly CommandEntry[]> {
  return new Map<string, readonly CommandEntry[]>([
    ['listForSurface(context-bar)', registry.listForSurface('context-bar', context)],
    ['listForSurface(palette)', registry.listForSurface('palette', context)],
    ['listForSurface(floating-toolbar)', registry.listForSurface('floating-toolbar', context)],
    ['listForSurface(omnibox)', registry.listForSurface('omnibox', context)],
    ['listByCategory', registry.listByCategory(context).flatMap((group) => group.commands)],
    ['recents', registry.recents(context)],
    ['suggestedFor', registry.suggestedFor(context)],
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandRegistry — the one filter', () => {
  it('offers host commands and the foreground extension commands, and nothing else', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: extensionOf([command({ id: 'act-one' })]),
      recentKeys: [],
    });
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.key)).toEqual([
      'host:host-one',
      'ext:sample-ext:act-one',
    ]);
  });

  it('offers nothing from an extension when none is in the foreground', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: null,
      recentKeys: [],
    });
    for (const [projection, entries] of everyProjection(registry, CONTEXT)) {
      expect(
        entries.every((entry) => entry.source === 'host'),
        `${projection} must offer only host commands`,
      ).toBe(true);
    }
  });

  it('hides a command whose predicate returns false, on every projection', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({ id: 'shown', category: 'select' }),
        command({ id: 'hidden', category: 'select', isVisible: () => false }),
      ]),
      recentKeys: ['ext:sample-ext:hidden', 'ext:sample-ext:shown'],
    });
    for (const [projection, entries] of everyProjection(
      registry,
      contextOf({ selectedItemIds: Object.freeze(['row-1']), selectedItemId: 'row-1' }),
    )) {
      expect(
        entries.map((entry) => entry.id),
        `${projection} must not offer the hidden command`,
      ).not.toContain('hidden');
    }
  });

  it('treats a non-boolean isVisible result as not visible', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({ id: 'truthy', isVisible: () => 'yes' as unknown as boolean }),
      ]),
      recentKeys: [],
    });
    expect(registry.listForSurface('palette', CONTEXT)).toEqual([]);
  });

  it('hides a command whose predicate throws, reports it once, and offers the rest', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({
          id: 'detonates',
          isVisible: () => {
            throw new Error('predicate refused');
          },
        }),
        command({ id: 'survivor' }),
      ]),
      recentKeys: [],
    });
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.id)).toEqual([
      'survivor',
    ]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('detonates');
  });

  it('ANDs `when` with `isVisible`, so a when can only ever narrow', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        // Visible by predicate, refused by the expression.
        command({ id: 'narrowed', when: 'contextKeys.ready' }),
        // Refused by the predicate, permitted by the expression. An OR here would
        // reveal a command a predicate was hiding, which is the failure this case
        // exists to catch.
        command({ id: 'still-hidden', when: 'true', isVisible: () => false }),
        command({ id: 'both-true', when: 'true' }),
      ]),
      recentKeys: [],
    });
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.id)).toEqual([
      'both-true',
    ]);
  });

  it('evaluates `when` against the live context, so a context key turns a command on', () => {
    const commands = [command({ id: 'gated', when: 'contextKeys.ready' })];
    const off = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf(commands),
      recentKeys: [],
    });
    expect(off.listForSurface('palette', CONTEXT)).toEqual([]);

    const ready = contextOf({
      contextKeys: Object.freeze(Object.assign(Object.create(null) as object, { ready: true })),
    });
    const on = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf(commands),
      recentKeys: [],
    });
    expect(on.listForSurface('palette', ready).map((entry) => entry.id)).toEqual(['gated']);
  });

  it('never runs a host command through a predicate, because a host command has none', () => {
    // The compiler already refuses `isVisible` on `HostCommand`; what this asserts
    // is the runtime consequence — a host command is offered on every surface it
    // asked for, with no predicate call and no `when` in the path.
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: null,
      recentKeys: [],
    });
    for (const surface of COMMAND_SURFACES) {
      expect(
        registry
          .listForSurface(surface as 'palette', CONTEXT)
          .map((entry) => entry.key),
      ).toEqual(['host:host-one']);
    }
  });
});

describe('CommandRegistry — surfaces', () => {
  it('honours `surfaces` as a narrowing, never as a widening', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-palette', surfaces: ['palette'] })],
      extension: extensionOf([
        command({ id: 'bar-only', surfaces: ['context-bar'] }),
        command({ id: 'everywhere' }),
        // An empty array is legal and means no surface at all: a command
        // reachable only by its chord.
        command({ id: 'chord-only', surfaces: [] }),
      ]),
      recentKeys: [],
    });
    expect(registry.listForSurface('context-bar', CONTEXT).map((entry) => entry.id)).toEqual([
      'bar-only',
      'everywhere',
    ]);
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.id)).toEqual([
      'host-palette',
      'everywhere',
    ]);
    expect(registry.listForSurface('omnibox', CONTEXT).map((entry) => entry.id)).toEqual([
      'everywhere',
    ]);
  });

  it('sorts by priority descending and keeps declaration order within a priority', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({ id: 'a' }),
        command({ id: 'b', priority: 10 }),
        command({ id: 'c' }),
        command({ id: 'd', priority: 10 }),
        command({ id: 'e', priority: -5 }),
      ]),
      recentKeys: [],
    });
    // b and d tie at 10 and keep the order they were declared in; a and c tie at
    // the implicit 0 and do the same. A manifest with no priorities at all is
    // therefore returned exactly as written, which is what the context bar's
    // inline/overflow split has always depended on.
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e',
    ]);
  });

  it('carries aria-keyshortcuts only for a chord that will actually fire', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: extensionOf([
        command({ id: 'chorded', hotkey: { key: 'k', ctrl: true, shift: true } }),
        command({ id: 'disabled', isDisabled: true, hotkey: { key: 'j', ctrl: true } }),
        command({ id: 'plain' }),
      ]),
      recentKeys: [],
    });
    const byId = new Map(
      registry.listForSurface('palette', CONTEXT).map((entry) => [entry.id, entry]),
    );
    // Key VALUES, not the display spelling: `aria-keyshortcuts` is defined in
    // terms of UI Events `KeyboardEvent.key`, where the control key is `Control`.
    expect(byId.get('chorded')?.keyShortcuts).toBe('Control+Shift+K');
    expect(byId.get('disabled')?.keyShortcuts).toBeUndefined();
    expect(byId.get('plain')?.keyShortcuts).toBeUndefined();
    expect(byId.get('host-one')?.keyShortcuts).toBeUndefined();
  });
});

describe('CommandRegistry — palette containment', () => {
  it('offers no route by which a second extension commands could enter a projection', () => {
    // STRUCTURAL, NOT A FILTER, and that is the point: a filter is removed in one
    // line and a missing parameter is not. `createCommandRegistry` takes ONE
    // extension, this module imports no registry and performs no lookup, so a
    // background extension's `onExecute` cannot be handed a `RibbonContext` whose
    // `contextKeys` belong to somebody else.
    const source = readFileSync(REGISTRY_SOURCE, 'utf8');
    // No import of the extension registry, and no import of the activation
    // controller — the two objects that know about extensions other than the one
    // that was passed in.
    //
    // The module names are ASSEMBLED rather than written as literals, because
    // `scripts/check-portability.mjs` reads an import-shaped string literal in any
    // tracked file as a real import and fails on one that does not resolve from
    // here. Spelling them out would make this case a portability violation about
    // itself.
    const imports = (module: string): boolean =>
      new RegExp(`from ['"][^'"]*${module}['"]`).test(source);
    expect(imports('RegistryContext')).toBe(false);
    expect(imports('ActivationContext')).toBe(false);
    expect(source).not.toContain('getExtension');
    expect(source).not.toContain('listExtensions');

    // And the input really is singular: the field is `extension`, not
    // `extensions`, and it holds one object or null.
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([command({ id: 'mine' })], 'foreground-ext'),
      recentKeys: [],
    });
    expect(registry.listForSurface('palette', CONTEXT).map((entry) => entry.key)).toEqual([
      'ext:foreground-ext:mine',
    ]);
  });

  it('namespaces a command key by its extension, so a key from elsewhere cannot resolve', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([command({ id: 'reply' })], 'mail'),
      // A recents list carried over from a session where a DIFFERENT extension
      // was in the foreground. The id collides; the key does not.
      recentKeys: ['ext:crm:reply', 'ext:mail:reply'],
      });
    expect(registry.recents(CONTEXT).map((entry) => entry.key)).toEqual(['ext:mail:reply']);
  });
});

describe('CommandRegistry — recents', () => {
  it('resolves recents against what is offered NOW, not against what was recorded', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: extensionOf([
        command({ id: 'live' }),
        command({ id: 'now-hidden', isVisible: () => false }),
      ]),
      recentKeys: [
        'ext:sample-ext:now-hidden',
        'ext:sample-ext:gone-entirely',
        'ext:sample-ext:live',
        'host:host-one',
      ],
    });
    // Recency order is preserved for what survives; everything else is dropped
    // silently, because "you have a recent command from another extension" is not
    // a fact this surface should publish either.
    expect(registry.recents(CONTEXT).map((entry) => entry.key)).toEqual([
      'ext:sample-ext:live',
      'host:host-one',
    ]);
  });

  it('bounds what recents returns, however long the stored list is', () => {
    const commands = Array.from({ length: MAX_RECENT_COMMANDS + 4 }, (_unused, index) =>
      command({ id: `c${String(index)}` }),
    );
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf(commands),
      recentKeys: commands.map((entry) => `ext:sample-ext:${entry.id}`),
    });
    expect(registry.recents(CONTEXT)).toHaveLength(MAX_RECENT_COMMANDS);
  });

  it('records an executed command through onExecuted, host command and plug-in alike', () => {
    const recorded: string[] = [];
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one' })],
      extension: extensionOf([command({ id: 'act-one' })]),
      recentKeys: [],
      onExecuted: (key) => {
        recorded.push(key);
      },
    });
    for (const entry of registry.listForSurface('palette', CONTEXT)) {
      entry.run();
    }
    expect(recorded).toEqual(['host:host-one', 'ext:sample-ext:act-one']);
  });

  it('runs without an onExecuted callback at all', () => {
    const ran = vi.fn();
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one', onSelect: ran })],
      extension: null,
      recentKeys: [],
    });
    expect(() => {
      registry.listForSurface('palette', CONTEXT)[0]?.run();
    }).not.toThrow();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('records a command whose handler threw, because the user still invoked it', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recorded: string[] = [];
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({
          id: 'detonates',
          onExecute: () => {
            throw new Error('handler refused');
          },
        }),
      ]),
      recentKeys: [],
      onExecuted: (key) => {
        recorded.push(key);
      },
    });
    registry.listForSurface('palette', CONTEXT)[0]?.run();
    expect(recorded).toEqual(['ext:sample-ext:detonates']);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('withRecent moves a repeat to the front rather than listing it twice, and bounds the list', () => {
    let keys: readonly string[] = [];
    for (let index = 0; index < MAX_RECENT_COMMANDS + 3; index += 1) {
      keys = withRecent(keys, `k${String(index)}`);
    }
    expect(keys).toHaveLength(MAX_RECENT_COMMANDS);
    expect(keys[0]).toBe(`k${String(MAX_RECENT_COMMANDS + 2)}`);

    const moved = withRecent(keys, keys[5] as string);
    expect(moved[0]).toBe(keys[5]);
    expect(moved.filter((key) => key === keys[5])).toHaveLength(1);
    expect(moved).toHaveLength(MAX_RECENT_COMMANDS);
  });

  it('keeps the persisted key bound wide enough for the keys the host actually mints', () => {
    // Both bounds are host constants and the hydration validator enforces them,
    // so they are asserted against a real key rather than left as numbers nobody
    // has measured anything with.
    const key = `ext:${'e'.repeat(64)}:${'c'.repeat(64)}`;
    expect(key.length).toBeLessThanOrEqual(MAX_RECENT_KEY_LENGTH);
  });
});

describe('CommandRegistry — listByCategory', () => {
  it('groups in the host order and puts uncategorised commands last', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-view', category: 'view' })],
      extension: extensionOf([
        command({ id: 'no-bucket' }),
        command({ id: 'helpful', category: 'help' }),
        command({ id: 'filed', category: 'file' }),
      ]),
      recentKeys: [],
    });
    const groups = registry.listByCategory(CONTEXT);
    expect(groups.map((group) => group.category)).toEqual(['file', 'view', 'help', null]);
    expect(groups.map((group) => group.label)).toEqual([
      'File',
      'View',
      'Help',
      UNCATEGORISED_LABEL,
    ]);
    expect(groups[3]?.commands.map((entry) => entry.id)).toEqual(['no-bucket']);
  });

  it('emits no empty group, so a category nobody used draws nothing', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([command({ id: 'filed', category: 'file' })]),
      recentKeys: [],
    });
    expect(registry.listByCategory(CONTEXT)).toHaveLength(1);
    expect(COMMAND_CATEGORIES.length).toBeGreaterThan(1);
  });

  it('labels every declared category, so a bucket cannot reach a surface unnamed', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf(
        COMMAND_CATEGORIES.map((category) => command({ id: `c-${category}`, category })),
      ),
      recentKeys: [],
    });
    const groups = registry.listByCategory(CONTEXT);
    expect(groups).toHaveLength(COMMAND_CATEGORIES.length);
    for (const group of groups) {
      expect(group.label).not.toBe('');
      expect(group.label).not.toBe(String(group.category));
    }
  });
});

describe('CommandRegistry — suggestedFor', () => {
  it('suggests nothing when nothing is selected', () => {
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({ id: 'selecty', category: 'select' }),
        command({ id: 'gated', when: 'selectedItemId != null' }),
      ]),
      recentKeys: [],
    });
    expect(registry.suggestedFor(CONTEXT)).toEqual([]);
  });

  it('suggests commands whose when reads the selection, and commands filed under select', () => {
    const selected = contextOf({
      selectedItemIds: Object.freeze(['row-1']),
      selectedItemId: 'row-1',
    });
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one', category: 'select' })],
      extension: extensionOf([
        command({ id: 'by-when', when: 'selectedItemId != null' }),
        command({ id: 'by-in-selection', when: "'row-1' in selectedItemIds" }),
        command({ id: 'by-category', category: 'select' }),
        command({ id: 'by-nested-when', when: '!(selectedItemId == null) && true' }),
        command({ id: 'unrelated', when: 'contextKeys.mode == 1' }),
        command({ id: 'plain' }),
      ]),
      recentKeys: [],
    });
    // A HOST command is never suggested: a suggestion is about the selection, and
    // the host does not know what a row in a plug-in's list means.
    expect(registry.suggestedFor(selected).map((entry) => entry.id)).toEqual([
      'by-when',
      'by-in-selection',
      'by-category',
      'by-nested-when',
    ]);
  });

  it('walks every node kind when deciding whether a when reads the selection', () => {
    const selected = contextOf({
      selectedItemIds: Object.freeze(['row-1']),
      selectedItemId: 'row-1',
    });
    // One case per branch of `referencesSelection`, so a node kind added later
    // without a decision is a failing case rather than a silent `false`.
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({ id: 'literal', when: 'true' }),
        command({ id: 'context-key', when: 'contextKeys.ready || true' }),
        command({ id: 'other-field', when: 'activeNavNodeId != null || true' }),
        command({ id: 'not', when: '!(selectedItemId == null)' }),
        command({ id: 'or', when: 'false || selectedItemId != null' }),
        command({ id: 'in-list', when: "selectedItemId in ('row-1', 'row-2')" }),
        command({ id: 'starts-with', when: "selectedItemId startsWith 'row'" }),
      ]),
      recentKeys: [],
    });
    expect(registry.suggestedFor(selected).map((entry) => entry.id)).toEqual([
      'not',
      'or',
      'in-list',
      'starts-with',
    ]);
  });

  it('suggests nothing from an extension that is not in the foreground, because there is none', () => {
    const registry = createCommandRegistry({
      hostCommands: [hostCommand({ id: 'host-one', category: 'select' })],
      extension: null,
      recentKeys: [],
    });
    expect(
      registry.suggestedFor(
        contextOf({ selectedItemIds: Object.freeze(['row-1']), selectedItemId: 'row-1' }),
      ),
    ).toEqual([]);
  });
});

describe('CommandRegistry — execution', () => {
  it('hands onExecute the same context the predicate saw, and the extension shell', () => {
    const seen: RibbonContext[] = [];
    const executed: [RibbonContext, IShellAPI][] = [];
    const api = shell();
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: {
        extensionId: 'sample-ext',
        shell: api,
        commands: [
          command({
            id: 'act-one',
            isVisible: (ctx: RibbonContext) => {
              seen.push(ctx);
              return true;
            },
            onExecute: (ctx: RibbonContext, handle: IShellAPI) => {
              executed.push([ctx, handle]);
            },
          }),
        ],
      },
      recentKeys: [],
    });
    registry.listForSurface('palette', CONTEXT)[0]?.run();
    // A predicate and its handler cannot see two different worlds.
    expect(seen[0]).toBe(CONTEXT);
    expect(executed[0]?.[0]).toBe(CONTEXT);
    expect(executed[0]?.[1]).toBe(api);
  });

  it('contains a handler that throws, so a surface calling run() is never unwound', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = createCommandRegistry({
      hostCommands: [],
      extension: extensionOf([
        command({
          id: 'detonates',
          onExecute: () => {
            throw new Error('handler refused');
          },
        }),
      ]),
      recentKeys: [],
    });
    expect(() => {
      registry.listForSurface('palette', CONTEXT)[0]?.run();
    }).not.toThrow();
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
  });
});
