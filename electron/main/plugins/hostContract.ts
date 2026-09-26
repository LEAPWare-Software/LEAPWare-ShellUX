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
 * version, id pattern, text patterns, reserved ids and text bound".
 * ============================================================================
 */

/** `HOST_API_VERSION`, `major.minor`, as `src/sdk/index.ts` exports it. */
export const HOST_API_VERSION = '2.0';

/** `EXTENSION_ID_PATTERN`, as the registry enforces it at `register`. */
export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Mirrors of `TEXT_FORBIDDEN_PATTERN` and `TEXT_INVISIBLE_PATTERN` from
 * `src/core/RegistryContext.tsx` (D-56, GitHub issue #172), for the same
 * reason `EXTENSION_ID_PATTERN` above is mirrored here: main cannot import
 * `src/`. This is a **guardrail**, not entry-point validation on its own —
 * real only insofar as it is kept in step with the registry's copies, which
 * the baseline test below holds it to. `pluginPackage.ts`'s manifest-title
 * check is the entry-point validation that actually applies these.
 *
 * No `g` flag on `TEXT_INVISIBLE_PATTERN`, same reasoning as the registry's
 * copy: a shared `g`-flagged `RegExp` is stateful across calls
 * (`/a/g.test('a')` → `true` then `false` on the same input), so every call
 * site builds its own fresh `'gu'` copy: `value.replace(new
 * RegExp(TEXT_INVISIBLE_PATTERN.source, 'gu'), '')`.
 */
export const TEXT_FORBIDDEN_PATTERN = /[\p{Cc}\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFFF9-\uFFFB\u206A-\u206F]/u;

/** See `TEXT_FORBIDDEN_PATTERN` above. */
export const TEXT_INVISIBLE_PATTERN = /[\u00AD\u115F\u1160\u180B-\u180F\u200B-\u200D\u2060-\u2065\u034F\u17B4\u17B5\u3164\uFEFF\uFFA0\uFFF0-\uFFF8\uFE00-\uFE0F\u2800\u{E0080}-\u{E0FFF}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u;

/** `RESERVED_IDS`, as the registry refuses them. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** `REGISTRY_LIMITS.MAX_TEXT_LENGTH`: the bound the registry puts on a blueprint `name`. */
export const MAX_TEXT_LENGTH = 256;
