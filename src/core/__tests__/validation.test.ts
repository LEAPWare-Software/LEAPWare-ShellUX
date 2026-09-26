import { describe, expect, it } from 'vitest';
import {
  HOTKEY_KEYS,
  HOTKEY_MODIFIER_REQUIRED_KEYS,
  REGISTRY_LIMITS,
  validateBlueprint,
} from '../RegistryContext';
import { ShellUXError } from '../types';
import type { Hotkey, ShellUXErrorCode } from '../types';
import {
  Pane2View,
  Pane3View,
  makeAction,
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

  it('rejects a bidi control, a C0/C1 control, a line/paragraph separator or an interlinear-annotation control (D-56, #172)', () => {
    const forbidden = [
      '\u202Eeman', // RIGHT-TO-LEFT OVERRIDE
      'name\u200F', // RLM
      'na\u2066me', // LRI
      '\u061Cname', // ARABIC LETTER MARK
      'name\n', // C0 control (also caught the same way as before)
      'name\u2028wide', // LINE SEPARATOR
      'name\u2029wide', // PARAGRAPH SEPARATOR
      'name\uFFF9anno\uFFFB', // interlinear annotation anchor/terminator
      'name\u206Awide', // deprecated format control
    ];
    for (const name of forbidden) {
      expectRejection(makeBlueprint({ name }), 'INVALID_FIELD', 'name');
    }
  });

  it('a string made only of two or more different invisible characters is blank (D-56, #172)', () => {
    // Reproduces the trap in the decision: calling `.replace(pattern, '')`
    // WITHOUT rebuilding a fresh `'gu'` copy removes only the first match,
    // leaving a second invisible character behind and the string looking
    // non-blank. `validateText` builds a fresh copy every call, so both are
    // stripped and this is refused as blank exactly like a single one is.
    const blank = [
      '\u200B\u034F', // ZERO WIDTH SPACE + COMBINING GRAPHEME JOINER
      '\uFEFF\u2060\u180B', // BOM + WORD JOINER + Mongolian FVS1
      '\u2800', // BRAILLE PATTERN BLANK alone — named by decision, not by Default_Ignorable
    ];
    for (const name of blank) {
      expectRejection(makeBlueprint({ name }), 'INVALID_FIELD', 'name');
    }
  });

  it('a Persian name held together by ZWNJ is not blank (D-56, #172)', () => {
    const name = '\u0645\u06CC\u200C\u0634\u0648\u062F';
    expect(validateBlueprint(makeBlueprint({ name })).name).toBe(name);
  });

  it('an emoji with a variation selector is not blank (D-56, #172)', () => {
    const name = '\u2764\uFE0F';
    expect(validateBlueprint(makeBlueprint({ name })).name).toBe(name);
  });

  it('rejects a bidi override in a NavigationNode.label the same way it rejects one in name (D-56, #172)', () => {
    // `validateText` is one function for all seven fields (docblock on
    // `TEXT_FORBIDDEN_PATTERN`/`TEXT_INVISIBLE_PATTERN` in
    // `RegistryContext.tsx`) \u2014 this narrows the coverage gap the D-56 debate's
    // QA round flagged: every case above drove only `name`.
    expectRejection(
      makeBlueprint({ navigationTree: [{ id: 'root-a', label: '\u202Eleman' }] }),
      'INVALID_FIELD',
      'navigationTree[0].label',
    );
  });

  it('rejects a RibbonAction.icon made only of invisible characters as blank (D-56, #172)', () => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          {
            id: 'act-one',
            label: 'A',
            icon: '\u200B\u034F',
            isVisible: () => true,
            onExecute: () => undefined,
          },
        ],
      }),
      'INVALID_FIELD',
      'ribbonActions[0].icon',
    );
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

/**
 * ============================================================================
 * RIBBON ACTION HOTKEYS — DECLARED AND VALIDATED HERE, DISPATCHED ELSEWHERE
 * ============================================================================
 * `RibbonAction.hotkey` is optional, structured, and checked at the same door
 * every other blueprint field is checked at. Dispatch is a different module and a
 * different suite — `src/core/__tests__/hotkeyDispatch.test.tsx` — and the rules
 * below are enforced at this door only, with no second suppression at dispatch
 * time (ADR-0001 Amendment I Decision 3).
 *
 * Five rules carry weight here and each has its own group below:
 *
 *   1. The key must be in the host allowlist, compared lowercased. `tab`, `space`
 *      and `escape` are absent on purpose and are pinned as rejections, because an
 *      allowlist's omissions are the part a later edit is most likely to undo.
 *   2. Each modifier is a boolean when present, on the `isDisabled` pattern.
 *   3. A single-character key must carry ctrl, alt or meta. This is the WCAG 2.2
 *      §2.1.4 Character Key Shortcuts (Level A) conformance route, not a style
 *      preference — shift alone does not satisfy it, because Shift produces a
 *      character too.
 *   4. A key on `HOTKEY_MODIFIER_REQUIRED_KEYS` — today `enter` — must carry
 *      ctrl, alt or meta as well, on ACTIVATION grounds rather than 2.1.4
 *      grounds. It is a separate rule with a separate message, and the two are
 *      kept apart on purpose: 2.1.4 reaches character keys only, so citing it for
 *      Enter would be an inaccurate citation. ADR-0001 Amendment I.
 *   5. A chord may not repeat inside one blueprint. It MAY repeat across
 *      blueprints; hotkeys are scoped to the foreground extension, and rejecting
 *      across extensions would make load order semantically load-bearing.
 *      ADR-0001 Amendment H.
 * ============================================================================
 */
describe('validateBlueprint — ribbon action hotkeys', () => {
  /** Read the single stored action back out of a validated blueprint. */
  function storedHotkey(hotkey: unknown): Hotkey | undefined {
    const validated = validateBlueprint(makeBlueprint({ ribbonActions: [makeAction({ hotkey })] }));
    return validated.ribbonActions[0]?.hotkey;
  }

  it('accepts an action with no hotkey at all, which is the common case', () => {
    const validated = validateBlueprint(makeBlueprint());
    expect(validated.ribbonActions[0]?.hotkey).toBeUndefined();
    expect('hotkey' in (validated.ribbonActions[0] as object)).toBe(false);
  });

  it('treats an explicitly undefined hotkey as absent', () => {
    expect(storedHotkey(undefined)).toBeUndefined();
  });

  it('stores a normalised chord with all four modifiers materialised', () => {
    // The plugin declared two of the four. The stored record carries all four as
    // explicit booleans, which is what makes `hotkeyToken` total.
    expect(storedHotkey({ key: 'k', ctrl: true, shift: true })).toEqual({
      key: 'k',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('stores the lowercased key, whatever case the plugin used', () => {
    expect(storedHotkey({ key: 'ArrowUp' })?.key).toBe('arrowup');
    expect(storedHotkey({ key: 'K', ctrl: true })?.key).toBe('k');
  });

  it.each([
    ['a string', 'ctrl+k'],
    ['null', null],
    ['an array', [{ key: 'k' }]],
    ['a number', 7],
    ['a boolean', true],
  ])('rejects %s as a hotkey', (_label, hotkey) => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey',
    );
  });

  it('rejects a hotkey with no key', () => {
    const error = expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey: { ctrl: true } })] }),
      'MISSING_FIELD',
      'ribbonActions[0].hotkey.key',
    );
    expect(error.message).toContain('ribbonActions[0].hotkey.key');
  });

  it.each([
    ['a number', 75],
    ['null', null],
    ['an object', {}],
    ['an array', ['k']],
  ])('rejects %s as a hotkey key', (_label, key) => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey: { key, ctrl: true } })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey.key',
    );
  });

  it('accepts every key in the host allowlist', () => {
    // Ctrl is added so that the single-character members clear the WCAG rule and
    // `enter` clears the activation rule; both have their own group below.
    for (const key of HOTKEY_KEYS) {
      expect(storedHotkey({ key, ctrl: true })?.key).toBe(key);
    }
    // 26 letters + 10 digits + 12 function keys + 4 arrows + 8 named navigation
    // and editing keys. Pinned so that a key quietly joining or leaving the
    // allowlist is a failing test rather than a silent widening. It was 61 until
    // `escape` was removed — ADR-0001 Amendment I.
    expect(HOTKEY_KEYS.size).toBe(60);
    expect(HOTKEY_KEYS.has('escape')).toBe(false);
  });

  it.each([
    ['tab, which owns focus order (WCAG 2.1.1, 2.4.3)', 'tab'],
    ['space, which activates the focused control', 'space'],
    ['escape, which is the shell dismissal key', 'escape'],
    ['a literal space character', ' '],
    ['control as a key', 'control'],
    ['alt as a key', 'alt'],
    ['shift as a key', 'shift'],
    ['meta as a key', 'meta'],
    ['capslock', 'capslock'],
    ['altgraph', 'altgraph'],
    ['a function key past f12', 'f13'],
    ['a multi-character letter run', 'kk'],
    ['an empty string', ''],
    ['a key with surrounding whitespace', ' k '],
    ['a punctuation key', '/'],
  ])('rejects %s as a hotkey key', (_label, key) => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey: { key, ctrl: true } })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey.key',
    );
  });

  it.each(['ctrl', 'alt', 'shift', 'meta'])('rejects a non-boolean "%s"', (modifier) => {
    expectRejection(
      makeBlueprint({
        ribbonActions: [makeAction({ hotkey: { key: 'f5', [modifier]: 'yes' } })],
      }),
      'INVALID_FIELD',
      `ribbonActions[0].hotkey.${modifier}`,
    );
  });

  it.each(['ctrl', 'alt', 'shift', 'meta'])('treats an explicitly undefined "%s" as absent', (modifier) => {
    expect(storedHotkey({ key: 'f5', [modifier]: undefined })).toEqual({
      key: 'f5',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
  });

  it('rejects a revoked Proxy as the hotkey, and as the key, as a ShellUXError', () => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey: makeRevokedProxy() })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey',
    );
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey: { key: makeRevokedProxy() } })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey.key',
    );
    expectRejection(
      makeBlueprint({
        ribbonActions: [makeAction({ hotkey: { key: 'f5', ctrl: makeRevokedProxy() } })],
      }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey.ctrl',
    );
  });
});

/**
 * WCAG 2.2 Success Criterion 2.1.4 Character Key Shortcuts, Level A.
 *
 * A shortcut that is a single printable character and nothing else is unusable
 * for a speech-input user, whose dictation emits characters, and hostile to
 * anyone typing into a surface the shortcut is live over. The criterion is met
 * by turning the shortcut off, remapping it, or scoping it to focus — or by
 * never creating one, which is the route taken: the registry refuses the
 * declaration.
 *
 * This group is the reason the rule is testable at all in Phase 1. There is no
 * dispatcher, so nothing observes a shortcut firing; what IS observable is that
 * the host will not accept the declaration.
 */
describe('validateBlueprint — the WCAG 2.1.4 modifier rule for character keys', () => {
  function expectHotkeyRejected(hotkey: Record<string, unknown>): ShellUXError {
    return expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey',
    );
  }

  function expectHotkeyAccepted(hotkey: Record<string, unknown>): void {
    expect(() =>
      validateBlueprint(makeBlueprint({ ribbonActions: [makeAction({ hotkey })] })),
    ).not.toThrow();
  }

  it('rejects a bare single-character key and names the criterion', () => {
    const error = expectHotkeyRejected({ key: 'k' });
    expect(error.message).toContain('2.1.4');
    expect(error.message).toContain('Character Key Shortcuts');
    expect(error.message).toContain('Level A');
  });

  it('rejects a bare digit — a digit is a character key too', () => {
    expectHotkeyRejected({ key: '7' });
  });

  it('rejects shift alone, because Shift produces a character', () => {
    const error = expectHotkeyRejected({ key: 'k', shift: true });
    expect(error.message).toContain('shift');
  });

  it('rejects all four modifiers explicitly false', () => {
    expectHotkeyRejected({ key: 'k', ctrl: false, alt: false, shift: false, meta: false });
  });

  it.each([
    ['ctrl', { key: 'k', ctrl: true }],
    ['alt', { key: 'k', alt: true }],
    ['meta', { key: 'k', meta: true }],
    ['ctrl and shift', { key: 'k', ctrl: true, shift: true }],
    ['alt and shift', { key: 'k', alt: true, shift: true }],
    ['meta and shift', { key: 'k', meta: true, shift: true }],
  ])('accepts a single-character key carrying %s', (_label, hotkey) => {
    expectHotkeyAccepted(hotkey);
  });

  it('exempts every non-character key in the allowlist, which may be bare', () => {
    // Derived from the allowlist rather than transcribed from it, so a key added
    // to `HOTKEY_KEYS` is covered here the moment it lands. Every member longer
    // than one character is a function key or a named navigation/editing key:
    // none can be produced by dictation or by typing into a field, so 2.1.4 does
    // not reach them.
    //
    // `HOTKEY_MODIFIER_REQUIRED_KEYS` is subtracted rather than named, so this
    // derivation keeps auto-covering the list instead of hard-coding what is on
    // it. Those keys are exempt from 2.1.4 too — Enter is not a character key —
    // but they are refused bare on the separate ACTIVATION rule, which has its
    // own group below. The 36 is still the single-character count: 26 letters
    // plus 10 digits.
    const exempt = [...HOTKEY_KEYS].filter(
      (key) => key.length > 1 && !HOTKEY_MODIFIER_REQUIRED_KEYS.has(key),
    );
    expect(exempt).toHaveLength(HOTKEY_KEYS.size - 36 - HOTKEY_MODIFIER_REQUIRED_KEYS.size);
    for (const key of exempt) {
      expectHotkeyAccepted({ key });
    }
  });

  it('exempts a bare named key carrying shift only', () => {
    expectHotkeyAccepted({ key: 'arrowdown', shift: true });
  });
});

/**
 * THE ACTIVATION RULE, WHICH IS NOT THE WCAG 2.1.4 RULE.
 *
 * `enter` is on the allowlist and `Ctrl+Enter` is a legitimate chord — it is the
 * one genuinely wanted member of the family — but a BARE Enter is refused. Enter
 * activates the focused control and submits a form, so a bare Enter chord would
 * fire on top of the activation the user asked for. That is the same failure mode
 * `space` is excluded from the allowlist for.
 *
 * **The two rules are kept apart deliberately, and this group is what holds them
 * apart.** WCAG 2.2 §2.1.4 is about single printable *character* keys and does
 * not reach Enter; a message citing it here would be an inaccurate citation, the
 * failure mode ADR-0001 Amendment G exists to stop. So the case below asserts
 * what the Enter message must NOT contain as firmly as the 2.1.4 group asserts
 * what its message must. ADR-0001 Amendment I.
 */
describe('validateBlueprint — the activation rule for keys that must carry a modifier', () => {
  function expectHotkeyRejected(hotkey: Record<string, unknown>): ShellUXError {
    return expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ hotkey })] }),
      'INVALID_FIELD',
      'ribbonActions[0].hotkey',
    );
  }

  function expectHotkeyAccepted(hotkey: Record<string, unknown>): void {
    expect(() =>
      validateBlueprint(makeBlueprint({ ribbonActions: [makeAction({ hotkey })] })),
    ).not.toThrow();
  }

  it('holds exactly the keys that activate the focused control', () => {
    expect([...HOTKEY_MODIFIER_REQUIRED_KEYS]).toEqual(['enter']);
    // Every member must be a real allowlist key, or the rule would guard a chord
    // that is already rejected one check earlier and mean nothing.
    for (const key of HOTKEY_MODIFIER_REQUIRED_KEYS) {
      expect(HOTKEY_KEYS.has(key)).toBe(true);
    }
  });

  it('rejects a bare enter, which activates the focused control', () => {
    expectHotkeyRejected({ key: 'enter' });
  });

  it('does NOT cite WCAG 2.1.4 for enter, which is not a character key', () => {
    const error = expectHotkeyRejected({ key: 'enter' });
    expect(error.message).toContain('activates the focused control');
    expect(error.message).toContain('Amendment I');
    expect(error.message).not.toContain('2.1.4');
    expect(error.message).not.toContain('Character Key Shortcuts');
    expect(error.message).not.toContain('Level A');
  });

  it('rejects enter with shift only, because Shift does not stop the activation', () => {
    expectHotkeyRejected({ key: 'enter', shift: true });
  });

  it('rejects every key on the modifier-required list when bare', () => {
    // Derived from the set rather than transcribed, so a key added to it is
    // covered the moment it lands.
    for (const key of HOTKEY_MODIFIER_REQUIRED_KEYS) {
      expectHotkeyRejected({ key });
    }
  });

  it('accepts ctrl+enter, the one genuinely wanted chord in this family', () => {
    expectHotkeyAccepted({ key: 'enter', ctrl: true });
  });

  it.each([
    ['alt', { key: 'enter', alt: true }],
    ['meta', { key: 'enter', meta: true }],
    ['ctrl and shift', { key: 'enter', ctrl: true, shift: true }],
  ])('accepts enter carrying %s', (_label, hotkey) => {
    expectHotkeyAccepted(hotkey);
  });

  it('leaves the 2.1.4 message alone for a genuine character key', () => {
    // The two branches must not have been merged into one message. A bare 'k' is
    // still refused by the criterion, by name.
    const error = expectHotkeyRejected({ key: 'k' });
    expect(error.message).toContain('2.1.4');
    expect(error.message).not.toContain('Amendment I');
  });
});

describe('validateBlueprint — duplicate hotkeys within one extension', () => {
  /** Two valid actions, each with the chord it is given. */
  function twoActions(first: unknown, second: unknown): Record<string, unknown> {
    return makeBlueprint({
      ribbonActions: [
        makeAction({ id: 'act-one', hotkey: first }),
        makeAction({ id: 'act-two', hotkey: second }),
      ],
    });
  }

  it('rejects the same chord twice, with DUPLICATE_HOTKEY on the second action', () => {
    const error = expectRejection(
      twoActions({ key: 'k', ctrl: true }, { key: 'k', ctrl: true }),
      'DUPLICATE_HOTKEY',
      'ribbonActions[1].hotkey',
    );
    expect(error.message).toContain('ctrl+k');
  });

  it('sees through a different spelling of the same chord', () => {
    // Absent and explicitly false are one chord, and so are two field orders.
    expectRejection(
      twoActions(
        { key: 'k', ctrl: true },
        { shift: false, ctrl: true, key: 'k', alt: false, meta: false },
      ),
      'DUPLICATE_HOTKEY',
      'ribbonActions[1].hotkey',
    );
  });

  it('sees through a different key casing', () => {
    expectRejection(
      twoActions({ key: 'arrowup' }, { key: 'ARROWUP' }),
      'DUPLICATE_HOTKEY',
      'ribbonActions[1].hotkey',
    );
  });

  it('accepts two chords that differ only by one modifier', () => {
    expect(() =>
      validateBlueprint(twoActions({ key: 'k', ctrl: true }, { key: 'k', ctrl: true, shift: true })),
    ).not.toThrow();
  });

  it('accepts two chords that differ only by key', () => {
    expect(() =>
      validateBlueprint(twoActions({ key: 'k', ctrl: true }, { key: 'j', ctrl: true })),
    ).not.toThrow();
  });

  it('does not confuse an action with no hotkey for a duplicate of another', () => {
    expect(() => validateBlueprint(twoActions(undefined, undefined))).not.toThrow();
  });

  it('lets two DIFFERENT extensions declare the same chord', () => {
    // Deliberate: hotkeys are scoped to the foreground extension, so this is not
    // a conflict. Rejecting it at registration would make load order
    // semantically load-bearing. ADR-0001 Amendment H.
    const chord = { key: 'k', ctrl: true };
    const first = makeBlueprint({ id: 'ext-one', ribbonActions: [makeAction({ hotkey: chord })] });
    const second = makeBlueprint({ id: 'ext-two', ribbonActions: [makeAction({ hotkey: chord })] });
    expect(validateBlueprint(first).ribbonActions[0]?.hotkey?.key).toBe('k');
    expect(validateBlueprint(second).ribbonActions[0]?.hotkey?.key).toBe('k');
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
