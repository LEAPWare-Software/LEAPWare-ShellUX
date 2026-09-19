/**
 * ============================================================================
 * THE HOST CONTRACT, AS MAIN READS IT: A MIRROR OF THE SDK BASELINE.
 * ============================================================================
 * ADR-0006 decision 3 has main compare a plugin's `hostApiVersion` with the
 * host's before a byte of the plugin is served. The host's number is
 * `HOST_API_VERSION` in `src/sdk/index.ts`, and main cannot import `src/`
 * (ADR-0001 Amendment O decision 6: `NodeNext` against extensionless imports).
 * Step 3 decided how main reads it; the decision and the two routes rejected are
 * recorded in ADR-0006's dated note of 2026-09-19 under decision 3.
 *
 * **The decision: these constants are written here, and a test holds them to
 * the committed baseline.** `src/sdk/api-surface.json` already records the SDK
 * version, the id pattern, the reserved ids and the registry's text bound; a
 * suite that reads it fails when this file and the baseline disagree, and a
 * second assertion holds the version to the SDK's own export. That is a
 * **guardrail**: it makes an honest omission loud, and a hand edit to both
 * sides is deliberate action it does not stop. *Tests:*
 * `electron/__tests__/pluginPackage.test.ts` — "mirrors the SDK baseline's
 * version, id pattern, reserved ids and text bound".
 * ============================================================================
 */

/** `HOST_API_VERSION`, `major.minor`, as `src/sdk/index.ts` exports it. */
export const HOST_API_VERSION = '1.0';

/** `EXTENSION_ID_PATTERN`, as the registry enforces it at `register`. */
export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `RESERVED_IDS`, as the registry refuses them. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** `REGISTRY_LIMITS.MAX_TEXT_LENGTH`: the bound the registry puts on a blueprint `name`. */
export const MAX_TEXT_LENGTH = 256;
