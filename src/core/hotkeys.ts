import type { Hotkey } from './types';

/**
 * ============================================================================
 * FOUR PURE FUNCTIONS OVER A CHORD. NO DOM, NO LISTENER, NO DISPATCHER HERE.
 * ============================================================================
 * This module attaches nothing. It has no `addEventListener`, no `window`, no
 * `document` and no React import; every export is a total function of its
 * arguments. `matchesHotkey` takes the five fields of a keyboard event it
 * actually needs rather than an event object, so it can be called on a plain
 * record and holds no reference to anything live.
 *
 * **The dispatcher is a SEPARATE MODULE, and that is the boundary this file
 * keeps.** `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener,
 * the foreground lookup and the suppression rules; this file owns the chord
 * vocabulary those decisions are expressed in. Keeping them apart is what lets
 * every function here stay callable on a plain record from a test with no DOM,
 * and it is what "hotkeys module — does not attach anything" in
 * `src/core/__tests__/hotkeys.test.ts` still asserts — a title worth keeping now
 * that a dispatcher exists somewhere, rather than only while none did.
 *
 * `hotkeyToken` is the deduplication key at registration. `matchesHotkey` is what
 * the dispatcher evaluates a live event against; keeping one canonical spelling
 * and one comparison in one module is what stops those two uses drifting apart.
 * `describeHotkey` and `ariaKeyShortcuts` are the two spellings a renderer needs,
 * and they are different on purpose — see `ariaKeyShortcuts`. Pinned by
 * "hotkeyToken", "describeHotkey", "ariaKeyShortcuts" and "matchesHotkey" in
 * `src/core/__tests__/hotkeys.test.ts`.
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
 * The spelling a USER reads: a tooltip, a menu, printed documentation. **Not the
 * `aria-keyshortcuts` value** — that attribute wants UI Events key values and
 * `Ctrl` is not one; see `ariaKeyShortcuts` below.
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
 * The chord in UI Events key-value spelling, for `aria-keyshortcuts`:
 * `"Control+Shift+K"`.
 *
 * **A separate function from `describeHotkey`, and the difference is one word.**
 * WAI-ARIA defines `aria-keyshortcuts` in terms of UI Events
 * `KeyboardEvent.key` VALUES — `Control`, `Alt`, `Shift`, `Meta` — while
 * `describeHotkey` deliberately emits the DISPLAY spelling a user reads on a
 * keycap and in a tooltip, where the control key is `Ctrl`. `Ctrl` is not a valid
 * key value, so an attribute built from `describeHotkey` would be malformed;
 * `Control+Shift+K` in a tooltip would read as a key nobody's keyboard is
 * labelled with. Merging the two would have to get one of them wrong.
 *
 * The key half is shared, because there the two spellings genuinely agree: ARIA
 * asks for the `key` value, and `describeKey` already produces `K`, `F5` and
 * `ArrowUp` — which are the `key` values.
 *
 * Pure, like the other three. It renders nothing and reads nothing ambient; the
 * one module that puts the result in the DOM is
 * `src/components/command/commandListItem.tsx`, the shared row every command
 * surface renders. Pinned by "ariaKeyShortcuts" in
 * `src/core/__tests__/hotkeys.test.ts`.
 */
export function ariaKeyShortcuts(hotkey: Hotkey): string {
  let prefix = '';
  if (hotkey.ctrl === true) {
    prefix += 'Control+';
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
