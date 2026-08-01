import type { IShellAPI, RibbonAction, RibbonContext } from './types';

/**
 * ============================================================================
 * THE TWO GUARDS EVERY ROUTE TO A RIBBON ACTION GOES THROUGH. ONE COPY OF EACH.
 * ============================================================================
 * `isVisible` and `execute` were module-private in
 * `src/components/ui/RibbonToolbar.tsx` while the button was the only way to
 * reach a plug-in action. Since ISSUE-006 there are two ways — the button and the
 * keyboard chord in `src/core/hotkeyDispatch.ts` — and the second one is only
 * defensible if it is gated by *the same* predicate call and *the same* handler
 * call as the first.
 *
 * **Two copies of these semantics would drift, and the drift would be silent and
 * security-relevant.** ADR-0001 Amendment H Decision 1 licenses a hotkey as "a
 * second way to fire this action's `onExecute`, gated by the same `isVisible` and
 * the same `isDisabled`", and the whole containment argument for hotkeys rests on
 * that word *same*: a chord that fired for an action the button would have hidden
 * would be a WIDER route to a plug-in handler than the ribbon is. It is the same
 * reasoning ADR-0001 Amendment I Decision 3 used to refuse a second bare-chord
 * suppression at dispatch time — a rule evaluated twice is a rule that can
 * disagree with itself — applied to a guard rather than to a validation.
 *
 * This module holds no DOM, no React and no state. It is three total functions
 * over an action, a context and (for `execute`) a shell handle.
 *
 * WHAT THE GUARDS CONTAIN, AND THE WORD THEY TURN ON: **THROWS**.
 *
 *  - A predicate that THROWS is treated as "not visible" and reported.
 *  - A predicate that returns a NON-BOOLEAN is treated as "not visible", because
 *    the comparison is `=== true` rather than a truthiness test.
 *  - A handler that THROWS is reported and does not reach the caller.
 *  - A REPORT that would itself throw — a plug-in that replaced `console.error`,
 *    or an `id` getter that detonates while the first failure is being written
 *    down — is contained too, so containment cannot be turned into an escape.
 *
 * *Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "hides an action
 * whose isVisible predicate throws and still renders the rest", "treats a
 * non-boolean isVisible result as not visible", "survives a console.error that
 * itself throws while reporting a bad predicate", "contains an id getter that
 * throws while a failing isVisible predicate is being reported", "contains an id
 * getter that throws while a failing onExecute handler is being reported" and
 * "survives an onExecute that throws, leaving the ribbon interactive";
 * `src/core/__tests__/hotkeyDispatch.test.tsx` — "does not fire a chord whose
 * isVisible predicate throws, and reports it once" and "survives an onExecute
 * that throws, leaving the dispatcher live".
 *
 * WHAT THEY DO NOT CONTAIN, named rather than left to inference: a predicate that
 * breaks its contract by SUCCEEDING at something else. A predicate that writes to
 * the shell store during the ribbon's render re-enters through React and wedges
 * the shell; the host is not on the path between the predicate and the store and
 * cannot be. See rule 3a in `RibbonToolbar.tsx` and *test:* "re-evaluates a
 * predicate that writes to the shell during render, which is a wedge this module
 * does not contain".
 * ============================================================================
 */

/**
 * Report a plug-in failure without letting the report become a second failure.
 *
 * `console` is no more the host's object than the predicate that just threw is; a
 * plug-in that replaces `console.error` with a throwing function would otherwise
 * turn containment into an escape. Same guard, and same reasoning, as the one in
 * `ShellHostProvider`'s registry sweep.
 */
export function report(message: string, error: unknown): void {
  try {
    console.error(message, error);
  } catch {
    // Reporting is best-effort. Keeping the shell running is not.
  }
}

/** Stands in for an `id` that could not be read, so the report still names a slot. */
const UNREADABLE_ID = '<an id that could not be read>';

/**
 * `action.id` as text, for a failure report, without the report becoming the
 * second failure.
 *
 * Reading `.id` is a property access on plug-in-shaped data and `String()`
 * consults `Symbol.toPrimitive`, `toString` and `valueOf`, so both halves are
 * calls into code the plug-in may have written. Every use of this function is
 * inside a `catch` — the one place where an unguarded throw is worst, because it
 * replaces a contained failure with an uncontained one and loses the original
 * error on the way out.
 *
 * **Not reachable through the registry today, and guarded anyway.**
 * `normalizeRibbonAction` stores a frozen record whose `id` is a captured
 * primitive string, so nothing arriving by the documented route can detonate
 * here. The callers' parameter types are `RibbonAction` and a caller is plain
 * JavaScript, which is exactly the standard `ShellAPI.ts` holds its own doors to:
 * the declared type proves nothing at runtime.
 *
 * It DOES interpolate the value, where `describeUntrusted` in `ShellAPI.ts`
 * deliberately refuses to. The two are answering different questions. That one
 * builds the message of a thrown `ShellUXError`, where a `toString` running
 * inside the host is a real escalation; this one builds a `console` line whose
 * entire usefulness is naming *which* action misbehaved, and the stringification
 * is already inside a guard whose failure mode is a placeholder.
 *
 * *Test:* `src/components/__tests__/RibbonToolbar.test.tsx` — "contains an id
 * getter that throws while a failing isVisible predicate is being reported" and
 * "contains an id getter that throws while a failing onExecute handler is being
 * reported".
 */
function actionId(action: RibbonAction): string {
  try {
    return String(action.id);
  } catch {
    return UNREADABLE_ID;
  }
}

/**
 * Whether `action` should appear — and, identically, whether its chord may fire —
 * with a throwing predicate treated as "no".
 *
 * `=== true` rather than a truthiness test: `isVisible` is declared to return a
 * boolean and a plug-in is plain JavaScript, so a predicate returning a truthy
 * non-boolean is a contract violation and is resolved the safe way — hidden.
 *
 * **A throw is contained. A WRITE is not.** See rule 3a in `RibbonToolbar.tsx`: a
 * predicate that calls back into the shell store from a render re-enters through
 * React and never stops, and nothing in this guard addresses that.
 */
export function isVisible(action: RibbonAction, context: Readonly<RibbonContext>): boolean {
  try {
    return action.isVisible(context) === true;
  } catch (error) {
    report(
      `ShellUX: the isVisible predicate of ribbon action "${actionId(action)}" threw. The action is treated as not visible — it renders nowhere and no hotkey fires it — and the rest of the shell still runs. A predicate must be pure and must return false rather than throw; see DEVELOPER.md, "Rules for writing predicates".`,
      error,
    );
    return false;
  }
}

/**
 * Invoke `onExecute` without letting a throwing handler reach the caller.
 *
 * The caller is React's event handler on a ribbon button, or the shell's one
 * `keydown` listener. Neither may be allowed to unwind: the first would take the
 * shell down through an error boundary, the second would leave a throw
 * propagating out of a DOM event dispatch with no owner.
 */
export function execute(
  action: RibbonAction,
  context: Readonly<RibbonContext>,
  shell: IShellAPI,
): void {
  try {
    action.onExecute(context, shell);
  } catch (error) {
    report(
      `ShellUX: the onExecute handler of ribbon action "${actionId(action)}" threw. The shell is still running; fix the handler.`,
      error,
    );
  }
}
