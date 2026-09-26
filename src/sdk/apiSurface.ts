/**
 * ============================================================================
 * THE BUMP RULE: WHAT A CHANGE TO THE CONTRACT REQUIRES OF `HOST_API_VERSION`.
 * ============================================================================
 * ADR-0006 decision 3, "What enforces the bump", implementation step 2. The
 * committed baseline `./api-surface.json` records the SDK's version and a
 * machine-derived description of the contract. A test derives the same
 * description from the source as it stands and hands both to `assessContract`
 * below, which fails when they differ and the version did not move by at least
 * what the difference requires. That is `bnd baseline` reduced to one file.
 *
 * **The rule, as written here.** Anything removed or narrowed needs a major;
 * anything added or widened needs a minor:
 *
 * | Part | Major | Minor |
 * |---|---|---|
 * | SDK exports (values, types) | a name removed | a name added |
 * | Blueprint keys | a key removed, a new required key, an optional key made required | a new optional key, a required key made optional |
 * | `IShellAPI` members | a member removed, a required member made optional | a member added, an optional member made required |
 * | Shared modules (`/shared/react.js`, `/shared/react-jsx-runtime.js`) | a name removed, React's major changed | a name added |
 * | `HOTKEY_KEYS` (an allowlist) | a key removed | a key added |
 * | `HOTKEY_MODIFIER_REQUIRED_KEYS`, `RESERVED_IDS` (denylists) | an entry added | an entry removed |
 * | `EXTENSION_ID_PATTERN` | any change to its source | — |
 * | `TEXT_FORBIDDEN_PATTERN`, `TEXT_INVISIBLE_PATTERN` | any change, including a widening | — |
 * | `REGISTRY_LIMITS` | a bound added or lowered | a bound removed or raised |
 *
 * `IShellAPI` runs the other way from the blueprint: the host PROVIDES it and a
 * plugin consumes it, so a member a plugin could rely on becoming optional is
 * the break, and an optional member becoming required only promises more.
 *
 * A pattern change is always a major because two regular expressions cannot be
 * compared for "accepts less" by looking at their text; the conservative answer
 * is the one that cannot let a narrowing through as a minor.
 *
 * **What this is, in this repository's vocabulary: a guardrail.** It closes the
 * documented route — change the contract, forget the version — and makes that
 * honest mistake loud. It enforces nothing against a baseline edited by hand to
 * match, and review of the `api-surface.json` diff is what catches that.
 *
 * **Its limit, stated as ADR-0006 states it.** It sees names, keys, allowlists
 * and bounds. A behavioural narrowing with no shape — a validator that starts
 * refusing a value it used to accept — is invisible to it and depends on review.
 * So is anything below the top level: a new required key on `Command` or
 * `NavigationNode`, or a changed parameter type on an `IShellAPI` member, is not
 * in the description and moves nothing here.
 *
 * *Tests:* `src/sdk/__tests__/apiSurface.test.ts` — "fails when the contract
 * changes and the version does not move", and one case per row of the table.
 * ============================================================================
 */

/** The machine-derived description of the contract. `./api-surface.json` is one. */
export interface ApiSurface {
  /** `HOST_API_VERSION` when the description was recorded, `major.minor`. */
  readonly version: string;
  /** The SDK barrel's exported names, split by whether they exist at runtime. */
  readonly exports: { readonly values: readonly string[]; readonly types: readonly string[] };
  /** `LEAPExtensionBlueprintInput`'s top-level keys. */
  readonly blueprint: { readonly required: readonly string[]; readonly optional: readonly string[] };
  /** `IShellAPI`'s members, split by whether the host must provide each. */
  readonly shellApi: { readonly required: readonly string[]; readonly optional: readonly string[] };
  /**
   * What each shared module stands in for exports, by name, and the React major
   * behind them. A plugin compiled against one React major is not promised the
   * next, so a React major is a host-contract major.
   */
  readonly sharedModules: {
    readonly react: readonly string[];
    readonly 'react-jsx-runtime': readonly string[];
    readonly reactMajor: number;
  };
  readonly hotkeyKeys: readonly string[];
  readonly hotkeyModifierRequiredKeys: readonly string[];
  /** `EXTENSION_ID_PATTERN.source`. */
  readonly extensionIdPattern: string;
  /**
   * `String(TEXT_FORBIDDEN_PATTERN)`, flags included. Unlike
   * `extensionIdPattern`, which has no flags and can record `.source` alone,
   * `TEXT_FORBIDDEN_PATTERN` and `TEXT_INVISIBLE_PATTERN` carry the `u` flag
   * and it changes what their character classes mean, so the flags are part of
   * what must be compared.
   */
  readonly textForbiddenPattern: string;
  /** `String(TEXT_INVISIBLE_PATTERN)`, flags included — see `textForbiddenPattern`. */
  readonly textInvisiblePattern: string;
  readonly reservedIds: readonly string[];
  readonly registryLimits: Readonly<Record<string, number>>;
}

/** How far the version has to move. Ordered: each needs everything before it. */
export type Bump = 'none' | 'minor' | 'major';

/** One difference between two descriptions, and the bump it needs. */
export interface ContractChange {
  readonly bump: 'minor' | 'major';
  readonly reason: string;
}

const RANK: Readonly<Record<Bump, number>> = Object.freeze({ none: 0, minor: 1, major: 2 });

/** `major.minor`, each a non-negative integer with no leading zero. */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
}

/** The two numbers of a `major.minor` version, or `null` when it is not one. */
export function parseHostApiVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function added(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before);
  return after.filter((name) => !seen.has(name));
}

/**
 * The changes to one list. `grow` is the bump an added entry needs; a removed
 * entry needs the other one. An allowlist grows by a minor; a denylist grows by
 * a major.
 */
function listChanges(
  part: string,
  before: readonly string[],
  after: readonly string[],
  grow: 'minor' | 'major',
): ContractChange[] {
  const shrink = grow === 'minor' ? 'major' : 'minor';
  return [
    ...added(before, after).map((name): ContractChange => ({ bump: grow, reason: `${part}: added "${name}"` })),
    ...added(after, before).map((name): ContractChange => ({ bump: shrink, reason: `${part}: removed "${name}"` })),
  ];
}

function blueprintChanges(before: ApiSurface['blueprint'], after: ApiSurface['blueprint']): ContractChange[] {
  const beforeAll = new Set([...before.required, ...before.optional]);
  const afterAll = new Set([...after.required, ...after.optional]);
  const changes: ContractChange[] = [];
  for (const key of added(before.required, after.required)) {
    const was = beforeAll.has(key) ? 'an optional key made required' : 'a new required key';
    changes.push({ bump: 'major', reason: `blueprint: "${key}" is ${was}` });
  }
  for (const key of added(before.optional, after.optional)) {
    const was = beforeAll.has(key) ? 'a required key made optional' : 'a new optional key';
    changes.push({ bump: 'minor', reason: `blueprint: "${key}" is ${was}` });
  }
  for (const key of beforeAll) {
    if (!afterAll.has(key)) changes.push({ bump: 'major', reason: `blueprint: "${key}" was removed` });
  }
  return changes;
}

/**
 * The changes to `IShellAPI`, which the host provides and a plugin consumes: the
 * blueprint's rule with the direction of the required/optional move reversed.
 */
function shellApiChanges(before: ApiSurface['shellApi'], after: ApiSurface['shellApi']): ContractChange[] {
  const beforeAll = new Set([...before.required, ...before.optional]);
  const afterAll = new Set([...after.required, ...after.optional]);
  const changes: ContractChange[] = [];
  for (const key of added(before.optional, after.optional)) {
    const was = beforeAll.has(key) ? 'a required member made optional' : 'a new optional member';
    changes.push({ bump: beforeAll.has(key) ? 'major' : 'minor', reason: `IShellAPI: "${key}" is ${was}` });
  }
  for (const key of added(before.required, after.required)) {
    const was = beforeAll.has(key) ? 'an optional member made required' : 'a new required member';
    changes.push({ bump: 'minor', reason: `IShellAPI: "${key}" is ${was}` });
  }
  for (const key of beforeAll) {
    if (!afterAll.has(key)) changes.push({ bump: 'major', reason: `IShellAPI: "${key}" was removed` });
  }
  return changes;
}

function limitChanges(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): ContractChange[] {
  const changes: ContractChange[] = [];
  for (const [name, value] of Object.entries(after)) {
    const old = before[name];
    if (old === undefined) {
      changes.push({ bump: 'major', reason: `registryLimits: bound "${name}" added (${value})` });
    } else if (value < old) {
      changes.push({ bump: 'major', reason: `registryLimits: "${name}" lowered ${old} → ${value}` });
    } else if (value > old) {
      changes.push({ bump: 'minor', reason: `registryLimits: "${name}" raised ${old} → ${value}` });
    }
  }
  for (const name of Object.keys(before)) {
    if (!(name in after)) changes.push({ bump: 'minor', reason: `registryLimits: bound "${name}" removed` });
  }
  return changes;
}

/** Every difference between two descriptions, each with the bump it needs. The version is not compared. */
export function diffSurface(before: ApiSurface, after: ApiSurface): ContractChange[] {
  const changes = [
    ...listChanges('exports (value)', before.exports.values, after.exports.values, 'minor'),
    ...listChanges('exports (type)', before.exports.types, after.exports.types, 'minor'),
    ...blueprintChanges(before.blueprint, after.blueprint),
    ...shellApiChanges(before.shellApi, after.shellApi),
    ...listChanges('/shared/react.js', before.sharedModules.react, after.sharedModules.react, 'minor'),
    ...listChanges(
      '/shared/react-jsx-runtime.js',
      before.sharedModules['react-jsx-runtime'],
      after.sharedModules['react-jsx-runtime'],
      'minor',
    ),
    ...listChanges('HOTKEY_KEYS', before.hotkeyKeys, after.hotkeyKeys, 'minor'),
    ...listChanges(
      'HOTKEY_MODIFIER_REQUIRED_KEYS',
      before.hotkeyModifierRequiredKeys,
      after.hotkeyModifierRequiredKeys,
      'major',
    ),
    ...listChanges('RESERVED_IDS', before.reservedIds, after.reservedIds, 'major'),
    ...limitChanges(before.registryLimits, after.registryLimits),
  ];
  if (before.sharedModules.reactMajor !== after.sharedModules.reactMajor) {
    changes.push({
      bump: 'major',
      reason: `React major: ${before.sharedModules.reactMajor} → ${after.sharedModules.reactMajor}`,
    });
  }
  if (before.extensionIdPattern !== after.extensionIdPattern) {
    changes.push({
      bump: 'major',
      reason: `EXTENSION_ID_PATTERN: /${before.extensionIdPattern}/ → /${after.extensionIdPattern}/`,
    });
  }
  // Same reasoning as `EXTENSION_ID_PATTERN` above, and unconditionally a
  // major even for a WIDENING: there is no mechanical way to tell whether one
  // regular expression accepts a subset of another's strings, so the
  // conservative answer is the one that cannot let a narrowing (or a
  // per-field exception a plugin could not have anticipated) through as a
  // minor. See `docs/adr/0006-runtime-plugin-host.md`.
  if (before.textForbiddenPattern !== after.textForbiddenPattern) {
    changes.push({
      bump: 'major',
      reason: `TEXT_FORBIDDEN_PATTERN: ${before.textForbiddenPattern} → ${after.textForbiddenPattern}`,
    });
  }
  if (before.textInvisiblePattern !== after.textInvisiblePattern) {
    changes.push({
      bump: 'major',
      reason: `TEXT_INVISIBLE_PATTERN: ${before.textInvisiblePattern} → ${after.textInvisiblePattern}`,
    });
  }
  return changes;
}

/** The largest bump any of `changes` needs. */
export function requiredBump(changes: readonly ContractChange[]): Bump {
  return changes.reduce<Bump>((most, change) => (RANK[change.bump] > RANK[most] ? change.bump : most), 'none');
}

/**
 * The same description with every list sorted and the bounds in key order, so
 * two descriptions of one contract compare equal however the file was written.
 */
export function canonicalSurface(surface: ApiSurface): ApiSurface {
  const sorted = (list: readonly string[]): string[] => [...list].sort();
  return {
    version: surface.version,
    exports: { values: sorted(surface.exports.values), types: sorted(surface.exports.types) },
    blueprint: { required: sorted(surface.blueprint.required), optional: sorted(surface.blueprint.optional) },
    shellApi: { required: sorted(surface.shellApi.required), optional: sorted(surface.shellApi.optional) },
    sharedModules: {
      react: sorted(surface.sharedModules.react),
      'react-jsx-runtime': sorted(surface.sharedModules['react-jsx-runtime']),
      reactMajor: surface.sharedModules.reactMajor,
    },
    hotkeyKeys: sorted(surface.hotkeyKeys),
    hotkeyModifierRequiredKeys: sorted(surface.hotkeyModifierRequiredKeys),
    extensionIdPattern: surface.extensionIdPattern,
    textForbiddenPattern: surface.textForbiddenPattern,
    textInvisiblePattern: surface.textInvisiblePattern,
    reservedIds: sorted(surface.reservedIds),
    registryLimits: Object.fromEntries(
      Object.entries(surface.registryLimits).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/**
 * Every reason `current` may not stand against `baseline`; empty when it may.
 *
 * In order: both versions must be `major.minor`; the version must not go
 * backwards; it may move by one step only — `M.m` to `M+1.0` or `M.m+1`, so a
 * skipped number or a major that keeps its minor is refused; it must move by at least what `diffSurface` requires; and once it
 * has, the baseline must be re-recorded — the last message carries the
 * description to record, so the honest path is one paste. A baseline that
 * matches the source exactly, version included, is the only passing state.
 */
export function assessContract(baseline: ApiSurface, current: ApiSurface): string[] {
  const from = parseHostApiVersion(baseline.version);
  const to = parseHostApiVersion(current.version);
  if (from === null || to === null) {
    return [
      `HOST_API_VERSION must be "major.minor"; the baseline records "${baseline.version}" and the SDK exports "${current.version}".`,
    ];
  }
  if (to.major < from.major || (to.major === from.major && to.minor < from.minor)) {
    return [`HOST_API_VERSION went backwards: the baseline records ${baseline.version}, the SDK exports ${current.version}.`];
  }
  const changes = diffSurface(baseline, current);
  const needed = requiredBump(changes);
  const moved: Bump | null =
    to.major === from.major && to.minor === from.minor
      ? 'none'
      : to.major === from.major + 1 && to.minor === 0
        ? 'major'
        : to.major === from.major && to.minor === from.minor + 1
          ? 'minor'
          : null;
  if (moved === null) {
    return [
      `HOST_API_VERSION moved from ${baseline.version} to ${current.version}, which is not one step: ` +
        `the next major is ${from.major + 1}.0 and the next minor is ${from.major}.${from.minor + 1}.`,
    ];
  }
  if (RANK[moved] < RANK[needed]) {
    return [
      `The contract changed and HOST_API_VERSION did not move by what the change requires: ` +
        `it needs a ${needed} bump from ${baseline.version}, and the SDK exports ${current.version}. ` +
        `Move HOST_API_VERSION in src/sdk/index.ts first. The changes:\n` +
        changes.map((change) => `  - [${change.bump}] ${change.reason}`).join('\n'),
    ];
  }
  const recorded = JSON.stringify(canonicalSurface(current), null, 2);
  if (JSON.stringify(canonicalSurface(baseline), null, 2) !== recorded) {
    return [
      `src/sdk/api-surface.json does not record the contract as it stands (version ${current.version}). ` +
        `The version moved far enough; record the new baseline by replacing the file with:\n${recorded}\n`,
    ];
  }
  return [];
}
