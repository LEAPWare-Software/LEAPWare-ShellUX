import { describe, expect, it } from 'vitest';
import { ShellUXError } from '../../types';
import type { Command, LEAPExtensionBlueprint, NavigationNode } from '../../types';
import { assertSerializable, splitBlueprint } from '../manifest';

/**
 * Property 4: the blueprint splits at the process boundary, an extension author
 * still writes one object, and a React component reference cannot cross.
 */

const PaneTwo = (): null => null;
const PaneThree = (): null => null;

function command(overrides: Partial<Command> = {}): Command {
  return {
    id: 'reply',
    label: 'Reply',
    icon: 'arrow-left',
    when: 'selectedItemId != null',
    category: 'edit',
    surfaces: ['context-bar', 'palette'],
    priority: 10,
    hotkey: { key: 'r', ctrl: true },
    isVisible: (): boolean => true,
    onExecute: (): void => undefined,
    ...overrides,
  };
}

function blueprint(overrides: Partial<LEAPExtensionBlueprint> = {}): LEAPExtensionBlueprint {
  const commands = overrides.commands ?? [command()];
  return {
    id: 'mail',
    name: 'Mail',
    version: '1.0.0',
    navigationTree: [{ id: 'inbox', label: 'Inbox', badgeCount: 2 }],
    commands,
    ribbonActions: commands,
    views: { pane2: PaneTwo, pane3: PaneThree },
    ...overrides,
  };
}

describe('manifest — what crosses', () => {
  it('carries identity, the navigation tree and every serializable command field', () => {
    const { manifest } = splitBlueprint(blueprint());

    expect(manifest).toEqual({
      id: 'mail',
      name: 'Mail',
      version: '1.0.0',
      navigationTree: [{ id: 'inbox', label: 'Inbox', badgeCount: 2 }],
      commands: [
        {
          id: 'reply',
          label: 'Reply',
          icon: 'arrow-left',
          when: 'selectedItemId != null',
          category: 'edit',
          surfaces: ['context-bar', 'palette'],
          priority: 10,
          hotkey: { key: 'r', ctrl: true },
        },
      ],
    });
  });

  it('leaves the two functions and the host-derived parse tree behind', () => {
    const withTree = command({
      whenExpression: { source: 'x', root: { kind: 'literal', value: true } } as never,
    });
    const { manifest } = splitBlueprint(blueprint({ commands: [withTree], ribbonActions: [withTree] }));
    const entry = manifest.commands[0] as unknown as Record<string, unknown>;

    // Absent by CONSTRUCTION — the entry was built from a fixed list, not
    // filtered from the command.
    expect(Object.hasOwn(entry, 'isVisible')).toBe(false);
    expect(Object.hasOwn(entry, 'onExecute')).toBe(false);
    // `whenExpression` would have cloned perfectly well. Main re-parses `when`
    // instead, so the tree it evaluates is one it derived.
    expect(Object.hasOwn(entry, 'whenExpression')).toBe(false);
    expect(entry.when).toBe('selectedItemId != null');
  });

  it('really does survive a structured clone, which the blueprint does not', () => {
    const source = blueprint();
    const { manifest } = splitBlueprint(source);

    expect(structuredClone(manifest)).toEqual(manifest);
    expect(() => structuredClone(source)).toThrow();
  });
});

describe('manifest — what stays in the pane', () => {
  it('keeps both views and every handler, reachable by command id', () => {
    const source = blueprint();
    const { paneLocal } = splitBlueprint(source);

    expect(paneLocal.id).toBe('mail');
    expect(paneLocal.views.pane2).toBe(PaneTwo);
    expect(paneLocal.views.pane3).toBe(PaneThree);
    // `onExecute` is invoked BY ID from main, fire-and-forget. This is the table
    // that turns an id back into the closure.
    expect(paneLocal.handlers.get('reply')?.onExecute).toBe(source.commands[0]?.onExecute);
  });

  it('freezes both halves as objects', () => {
    const { manifest, paneLocal } = splitBlueprint(blueprint());
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.commands[0])).toBe(true);
    expect(Object.isFrozen(paneLocal)).toBe(true);
    // And the honest half: a `Map`'s entries are not own properties, so the
    // freeze does not seal them. Stated rather than claimed away.
    expect(() => paneLocal.handlers.get('reply')).not.toThrow();
  });
});

describe('manifest — a component reference cannot cross', () => {
  it('refuses a component reference smuggled onto a navigation node, and names where it was', () => {
    const smuggled = {
      id: 'inbox',
      label: 'Inbox',
      render: PaneTwo,
    } as unknown as NavigationNode;

    let raised: ShellUXError | null = null;
    try {
      splitBlueprint(blueprint({ navigationTree: [smuggled] }));
    } catch (error) {
      raised = error as ShellUXError;
    }

    expect(raised).toBeInstanceOf(ShellUXError);
    expect(raised?.code).toBe('INVALID_FIELD');
    // The path is the point: a `DataCloneError` from inside a port callback
    // names nothing at all.
    expect(raised?.field).toBe('manifest.navigationTree[0].render');
  });

  it('the transport would have refused it too, with nothing useful to say', () => {
    const smuggled = { id: 'inbox', label: 'Inbox', render: PaneTwo };
    let transportError: Error | null = null;
    try {
      structuredClone({ navigationTree: [smuggled] });
    } catch (error) {
      transportError = error as Error;
    }

    expect(transportError).not.toBeNull();
    // No field, no path, no command id. Declared-not-exempted: the seam refuses
    // it first, at the layer that can report usefully.
    expect(transportError?.message ?? '').not.toContain('navigationTree');
  });

  it('refuses a symbol, which clones no better than a function does', () => {
    const smuggled = { id: 'inbox', label: 'Inbox', tag: Symbol('x') } as unknown as NavigationNode;
    expect(() => splitBlueprint(blueprint({ navigationTree: [smuggled] }))).toThrow(
      /type "symbol"/u,
    );
  });

  it('refuses a cycle rather than truncating it', () => {
    const node: Record<string, unknown> = { id: 'inbox', label: 'Inbox' };
    node.children = [node];

    expect(() =>
      splitBlueprint(blueprint({ navigationTree: [node as unknown as NavigationNode] })),
    ).toThrow(/closes a cycle/u);
  });
});

describe('assertSerializable — the walk itself', () => {
  it('passes every leaf a payload may hold', () => {
    expect(() => {
      assertSerializable(
        { a: 'text', b: 1, c: true, d: null, e: undefined, f: [1, 'two', false] },
        'value',
      );
    }).not.toThrow();
  });

  it('does not mistake a value that appears twice for a cycle', () => {
    const shared = Object.freeze(['context-bar']);
    expect(() => {
      assertSerializable({ first: shared, second: shared }, 'value');
    }).not.toThrow();
  });
});
