/**
 * ============================================================================
 * THE `hostApiVersion` RULE: ONE NUMBER, COMPARED BEFORE THE BUNDLE IS SERVED.
 * ============================================================================
 * ADR-0006 decision 3, in #28's OSGi register. A plugin states the host
 * contract it was built against; the host states the one it offers. Both are
 * `major.minor`, the form `HOST_API_VERSION` takes in `src/sdk/index.ts`.
 *
 * | Host vs plugin                          | State        |
 * |-----------------------------------------|--------------|
 * | Major differs                           | incompatible |
 * | Same major, plugin minor > host minor   | incompatible |
 * | Same major, plugin minor <= host minor  | compatible   |
 *
 * A major that differs is refused in **both** directions: a plugin built for an
 * older major may call a member that major removed, and a newer one may rely on
 * one that does not exist yet. The rule decides a state, not an install: what
 * the store does with an incompatible plugin is step 4's.
 *
 * *Tests:* `electron/__tests__/pluginPackage.test.ts` — "marks a plugin
 * incompatible when its major differs", "marks a plugin incompatible when it
 * needs a newer minor than the host offers".
 * ============================================================================
 */

/**
 * `major.minor`, each part a non-negative integer of at most nine digits with no
 * leading zero. Nine digits keeps every part an exact `Number`, so the
 * comparison below is integer arithmetic and never a string comparison.
 */
export const CONTRACT_VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/** What the rule decides for one plugin against one host. */
export type Compatibility =
  | { readonly state: 'compatible' }
  | { readonly state: 'incompatible'; readonly reason: string };

/** `[major, minor]`, or `null` for a string that is not `major.minor`. */
function partsOf(version: string): readonly [number, number] | null {
  const match = CONTRACT_VERSION_PATTERN.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

/**
 * The state of a plugin built against `pluginVersion` on a host offering
 * `hostVersion`. The manifest validator refuses a plugin version that is not
 * `major.minor` before it gets here; this function still answers for one,
 * incompatible and saying why, rather than guessing at a number.
 */
export function compareHostApiVersion(pluginVersion: string, hostVersion: string): Compatibility {
  const plugin = partsOf(pluginVersion);
  const host = partsOf(hostVersion);
  if (plugin === null || host === null) {
    return {
      state: 'incompatible',
      reason: `host contract versions must be "major.minor"; the plugin states "${pluginVersion}", this shell offers "${hostVersion}"`,
    };
  }
  const [pluginMajor, pluginMinor] = plugin;
  const [hostMajor, hostMinor] = host;
  if (pluginMajor !== hostMajor) {
    return {
      state: 'incompatible',
      reason: `built for host contract ${String(pluginMajor)}, this shell offers ${String(hostMajor)}`,
    };
  }
  if (pluginMinor > hostMinor) {
    return {
      state: 'incompatible',
      reason: `needs contract ${pluginVersion}, this shell offers ${hostVersion}`,
    };
  }
  return { state: 'compatible' };
}
