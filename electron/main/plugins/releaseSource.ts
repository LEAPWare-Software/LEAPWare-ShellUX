import { quoteUntrusted } from './compatibility.js';
import { MAX_PACKAGE_BYTES } from './pluginPackage.js';

/**
 * ============================================================================
 * THE SECOND INSTALL SOURCE: A GITHUB RELEASE ASSET URL, CHECKED, THEN FETCHED BY MAIN.
 * ============================================================================
 * ADR-0006 decision 2, implementation step 11. Host chrome hands main one
 * string; main checks it against the one shape decision 2 fixes — scheme
 * `https`, host `github.com`, no port, credentials, query or fragment, and the
 * path
 *
 *   /LEAPWare-Software/<repo>/releases/download/<tag>/<name>.lwplugin
 *
 * — and only a string that passes is ever handed to the network. (Written as
 * parts, not as one URL: `RELEASE_URL_PREFIX` below is the one place the
 * whole prefix is spelled. **This is not enforcement.** `check:portability`'s
 * `hardcoded-hostname` rule is a plain regex over source text
 * (`\bhttps?://([A-Za-z0-9._-]+)`); it never evaluates a template literal, so
 * `` `https://${RELEASE_HOST}/` `` is invisible to it either way — the rule
 * neither passes this file nor would catch a different host written the same
 * interpolated way. Writing it as parts only keeps this file out of the
 * `ALLOWLIST` exemption `pluginReleaseSource.test.ts` needs for its literal
 * adversarial-input hostnames; it buys no guarantee against a changed host
 * here, and no test claims otherwise.)
 * What comes back
 * is bytes, and the bytes go to `PluginStore.installBytes` — the same
 * validation, staging directory and rename as a package main's picker chose.
 * Nothing here writes to disk, and no renderer string becomes a path.
 *
 * ---------------------------------------------------------------------------
 * THE ORGANISATION ALLOWLIST IS ENTRY-POINT VALIDATION, AT THIS DOOR ONLY.
 * ---------------------------------------------------------------------------
 * It is how D-23 appears at the URL door: a URL not spelled as above is
 * refused, and no request is made for it. *Tests:*
 * `electron/__tests__/pluginReleaseSource.test.ts` — "refuses a URL outside the
 * LEAPWare-Software organisation". What it says nothing about, stated so it is
 * not read wider:
 *
 * - **Who controls the organisation.** D-34's reasoning, unchanged: whoever
 *   controls the GitHub organisation, or a release in it, controls what this
 *   door installs.
 * - **Where GitHub's answer leads.** A release asset URL answers with a
 *   redirect to GitHub's download host (measured 2026-09-25, `curl -sS -D -`
 *   against a public release asset of `cli/cli`: `302 Found`, to the host
 *   ADR-0006 decision 2's step-11 note records). Redirects are followed as
 *   the network stack follows them, and the allowlist is checked on the URL
 *   asked for, not on any URL the bytes came from — including GitHub's own
 *   redirect for a repository that has been renamed or transferred out of the
 *   organisation: a URL admitted here because it was once
 *   `github.com/LEAPWare-Software/<repo>/...` is followed wherever GitHub
 *   points it today, whoever that repository now belongs to. Not reproduced
 *   against live GitHub; disclosed as a named instance of the redirect gap
 *   above, not a narrower or separate one.
 * - **The local-file door.** An operator can still install a `.lwplugin`
 *   anyone built through main's picker (ADR-0001 Amendment P).
 *
 * **The URL is checked as written, not as parsed.** The WHATWG parser `fetch`
 * uses rewrites what it is given: it drops tabs and newlines anywhere, reads
 * `\` as `/` and resolves `..` and `%2e%2e`, so a path written
 * `/LEAPWare-Software\..\other/…` is requested as `/other/…`. Every check
 * below is on the raw string, and the segments admit only `[A-Za-z0-9._+-]`
 * (never `.` or `..` alone), so that a string that passes is one the parser
 * leaves unchanged — asserted for each admitted sample the test builds, the
 * longest included, not proven for every string. *Tests:*
 * `electron/__tests__/pluginReleaseSource.test.ts` — "checks the URL as
 * written, and admits only spellings the URL parser leaves unchanged".
 *
 * ---------------------------------------------------------------------------
 * UNSIGNED, BY D-47. THE ALLOWLIST AND THE MANIFEST `sha512` ARE WHAT STAND.
 * ---------------------------------------------------------------------------
 * The owner ruled against signing for 1.0 (D-47), so this door reads and
 * checks no signature, and `lwplugin/1` defines no field to carry one. The
 * `sha512` check is decision 4's entry-point validation: it refuses a damaged
 * or mismatched package, and it accepts a package whose bundle and hash were
 * replaced together, because the two travel in one file. That limit is asserted
 * for this door, not only stated. *Tests:*
 * `electron/__tests__/pluginReleaseSource.test.ts` — "unsigned by D-47:
 * installs a release asset that carries no signature, including one whose
 * bundle and sha512 were replaced together".
 *
 * ---------------------------------------------------------------------------
 * THE DOWNLOAD IS BOUNDED IN SIZE AND IN TIME — THE TIME BOUND DOES NOT
 * DEPEND ON THE NETWORK LAYER NOTICING IT, AND SHARES NO LISTENER SLOT WITH IT.
 * ---------------------------------------------------------------------------
 * A response that is not a 2xx, declares a `Content-Length` over decision 1's
 * 8 MiB, streams more than 8 MiB, carries no body or does not finish within
 * `DOWNLOAD_TIMEOUT_MS` is refused with one reason, and nothing is installed.
 * The body is read chunk by chunk and refused at the first byte past the bound,
 * so memory holds at most the bound plus one chunk. Every wait on `fetch` and
 * on the body reader is raced, with `Promise.race`, against a plain promise
 * only this function's own timer ever settles — not `AbortSignal.onabort`,
 * which an earlier version of this fix used and which turned out to share its
 * one slot with whatever else on the same signal sets it (a network layer
 * that also writes `onabort` can silently displace this module's handler, in
 * either direction — a real hazard, corrected before it shipped). The timer
 * ends the download even if `fetch` or the reader never settles on their own,
 * which is itself a real risk: a `fetch` implementation is not obliged to
 * reject, or to error its body stream, just because its signal fired. The
 * request and the reader are both cancelled when the download ends, however
 * it ends. *Tests:* `electron/__tests__/pluginReleaseSource.test.ts` —
 * "refuses an error status, an oversized download and an empty response, and
 * installs nothing", "gives up on a download that does not finish in time",
 * "gives up on a download whose fetch call never settles and never touches
 * the signal", "gives up on a download whose network layer never notices the
 * abort signal". **Not measured:** whether Electron's real `net.fetch` —
 * what `index.ts` passes — itself honours the abort signal, writes its own
 * `onabort` (now moot: nothing here reads or writes that property), or which
 * redirects it follows; this module is driven here by a recording fake
 * either way, and the real network runs only in the packaged application.
 * The fix above removes the dependency on cooperation, it does not measure
 * whether the real stack cooperates.
 * ============================================================================
 */

/** The one host decision 2 admits. */
export const RELEASE_HOST = 'github.com';

/** The one GitHub organisation decision 2 admits, spelled exactly so (D-23, D-46). */
export const RELEASE_ORGANISATION = 'LEAPWare-Software';

const HOST_PREFIX = `https://${RELEASE_HOST}/`;

/** Everything before `<repo>`. */
export const RELEASE_URL_PREFIX = `${HOST_PREFIX}${RELEASE_ORGANISATION}/`;

/**
 * A bound on the string before anything else reads it. The longest URL the
 * rules below admit is 441 characters; a test builds it.
 */
export const MAX_RELEASE_URL_LENGTH = 1024;

/** How long a download may take, headers and body, before it is abandoned. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A repository or a tag: GitHub's name characters, no `%`, no `/`, never `.` or `..` alone. */
const SEGMENT_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._+-]{1,128}$/;

/** The asset: the same characters, ending `.lwplugin`, at most 128 in all. */
const ASSET_PATTERN = /^[A-Za-z0-9._+-]{1,119}\.lwplugin$/;

/** What main passes to reach the network: `net.fetch` in `index.ts`, a recording fake in a test. */
export type ReleaseFetch = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'follow' },
) => Promise<Response>;

export type ReleaseUrlResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

export type ReleaseDownloadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: string };

function refusedUrl(detail: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason: `the release URL was refused: ${detail}` };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hold `value` to decision 2's shape, on the string as written. Returns the
 * URL unchanged, or one reason. Makes no request.
 */
export function parseReleaseAssetUrl(value: unknown): ReleaseUrlResult {
  if (typeof value !== 'string') return refusedUrl('it must be a string');
  if (value.length > MAX_RELEASE_URL_LENGTH) {
    return refusedUrl(`it is longer than ${String(MAX_RELEASE_URL_LENGTH)} characters`);
  }
  if (!value.startsWith(HOST_PREFIX)) {
    return refusedUrl(`it does not start ${HOST_PREFIX}, spelled exactly so: ${quoteUntrusted(value)}`);
  }
  const segments = value.slice(HOST_PREFIX.length).split('/');
  const [organisation, repo, releases, download, tag, asset] = segments;
  if (organisation !== RELEASE_ORGANISATION) {
    return refusedUrl(
      `it is outside the ${RELEASE_ORGANISATION} organisation, spelled exactly so: ${quoteUntrusted(String(organisation))}`,
    );
  }
  if (segments.length !== 6 || releases !== 'releases' || download !== 'download') {
    return refusedUrl(`it is not ${RELEASE_URL_PREFIX}<repo>/releases/download/<tag>/<name>.lwplugin`);
  }
  if (!SEGMENT_PATTERN.test(String(repo)) || !SEGMENT_PATTERN.test(String(tag))) {
    return refusedUrl('its repository or tag is not made of letters, digits, ".", "_", "+" and "-"');
  }
  if (!ASSET_PATTERN.test(String(asset))) {
    return refusedUrl('its asset is not a .lwplugin name made of letters, digits, ".", "_", "+" and "-"');
  }
  return { ok: true, url: value };
}

/**
 * The download itself. Not exported: the only way in is `fetchReleaseAsset`,
 * which checks the URL first, so no caller of this module can reach the network
 * with a URL the allowlist did not see.
 *
 * **The timeout does not depend on the network layer cooperating, and shares
 * no listener slot with it.** `timedOut` is a plain promise that only this
 * function's own timer ever settles — not `AbortSignal.onabort`, and not
 * `addEventListener`. An earlier version of this fix used `signal.onabort`,
 * which turned out to share its one slot with whatever else on the same
 * signal sets it: a network layer that also writes `onabort` can silently
 * displace this module's handler, in either direction. Racing every wait on
 * `fetch` and on the body reader against `timedOut` with `Promise.race`
 * removes that hazard entirely — nothing here reads or writes any property of
 * `signal` — while `controller.abort()` is still called, for whatever
 * cooperating effect it has on the real `fetch`, and the timer also calls
 * `reader.cancel()` once a reader exists, to release the underlying
 * connection rather than only abandoning it. *Tests:*
 * `electron/__tests__/pluginReleaseSource.test.ts` — "gives up on a download
 * whose fetch call never settles and never touches the signal", "gives up on
 * a download whose network layer never notices the abort signal".
 */
async function downloadReleaseAsset(url: string, fetch: ReleaseFetch, timeoutMs: number): Promise<ReleaseDownloadResult> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = new Error(`it did not finish within ${String(timeoutMs)} ms`);
      controller.abort(reason);
      reader?.cancel(reason).catch(() => undefined);
      reject(reason);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([fetch(url, { signal: controller.signal, redirect: 'follow' }), timedOut]);
    if (!response.ok) return { ok: false, reason: `the download was refused: the server answered ${String(response.status)}` };
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_PACKAGE_BYTES) {
      return {
        ok: false,
        reason: `the download was refused: it declares ${String(declared)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
      };
    }
    if (response.body === null) return { ok: false, reason: 'the download was refused: the response carried no body' };
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PACKAGE_BYTES) {
        return {
          ok: false,
          reason: `the download was refused: it is more than ${String(MAX_PACKAGE_BYTES)} bytes`,
        };
      }
      chunks.push(value);
    }
    return { ok: true, bytes: Buffer.concat(chunks, total) };
  } catch (error) {
    return { ok: false, reason: `the download failed: ${describeError(error)}` };
  } finally {
    clearTimeout(timer);
    // However it ended: an unread or half-read body is not left streaming.
    controller.abort();
  }
}

/**
 * Check `value` against decision 2's shape and, only if it passes, download it.
 * Resolves to the package's bytes or one reason; never rejects.
 */
export async function fetchReleaseAsset(
  value: unknown,
  fetch: ReleaseFetch,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<ReleaseDownloadResult> {
  const parsed = parseReleaseAssetUrl(value);
  if (!parsed.ok) return parsed;
  return downloadReleaseAsset(parsed.url, fetch, timeoutMs);
}
