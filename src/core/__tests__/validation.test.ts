import { describe, expect, it } from 'vitest';
import { REGISTRY_LIMITS, validateBlueprint } from '../RegistryContext';
import { ShellUXError } from '../types';
import type { ShellUXErrorCode } from '../types';
import {
  Pane2View,
  Pane3View,
  makeBlueprint,
  makeDeepTree,
  makeExplodingPayload,
  makeManyActions,
  makeRevokedProxy,
  makeWideTree,
} from './fixtures';

/** Assert that validation rejects `payload` with a specific code and field. */
function expectRejection(
  payload: unknown,
  code: ShellUXErrorCode,
  field: string | null,
): ShellUXError {
  let caught: unknown;
  try {
    validateBlueprint(payload);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  const error = caught as ShellUXError;
  expect(error.code).toBe(code);
  expect(error.field).toBe(field);
  expect(error.name).toBe('ShellUXError');
  return error;
}

describe('validateBlueprint — payload shape', () => {
  // ---- DELIBERATE CONTRACT CHANGE -----------------------------------------
  // This test previously asserted `expect(validated).toBe(payload)` — that
  // validation handed back the caller's own object. That is exactly the defect
  // that made every bounds check and every field check revocable: the plugin
  // kept a live, mutable handle on the thing the host had just approved. The
  // contract is now the opposite, and this test asserts the opposite.
  it('accepts a well-formed blueprint and returns a host-owned normalised copy', () => {
    const payload = makeBlueprint();
    const validated = validateBlueprint(payload);
    expect(validated).not.toBe(payload);
    expect(validated.id).toBe('sample-ext');
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not-a-blueprint'],
    ['a number', 42],
    ['a boolean', true],
    ['an array', [{ id: 'x' }]],
  ])('rejects %s as a payload', (_label, payload) => {
    expectRejection(payload, 'INVALID_PAYLOAD', null);
  });

  it('names the received type in the payload rejection message', () => {
    expect(expectRejection(null, 'INVALID_PAYLOAD', null).message).toContain('null');
    expect(expectRejection([], 'INVALID_PAYLOAD', null).message).toContain('an array');
    expect(expectRejection('x', 'INVALID_PAYLOAD', null).message).toContain('"string"');
  });
});

describe('validateBlueprint — required fields', () => {
  it.each(['id', 'name', 'version', 'navigationTree', 'ribbonActions', 'views'])(
    'rejects a blueprint missing "%s" and names the field',
    (field) => {
      const payload = makeBlueprint();
      delete payload[field];
      const error = expectRejection(payload, 'MISSING_FIELD', field);
      expect(error.message).toContain(`"${field}"`);
    },
  );

  it.each(['pane2', 'pane3'])('rejects views missing "%s"', (pane) => {
    const views: Record<string, unknown> = { pane2: Pane2View, pane3: Pane3View };
    delete views[pane];
    expectRejection(makeBlueprint({ views }), 'MISSING_FIELD', `views.${pane}`);
  });

  it.each(['id', 'label'])('rejects a navigation node missing "%s"', (field) => {
    const node: Record<string, unknown> = { id: 'root-a', label: 'Root A' };
    delete node[field];
    expectRejection(
      makeBlueprint({ navigationTree: [node] }),
      'MISSING_FIELD',
      `navigationTree[0].${field}`,
    );
  });

  it.each(['id', 'label', 'icon', 'isVisible', 'onExecute'])(
    'rejects a ribbon action missing "%s"',
    (field) => {
      const action: Record<string, unknown> = {
        id: 'act-one',
        label: 'Act One',
        icon: 'save',
        isVisible: () => true,
        onExecute: () => undefined,
      };
      delete action[field];
      expectRejection(
        makeBlueprint({ ribbonActions: [action] }),
        'MISSING_FIELD',
        `ribbonActions[0].${field}`,
      );
    },
  );
});

describe('validateBlueprint — identifier hardening', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the prototype-pollution identifier "%s" as RESERVED_ID',
    (id) => {
      // Assigned through defineProperty so that `__proto__` becomes a real own
      // data property rather than invoking the Object.prototype setter.
      const payload = makeBlueprint();
      Object.defineProperty(payload, 'id', { value: id, enumerable: true, writable: true });
      expectRejection(payload, 'RESERVED_ID', 'id');
    },
  );

  it('leaves Object.prototype untouched after a __proto__ registration attempt', () => {
    const payload = makeBlueprint();
    Object.defineProperty(payload, 'id', { value: '__proto__', enumerable: true, writable: true });
    expectRejection(payload, 'RESERVED_ID', 'id');
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it.each([
    ['a path traversal', '../../etc/passwd'],
    ['a windows path', 'plugins\\evil'],
    ['a forward slash', 'org/plugin'],
    ['markup', '<script>alert(1)</script>'],
    ['a url scheme', 'javascript:alert(1)'],
    ['uppercase', 'SampleExt'],
    ['whitespace', 'sample ext'],
    ['a leading hyphen', '-sample'],
    ['a leading underscore', '_sample'],
    ['an empty string', ''],
    ['a null byte', ['sample','ext'].join(String.fromCharCode(0))],
    ['a newline', 'sample\next'],
    ['a dot', 'sample.ext'],
    ['65 characters', 'a'.repeat(65)],
  ])('rejects %s as an id', (_label, id) => {
    expectRejection(makeBlueprint({ id }), 'INVALID_ID', 'id');
  });

  it('accepts an id of exactly 64 characters', () => {
    const id = `a${'b'.repeat(63)}`;
    expect(id).toHaveLength(64);
    expect(validateBlueprint(makeBlueprint({ id })).id).toBe(id);
  });

  it.each([
    ['null', null],
    ['a number', 7],
    ['an array', []],
    ['an object', {}],
  ])('rejects %s as an id type', (_label, id) => {
    expectRejection(makeBlueprint({ id }), 'INVALID_FIELD', 'id');
  });

  it('applies the same allowlist to navigation node ids', () => {
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'Bad Node', label: 'x' }] }),
      'INVALID_ID',
      'navigationTree[0].id',
    );
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'constructor', label: 'x' }] }),
      'RESERVED_ID',
      'navigationTree[0].id',
    );
  });

  it('applies the same allowlist to ribbon action ids', () => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          {
            id: 'Bad Action',
            label: 'x',
            icon: 'i',
            isVisible: () => true,
            onExecute: () => undefined,
          },
        ],
      }),
      'INVALID_ID',
      'ribbonActions[0].id',
    );
  });

  it('rejects duplicate navigation node ids inside one tree', () => {
    expectRejection(
      makeBlueprint({
        navigationTree: [
          { id: 'root-a', label: 'A', children: [{ id: 'root-a', label: 'A again' }] },
        ],
      }),
      'DUPLICATE_ID',
      'navigationTree[0].children[0].id',
    );
  });

  it('rejects duplicate ribbon action ids inside one extension', () => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          {
            id: 'act-one',
            label: 'A',
            icon: 'i',
            isVisible: () => true,
            onExecute: () => undefined,
          },
          {
            id: 'act-one',
            label: 'B',
            icon: 'i',
            isVisible: () => true,
            onExecute: () => undefined,
          },
        ],
      }),
      'DUPLICATE_ID',
      'ribbonActions[1].id',
    );
  });
});

describe('validateBlueprint — text fields', () => {
  it.each(['name', 'version'])('rejects a non-string "%s"', (field) => {
    expectRejection(makeBlueprint({ [field]: 42 }), 'INVALID_FIELD', field);
  });

  it.each(['name', 'version'])('rejects a blank "%s"', (field) => {
    expectRejection(makeBlueprint({ [field]: '   \t\n ' }), 'INVALID_FIELD', field);
  });

  it('rejects an oversized name', () => {
    const name = 'n'.repeat(REGISTRY_LIMITS.MAX_TEXT_LENGTH + 1);
    expectRejection(makeBlueprint({ name }), 'PAYLOAD_TOO_LARGE', 'name');
  });

  it('accepts a name of exactly the maximum length', () => {
    const name = 'n'.repeat(REGISTRY_LIMITS.MAX_TEXT_LENGTH);
    expect(validateBlueprint(makeBlueprint({ name })).name).toBe(name);
  });

  it('rejects an oversized version', () => {
    const version = '9'.repeat(REGISTRY_LIMITS.MAX_VERSION_LENGTH + 1);
    expectRejection(makeBlueprint({ version }), 'PAYLOAD_TOO_LARGE', 'version');
  });

  it('rejects a non-string navigation label', () => {
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'root-a', label: 99 }] }),
      'INVALID_FIELD',
      'navigationTree[0].label',
    );
  });

  it('rejects an oversized ribbon action icon', () => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          {
            id: 'act-one',
            label: 'A',
            icon: 'i'.repeat(REGISTRY_LIMITS.MAX_TEXT_LENGTH + 1),
            isVisible: () => true,
            onExecute: () => undefined,
          },
        ],
      }),
      'PAYLOAD_TOO_LARGE',
      'ribbonActions[0].icon',
    );
  });

  it('stores markup in a label verbatim — escaping belongs at the render boundary', () => {
    const label = '<img src=x onerror=alert(1)>';
    const validated = validateBlueprint(
      makeBlueprint({ navigationTree: [{ id: 'root-a', label }] }),
    );
    expect(validated.navigationTree[0]?.label).toBe(label);
  });
});

describe('validateBlueprint — navigation tree', () => {
  it.each([
    ['a string', 'not-a-tree'],
    ['an object', { id: 'root-a' }],
    ['null', null],
  ])('rejects %s as navigationTree', (_label, navigationTree) => {
    expectRejection(makeBlueprint({ navigationTree }), 'INVALID_FIELD', 'navigationTree');
  });

  it('accepts an empty navigation tree', () => {
    expect(validateBlueprint(makeBlueprint({ navigationTree: [] })).navigationTree).toHaveLength(0);
  });

  it.each([
    ['a string', 'node'],
    ['null', null],
    ['an array', []],
  ])('rejects %s as a navigation node', (_label, node) => {
    expectRejection(makeBlueprint({ navigationTree: [node] }), 'INVALID_FIELD', 'navigationTree[0]');
  });

  it.each([
    ['a string', 'three'],
    ['a fraction', 1.5],
    ['a negative', -1],
    ['NaN', Number.NaN],
  ])('rejects %s as badgeCount', (_label, badgeCount) => {
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', badgeCount }] }),
      'INVALID_FIELD',
      'navigationTree[0].badgeCount',
    );
  });

  it('treats an explicitly undefined badgeCount as absent', () => {
    expect(() =>
      validateBlueprint(
        makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', badgeCount: undefined }] }),
      ),
    ).not.toThrow();
  });

  it('accepts a zero badgeCount', () => {
    expect(() =>
      validateBlueprint(
        makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', badgeCount: 0 }] }),
      ),
    ).not.toThrow();
  });

  it('rejects non-array children', () => {
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', children: 'nope' }] }),
      'INVALID_FIELD',
      'navigationTree[0].children',
    );
  });

  it('treats explicitly undefined children as absent', () => {
    expect(() =>
      validateBlueprint(
        makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', children: undefined }] }),
      ),
    ).not.toThrow();
  });

  it('accepts a tree at exactly the maximum depth', () => {
    const navigationTree = makeDeepTree(REGISTRY_LIMITS.MAX_NAV_DEPTH);
    expect(() => validateBlueprint(makeBlueprint({ navigationTree }))).not.toThrow();
  });

  it('rejects a tree one level deeper than the maximum', () => {
    const navigationTree = makeDeepTree(REGISTRY_LIMITS.MAX_NAV_DEPTH + 1);
    const path = `navigationTree[0]${'.children[0]'.repeat(REGISTRY_LIMITS.MAX_NAV_DEPTH)}`;
    expectRejection(makeBlueprint({ navigationTree }), 'PAYLOAD_TOO_LARGE', path);
  });

  it('accepts exactly the maximum number of navigation nodes', () => {
    const navigationTree = makeWideTree(REGISTRY_LIMITS.MAX_NAV_NODES);
    expect(() => validateBlueprint(makeBlueprint({ navigationTree }))).not.toThrow();
  });

  it('rejects one node beyond the maximum', () => {
    const navigationTree = makeWideTree(REGISTRY_LIMITS.MAX_NAV_NODES + 1);
    expectRejection(makeBlueprint({ navigationTree }), 'PAYLOAD_TOO_LARGE', 'navigationTree');
  });
});

describe('validateBlueprint — ribbon actions', () => {
  it('rejects a non-array ribbonActions', () => {
    expectRejection(makeBlueprint({ ribbonActions: {} }), 'INVALID_FIELD', 'ribbonActions');
  });

  it('rejects a non-object ribbon action', () => {
    expectRejection(makeBlueprint({ ribbonActions: [7] }), 'INVALID_FIELD', 'ribbonActions[0]');
  });

  it('rejects a non-boolean isDisabled', () => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          {
            id: 'act-one',
            label: 'A',
            icon: 'i',
            isDisabled: 'yes',
            isVisible: () => true,
            onExecute: () => undefined,
          },
        ],
      }),
      'INVALID_FIELD',
      'ribbonActions[0].isDisabled',
    );
  });

  it.each(['isVisible', 'onExecute'])('rejects a non-function "%s"', (field) => {
    const action: Record<string, unknown> = {
      id: 'act-one',
      label: 'A',
      icon: 'i',
      isVisible: () => true,
      onExecute: () => undefined,
    };
    action[field] = 'not-a-function';
    expectRejection(
      makeBlueprint({ ribbonActions: [action] }),
      'INVALID_FIELD',
      `ribbonActions[0].${field}`,
    );
  });

  it('accepts exactly the maximum number of ribbon actions', () => {
    const ribbonActions = makeManyActions(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS);
    expect(() => validateBlueprint(makeBlueprint({ ribbonActions }))).not.toThrow();
  });

  it('rejects one ribbon action beyond the maximum', () => {
    const ribbonActions = makeManyActions(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS + 1);
    expectRejection(makeBlueprint({ ribbonActions }), 'PAYLOAD_TOO_LARGE', 'ribbonActions');
  });
});

describe('validateBlueprint — views', () => {
  it.each([
    ['a string', 'views'],
    ['an array', []],
    ['null', null],
  ])('rejects %s as views', (_label, views) => {
    expectRejection(makeBlueprint({ views }), 'INVALID_FIELD', 'views');
  });

  it('accepts an object component such as React.memo output', () => {
    const memoLike = { $$typeof: Symbol.for('react.memo'), type: Pane2View };
    expect(() =>
      validateBlueprint(makeBlueprint({ views: { pane2: memoLike, pane3: Pane3View } })),
    ).not.toThrow();
  });

  it.each([
    ['null', null],
    ['a string', 'Pane'],
    ['a number', 1],
  ])('rejects %s as a pane view', (_label, pane2) => {
    expectRejection(
      makeBlueprint({ views: { pane2, pane3: Pane3View } }),
      'INVALID_FIELD',
      'views.pane2',
    );
  });

  it('rejects a malformed pane3 while pane2 is valid', () => {
    expectRejection(
      makeBlueprint({ views: { pane2: Pane2View, pane3: true } }),
      'INVALID_FIELD',
      'views.pane3',
    );
  });
});

/**
 * ============================================================================
 * A REVOKED PROXY IS REFUSED AS A ShellUXError, NOT AS A RAW TypeError
 * ============================================================================
 * `Array.isArray` is the only type predicate in the validator that can THROW
 * instead of answering: handed a revoked `Proxy` it raises a raw `TypeError`,
 * because every internal method on a revoked `Proxy` does. Five call sites
 * reached it with a value the validator had not yet classified — `isRecord`,
 * `describeType`, the `children` check in `normalizeNavigationNode`, and the
 * `navigationTree` and `ribbonActions` checks in `normalizeBlueprint` — and the
 * exported `validateBlueprint` has no `catch` of its own, so that `TypeError`
 * escaped to a caller that had been told to expect `ShellUXError`. A consumer
 * catching only `ShellUXError` crashed.
 *
 * `expectRejection` asserts `toBeInstanceOf(ShellUXError)`, and a raw
 * `TypeError` is not one, so every case here fails against an unguarded
 * `Array.isArray`. The table walks every field position that can steer a revoked
 * `Proxy` into one of the five sites, and the tests after it name the site each
 * group lands in — so guarding only some of the five leaves this suite red.
 *
 * `typeof` is not a guard against this. It answers `"object"` for a revoked
 * `Proxy` without trapping, which is why `id`, `name`, `version` and the
 * function/component fields reach `describeType` on their failure path with the
 * throw still ahead of them: `isRecord` is never consulted for them at all.
 * ============================================================================
 */
describe('validateBlueprint — a revoked Proxy', () => {
  /** A valid navigation node with one field replaced by a hostile value. */
  function nodeWith(overrides: Record<string, unknown>): Record<string, unknown> {
    return { id: 'root-a', label: 'Root A', ...overrides };
  }

  /** A valid ribbon action with one field replaced by a hostile value. */
  function actionWith(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'act-one',
      label: 'Act One',
      icon: 'save',
      isVisible: () => true,
      onExecute: () => undefined,
      ...overrides,
    };
  }

  it.each<[string, unknown, ShellUXErrorCode, string | null]>([
    // ---- reaches `isRecord` -------------------------------------------------
    ['the whole payload', makeRevokedProxy(), 'INVALID_PAYLOAD', null],
    [
      'a navigation node',
      makeBlueprint({ navigationTree: [makeRevokedProxy()] }),
      'INVALID_FIELD',
      'navigationTree[0]',
    ],
    [
      'a ribbon action',
      makeBlueprint({ ribbonActions: [makeRevokedProxy()] }),
      'INVALID_FIELD',
      'ribbonActions[0]',
    ],
    ['views', makeBlueprint({ views: makeRevokedProxy() }), 'INVALID_FIELD', 'views'],
    [
      'views.pane2',
      makeBlueprint({ views: { pane2: makeRevokedProxy(), pane3: Pane3View } }),
      'INVALID_FIELD',
      'views.pane2',
    ],
    [
      'views.pane3',
      makeBlueprint({ views: { pane2: Pane2View, pane3: makeRevokedProxy() } }),
      'INVALID_FIELD',
      'views.pane3',
    ],

    // ---- reaches `describeType` on a failed `typeof` check ------------------
    ['id', makeBlueprint({ id: makeRevokedProxy() }), 'INVALID_FIELD', 'id'],
    ['name', makeBlueprint({ name: makeRevokedProxy() }), 'INVALID_FIELD', 'name'],
    ['version', makeBlueprint({ version: makeRevokedProxy() }), 'INVALID_FIELD', 'version'],
    [
      'a navigation node id',
      makeBlueprint({ navigationTree: [nodeWith({ id: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'navigationTree[0].id',
    ],
    [
      'a navigation node label',
      makeBlueprint({ navigationTree: [nodeWith({ label: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'navigationTree[0].label',
    ],
    [
      'a ribbon action id',
      makeBlueprint({ ribbonActions: [actionWith({ id: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].id',
    ],
    [
      'a ribbon action label',
      makeBlueprint({ ribbonActions: [actionWith({ label: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].label',
    ],
    [
      'a ribbon action icon',
      makeBlueprint({ ribbonActions: [actionWith({ icon: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].icon',
    ],
    [
      'isVisible',
      makeBlueprint({ ribbonActions: [actionWith({ isVisible: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].isVisible',
    ],
    [
      'onExecute',
      makeBlueprint({ ribbonActions: [actionWith({ onExecute: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].onExecute',
    ],

    // ---- reaches an `Array.isArray` check directly --------------------------
    [
      'navigationTree',
      makeBlueprint({ navigationTree: makeRevokedProxy() }),
      'INVALID_FIELD',
      'navigationTree',
    ],
    [
      'children',
      makeBlueprint({ navigationTree: [nodeWith({ children: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'navigationTree[0].children',
    ],
    [
      'ribbonActions',
      makeBlueprint({ ribbonActions: makeRevokedProxy() }),
      'INVALID_FIELD',
      'ribbonActions',
    ],

    // ---- never reached an `Array.isArray` site, asserted anyway -------------
    // These two are refused by a `typeof` check whose message does not consult
    // `describeType`, so they were already `ShellUXError` before the guards
    // landed. Pinned so that a later edit cannot route them into one.
    [
      'badgeCount',
      makeBlueprint({ navigationTree: [nodeWith({ badgeCount: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'navigationTree[0].badgeCount',
    ],
    [
      'isDisabled',
      makeBlueprint({ ribbonActions: [actionWith({ isDisabled: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].isDisabled',
    ],
  ])('refuses %s as a ShellUXError', (_label, payload, code, field) => {
    expectRejection(payload, code, field);
  });

  it('names a revoked Proxy in the message rather than guessing its type', () => {
    // `typeof` a revoked Proxy is `"object"`, so the pre-guard fallback would
    // have described it as `a value of type "object"` had it ever got that far.
    // Naming it exactly is what tells a plugin author what was wrong.
    expect(expectRejection(makeRevokedProxy(), 'INVALID_PAYLOAD', null).message).toContain(
      'a revoked Proxy',
    );
    expect(
      expectRejection(makeBlueprint({ id: makeRevokedProxy() }), 'INVALID_FIELD', 'id').message,
    ).toContain('a revoked Proxy');
    expect(
      expectRejection(
        makeBlueprint({ navigationTree: makeRevokedProxy() }),
        'INVALID_FIELD',
        'navigationTree',
      ).message,
    ).toContain('a revoked Proxy');
  });

  it('still propagates whatever a throwing property getter threw', () => {
    // The one untyped escape the guards do NOT close, asserted rather than only
    // documented. Reading a field off the payload is a call into plugin code and
    // `validateBlueprint` has no catch, so this is NOT a ShellUXError — which is
    // exactly why the docblock tells callers of the export to guard the call.
    // `register` does catch: see "register — hostile payloads never crash the
    // host" in `registry.test.tsx`.
    const thrown = new Error('getter refused');
    let caught: unknown;
    try {
      validateBlueprint(makeExplodingPayload(thrown));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(thrown);
    expect(caught).not.toBeInstanceOf(ShellUXError);
  });

  it('still refuses a revoked Proxy nested below a valid level', () => {
    // The `children` guard sits inside the recursive walk, so it has to hold at
    // depth and not only at the root.
    expectRejection(
      makeBlueprint({
        navigationTree: [
          nodeWith({ children: [nodeWith({ id: 'child-a', children: makeRevokedProxy() })] }),
        ],
      }),
      'INVALID_FIELD',
      'navigationTree[0].children[0].children',
    );
  });
});
