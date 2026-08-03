import type { Command, IShellAPI, RibbonContext } from './types';

/**
 * ============================================================================
 * THE TWO GUARDS EVERY ROUTE TO A PLUG-IN COMMAND GOES THROUGH. ONE COPY OF EACH.
 * ============================================================================
 * `isVisible` and `execute` were module-private in `RibbonToolbar.tsx` while the
 * ribbon button was the only way to reach a plug-in action. ISSUE-006 made it two
 * — the button and the keyboard chord in `src/core/hotkeyDispatch.ts` — and
 * extracting them here was the answer. **This file is the same file under a new
 * name, and the count is now SIX**: the context bar, the command palette, the
 * floating toolbar, the omnibox composer, the chord dispatcher, and the shared
 * row every one of those four surfaces renders. Nothing else calls a plug-in
 * predicate or a plug-in handler.
 *
 * **Six copies of these semantics would drift, and the drift would be silent and
 * security-relevant.** ADR-0001 Amendment H Decision 1 licenses a hotkey as "a
 * second way to fire this action's `onExecute`, gated by the same `isVisible` and
 * the same `isDisabled`", and the whole containment argument rests on that word
 * *same*: a route that fired for a command another route would have hidden would
 * be a WIDER route to a plug-in handler than the one it was licensed against.
 * Four surfaces are four opportunities for that to happen, which is four reasons
 * for one implementation rather than one reason less.
 *
 * It is the same reasoning ADR-0001 Amendment I Decision 3 used to refuse a
 * second bare-chord suppression at dispatch time — a rule evaluated twice is a
 * rule that can disagree with itself — applied to a guard rather than to a
 * validation.
 *
 * **The rename moved the file and changed no behaviour.** `isVisible`, `execute`
 * and `report` are the same three total functions over a command, a context and
 * (for `execute`) a shell handle. This module holds no DOM, no React and no
 * state.
 *
 * **`when` is NOT evaluated here, and that is deliberate.** `evaluateWhen` in
 * `src/core/commands/when.ts` is already total — it returns a boolean and cannot
 * throw — so it needs no guard, and wrapping it here would put a host-owned pure
 * function inside a container built for plug-in code. The AND of the two tiers is
 * `CommandRegistry`'s, which is the one place that decides what a surface is
 * offered; see its banner.
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
 * *Tests:* `src/components/command/__tests__/commandSurfaces.test.tsx` — the
 * whole of "every command surface — a throwing predicate", "every command surface
 * — a throwing handler" and "every command surface — a report that throws", each
 * of which runs its cases against all four surfaces;
 * `src/core/__tests__/hotkeyDispatch.test.tsx` — "does not fire a chord whose
 * isVisible predicate throws, and reports it once" and "survives an onExecute
 * that throws, leaving the dispatcher live".
 *
 * WHAT THEY DO NOT CONTAIN, named rather than left to inference: a predicate that
 * breaks its contract by SUCCEEDING at something else. A predicate that writes to
 * the shell store during a surface's render re-enters through React and wedges the
 * shell; the host is not on the path between the predicate and the store and
 * cannot be. *Test:* "re-evaluates a predicate that writes to the shell during
 * render, which is a wedge this module does not contain" in
 * `src/components/command/__tests__/ContextBar.test.tsx`.
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
 * `command.id` as text, for a failure report, without the report becoming the
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
 * `normalizeCommand` stores a frozen record whose `id` is a captured primitive
 * string, so nothing arriving by the documented route can detonate here. The
 * callers' parameter types are `Command` and a caller is plain JavaScript, which
 * is exactly the standard `ShellAPI.ts` holds its own doors to: the declared type
 * proves nothing at runtime.
 *
 * It DOES interpolate the value, where `describeUntrusted` in `ShellAPI.ts`
 * deliberately refuses to. The two are answering different questions. That one
 * builds the message of a thrown `ShellUXError`, where a `toString` running
 * inside the host is a real escalation; this one builds a `console` line whose
 * entire usefulness is naming *which* command misbehaved, and the stringification
 * is already inside a guard whose failure mode is a placeholder.
 *
 * *Tests:* `src/components/command/__tests__/commandSurfaces.test.tsx` — "the
 * context bar contains an id getter that throws while a failing isVisible
 * predicate is being reported" and "the context bar contains an id getter that
 * throws while a failing onExecute handler is being reported", each with three
 * siblings naming the other three surfaces.
 */
function commandId(command: Command): string {
  try {
    return String(command.id);
  } catch {
    return UNREADABLE_ID;
  }
}

/**
 * Whether `command` should appear — and, identically, whether its chord may fire —
 * with a throwing predicate treated as "no".
 *
 * `=== true` rather than a truthiness test: `isVisible` is declared to return a
 * boolean and a plug-in is plain JavaScript, so a predicate returning a truthy
 * non-boolean is a contract violation and is resolved the safe way — hidden.
 *
 * **A throw is contained. A WRITE is not.** A predicate that calls back into the
 * shell store from a render re-enters through React and never stops, and nothing
 * in this guard addresses that. See the banner.
 */
export function isVisible(command: Command, context: Readonly<RibbonContext>): boolean {
  try {
    return command.isVisible(context) === true;
  } catch (error) {
    report(
      `ShellUX: the isVisible predicate of command "${commandId(command)}" threw. The command is treated as not visible — it renders on no surface and no hotkey fires it — and the rest of the shell still runs. A predicate must be pure and must return false rather than throw; see DEVELOPER.md, "Rules for writing predicates".`,
      error,
    );
    return false;
  }
}

/**
 * Invoke `onExecute` without letting a throwing handler reach the caller.
 *
 * The caller is a React event handler on one of the four command surfaces, or the
 * shell's one `keydown` listener. Neither may be allowed to unwind: the first
 * would take the shell down through an error boundary, the second would leave a
 * throw propagating out of a DOM event dispatch with no owner.
 */
export function execute(
  command: Command,
  context: Readonly<RibbonContext>,
  shell: IShellAPI,
): void {
  try {
    command.onExecute(context, shell);
  } catch (error) {
    report(
      `ShellUX: the onExecute handler of command "${commandId(command)}" threw. The shell is still running; fix the handler.`,
      error,
    );
  }
}
