import { useEffect } from 'react';
import { useActivation } from './ActivationContext';
import { useShellStore } from './ShellAPI';
import { matchesHotkey } from './hotkeys';
import { execute, isVisible } from './ribbonAction';

/**
 * ============================================================================
 * THE SHELL'S ONE KEYBOARD LISTENER. FOREGROUND-SCOPED, BUBBLE PHASE.
 * ============================================================================
 * This is the module ADR-0001 Amendment H deferred and every "dispatch is Phase
 * 2" sentence in this repository pointed at. It owns the only
 * `addEventListener` under `src/`, and `src/__tests__/noEventListener.test.ts`
 * now carries a one-entry allowlist naming this file rather than the absolute
 * prohibition it used to carry — narrowed deliberately and in the open, with the
 * pairing pinned at RUNTIME instead of by source scan, because "one listener, and
 * it is removed" is the invariant that actually matters and a text scan never
 * asserted it. *Tests:* "adds exactly one keydown listener and removes the
 * identical handler on unmount" and "registers once under StrictMode, whose
 * simulated remount is symmetric" in `src/core/__tests__/hotkeyDispatch.test.tsx`;
 * "holds the hotkey-dispatch allowlist to the exact spellings the dispatcher
 * contains" and "holds the dispatcher to exactly one addEventListener and one
 * removeEventListener" in `src/__tests__/noEventListener.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * FIVE DECISIONS. ARGUE WITH THESE BEFORE CHANGING ANYTHING BELOW.
 * ---------------------------------------------------------------------------
 *
 * 1. **`ShellLayout` calls this, not `ShellHostProvider`.** `ShellLayout` is host
 *    territory above every `ExtensionHostBoundary`; it already holds
 *    `useActivation()` and `useShellContext()`, and it renders the ribbon — so the
 *    button path and the chord path read one source of truth about which actions
 *    exist and which extension owns them. A listener in the provider would be live
 *    with no shell mounted at all: a host that renders `ShellHostProvider` around
 *    something other than `ShellLayout` would get global chords over a UI that
 *    shows no ribbon and offers no way to see what is bound.
 *
 * 2. **Bubble phase, not capture.** Capture would make the host win over
 *    everything below it, including a Radix menu's own key handling and the
 *    Pane 2 list's arrow keys. Bubble lets a component that deliberately handles a
 *    key and calls `stopPropagation()` keep it — which is exactly what Amendment H
 *    Decision 8's view-local `J`/`K` navigation needs.
 *
 *    **The accepted cost, stated rather than discovered:** a foreground extension
 *    that calls `stopPropagation()` on `keydown` inside its own pane starves its
 *    OWN chords. It starves nobody else's, because chords are foreground-scoped —
 *    the only actions this dispatcher would have walked are that same extension's.
 *    A plug-in denying itself its own shortcuts is a plug-in bug with a contained
 *    blast radius, which is why bubble is the right trade and capture is not.
 *
 * 3. **Attach once; read everything time-varying at DISPATCH time.** The effect
 *    depends only on `activation` and `store`, both of which are one object for
 *    the surrounding `ShellHostProvider`'s whole lifetime. Nothing that changes
 *    per keystroke — the foreground extension, its actions, the live context — is
 *    captured at attach time, so there is no add/remove churn and no stale
 *    closure. `preventDefault()` is called on a match and `stopPropagation()`
 *    never is: `window` is the last stop in the bubble path, so there is nothing
 *    left to stop.
 *
 * 4. **Foreground-only, and this is load-bearing rather than a simplification.**
 *    Amendment H Decision 6 makes cross-extension chord collisions LEGAL by
 *    design: two live extensions may both declare `Ctrl+K` and both registrations
 *    succeed. A shell-wide dispatch table is therefore ambiguous by construction,
 *    and scoping the lookup to `activation.getActive()` is what makes it total. It
 *    also mirrors the ribbon exactly — the same one extension's actions, in the
 *    same order. `getActive()` re-checks liveness rather than trusting the last
 *    commit, so a chord stops firing the statement after `release`/`unregister`
 *    rather than at the next render. *Tests:* "does not fire a background
 *    extension chord while another extension is in the foreground" and "stops
 *    firing after the extension is released".
 *
 * 5. **The context comes from `store.getContext()` at dispatch time, not from
 *    `useShellContext()` and not from anything captured when the listener was
 *    attached.** The two can disagree by one frame: `useShellContext` is a
 *    `useSyncExternalStore` snapshot taken at the last commit, and the store is
 *    authoritative now. When they disagree the dispatcher's answer is the fresher
 *    one, and the consequence runs in the safe direction — an action that has just
 *    become hidden does not fire, where a committed snapshot would still have said
 *    it was visible. What is ASSERTED, which is the narrower and testable half, is
 *    that the context is read from the store on every keystroke rather than closed
 *    over at attach time, and that the object handed to `isVisible` is the same one
 *    handed to `onExecute` — a predicate and its handler cannot see two different
 *    worlds. *Test:* "reads the context off the store at dispatch time, not from a
 *    snapshot captured when the listener was attached".
 *
 * ---------------------------------------------------------------------------
 * WHAT DOES NOT FIRE
 * ---------------------------------------------------------------------------
 * **Hidden and disabled actions never fire, and that is the containment
 * argument.** Amendment H Decision 1 licenses a hotkey as "a second way to fire
 * this action's `onExecute`, gated by the same `isVisible` and the same
 * `isDisabled`". If a chord fired for a hidden action, the chord would be a WIDER
 * route to a plug-in handler than the button is, and the argument that a hotkey
 * grants no capability the ribbon did not already grant would collapse. The
 * guards are literally the same functions the ribbon calls — `isVisible` and
 * `execute` from `./ribbonAction` — so the non-boolean-is-false rule, the
 * throw-is-false rule and the guarded report are one implementation, not two.
 *
 * **Placement is irrelevant.** `INLINE_ACTION_LIMIT` in `RibbonToolbar.tsx`
 * decides bar versus overflow menu and is a rendering decision about width. This
 * walks every action the extension declared and consults visibility, never the
 * inline slice. *Test:* "fires a chord belonging to an action that renders in the
 * overflow menu".
 *
 * ---------------------------------------------------------------------------
 * THE SUPPRESSION LIST IS A GUARDRAIL, NOT A BOUNDARY
 * ---------------------------------------------------------------------------
 * Stated in the same register as ADR-0001's "No sandbox". `isEditableTarget`
 * recognises the editable surfaces the platform names: the three form elements,
 * `contenteditable`, and the three ARIA text roles. **A plug-in can render a
 * custom editor built from a `div` with no recognised role, and a chord WILL fire
 * into it while the user is typing.** Nothing here can close that — the host does
 * not know what a plug-in's DOM means — and the honest description is that this
 * catches the ordinary cases and is not a proof that no chord ever interrupts
 * typing. An extension that builds its own editor is responsible for calling
 * `stopPropagation()` on it, which decision 2 above deliberately leaves working.
 *
 * `closest()` walks up through plug-in DOM. It reads element attributes and
 * invokes no plug-in code: there is no getter to trigger and no callback to run,
 * which is why it is safe to call on a target the host did not render.
 * `element.isContentEditable` is deliberately NOT used — it returns `undefined`
 * in this jsdom, so a check built on it would pass every test vacuously while
 * doing nothing in a browser.
 * ============================================================================
 */

/**
 * ARIA roles whose author is telling us the element takes typed text.
 *
 * `combobox` is included because an editable combobox is a text field the user
 * types into; a non-editable one is a listbox trigger where suppressing a chord
 * costs almost nothing. The list is deliberately short: a role not on it is not
 * treated as editable, which is the guardrail's limit rather than a hole in it.
 */
const EDITABLE_ROLE_SELECTOR = '[role="textbox"], [role="searchbox"], [role="combobox"]';

/**
 * Whether the event's target is a surface the user is typing into.
 *
 * The `instanceof Element` guard comes first so that no property is read off a
 * non-element target at all — a `keydown` dispatched on `window` or on a text
 * node reaches here, and neither has `closest`.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  // `contenteditable="false"` is an explicit opt-OUT, and it is the reason this
  // is an attribute read rather than a bare `closest('[contenteditable]')`: an
  // author who turned editing off inside an editable ancestor means it.
  const editable = target.closest('[contenteditable]');
  if (editable !== null && editable.getAttribute('contenteditable') !== 'false') {
    return true;
  }
  return target.closest(EDITABLE_ROLE_SELECTOR) !== null;
}

/**
 * Whether this event must not be looked up as a chord at all.
 *
 * Consulted BEFORE any `matchesHotkey` call, so a suppressed event costs one
 * cheap check and reaches no plug-in predicate.
 *
 *  - `defaultPrevented` — something below already handled this key. Firing on
 *    top of it would be a second, invisible handler for one keystroke.
 *  - `repeat` — holding a chord down emits auto-repeat at the OS rate. An action
 *    that runs thirty times a second is a defect however benign the action is.
 *  - `isComposing`/`keyCode === 229` — an IME composition is in flight and the
 *    keystrokes belong to it. Both are checked because they are two different
 *    signals for the same state and browsers do not agree on which they send.
 *  - an editable target — see the banner, and note what it does not cover.
 */
function isSuppressed(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    isEditableTarget(event.target)
  );
}

/**
 * Attach the shell's keyboard dispatch for as long as the caller is mounted.
 *
 * Called ONCE, by `ShellLayout`. Returns nothing: there is no handle to hold, no
 * table to register into and nothing for a caller to configure — which is
 * deliberate, because a configurable dispatcher is a second place for the
 * foreground rule to be decided.
 *
 * @throws when called outside a `ShellHostProvider`, by way of `useActivation`
 *   and `useShellStore`. It is host-only and refuses inside an
 *   `ExtensionHostBoundary` for the same reason `useActivation` does.
 */
export function useHotkeyDispatch(): void {
  const activation = useActivation();
  const store = useShellStore();

  useEffect(() => {
    const dispatchChord = (event: KeyboardEvent): void => {
      if (isSuppressed(event)) {
        return;
      }
      const active = activation.getActive();
      if (active === null) {
        return;
      }
      // Read once, after the foreground is known, and shared by the predicate and
      // the handler. See decision 5.
      const context = store.getContext();
      for (const action of active.blueprint.ribbonActions) {
        // Matching first means a keystroke that is not one of this extension's
        // chords calls no plug-in code at all — `matchesHotkey` is host code over
        // a host-owned frozen chord. Visibility is then consulted per candidate,
        // which is the same answer as filtering the whole list first and costs
        // one predicate call instead of all of them.
        if (action.hotkey === undefined || !matchesHotkey(action.hotkey, event)) {
          continue;
        }
        if (!isVisible(action, context) || action.isDisabled === true) {
          continue;
        }
        // Only on a real match, and only preventDefault: `window` is the end of
        // the bubble path, so there is nothing left to stop propagating to.
        event.preventDefault();
        execute(action, context, active.shell);
        return;
      }
    };

    window.addEventListener('keydown', dispatchChord);
    return () => {
      // The identical function reference, which is why `dispatchChord` is
      // declared inside the effect rather than rebuilt in the cleanup.
      window.removeEventListener('keydown', dispatchChord);
    };
  }, [activation, store]);
}
