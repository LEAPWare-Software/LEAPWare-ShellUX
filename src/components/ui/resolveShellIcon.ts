import type { ReactElement } from 'react';
import { FALLBACK_ICON, SHELL_ICONS } from './shellIcons';

// A `.ts` module of its own rather than an export of `./shellIcons.tsx`: a
// function exported beside components trips `react-refresh/only-export-components`,
// and this repository states such exceptions in config or not at all.
/**
 * The one lookup from an untrusted icon key to a host glyph: a published key
 * draws its glyph, anything else draws `FALLBACK_ICON`. The key reaches nothing
 * but `Map.prototype.get`, so no string a plugin writes is ever drawn as markup.
 * A navigation node's `icon`, a command's `icon` and a plugin manifest's `icon`
 * (ADR-0006 decision 1, D-40) all resolve here, so the three cannot drift apart.
 * Deciding the monogram for a key that is absent stays with the caller, because
 * only the caller has the label it is drawn from. *Tests:*
 * `src/components/__tests__/ShellLayoutIcons.test.tsx` — "falls back to the host
 * glyph for an icon key the host does not publish";
 * `electron/__tests__/pluginPackage.test.ts` — "resolves a manifest icon key the
 * host does not publish to the host fallback glyph, and keeps no icon when the
 * manifest gives none".
 */
export function resolveShellIcon(key: string): ReactElement {
  return SHELL_ICONS.get(key) ?? FALLBACK_ICON;
}
