import { describe, expect, it } from 'vitest';
import { REGISTRY_LIMITS, validateBlueprint } from '../RegistryContext';
import { COMMAND_CATEGORIES, ShellUXError } from '../types';
import type { ShellUXErrorCode } from '../types';
import { makeAction, makeBlueprint, makeManyActions } from './fixtures';

/**
 * ============================================================================
 * THE COMMAND CONTRACT: TWO NAMES FOR ONE COLLECTION, AND FOUR NEW FIELDS.
 * ============================================================================
 * `RibbonAction` is `Command`, generalised. What is new at the registry's door is
 * one rule about the COLLECTION — exactly one of `commands` and `ribbonActions` —
 * and four optional fields on each member: `when`, `category`, `surfaces` and
 * `priority`. Everything else about `normalizeCommand` is unchanged, and the cases
 * for it stay in `validation.test.ts`, which is why this is a separate file rather
 * than a longer one.
 *
 * Every case is written against the runtime validator over plain-JavaScript
 * payloads, because that is what a plug-in is: the declared types prove nothing at
 * runtime, which is the standard `ShellAPI.ts` holds its own doors to.
 * ============================================================================
 */

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

describe('validateBlueprint — one collection, two possible names', () => {
  it('accepts the deprecated ribbonActions and publishes it as commands too', () => {
    const record = validateBlueprint(makeBlueprint());
    // The IDENTICAL array object, not a copy of it. One collection with two names
    // cannot drift; two collections with two names is the drift the both-present
    // rejection exists to prevent.
    expect(record.commands).toBe(record.ribbonActions);
    expect(record.commands.map((command) => command.id)).toEqual(['act-one', 'act-two']);
  });

  it('accepts commands on its own, and publishes it as ribbonActions too', () => {
    const payload = makeBlueprint();
    payload['commands'] = payload['ribbonActions'];
    delete payload['ribbonActions'];
    const record = validateBlueprint(payload);
    expect(record.ribbonActions).toBe(record.commands);
    expect(record.commands.map((command) => command.id)).toEqual(['act-one', 'act-two']);
  });

  it('rejects a blueprint that declares BOTH, rather than merging or preferring one', () => {
    const payload = makeBlueprint();
    payload['commands'] = payload['ribbonActions'];
    const error = expectRejection(payload, 'INVALID_FIELD', 'commands');
    expect(error.message).toContain('never both');

    // Identical CONTENTS are refused too. "They must agree" is a rule nothing
    // enforces, and which one won would be invisible from the manifest.
    payload['commands'] = [...(payload['ribbonActions'] as unknown[])];
    expectRejection(payload, 'INVALID_FIELD', 'commands');
  });

  it('reports a blueprint declaring neither as a missing ribbonActions', () => {
    const payload = makeBlueprint();
    delete payload['ribbonActions'];
    // The legacy name, because that is what every existing manifest and every
    // existing rejection message uses.
    expectRejection(payload, 'MISSING_FIELD', 'ribbonActions');
  });

  it('names the field the caller actually wrote in every rejection path', () => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ id: 'BAD' })] }),
      'INVALID_ID',
      'ribbonActions[0].id',
    );

    const modern = makeBlueprint({ commands: [makeAction({ id: 'BAD' })] });
    delete modern['ribbonActions'];
    // An author reading `commands[0].id` can find line 0 of the array they
    // declared, rather than one they did not.
    expectRejection(modern, 'INVALID_ID', 'commands[0].id');
  });

  it('applies the same array rule and the same bound under either name', () => {
    const notAnArray = makeBlueprint({ commands: 'not-an-array' });
    delete notAnArray['ribbonActions'];
    expectRejection(notAnArray, 'INVALID_FIELD', 'commands');

    const tooMany = makeBlueprint({
      commands: makeManyActions(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS + 1),
    });
    delete tooMany['ribbonActions'];
    expectRejection(tooMany, 'PAYLOAD_TOO_LARGE', 'commands');
  });
});

describe('validateBlueprint — when', () => {
  it('parses a when at registration and carries the frozen tree on the stored record', () => {
    const record = validateBlueprint(
      makeBlueprint({ ribbonActions: [makeAction({ when: 'selectedItemId != null' })] }),
    );
    const command = record.commands[0];
    expect(command?.when).toBe('selectedItemId != null');
    expect(command?.whenExpression?.source).toBe('selectedItemId != null');
    expect(command?.whenExpression?.node.kind).toBe('compare');
    expect(Object.isFrozen(command?.whenExpression)).toBe(true);
  });

  it('rejects a malformed when at the door, naming the field', () => {
    // A registration rejection rather than a command that silently never appears.
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ when: 'selectedItemId ===' })] }),
      'INVALID_FIELD',
      'ribbonActions[0].when',
    );
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ when: 42 })] }),
      'INVALID_FIELD',
      'ribbonActions[0].when',
    );
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ when: 'x'.repeat(600) })] }),
      'PAYLOAD_TOO_LARGE',
      'ribbonActions[0].when',
    );
  });

  it('does not read a plug-in supplied whenExpression, so a tree cannot bypass the parser', () => {
    const record = validateBlueprint(
      makeBlueprint({
        ribbonActions: [
          makeAction({ whenExpression: { source: 'true', node: { kind: 'literal', value: true } } }),
        ],
      }),
    );
    // The field is HOST-DERIVED. Whatever a plug-in put there does not survive
    // normalisation, exactly as any other undeclared field does not.
    expect(record.commands[0]?.whenExpression).toBeUndefined();
    expect(Object.hasOwn(record.commands[0] as object, 'whenExpression')).toBe(false);
  });

  it('leaves a command with no when carrying no expression at all', () => {
    const record = validateBlueprint(makeBlueprint());
    expect(record.commands[0]?.when).toBeUndefined();
    expect(record.commands[0]?.whenExpression).toBeUndefined();
  });
});

describe('validateBlueprint — category, surfaces and priority', () => {
  it('accepts every category the host publishes', () => {
    for (const category of COMMAND_CATEGORIES) {
      const record = validateBlueprint(
        makeBlueprint({ ribbonActions: [makeAction({ category })] }),
      );
      expect(record.commands[0]?.category).toBe(category);
    }
  });

  it('rejects an unknown category with NO FALLBACK, and says why', () => {
    // The asymmetry with `icon` is the decision: an unknown icon key resolves to a
    // host glyph because a wrong picture still leaves the command labelled and
    // reachable, and an unknown category has no fallback that is not a lie about
    // where the command lives.
    const error = expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ category: 'mail' })] }),
      'INVALID_FIELD',
      'ribbonActions[0].category',
    );
    expect(error.message).toContain('no fallback category');
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ category: 7 })] }),
      'INVALID_FIELD',
      'ribbonActions[0].category',
    );
    // Case matters: the vocabulary is lowercase and a near miss is a rejection
    // rather than a guess.
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ category: 'File' })] }),
      'INVALID_FIELD',
      'ribbonActions[0].category',
    );
  });

  it('accepts a surfaces array of known members, including the empty one', () => {
    const record = validateBlueprint(
      makeBlueprint({
        ribbonActions: [
          makeAction({ id: 'a', surfaces: ['palette', 'context-bar'] }),
          // Legal, and it means "no surface at all": a command reachable only by
          // its chord.
          makeAction({ id: 'b', surfaces: [] }),
        ],
      }),
    );
    expect(record.commands[0]?.surfaces).toEqual(['palette', 'context-bar']);
    expect(Object.isFrozen(record.commands[0]?.surfaces)).toBe(true);
    expect(record.commands[1]?.surfaces).toEqual([]);
  });

  it('rejects an unknown surface, a repeated surface, a non-array and an oversized list', () => {
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ surfaces: ['ribbon'] })] }),
      'INVALID_FIELD',
      'ribbonActions[0].surfaces[0]',
    );
    // Repeats are refused rather than collapsed, for the reason a repeated
    // selected id is: quietly fixing it returns a different list from the one that
    // was declared.
    const repeat = expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ surfaces: ['palette', 'palette'] })] }),
      'INVALID_FIELD',
      'ribbonActions[0].surfaces[1]',
    );
    expect(repeat.message).toContain('repeats surface');
    expectRejection(
      makeBlueprint({ ribbonActions: [makeAction({ surfaces: 'palette' })] }),
      'INVALID_FIELD',
      'ribbonActions[0].surfaces',
    );
    expectRejection(
      makeBlueprint({
        ribbonActions: [
          makeAction({
            surfaces: ['palette', 'context-bar', 'omnibox', 'floating-toolbar', 'palette'],
          }),
        ],
      }),
      'PAYLOAD_TOO_LARGE',
      'ribbonActions[0].surfaces',
    );
  });

  it('accepts a safe-integer priority and normalises negative zero', () => {
    const record = validateBlueprint(
      makeBlueprint({
        ribbonActions: [
          makeAction({ id: 'a', priority: 10 }),
          makeAction({ id: 'b', priority: -0 }),
        ],
      }),
    );
    expect(record.commands[0]?.priority).toBe(10);
    // A sort key that is not the one that was written is a small lie the host does
    // not need to tell.
    expect(Object.is(record.commands[1]?.priority, -0)).toBe(false);
    expect(record.commands[1]?.priority).toBe(0);
  });

  it('rejects a priority that is not a safe integer', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, '3', null]) {
      expectRejection(
        makeBlueprint({ ribbonActions: [makeAction({ priority: bad })] }),
        'INVALID_FIELD',
        'ribbonActions[0].priority',
      );
    }
  });

  it('freezes the stored command, so a plug-in mutating its own record afterwards changes nothing', () => {
    const action = makeAction({ category: 'file', surfaces: ['palette'], priority: 3 });
    const record = validateBlueprint(makeBlueprint({ ribbonActions: [action] }));
    const stored = record.commands[0] as unknown as Record<string, unknown>;
    expect(Object.isFrozen(stored)).toBe(true);
    action['category'] = 'help';
    (action['surfaces'] as string[]).push('omnibox');
    expect(stored['category']).toBe('file');
    expect(stored['surfaces']).toEqual(['palette']);
  });
});
