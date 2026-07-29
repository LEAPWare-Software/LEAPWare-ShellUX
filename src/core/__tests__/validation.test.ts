import { describe, expect, it } from 'vitest';
import { REGISTRY_LIMITS, validateBlueprint } from '../RegistryContext';
import { ShellUXError } from '../types';
import type { ShellUXErrorCode } from '../types';
import {
  Pane2View,
  Pane3View,
  makeBlueprint,
  makeDeepTree,
  makeManyActions,
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
