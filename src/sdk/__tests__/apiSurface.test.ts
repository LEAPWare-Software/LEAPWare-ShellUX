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
  // Relative to whatever the baseline records, so moving `HOST_API_VERSION` does
  // not rewrite these cases. They were literal `1.0`/`1.1` until 1.1 shipped.
  const parsed = parseHostApiVersion(baseline.version)!;
  const nextMinor = `${parsed.major}.${parsed.minor + 1}`;
  const nextMajor = `${parsed.major + 1}.0`;

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
    const { required, optional } = baseline.shellApi;
    const current = changed({ version: nextMinor, shellApi: { required: required.slice(1), optional } });
    const problems = assessContract(baseline, current);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`it needs a major bump from ${baseline.version}`);
    expect(problems[0]).toContain(`[major] IShellAPI: "${required[0]!}" was removed`);
  });

  it('accepts the bump, then asks for the baseline to be re-recorded, and passes once it is', () => {
    const current = changed({ version: nextMinor, hotkeyKeys: [...baseline.hotkeyKeys, 'escape'] });
    const problems = assessContract(baseline, current);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`does not record the contract as it stands (version ${nextMinor})`);
    // The message carries the description to record, and recording it passes.
    const recorded: unknown = JSON.parse(problems[0]!.slice(problems[0]!.indexOf('{')));
    expect(recorded).toEqual(canonicalSurface(current));
    expect(assessContract(current, current)).toEqual([]);
  });

  it('accepts a major bump for a minor change', () => {
    const current = changed({
      version: nextMajor,
      shellApi: { ...baseline.shellApi, required: [...baseline.shellApi.required, 'newMember'] },
    });
    expect(assessContract(baseline, current)).toEqual([expect.stringContaining(`(version ${nextMajor})`)]);
  });

  it('asks for the baseline to be re-recorded when the version moves with no change of shape', () => {
    // A behavioural narrowing has no shape; its major bump is legitimate and the
    // baseline must still record the new number.
    expect(assessContract(baseline, changed({ version: nextMajor }))).toEqual([
      expect.stringContaining(`does not record the contract as it stands (version ${nextMajor})`),
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

  it.each([
    ['1.3', '2.3'],
    ['1.0', '7.0'],
    ['1.0', '1.2'],
    ['1.3', '2.1'],
  ])('refuses %s → %s, which is not one step', (from, to) => {
    const current = changed({ version: to, hotkeyKeys: [...baseline.hotkeyKeys, 'escape'] });
    expect(assessContract(changed({ version: from }), current)).toEqual([
      expect.stringContaining(`moved from ${from} to ${to}, which is not one step`),
    ]);
  });

  it.each([
    ['1.3', '2.0'],
    ['1.3', '1.4'],
  ])('accepts %s → %s as one step', (from, to) => {
    const current = changed({ version: to, hotkeyKeys: [...baseline.hotkeyKeys, 'escape'] });
    expect(assessContract(changed({ version: from }), current)).toEqual([
      expect.stringContaining(`(version ${to})`),
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
  const api = baseline.shellApi;
  const shared = baseline.sharedModules;
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
    ['an IShellAPI member removed', { shellApi: { required: api.required.slice(1), optional: api.optional } }, 'major'],
    [
      'a required IShellAPI member added',
      { shellApi: { required: [...api.required, 'openPalette'], optional: api.optional } },
      'minor',
    ],
    [
      'an optional IShellAPI member added',
      { shellApi: { required: api.required, optional: [...api.optional, 'openPalette'] } },
      'minor',
    ],
    [
      'a required IShellAPI member made optional',
      { shellApi: { required: api.required.slice(1), optional: [...api.optional, api.required[0]!] } },
      'major',
    ],
    [
      'a name removed from /shared/react.js',
      { sharedModules: { ...shared, react: shared.react.filter((name) => name !== 'useId') } },
      'major',
    ],
    ['a name added to /shared/react.js', { sharedModules: { ...shared, react: [...shared.react, 'use'] } }, 'minor'],
    [
      'a name removed from /shared/react-jsx-runtime.js',
      { sharedModules: { ...shared, 'react-jsx-runtime': shared['react-jsx-runtime'].slice(1) } },
      'major',
    ],
    ['the React major changed', { sharedModules: { ...shared, reactMajor: shared.reactMajor + 1 } }, 'major'],
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
    // D-56, GitHub issue #172: any change to either text pattern, even a
    // WIDENING, is a major — same reasoning as `extensionIdPattern` above.
    [
      'the forbidden text pattern changed',
      { textForbiddenPattern: `${baseline.textForbiddenPattern}extra` },
      'major',
    ],
    [
      'the invisible text pattern changed',
      { textInvisiblePattern: `${baseline.textInvisiblePattern}extra` },
      'major',
    ],
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

  it('treats an optional IShellAPI member made required as a minor: the host promises more', () => {
    const before = changed({ shellApi: { required: ['a'], optional: ['b'] } });
    const after = changed({ shellApi: { required: ['a', 'b'], optional: [] } });
    expect(diffSurface(before, after)).toEqual([
      { bump: 'minor', reason: 'IShellAPI: "b" is an optional member made required' },
    ]);
  });

  it('names the pattern and both sides of the change in the reason string for each text pattern (D-56, #172)', () => {
    const forbiddenAfter = changed({ textForbiddenPattern: `${baseline.textForbiddenPattern}extra` });
    expect(diffSurface(baseline, forbiddenAfter)).toEqual([
      {
        bump: 'major',
        reason: `TEXT_FORBIDDEN_PATTERN: ${baseline.textForbiddenPattern} → ${baseline.textForbiddenPattern}extra`,
      },
    ]);

    const invisibleAfter = changed({ textInvisiblePattern: `${baseline.textInvisiblePattern}extra` });
    expect(diffSurface(baseline, invisibleAfter)).toEqual([
      {
        bump: 'major',
        reason: `TEXT_INVISIBLE_PATTERN: ${baseline.textInvisiblePattern} → ${baseline.textInvisiblePattern}extra`,
      },
    ]);
  });

  it('names what changed in each reason', () => {
    expect(
      diffSurface(baseline, changed({ blueprint: { required: [...required, optional[0]!], optional: optional.slice(1) } })),
    ).toEqual([{ bump: 'major', reason: `blueprint: "${optional[0]!}" is an optional key made required` }]);
    expect(diffSurface(baseline, changed({ extensionIdPattern: 'x' }))).toEqual([
      { bump: 'major', reason: `EXTENSION_ID_PATTERN: /${baseline.extensionIdPattern}/ → /x/` },
    ]);
    expect(
      diffSurface(baseline, changed({ sharedModules: { ...baseline.sharedModules, reactMajor: 19 } })),
    ).toEqual([{ bump: 'major', reason: `React major: ${baseline.sharedModules.reactMajor} → 19` }]);
    expect(diffSurface(baseline, changed({ reservedIds: [...baseline.reservedIds, 'shell'] }))).toEqual([
      { bump: 'major', reason: 'RESERVED_IDS: added "shell"' },
    ]);
  });
});
