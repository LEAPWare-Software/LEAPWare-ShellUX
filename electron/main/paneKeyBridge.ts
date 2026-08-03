import type { WebContents } from 'electron';
import type { FocusRing } from './focusRing.js';
import type { PaneSurfaceId } from './surfaces.js';

/**
 * ============================================================================
 * KEYBOARD IS HYBRID AND RENDERER-FIRST. THIS FILE IS THE NARROW HALF.
 * ============================================================================
 * `before-input-event` fires in the MAIN process **before** the renderer's DOM
 * handling, and it carries neither a DOM target nor `defaultPrevented`. That is
 * not an inconvenience — it means the suppression rules `hotkeyDispatch.ts`
 * already implements **cannot run here at all**:
 *
 *  - `isEditableTarget` walks up from `event.target` with `closest()`. There is
 *    no target on an `Input`, so main cannot tell a chord aimed at the shell from
 *    the same chord aimed at a text field the user is typing in.
 *  - `event.defaultPrevented` is the "something below already handled this"
 *    signal. It is decided by DOM handlers that have not run yet.
 *  - `isComposing` / `keyCode === 229` describe an IME composition in the
 *    renderer's own input pipeline.
 *
 * So the suppression logic stays in the renderer, unchanged, in the one module
 * that already owns it, and this file is used for **exactly one thing**: the
 * escape hatch. A chord that must fire *even if the renderer that would
 * otherwise handle it is wedged* — an infinite loop, a blocked main thread, a
 * pane that has stopped pumping its event loop — has no route through the DOM,
 * because the DOM is what is stuck. Main is the only process still listening.
 *
 * **One chord, and it is the one worth having.** `Ctrl`/`Cmd` + `Alt` + `Shift` +
 * `F` returns keyboard focus to host chrome. That is the surface holding the
 * rail, the navigation tree, the context bar and the command palette — which is
 * to say the only route to a different extension. Every other candidate was
 * rejected for the same reason: a hatch that lands the user anywhere except
 * "somewhere they can act from" is a hatch onto a ledge.
 *
 * **The modifier set is deliberately awkward.** Three modifiers plus a letter is
 * a chord no extension will declare by accident and no user will hit by
 * accident, and `HOTKEY_KEYS` in `src/core/types.ts` describes plug-in chords
 * that this one cannot collide with in practice. An escape hatch that fires
 * during ordinary typing is a defect that looks exactly like the one it was
 * added to fix.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MATCHER IS EXPORTED AND PURE
 * ---------------------------------------------------------------------------
 * `matchEscapeChord` takes the four booleans and the key, and returns an id or
 * `null`. It touches no Electron object, so
 * `electron/__tests__/paneKeyBridge.test.ts` can enumerate the near misses —
 * auto-repeat, key-up, a missing modifier, one modifier too many — without a
 * window. The half that cannot be tested without Electron is `attachEscapeHatch`,
 * which is four lines and does nothing but wire the matcher to the ring.
 * ============================================================================
 */

/** Every chord main handles. One member, on purpose; see the banner. */
export type EscapeChordId = 'focus-host-chrome';

/**
 * The shape of Electron's `before-input-event` payload, narrowed to what is
 * read.
 *
 * Structural rather than imported, so the matcher's test constructs one as an
 * object literal. `isAutoRepeat` is optional because it is the one field whose
 * absence is meaningful: a synthesised input that does not carry it is not a
 * repeat.
 */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat?: boolean;
}

/** The one chord, spelled once. */
const ESCAPE_KEY = 'f';

/**
 * The escape chord this input matches, or `null`.
 *
 * `Ctrl` OR `Meta`, for the reason `HOST_CHORDS` in `hotkeyDispatch.ts` accepts
 * either: the plan spells host chords "Cmd" on macOS and "Ctrl" on Windows and
 * they are the same command. `alt` and `shift` are both REQUIRED, which is what
 * keeps this out of the space an extension or a user reaches by accident.
 *
 * Auto-repeat is refused, exactly as `isSuppressed` refuses `event.repeat`:
 * holding a chord down emits at the operating system's repeat rate, and an
 * escape hatch that fires thirty times a second is a second wedge.
 */
export function matchEscapeChord(input: KeyInput): EscapeChordId | null {
  if (input.type !== 'keyDown') return null;
  if (input.isAutoRepeat === true) return null;
  if (!input.alt || !input.shift) return null;
  if (!input.control && !input.meta) return null;
  if (input.key.toLowerCase() !== ESCAPE_KEY) return null;
  return 'focus-host-chrome';
}

/**
 * Wire one view's `before-input-event` to the escape hatch.
 *
 * **`preventDefault` is called only on a match**, which is the whole of "this is
 * an escape hatch and not a keyboard layer". Every other keystroke reaches the
 * renderer untouched, so the renderer-first design — the unchanged suppression
 * logic, the host chord table, the foreground extension's chords — is what
 * decides every ordinary key. This handler's job is to be the one thing left
 * when that pipeline is not running.
 */
export function attachEscapeHatch(
  contents: WebContents,
  surface: PaneSurfaceId,
  focusRing: FocusRing,
  warn: (message: string) => void,
): void {
  contents.on('before-input-event', (event, input) => {
    if (matchEscapeChord(input) === null) return;
    event.preventDefault();
    warn(`escape hatch: returning focus to host chrome from the ${surface} surface.`);
    focusRing.request('chrome');
  });
}
