import type { ReactElement } from 'react';

/**
 * ============================================================================
 * THE HOST'S ICON VOCABULARY. ONE TABLE, TWO RENDER SITES.
 * ============================================================================
 * A plug-in's `icon` — on a `RibbonAction` since ISSUE-001, and on a
 * `NavigationNode` since GitHub issue #19 — is a LOOKUP KEY and nothing else. It
 * is never markup, never a URL, never a `src`, never a `style`. This module owns
 * the only geometry the shell draws for one, and every path in it is
 * host-authored.
 *
 * **This table used to be module-private in `RibbonToolbar.tsx`, and it moved
 * here rather than being copied.** Two surfaces resolve an icon key now — the
 * ribbon button and the collapsed 48px navigation track — and two copies of a
 * lookup table drift exactly the way two copies of a validation rule do: one
 * gains a key, the other does not, and an extension's icon renders on one surface
 * and falls back on the other with nothing to say why. It is the same argument
 * ADR-0001 Amendment J Decision 1 makes for extracting `isVisible`/`execute`
 * before adding a second route to them.
 *
 * **A `Map`, not a `Record`, and the reason is preserved verbatim from where it
 * was written.** The key is untrusted, and an object literal answers
 * `icons['__proto__']` with `Object.prototype` — an object React refuses to
 * render, reached from a key that matches no own property. A `Map` has no
 * prototype chain to inherit from, so a prototype-shaped key resolves to nothing
 * and falls back like any other unknown key. That property is the reason this is
 * a `Map` and it must survive any edit to this file. *Tests:*
 * `src/components/__tests__/RibbonToolbar.test.tsx` — "does not resolve a
 * prototype-shaped icon key to anything inherited";
 * `src/components/__tests__/ShellLayoutIcons.test.tsx` — "does not resolve a
 * prototype-shaped node icon key to anything inherited".
 *
 * **Every object-valued export here is frozen, and this module is inside the
 * freeze gate.** `ReadonlyMap` is a COMPILE-TIME type and binds nobody who is not
 * being compiled, so until the 2026-08-16 landing an importer could assign an own
 * `get` onto `SHELL_ICONS` and shadow the prototype method all three call sites
 * invoke — returning an attacker-chosen `ReactElement` that the host draws in its
 * own navigation rail and ribbon, outside any `ExtensionHostBoundary`. That is
 * `as const` on `REGISTRY_LIMITS` before issue #10, in a second module. The module
 * is now listed in `GATED_MODULES` in `src/core/__tests__/hostConstants.test.ts`,
 * so the next constant added to this file is covered without anyone acting.
 *
 * **What the freeze buys, stated narrowly, because the wider reading is false.**
 * It buys that `get` cannot be REPLACED by an own property. It does NOT make the
 * map immutable and no prose about it may say so: `Map` state lives in internal
 * slots rather than in properties, so `set`, `delete` and `clear` go on working on
 * a frozen instance exactly as `add` does on a frozen `Set`. Shadowing was the
 * interesting attack — an importer owning `SHELL_ICONS.get` owns every glyph the
 * host chrome draws — and shadowing is what is closed. *Tests:*
 * `src/core/__tests__/hostConstants.test.ts` — "freezes the host constants against
 * replacement", "refuses to let a caller shadow an interrogation method on %s" and
 * "does not claim more than a frozen Map delivers";
 * `src/components/__tests__/ShellLayoutIcons.test.tsx` — "refuses an own get on the
 * icon table, so the collapsed track still draws host geometry";
 * `src/components/__tests__/RibbonToolbar.test.tsx` — "refuses an own get on the
 * icon table, so the ribbon still draws host geometry".
 *
 * The vocabulary is PUBLISHED, which it was not: an author who guessed a key
 * wrong got the fallback glyph and no way to find out what the real keys were.
 * `DEVELOPER.md` now lists every key in this map, and
 * `src/components/__tests__/ShellLayoutIcons.test.tsx` — "publishes every icon key
 * in DEVELOPER.md, and no key it does not have" — reads both and fails if they
 * disagree, so the list cannot go stale by omission or by invention.
 * ============================================================================
 */

/**
 * Inline SVG built from one or more path commands.
 *
 * Host-authored geometry only. Nothing a plug-in supplies ever reaches `d`; the
 * plug-in's contribution is a key into the map below and nothing else.
 */
function glyph(paths: readonly string[]): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The host's icon vocabulary. An extension names one of these keys; anything
 * else gets `FALLBACK_ICON`.
 *
 * The last four entries are new with GitHub issue #19. They are named for SHAPES
 * rather than for the mock extension that wanted them — `box`, `layers`,
 * `droplet`, `folder`, not `component`, `assembly`, `consumable` — because a
 * vocabulary named after one vendor's domain is a vocabulary the next vendor
 * cannot use.
 */
export const SHELL_ICONS: ReadonlyMap<string, ReactElement> = Object.freeze(
  new Map<string, ReactElement>([
    ['save', glyph(['M3 3h7l3 3v7H3z', 'M6 3v3h3', 'M5.5 13V9.5h5V13'])],
    ['open', glyph(['M2 4.5h4L7.5 6.5H14V13H2z'])],
    ['edit', glyph(['M11 2.5 13.5 5l-7.5 7.5H3.5V10z'])],
    ['delete', glyph(['M3 4.5h10', 'M6.5 4.5V2.5h3v2', 'M4.5 4.5 5.5 13.5h5l1-9'])],
    ['refresh', glyph(['M13 8a5 5 0 1 1-1.6-3.7', 'M13 2v3h-3'])],
    ['search', glyph(['M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M10.5 10.5 14 14'])],
    ['add', glyph(['M8 3v10', 'M3 8h10'])],
    [
      'settings',
      glyph([
        'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
        'M8 1.5v2',
        'M8 12.5v2',
        'M1.5 8h2',
        'M12.5 8h2',
      ]),
    ],
    ['navigation', glyph(['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'])],
    ['drawer', glyph(['M2.5 3h11v10h-11z', 'M10 3v10'])],
    ['close', glyph(['M4 4l8 8', 'M12 4l-8 8'])],
    ['folder', glyph(['M2 4h4.5L8 5.5h6V13H2z'])],
    ['box', glyph(['M8 2 14 5v6l-6 3-6-3V5z', 'M2 5l6 3 6-3', 'M8 8v6'])],
    ['layers', glyph(['M8 2 14 5 8 8 2 5z', 'M2 8.5 8 11.5 14 8.5', 'M2 11.5 8 14.5 14 11.5'])],
    ['droplet', glyph(['M8 2s4 4.5 4 7a4 4 0 0 1-8 0c0-2.5 4-7 4-7z'])],
  ]),
);

/**
 * Shown for any icon key the host does not publish.
 *
 * **Frozen here rather than left to React, and the difference is not academic.**
 * React freezes a `ReactElement` and its props in DEVELOPMENT builds only — the
 * `Object.freeze` pair lives inside the `__DEV__` branch of the JSX runtime — so
 * under Vitest this element arrives frozen already and in the shipped production
 * bundle it does not. Without the call below, the freeze gate would pass for a
 * reason that does not hold where it matters. Same claim as the map's: the
 * element cannot be REPLACED property-wise, which is what stops an importer
 * repointing `type` or `props` at its own geometry.
 */
export const FALLBACK_ICON: ReactElement = Object.freeze(glyph(['M3.5 3.5h9v9h-9z']));

/**
 * The overflow-menu glyph. Deliberately NOT an entry in `SHELL_ICONS`: that map
 * is the vocabulary offered to extensions, the overflow button is host chrome,
 * and looking it up through the map would add a fallback branch that no input can
 * ever reach.
 *
 * Frozen for the reason given on `FALLBACK_ICON`: React's own element freeze is
 * development-only, and this module is inside the freeze gate.
 */
export const OVERFLOW_ICON: ReactElement = Object.freeze(
  glyph(['M4 8h.01', 'M8 8h.01', 'M12 8h.01']),
);
