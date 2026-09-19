import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ExtensionRegistryProvider,
  REGISTRY_LIMITS,
  useRegistry,
  useRegistryRevision,
} from '../RegistryContext';
import type { ExtensionRegistry, RegistrationResult } from '../RegistryContext';
import { SHELL_UX_ERROR_CODES, ShellUXError } from '../types';
import type { LEAPExtensionBlueprint, RibbonContext } from '../types';
import {
  Pane2View,
  Pane3View,
  makeAction,
  makeBlueprint,
  makeExplodingPayload,
  makeManyActions,
  makeShiftingLengthArray,
  makeWideTree,
} from './fixtures';

/**
 * Trust-boundary normalisation regression suite.
 *
 * Every test here fails against a registry that stores the caller's live
 * object. They cover two things point-fixes kept missing:
 *
 *   1. A bound is only a bound if it constrains what was STORED. A Proxy can
 *      report an honest `length` while it is being measured and a larger one
 *      afterwards, so a check against a re-readable number checks nothing.
 *   2. A validated object that the plugin can still reach is a validated
 *      object the plugin can still edit. Registration has to end with a
 *      host-owned record.
 *
 * Plus the error channel: `register` must never hand back a `ShellUXError`
 * that came out of plugin code, because a plugin can obtain a real one, rewrite
 * its `code` and arm its `message` getter.
 */

interface Probe {
  readonly registry: ExtensionRegistry;
  readonly revision: number;
}

function Wrapper({
  children,
  runsPluginCode = false,
}: {
  children: ReactNode;
  runsPluginCode?: boolean;
}): ReactElement {
  return (
    <ExtensionRegistryProvider runsPluginCode={runsPluginCode}>
      {children}
    </ExtensionRegistryProvider>
  );
}

function setup(options: { runsPluginCode?: boolean } = {}): { current: Probe } {
  const { runsPluginCode = false } = options;
  return renderHook(
    (): Probe => ({ registry: useRegistry(), revision: useRegistryRevision() }),
    { wrapper: (props) => <Wrapper {...props} runsPluginCode={runsPluginCode} /> },
  ).result;
}

function callRegister(probe: { current: Probe }, payload: unknown): RegistrationResult {
  let out!: RegistrationResult;
  act(() => {
    out = probe.current.registry.register(payload);
  });
  return out;
}

function expectFailure(outcome: RegistrationResult): ShellUXError {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error('expected a failed registration');
  }
  expect(outcome.error).toBeInstanceOf(ShellUXError);
  return outcome.error;
}

/** Register `payload`, assert success, and return the stored record. */
function registerAndRead(
  probe: { current: Probe },
  payload: unknown,
  id = 'sample-ext',
): LEAPExtensionBlueprint {
  expect(callRegister(probe, payload).ok).toBe(true);
  const stored = probe.current.registry.getExtension(id);
  expect(stored).toBeDefined();
  return stored as LEAPExtensionBlueprint;
}

/* -------------------------------------------------------------------------- */
/* NEW-E — the bound applies to what is stored                                 */
/* -------------------------------------------------------------------------- */

describe('register — a lying `length` cannot grow the payload after it is measured', () => {
  it('stores exactly the ribbon actions it bounds-checked, and nothing past them', () => {
    const probe = setup();
    // 200 real, individually valid actions behind a Proxy that reports 2 while
    // the host measures it and 1000 on every read afterwards. Against a
    // registry that stored the Proxy, `stored.ribbonActions.length` would read
    // 1000 and indices 2..199 would be live, unvalidated-in-context entries.
    const ribbonActions = makeShiftingLengthArray(makeManyActions(200), [2, 1000]);

    const stored = registerAndRead(probe, makeBlueprint({ ribbonActions }));

    expect(stored.ribbonActions).toHaveLength(2);
    expect(stored.ribbonActions.map((action) => action.id)).toEqual(['act-0', 'act-1']);
    expect(stored.ribbonActions[2]).toBeUndefined();
    expect(stored.ribbonActions[999]).toBeUndefined();
    // The stored array is a fresh host-owned array, not the Proxy.
    expect(stored.ribbonActions).not.toBe(ribbonActions);
    expect(Array.isArray(stored.ribbonActions)).toBe(true);
  });

  it('applies MAX_RIBBON_ACTIONS to the stored count, not to a revocable one', () => {
    const probe = setup();
    const ribbonActions = makeShiftingLengthArray(makeManyActions(1000), [
      REGISTRY_LIMITS.MAX_RIBBON_ACTIONS,
      1000,
    ]);

    const stored = registerAndRead(probe, makeBlueprint({ ribbonActions }));

    expect(stored.ribbonActions).toHaveLength(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS);
  });

  it('still rejects an honest overrun of MAX_RIBBON_ACTIONS', () => {
    const probe = setup();
    const ribbonActions = makeManyActions(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS + 1);
    const error = expectFailure(callRegister(probe, makeBlueprint({ ribbonActions })));
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.field).toBe('ribbonActions');
  });

  it('stores exactly the navigation nodes it walked', () => {
    const probe = setup();
    const navigationTree = makeShiftingLengthArray(makeWideTree(1000), [3, 1000]);

    const stored = registerAndRead(probe, makeBlueprint({ navigationTree }));

    expect(stored.navigationTree).toHaveLength(3);
    expect(stored.navigationTree.map((node) => node.id)).toEqual(['node-0', 'node-1', 'node-2']);
    expect(stored.navigationTree[3]).toBeUndefined();
  });

  it('stores exactly the children it walked', () => {
    const probe = setup();
    const children = makeShiftingLengthArray(
      [
        { id: 'child-a', label: 'A' },
        { id: 'child-b', label: 'B' },
        { id: 'child-c', label: 'C' },
      ],
      [1, 3],
    );
    const stored = registerAndRead(
      probe,
      makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'Root', children }] }),
    );

    expect(stored.navigationTree[0]?.children).toHaveLength(1);
    expect(stored.navigationTree[0]?.children?.[0]?.id).toBe('child-a');
  });

  it('never lets an unvalidated element past the recorded count reach the store', () => {
    const probe = setup();
    // The smuggled entry carries a reserved id. It sits at index 1, past the
    // count the host measured, so it must never be normalised or stored.
    const smuggled = {
      id: '__proto__',
      label: 'Smuggled',
      icon: 'bad',
      isVisible: (): boolean => true,
      onExecute: (): void => undefined,
    };
    const legit = {
      id: 'act-one',
      label: 'Act One',
      icon: 'save',
      isVisible: (): boolean => true,
      onExecute: (): void => undefined,
    };
    const ribbonActions = makeShiftingLengthArray([legit, smuggled], [1, 2]);

    const stored = registerAndRead(probe, makeBlueprint({ ribbonActions }));

    expect(stored.ribbonActions).toHaveLength(1);
    expect(stored.ribbonActions.some((action) => action.id === '__proto__')).toBe(false);
    expect(Object.prototype).not.toHaveProperty('label');
  });
});

/* -------------------------------------------------------------------------- */
/* NEW-E — the stored record is host-owned and frozen                          */
/* -------------------------------------------------------------------------- */

describe('register — the stored record is host-owned', () => {
  it('is frozen at every host-owned level', () => {
    const probe = setup();
    const stored = registerAndRead(probe, makeBlueprint());

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.navigationTree)).toBe(true);
    for (const node of stored.navigationTree) {
      expect(Object.isFrozen(node)).toBe(true);
      if (node.children !== undefined) {
        expect(Object.isFrozen(node.children)).toBe(true);
        for (const child of node.children) {
          expect(Object.isFrozen(child)).toBe(true);
        }
      }
    }
    expect(Object.isFrozen(stored.ribbonActions)).toBe(true);
    for (const action of stored.ribbonActions) {
      expect(Object.isFrozen(action)).toBe(true);
    }
    expect(Object.isFrozen(stored.views)).toBe(true);
  });

  it('refuses mutation of the stored record under strict mode', () => {
    const probe = setup();
    const stored = registerAndRead(probe, makeBlueprint());

    expect(() => {
      (stored as unknown as Record<string, unknown>)['name'] = 'hijacked';
    }).toThrow(TypeError);
    expect(() => {
      (stored.ribbonActions as unknown as Record<string, unknown>)['0'] = null;
    }).toThrow(TypeError);
    expect(() => {
      (stored.navigationTree[0] as unknown as Record<string, unknown>)['label'] = 'hijacked';
    }).toThrow(TypeError);
    expect(() => Object.setPrototypeOf(stored, { evil: true })).toThrow(TypeError);
  });

  it('is unaffected by the plugin mutating its own blueprint afterwards', () => {
    const probe = setup();
    const blueprint = makeBlueprint();
    const stored = registerAndRead(probe, blueprint);
    const loose = blueprint as Record<string, unknown>;

    // Everything a plugin could do to the object it still holds.
    loose['name'] = 'Renamed After The Fact';
    loose['version'] = '9.9.9';
    loose['views'] = null;
    (loose['ribbonActions'] as Record<string, unknown>[])[0]!['icon'] = 'javascript:alert(1)';
    (loose['ribbonActions'] as Record<string, unknown>[]).push({ id: 'late', label: 'Late' });
    (loose['navigationTree'] as Record<string, unknown>[])[0]!['label'] = '<img src=x>';
    (loose['navigationTree'] as Record<string, unknown>[]).push({ id: 'late', label: 'Late' });

    expect(stored.name).toBe('Sample Extension');
    expect(stored.version).toBe('1.0.0');
    expect(stored.views).not.toBeNull();
    expect(stored.views.pane2).toBe(Pane2View);
    expect(stored.ribbonActions).toHaveLength(2);
    expect(stored.ribbonActions[0]?.icon).toBe('save');
    expect(stored.navigationTree).toHaveLength(2);
    expect(stored.navigationTree[0]?.label).toBe('Root A');

    // And a fresh read agrees — the store was not holding the mutated object.
    const reread = probe.current.registry.getExtension('sample-ext');
    expect(reread).toBe(stored);
    expect(reread?.name).toBe('Sample Extension');
    expect(probe.current.registry.listExtensions()[0]).toBe(stored);
  });

  it('cannot be re-pointed by a getter that changes what it returns', () => {
    const probe = setup();
    const payload = makeBlueprint();
    let reads = 0;
    Object.defineProperty(payload, 'name', {
      enumerable: true,
      configurable: true,
      get(): string {
        reads += 1;
        return reads === 1 ? 'Honest Name' : 'Substituted Name';
      },
    });

    const stored = registerAndRead(probe, payload);

    expect(stored.name).toBe('Honest Name');
    expect(stored.name).toBe('Honest Name');
    // One read at registration and no others: the record holds a primitive.
    expect(reads).toBe(1);
  });

  it('carries functions and components across by reference, unfrozen and callable', () => {
    const probe = setup();
    const isVisible = (): boolean => true;
    const onExecute = (): void => undefined;
    const ribbonActions = [{ id: 'act-one', label: 'A', icon: 'i', isVisible, onExecute }];

    const stored = registerAndRead(
      probe,
      makeBlueprint({ ribbonActions, views: { pane2: Pane2View, pane3: Pane3View } }),
    );

    // Identity is preserved — a clone would break closures and remount panes.
    expect(stored.ribbonActions[0]?.isVisible).toBe(isVisible);
    expect(stored.ribbonActions[0]?.onExecute).toBe(onExecute);
    expect(stored.views.pane2).toBe(Pane2View);
    expect(stored.views.pane3).toBe(Pane3View);

    // Still callable.
    const context: RibbonContext = {
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemIds: [],
      selectedItemId: null,
      contextKeys: {},
    };
    expect(stored.ribbonActions[0]?.isVisible(context)).toBe(true);

    // Deliberately NOT frozen: they belong to the plugin, and freezing another
    // party's component object breaks memo/forwardRef internals.
    expect(Object.isFrozen(isVisible)).toBe(false);
    expect(Object.isFrozen(Pane2View)).toBe(false);
  });

  it('copies optional fields faithfully and omits absent ones', () => {
    const probe = setup();
    const stored = registerAndRead(probe, makeBlueprint());

    expect(stored.navigationTree[0]?.badgeCount).toBe(3);
    expect(stored.navigationTree[1]).not.toHaveProperty('badgeCount');
    expect(stored.navigationTree[1]).not.toHaveProperty('children');
    expect(stored.ribbonActions[0]?.isDisabled).toBe(false);
    expect(stored.ribbonActions[1]).not.toHaveProperty('isDisabled');
  });

  it('keeps StrictMode idempotency keyed on the plugin object, not on the copy', () => {
    const probe = setup();
    const blueprint = makeBlueprint();

    expect(callRegister(probe, blueprint)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: false,
    });
    const first = probe.current.registry.getExtension('sample-ext');

    // Same object again: idempotent no-op, and the ORIGINAL record survives.
    expect(callRegister(probe, blueprint)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: true,
    });
    expect(probe.current.registry.getExtension('sample-ext')).toBe(first);
    expect(probe.current.revision).toBe(1);

    // A structurally identical but DIFFERENT object is still a collision.
    expect(expectFailure(callRegister(probe, makeBlueprint())).code).toBe('DUPLICATE_ID');
  });

  /* ------------------------------------------------------------------------ */
  /* Hotkeys get the same treatment as every other validated field            */
  /* ------------------------------------------------------------------------ */

  /** The sample blueprint with one hotkey-bearing action, sharing `hotkey`. */
  function blueprintWithHotkey(hotkey: Record<string, unknown>): Record<string, unknown> {
    return makeBlueprint({ ribbonActions: [makeAction({ hotkey })] });
  }

  it('freezes the stored hotkey', () => {
    const probe = setup();
    const stored = registerAndRead(probe, blueprintWithHotkey({ key: 'k', ctrl: true }));
    const hotkey = stored.ribbonActions[0]?.hotkey;

    expect(hotkey).toBeDefined();
    expect(Object.isFrozen(hotkey)).toBe(true);
    expect(() => {
      (hotkey as unknown as Record<string, unknown>)['key'] = 'tab';
    }).toThrow(TypeError);
    expect(() => {
      (hotkey as unknown as Record<string, unknown>)['ctrl'] = false;
    }).toThrow(TypeError);
    expect(() => Object.setPrototypeOf(hotkey as object, { evil: true })).toThrow(TypeError);
    expect(hotkey?.key).toBe('k');
  });

  it('materialises all four modifiers, so the canonical token has no undefined branch', () => {
    const probe = setup();
    const stored = registerAndRead(probe, blueprintWithHotkey({ key: 'k', alt: true }));

    expect(stored.ribbonActions[0]?.hotkey).toEqual({
      key: 'k',
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    });
  });

  it('is unaffected by the plugin mutating its own hotkey afterwards', () => {
    const probe = setup();
    // The plugin keeps a live handle on the very object it declared the chord
    // with. Against a registry that stored it, every edit below would land.
    const hotkey: Record<string, unknown> = { key: 'k', ctrl: true };
    const blueprint = blueprintWithHotkey(hotkey);
    const stored = registerAndRead(probe, blueprint);

    hotkey['key'] = 'tab';
    hotkey['ctrl'] = false;
    hotkey['shift'] = true;
    hotkey['meta'] = 'not-even-a-boolean';

    expect(stored.ribbonActions[0]?.hotkey).toEqual({
      key: 'k',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    });
    // And the stored chord is not the plugin's object in the first place.
    expect(stored.ribbonActions[0]?.hotkey).not.toBe(hotkey);
    expect(probe.current.registry.getExtension('sample-ext')).toBe(stored);
  });

  it('omits hotkey entirely from an action that declared none', () => {
    const probe = setup();
    const stored = registerAndRead(probe, makeBlueprint());
    expect(stored.ribbonActions[0]).not.toHaveProperty('hotkey');
    expect(stored.ribbonActions[1]).not.toHaveProperty('hotkey');
  });

  it('reports a duplicate chord through register rather than by throwing', () => {
    const probe = setup();
    const error = expectFailure(
      callRegister(
        probe,
        makeBlueprint({
          ribbonActions: [
            makeAction({ id: 'act-one', hotkey: { key: 'k', ctrl: true } }),
            makeAction({ id: 'act-two', hotkey: { key: 'k', ctrl: true } }),
          ],
        }),
      ),
    );
    expect(error.code).toBe('DUPLICATE_HOTKEY');
    expect(error.field).toBe('ribbonActions[1].hotkey');
    expect(SHELL_UX_ERROR_CODES.has(error.code)).toBe(true);
    expect(probe.current.registry.getExtension('sample-ext')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* NEW-D — the returned error is always host-owned                             */
/* -------------------------------------------------------------------------- */

describe('register — a weaponised ShellUXError cannot be relocated into the host', () => {
  /** Obtain a genuine, host-constructed `ShellUXError`, exactly as a plugin can. */
  function harvestRealError(probe: { current: Probe }): ShellUXError {
    const harvested = expectFailure(callRegister(probe, null));
    expect(harvested).toBeInstanceOf(ShellUXError);
    return harvested;
  }

  it('confirms a plugin really can obtain and rewrite a real ShellUXError', () => {
    const probe = setup();
    const harvested = harvestRealError(probe);
    Object.defineProperty(harvested, 'code', { value: 'ATTACKER_CHOSEN', configurable: true });
    // The premise of the attack: `code` is writable at runtime despite being
    // `readonly` in the type. If this ever stops holding the tests below are
    // testing nothing, so it is asserted rather than assumed.
    expect((harvested as { code: string }).code).toBe('ATTACKER_CHOSEN');
    expect(SHELL_UX_ERROR_CODES.has('ATTACKER_CHOSEN')).toBe(false);
  });

  it('rejects an attacker-chosen code and defuses a detonating message getter', () => {
    const probe = setup();
    const weapon = harvestRealError(probe);
    let messageReads = 0;
    Object.defineProperty(weapon, 'code', { value: 'ATTACKER_CHOSEN', configurable: true });
    Object.defineProperty(weapon, 'message', {
      configurable: true,
      get(): never {
        messageReads += 1;
        throw new Error('message detonated inside the host');
      },
    });

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, makeExplodingPayload(weapon));
    }).not.toThrow();
    const error = expectFailure(outcome);

    // Host-owned: a different object entirely.
    // Object.is rather than .not.toBe: a failing `.toBe` runs a deep-equality
    // pass to build its diff, and that pass would read the weapon's message.
    expect(Object.is(error, weapon)).toBe(false);
    // Reading it does not run plugin code and does not throw.
    const readsBefore = messageReads;
    expect(() => error.message).not.toThrow();
    expect(typeof error.message).toBe('string');
    expect(messageReads).toBe(readsBefore);
    // The code is one of the host's own.
    expect(SHELL_UX_ERROR_CODES.has(error.code)).toBe(true);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.field).toBeNull();
  });

  it('refuses an attacker-chosen code even when everything else is readable', () => {
    const probe = setup();
    const weapon = harvestRealError(probe);
    Object.defineProperty(weapon, 'code', { value: 'ATTACKER_CHOSEN', configurable: true });
    Object.defineProperty(weapon, 'field', { value: 'id', configurable: true });

    const error = expectFailure(callRegister(probe, makeExplodingPayload(weapon)));

    // Object.is rather than .not.toBe: a failing `.toBe` runs a deep-equality
    // pass to build its diff, and that pass would read the weapon's message.
    expect(Object.is(error, weapon)).toBe(false);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('failed inspection');
  });

  it('refuses a non-string code', () => {
    const probe = setup();
    const weapon = harvestRealError(probe);
    Object.defineProperty(weapon, 'code', { value: 42, configurable: true });

    const error = expectFailure(callRegister(probe, makeExplodingPayload(weapon)));

    // Object.is rather than .not.toBe: a failing `.toBe` runs a deep-equality
    // pass to build its diff, and that pass would read the weapon's message.
    expect(Object.is(error, weapon)).toBe(false);
    expect(SHELL_UX_ERROR_CODES.has(error.code)).toBe(true);
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('refuses a non-string message even under a legitimate code', () => {
    const probe = setup();
    const weapon = harvestRealError(probe);
    Object.defineProperty(weapon, 'code', { value: 'DUPLICATE_ID', configurable: true });
    Object.defineProperty(weapon, 'message', { value: 42, configurable: true });

    const error = expectFailure(callRegister(probe, makeExplodingPayload(weapon)));

    // Object.is rather than .not.toBe: a failing `.toBe` runs a deep-equality
    // pass to build its diff, and that pass would read the weapon's message.
    expect(Object.is(error, weapon)).toBe(false);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(typeof error.message).toBe('string');
  });

  it('refuses a non-string field while keeping a legitimate code and message', () => {
    const probe = setup();
    const weapon = harvestRealError(probe);
    Object.defineProperty(weapon, 'code', { value: 'PAYLOAD_TOO_LARGE', configurable: true });
    Object.defineProperty(weapon, 'message', { value: 'a plain string', configurable: true });
    Object.defineProperty(weapon, 'field', {
      configurable: true,
      value: {
        toString(): never {
          throw new Error('field stringification refused');
        },
      },
    });

    const error = expectFailure(callRegister(probe, makeExplodingPayload(weapon)));

    // Object.is rather than .not.toBe: a failing `.toBe` runs a deep-equality
    // pass to build its diff, and that pass would read the weapon's message.
    expect(Object.is(error, weapon)).toBe(false);
    // The code and message survive because both passed their own checks; the
    // hostile `field` is dropped rather than carried.
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.message).toBe('a plain string');
    expect(error.field).toBeNull();
  });

  it('always returns a fresh instance, even for an entirely honest error', () => {
    const probe = setup();
    const honest = new ShellUXError('MISSING_FIELD', 'a perfectly normal rejection', 'views');

    const error = expectFailure(callRegister(probe, makeExplodingPayload(honest)));

    expect(Object.is(error, honest)).toBe(false);
    expect(error).toBeInstanceOf(ShellUXError);
    expect(error.code).toBe('MISSING_FIELD');
    expect(error.message).toBe('a perfectly normal rejection');
    expect(error.field).toBe('views');
  });

  it('leaves the registry untouched after every weaponised rejection', () => {
    const probe = setup();
    expect(probe.current.registry.listExtensions()).toEqual([]);
    expect(probe.current.revision).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* ISSUE-183 — lifecycle-hook ownership: `runsPluginCode` at the registry door */
/* -------------------------------------------------------------------------- */

describe('register — lifecycle hooks belong to a registry that declares it runs plugin code', () => {
  it('refuses a blueprint declaring lifecycle hooks in a registry that does not run plugin code, and names the field', () => {
    const probe = setup();

    const outcome = callRegister(
      probe,
      makeBlueprint({ lifecycle: { onRelease: () => undefined } }),
    );

    const error = expectFailure(outcome);
    expect(error.field).toBe('lifecycle');
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });
});
