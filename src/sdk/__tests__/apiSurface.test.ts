import { describe, expect, it } from 'vitest';
import baselineJson from '../api-surface.json';
import {
  assessContract,
  canonicalSurface,
  diffSurface,
  parseHostApiVersion,
  requiredBump,
} from '../apiSurface';
import type { ApiSurface, Bump } from '../apiSurface';
import * as sdk from '../index';
import { deriveApiSurface } from './deriveApiSurface';

/**
 * ADR-0006 decision 3, "What enforces the bump". Two halves:
 *
 *  - the LIVE check — the committed baseline against the contract derived from
 *    the source as it stands. This is the case that goes red in a pull request
 *    that changes the contract;
 *  - the RULE — `assessContract` and `diffSurface` driven with descriptions
 *    built here, one per row of the table in `../apiSurface.ts`, so the rule is
 *    shown to fail for the reason it names and not merely to pass on today's
 *    tree.
 *
 * The baseline is what the live check compares against, so the rule cases
 * start from a copy of it and change one thing.
 */
const baseline: ApiSurface = baselineJson;

/** The baseline with `patch` applied. Every rule case is one of these. */
function changed(patch: Partial<ApiSurface>): ApiSurface {
  return { ...baseline, ...patch };
}

describe('the SDK contract baseline, src/sdk/api-surface.json', () => {
  it('records the contract as it stands, version included', () => {
    expect(assessContract(baseline, deriveApiSurface())).toEqual([]);
  });

  it('records the SDK barrel runtime exports as exactly its value names', () => {
    // The checker decides value versus type; the running module is the other
    // witness. A name the checker filed wrongly would differ here.
    expect(Object.keys(sdk).sort()).toEqual(deriveApiSurface().exports.values);
  });

  it('is stored in canonical form, so a diff of the file is a diff of the contract', () => {
    expect(canonicalSurface(baseline)).toEqual(baseline);
  });
});

describe('the bump rule', () => {
  it('fails when the contract changes and the version does not move', () => {
    const current = changed({
      exports: { ...baseline.exports, values: [...baseline.exports.values, 'newHelper'] },
    });
    const problems = assessContract(baseline, current);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`it needs a minor bump from ${baseline.version}`);
    expect(problems[0]).toContain(`the SDK exports ${baseline.version}`);
    expect(problems[0]).toContain('[minor] exports (value): added "newHelper"');
  });

  it('fails a major change when only the minor moved', () => {
    const current = changed({ version: '1.1', shellApi: baseline.shellApi.slice(1) });
    const problems = assessContract(baseline, current);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('it needs a major bump from 1.0');
    expect(problems[0]).toContain(`[major] IShellAPI: removed "${baseline.shellApi[0]}"`);
  });

  it('accepts the bump, then asks for the baseline to be re-recorded, and passes once it is', () => {
    const current = changed({ version: '1.1', hotkeyKeys: [...baseline.hotkeyKeys, 'escape'] });
    const problems = assessContract(baseline, current);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not record the contract as it stands (version 1.1)');
    // The message carries the description to record, and recording it passes.
    const recorded: unknown = JSON.parse(problems[0]!.slice(problems[0]!.indexOf('{')));
    expect(recorded).toEqual(canonicalSurface(current));
    expect(assessContract(current, current)).toEqual([]);
  });

  it('accepts a major bump for a minor change', () => {
    const current = changed({ version: '2.0', shellApi: [...baseline.shellApi, 'newMember'] });
    expect(assessContract(baseline, current)).toEqual([expect.stringContaining('(version 2.0)')]);
  });

  it('asks for the baseline to be re-recorded when the version moves with no change of shape', () => {
    // A behavioural narrowing has no shape; its major bump is legitimate and the
    // baseline must still record the new number.
    expect(assessContract(baseline, changed({ version: '2.0' }))).toEqual([
      expect.stringContaining('does not record the contract as it stands (version 2.0)'),
    ]);
  });

  it('refuses a version that goes backwards', () => {
    const ahead = changed({ version: '3.2' });
    expect(assessContract(ahead, changed({ version: '3.1' }))).toEqual([
      'HOST_API_VERSION went backwards: the baseline records 3.2, the SDK exports 3.1.',
    ]);
    expect(assessContract(ahead, changed({ version: '2.9' }))).toEqual([
      expect.stringContaining('went backwards'),
    ]);
  });

  it.each(['1.0.0', '01.0', '1', 'v1.0', ''])('refuses %j as a version', (version) => {
    expect(assessContract(baseline, changed({ version }))).toEqual([
      expect.stringContaining('must be "major.minor"'),
    ]);
    expect(assessContract(changed({ version }), baseline)).toEqual([
      expect.stringContaining('must be "major.minor"'),
    ]);
  });

  it('parses a major.minor version into its two numbers', () => {
    expect(parseHostApiVersion('12.0')).toEqual({ major: 12, minor: 0 });
    expect(parseHostApiVersion('1.10')).toEqual({ major: 1, minor: 10 });
  });

  it('compares descriptions regardless of list order', () => {
    const shuffled = changed({
      hotkeyKeys: [...baseline.hotkeyKeys].reverse(),
      registryLimits: Object.fromEntries(Object.entries(baseline.registryLimits).reverse()),
    });
    expect(assessContract(baseline, shuffled)).toEqual([]);
  });
});

describe('the bump each change requires, one row of the table at a time', () => {
  const { values, types } = baseline.exports;
  const { required, optional } = baseline.blueprint;
  const firstLimit = Object.keys(baseline.registryLimits)[0]!;
  const firstLimitValue = baseline.registryLimits[firstLimit]!;

  const cases: ReadonlyArray<readonly [string, Partial<ApiSurface>, Bump]> = [
    ['an SDK value export removed', { exports: { values: values.slice(1), types } }, 'major'],
    ['an SDK value export added', { exports: { values: [...values, 'x'], types } }, 'minor'],
    ['an SDK type export removed', { exports: { values, types: types.slice(1) } }, 'major'],
    ['an SDK type export added', { exports: { values, types: [...types, 'X'] } }, 'minor'],
    ['a new required blueprint key', { blueprint: { required: [...required, 'icon'], optional } }, 'major'],
    [
      'an optional blueprint key made required',
      { blueprint: { required: [...required, optional[0]!], optional: optional.slice(1) } },
      'major',
    ],
    ['a new optional blueprint key', { blueprint: { required, optional: [...optional, 'onActivate'] } }, 'minor'],
    [
      'a required blueprint key made optional',
      { blueprint: { required: required.slice(1), optional: [...optional, required[0]!] } },
      'minor',
    ],
    ['a required blueprint key removed', { blueprint: { required: required.slice(1), optional } }, 'major'],
    ['an optional blueprint key removed', { blueprint: { required, optional: optional.slice(1) } }, 'major'],
    ['an IShellAPI member removed', { shellApi: baseline.shellApi.slice(1) }, 'major'],
    ['an IShellAPI member added', { shellApi: [...baseline.shellApi, 'clearBadge'] }, 'minor'],
    ['a hotkey key removed from the allowlist', { hotkeyKeys: baseline.hotkeyKeys.slice(1) }, 'major'],
    ['a hotkey key added to the allowlist', { hotkeyKeys: [...baseline.hotkeyKeys, 'escape'] }, 'minor'],
    [
      'a key that must carry a modifier added',
      { hotkeyModifierRequiredKeys: [...baseline.hotkeyModifierRequiredKeys, 'delete'] },
      'major',
    ],
    ['a key that must carry a modifier removed', { hotkeyModifierRequiredKeys: [] }, 'minor'],
    ['a reserved id added', { reservedIds: [...baseline.reservedIds, 'shell'] }, 'major'],
    ['a reserved id removed', { reservedIds: baseline.reservedIds.slice(1) }, 'minor'],
    ['the id pattern changed', { extensionIdPattern: '^[a-z][a-z0-9-]{0,63}$' }, 'major'],
    ['a registry bound added', { registryLimits: { ...baseline.registryLimits, MAX_NEW: 1 } }, 'major'],
    [
      'a registry bound lowered',
      { registryLimits: { ...baseline.registryLimits, [firstLimit]: firstLimitValue - 1 } },
      'major',
    ],
    [
      'a registry bound raised',
      { registryLimits: { ...baseline.registryLimits, [firstLimit]: firstLimitValue + 1 } },
      'minor',
    ],
    [
      'a registry bound removed',
      {
        registryLimits: Object.fromEntries(
          Object.entries(baseline.registryLimits).filter(([name]) => name !== firstLimit),
        ),
      },
      'minor',
    ],
    ['nothing changed', {}, 'none'],
  ];

  it.each(cases.map(([label, patch, bump]) => ({ label, patch, bump })))(
    '$label needs: $bump',
    ({ patch, bump }) => {
      const changes = diffSurface(baseline, changed(patch));
      expect(requiredBump(changes)).toBe(bump);
      // One change, one reason: no row trips a second rule it was not written for.
      expect(changes).toHaveLength(bump === 'none' ? 0 : 1);
    },
  );

  it('needs the largest bump any one change needs, whatever order the changes come in', () => {
    const major = { bump: 'major', reason: 'removed' } as const;
    const minor = { bump: 'minor', reason: 'added' } as const;
    expect(requiredBump([major, minor])).toBe('major');
    expect(requiredBump([minor, major, minor])).toBe('major');
    expect(requiredBump([minor, minor])).toBe('minor');
  });

  it('names what changed in each reason', () => {
    expect(
      diffSurface(baseline, changed({ blueprint: { required: [...required, optional[0]!], optional: optional.slice(1) } })),
    ).toEqual([{ bump: 'major', reason: `blueprint: "${optional[0]!}" is an optional key made required` }]);
    expect(diffSurface(baseline, changed({ extensionIdPattern: 'x' }))).toEqual([
      { bump: 'major', reason: `EXTENSION_ID_PATTERN: /${baseline.extensionIdPattern}/ → /x/` },
    ]);
    expect(diffSurface(baseline, changed({ reservedIds: [...baseline.reservedIds, 'shell'] }))).toEqual([
      { bump: 'major', reason: 'RESERVED_IDS: added "shell"' },
    ]);
  });
});
