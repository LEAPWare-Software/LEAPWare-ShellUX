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
 * | `IShellAPI` members | a member removed | a member added |
 * | `HOTKEY_KEYS` (an allowlist) | a key removed | a key added |
 * | `HOTKEY_MODIFIER_REQUIRED_KEYS`, `RESERVED_IDS` (denylists) | an entry added | an entry removed |
 * | `EXTENSION_ID_PATTERN` | any change to its source | — |
 * | `REGISTRY_LIMITS` | a bound added or lowered | a bound removed or raised |
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
  /** `IShellAPI`'s member names. */
  readonly shellApi: readonly string[];
  readonly hotkeyKeys: readonly string[];
  readonly hotkeyModifierRequiredKeys: readonly string[];
  /** `EXTENSION_ID_PATTERN.source`. */
  readonly extensionIdPattern: string;
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
    ...listChanges('IShellAPI', before.shellApi, after.shellApi, 'minor'),
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
  if (before.extensionIdPattern !== after.extensionIdPattern) {
    changes.push({
      bump: 'major',
      reason: `EXTENSION_ID_PATTERN: /${before.extensionIdPattern}/ → /${after.extensionIdPattern}/`,
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
    shellApi: sorted(surface.shellApi),
    hotkeyKeys: sorted(surface.hotkeyKeys),
    hotkeyModifierRequiredKeys: sorted(surface.hotkeyModifierRequiredKeys),
    extensionIdPattern: surface.extensionIdPattern,
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
 * backwards; it must move by at least what `diffSurface` requires; and once it
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
  const moved: Bump = to.major > from.major ? 'major' : to.minor > from.minor ? 'minor' : 'none';
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
