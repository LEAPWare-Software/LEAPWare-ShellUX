import type { Hotkey } from './types';

/**
 * ============================================================================
 * THREE PURE FUNCTIONS OVER A CHORD. NO DOM, NO LISTENER, NO DISPATCHER.
 * ============================================================================
 * This module attaches nothing. It has no `addEventListener`, no `window`, no
 * `document` and no React import; every export is a total function of its
 * arguments. `matchesHotkey` takes the five fields of a keyboard event it
 * actually needs rather than an event object, so it can be called on a plain
 * record and holds no reference to anything live.
 *
 * **The dispatcher is deliberately absent, and this is Phase 1's scope line.**
 * A dispatcher needs two things this layer has no view of: which extension is in
 * the foreground (a hotkey is live only for that one — see ADR-0001 Amendment H)
 * and the live `RibbonContext` that `isVisible` and `onExecute` are evaluated
 * against. Both arrive with the ribbon in Phase 2. What exists today is
 * declaration and validation at registration, and these three helpers, which is
 * what `RegistryContext.tsx` needs for intra-extension deduplication.
 *
 * `hotkeyToken` is the deduplication key today and the dispatch lookup key
 * later; keeping one canonical spelling in one function is what stops those two
 * uses drifting apart. Pinned by "hotkeyToken", "describeHotkey" and
 * "matchesHotkey" in `src/core/__tests__/hotkeys.test.ts`.
 * ============================================================================
 */

/**
 * Display labels for the multi-word key names, where simple capitalisation
 * would produce `Arrowup` rather than `ArrowUp`.
 *
 * Every other allowlisted key — the letters, the digits, the function keys and
 * the single-word navigation keys — reads correctly with its first character
 * upper-cased, so they are not listed. A `Map` rather than an object literal for
 * the same reason the registry uses one: a lookup on a plain object walks
 * `Object.prototype`, and `describeKey` is reachable with any string.
 */
const HOTKEY_KEY_LABELS: ReadonlyMap<string, string> = new Map([
  ['arrowup', 'ArrowUp'],
  ['arrowdown', 'ArrowDown'],
  ['arrowleft', 'ArrowLeft'],
  ['arrowright', 'ArrowRight'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
]);

function describeKey(key: string): string {
  const label = HOTKEY_KEY_LABELS.get(key);
  if (label !== undefined) {
    return label;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The canonical token for a chord: modifiers in the fixed order
 * `ctrl`, `alt`, `shift`, `meta`, then the lowercased key —
 * `"ctrl+alt+shift+meta+k"`.
 *
 * The order is fixed rather than derived from the declaration, so two authors
 * who spell the same chord with their fields in different orders produce the
 * same token and collide as they should. Absent and `false` are the same token,
 * which is why a chord declared `{ key: 'k', ctrl: true }` and one declared
 * `{ key: 'k', ctrl: true, shift: false }` are one chord and not two.
 *
 * Not a user-facing string — see `describeHotkey` for that.
 */
export function hotkeyToken(hotkey: Hotkey): string {
  let token = '';
  if (hotkey.ctrl === true) {
    token += 'ctrl+';
  }
  if (hotkey.alt === true) {
    token += 'alt+';
  }
  if (hotkey.shift === true) {
    token += 'shift+';
  }
  if (hotkey.meta === true) {
    token += 'meta+';
  }
  return `${token}${hotkey.key.toLowerCase()}`;
}

/**
 * The human-readable spelling of a chord — `"Ctrl+Shift+K"`.
 *
 * Intended for a tooltip and for the `aria-keyshortcuts` attribute a ribbon
 * renderer will emit in Phase 2. Nothing renders it today.
 *
 * `Meta` is spelled `Meta` rather than `Cmd` or `Win`: this module cannot see
 * the platform, and guessing wrong prints a key the user does not have. A
 * renderer that knows its platform may substitute.
 */
export function describeHotkey(hotkey: Hotkey): string {
  let prefix = '';
  if (hotkey.ctrl === true) {
    prefix += 'Ctrl+';
  }
  if (hotkey.alt === true) {
    prefix += 'Alt+';
  }
  if (hotkey.shift === true) {
    prefix += 'Shift+';
  }
  if (hotkey.meta === true) {
    prefix += 'Meta+';
  }
  return `${prefix}${describeKey(hotkey.key.toLowerCase())}`;
}

/**
 * Whether a keyboard event is exactly this chord.
 *
 * **Exactly**, in both directions: a modifier the chord does not declare must
 * also not be held. `{ key: 'k', ctrl: true }` does not match `Ctrl+Shift+K`,
 * because otherwise every chord would swallow the supersets of itself and an
 * extension declaring `Ctrl+K` would silently shadow another declaring
 * `Ctrl+Shift+K`.
 *
 * The key comparison is on `event.key` lowercased, which is layout-dependent by
 * design — ADR-0001 Amendment H, and the `Hotkey` docblock in `types.ts`.
 *
 * A pure predicate. It registers nothing, reads no ambient state, and does not
 * call `preventDefault` — the parameter type is a `Pick` of exactly the five
 * fields it reads, so there is no event object to act on.
 */
export function matchesHotkey(
  hotkey: Hotkey,
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): boolean {
  return (
    event.key.toLowerCase() === hotkey.key.toLowerCase() &&
    event.ctrlKey === (hotkey.ctrl === true) &&
    event.altKey === (hotkey.alt === true) &&
    event.shiftKey === (hotkey.shift === true) &&
    event.metaKey === (hotkey.meta === true)
  );
}
