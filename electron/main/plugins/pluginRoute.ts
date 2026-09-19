import { EXTENSION_ID_PATTERN, RESERVED_IDS } from './hostContract.js';
import { PACKAGE_ENTRY, PLUGIN_VERSION_PATTERN } from './pluginPackage.js';
import type { PluginStore } from './pluginStore.js';

/**
 * ============================================================================
 * THE `/plugins/` ROUTE: CONSTRUCTED, NOT FILTERED.
 * ============================================================================
 * ADR-0006 decision 5, implementation step 4. The scheme handler in
 * `electron/main/rendererCsp.ts` hands every request under `/plugins/` here,
 * and never to its own file fetcher, so no path under `/plugins/` is ever joined
 * to `dist/`. This route answers exactly one shape,
 *
 *   shellux://renderer/plugins/<id>/<version>/bundle.js
 *
 * with an id that passes `EXTENSION_ID_PATTERN` and a version that passes the
 * manifest's `PLUGIN_VERSION_PATTERN`, read from the URL's pathname as written
 * (a percent-escape is not decoded, so it cannot spell a separator). The pair
 * is then LOOKED UP in `state.json` by `PluginStore.entryFor`, which serves only
 * an installed, enabled, compatible plugin at that exact version whose entry
 * still hashes to what was installed. Everything else under `/plugins/` —
 * `plugin.json`, `state.json`, a disabled or incompatible plugin, another
 * version, a traversal — is a 404. The handler adds the Content-Security-Policy
 * to whatever this returns. *Tests:* `electron/__tests__/pluginScheme.test.ts` —
 * "serves only the entry of an installed, enabled, compatible plugin", "answers
 * 404 for every other path under /plugins/, and never reads dist for one".
 * ============================================================================
 */

/** The route's prefix, as the handler matches it. */
export const PLUGIN_ROUTE_PREFIX = '/plugins/';

const ENTRY_PATH_PATTERN = new RegExp(`^/plugins/([^/]+)/([^/]+)/${PACKAGE_ENTRY.replace('.', '\\.')}$`);

/** The URL path an installed plugin's entry is served at. */
export function pluginEntryPath(id: string, version: string): string {
  return `${PLUGIN_ROUTE_PREFIX}${id}/${version}/${PACKAGE_ENTRY}`;
}

/**
 * Whether the scheme handler must send `requestUrl` to this route rather than to
 * `dist/`. Decided on the DECODED pathname, lower-cased, so neither
 * `/plug%69ns/` nor `/PLUGINS/` reaches the file fetcher on a case-insensitive
 * filesystem. A URL that does not parse is not this route's; the handler's own
 * containment check refuses it.
 */
export function isPluginRequest(requestUrl: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname).toLowerCase();
  } catch {
    return false;
  }
  return pathname === '/plugins' || pathname.startsWith(PLUGIN_ROUTE_PREFIX);
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** The route, over a store. */
export function createPluginRoute(
  store: Pick<PluginStore, 'entryFor'>,
  warn: (message: string) => void,
): (requestUrl: string) => Response {
  return (requestUrl) => {
    const match = ENTRY_PATH_PATTERN.exec(new URL(requestUrl).pathname);
    if (match === null) {
      warn(`plugin route: no such path: ${requestUrl}`);
      return notFound();
    }
    const [, id, version] = match as unknown as [string, string, string];
    if (!EXTENSION_ID_PATTERN.test(id) || RESERVED_IDS.has(id) || !PLUGIN_VERSION_PATTERN.test(version)) {
      warn(`plugin route: not an id and a version: ${requestUrl}`);
      return notFound();
    }
    const entry = store.entryFor(id, version);
    if (!entry.ok) {
      warn(`plugin route: refused ${id} ${version}: ${entry.reason}`);
      return notFound();
    }
    return new Response(entry.value, {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
    });
  };
}
