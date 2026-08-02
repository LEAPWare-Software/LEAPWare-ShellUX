import { Component, Fragment } from 'react';
import type { ReactNode } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

/**
 * ============================================================================
 * THE FAULT BOUNDARY. WHAT IT CONTAINS, WHAT IT REFUSES TO TOUCH, AND WHAT IT
 * DOES NOT CATCH AT ALL.
 * ============================================================================
 * A class component, because `getDerivedStateFromError` and `componentDidCatch`
 * are the only error-catching hooks React has and neither has a function-component
 * form. Nothing else in `src/` is a class component — `ShellUXError` in
 * `core/types.ts` is a class, but it is an error type rather than a component —
 * and this is the one place where React leaves no alternative.
 *
 * 1. `getDerivedStateFromError` STORES THE THROWN VALUE AND READS NOTHING OFF
 *    IT. Not `error.message`, not `String(error)`, not even `instanceof`. A
 *    plug-in can throw an object whose `message` getter throws, and this static
 *    runs inside React's error path where a *second* throw is not recoverable —
 *    React aborts the whole root rather than catching it again. So the value is
 *    boxed and put in state untouched, and every attempt to read it happens in
 *    `render`, inside `describeFault`'s `try`/`catch`, where the worst case is
 *    the host's own fallback sentence.
 *
 *    This is the same discipline as `toShellUXError` in
 *    `src/core/RegistryContext.tsx` — which wraps `instanceof`, the `message`
 *    getter and `String()` in one `try` because each of them can re-enter
 *    plug-in code — and as `describeUntrusted` in `src/core/ShellAPI.ts`, which
 *    goes further and reports only `typeof`. This module sits between the two:
 *    it *does* want the message, because a contained failure a user cannot
 *    describe to support is barely contained, so it reads it — under guard, and
 *    only after `typeof` has already proved the value is a primitive string.
 *    *Tests:* `src/components/__tests__/FaultBoundary.test.tsx` — "survives an
 *    error whose message getter throws, and shows host text instead", "survives
 *    a thrown value that is not an Error at all" and "never stringifies the
 *    thrown value".
 *
 * 2. THE FALLBACK RENDERS NO PLUG-IN COMPONENT AND NO PLUG-IN MARKUP. This is
 *    the answer to "a plug-in that throws *inside* the fallback itself": there
 *    is nothing of the plug-in's in there to throw. The only untrusted values
 *    that reach it are `extensionId` — a string the registry already validated
 *    against `EXTENSION_ID_PATTERN` — and the guarded message, and both arrive
 *    as JSX text nodes. There is no `dangerouslySetInnerHTML`, no URL-bearing
 *    attribute and no render prop. *Tests:* "renders no plug-in element in the
 *    fallback" and "the module source contains no HTML-injection sink at all".
 *
 * 3. WHAT COMES BACK AFTER A RETRY OR A RESET IS A FRESH MOUNT, NOT THE FIBERS
 *    THAT FAILED. The children are keyed on a `generation` counter that both
 *    retry and `resetKey` bump. **Be precise about which path the key is
 *    load-bearing on**, because the usual justification for it is half wrong:
 *    on the RETRY path React has already deleted the failed subtree in order to
 *    show the fallback, so children would mount fresh with or without a key. On
 *    the `resetKey` path nothing was unmounted — the boundary may be showing a
 *    perfectly healthy subtree when the active extension changes — and there the
 *    key is the only thing that turns the swap into a remount rather than a
 *    re-render that carries the previous extension's component state into the
 *    next one's view. Both paths are asserted, and they are asserted separately:
 *    "retries by remounting the subtree rather than re-rendering it" and
 *    "remounts the subtree when resetKey changes even with nothing thrown".
 *
 * 4. RETRY IS BOUNDED AND NEVER AUTOMATIC. Three consecutive failures and the
 *    button is replaced by host text. Nothing here retries on a timer: a
 *    component that throws deterministically plus an automatic retry is an
 *    infinite render loop that pins a core. A retry that succeeds clears the
 *    count, which is what makes the bound *consecutive* rather than lifetime.
 *    *Tests:* "stops offering a retry after three consecutive failures" and
 *    "clears the failure count when a retry succeeds".
 *
 * 5. `resetKey` CLEARS A LATCHED ERROR. Without it, extension A's error surface
 *    stays latched over extension B's perfectly healthy view, because the
 *    boundary's state does not know the subtree underneath it was swapped.
 *    Changing the key clears the error *and* bumps the generation, so B mounts
 *    fresh. *Test:* "clears a latched error when resetKey changes".
 *
 * 6. THE REPORT IS DOUBLE-GUARDED. `console` is no more the host's object than
 *    the component that just threw is; a plug-in that replaces `console.error`
 *    with a thrower would otherwise turn containment into an escape. Same shape
 *    and same reasoning as `report` in `src/core/command.ts` and the guard in
 *    `ShellHostProvider`'s registry sweep. Nothing is interpolated into the
 *    report either — the values are passed as arguments, so no `toString` runs.
 *    *Test:* "survives a console.error that itself throws".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT CATCH. React error boundaries catch render, lifecycle and
 * constructor errors on the subtree below them. They do not catch, and this
 * component must never be described as covering:
 *
 *   - **Errors thrown in event handlers.** A `Command.onExecute` that throws is
 *     caught by `execute` in `src/core/command.ts` — the one guard every command
 *     surface and the chord dispatcher share — not by this boundary, and a click
 *     handler inside a plug-in view that throws is caught by nobody here.
 *   - **`setTimeout`, `setInterval` and `requestAnimationFrame` callbacks.**
 *     They run on a fresh task with no React stack above them.
 *   - **Unhandled promise rejections.** Async work is not part of any render.
 *   - **Server-side rendering.** `componentDidCatch` does not run during
 *     `renderToString`; this shell does not server-render, and the limit is
 *     recorded so nobody assumes otherwise.
 *   - **Anything thrown by this fallback, or by a parent of this boundary.** A
 *     boundary never catches itself. Point 2 above is why the fallback has
 *     nothing in it that can throw; the parent case is why `ShellLayout`
 *     composes several of these rather than one at the root.
 *
 * The same list is in `DEVELOPER.md` under "Fault containment — and its real
 * limits", and the two are kept in step by "documents in both the source and
 * DEVELOPER.md what a boundary cannot catch" in
 * `src/components/__tests__/FaultBoundary.test.tsx`.
 * ============================================================================
 */

/** How the fallback is shaped for the surface it is standing in for. */
export type FaultBoundaryVariant = 'pane' | 'row';

export interface FaultBoundaryProps {
  /**
   * Host-authored name for the surface, used as the subject of the fallback
   * sentence — "The List pane could not be displayed."
   *
   * HOST TEXT ONLY. Never pass a plug-in's `name` here: the fallback's whole
   * claim is that it renders no plug-in-controlled prose, and the extension is
   * identified by `extensionId`, which the registry validated.
   */
  readonly boundaryLabel: string;
  /**
   * The registry-validated id of the extension whose subtree this is, or `null`
   * when the surface is host-owned and no extension is implicated.
   */
  readonly extensionId: string | null;
  /**
   * Changing this clears a latched error and remounts the subtree.
   *
   * The active extension id is what `ShellLayout` passes: switching extension is
   * exactly the moment a stale error surface would otherwise sit over a fresh
   * view.
   */
  readonly resetKey?: string | null | undefined;
  /** `'pane'` — a block surface with a retry. `'row'` — one line, no control. */
  readonly variant?: FaultBoundaryVariant | undefined;
  readonly children: ReactNode;
}

interface FaultBoundaryState {
  /**
   * The thrown value, boxed.
   *
   * Boxed rather than stored bare so that a plug-in throwing `null` or
   * `undefined` — both legal — stays distinguishable from "nothing has thrown".
   */
  readonly caught: { readonly value: unknown } | null;
  /** Consecutive failures. Reset by a successful retry and by `resetKey`. */
  readonly failures: number;
  /** Bumped by retry and by `resetKey`; the children are keyed on it. */
  readonly generation: number;
  /** The `resetKey` this state was derived against. */
  readonly resetKey: string | null;
}

/** Consecutive failures after which the retry control is withdrawn. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * The longest message the fallback will show.
 *
 * A plug-in can throw an `Error` whose `message` is megabytes long; the string
 * is already proven primitive by the time it is cut, so slicing it invokes
 * nothing. Truncation is visible rather than silent — the ellipsis is appended —
 * because a message that stops mid-word with no marker reads as a rendering bug.
 */
const MAX_MESSAGE_LENGTH = 240;

/** Shown when the thrown value yielded no readable message. */
const UNREADABLE_MESSAGE = 'The failure reported no readable message.';

/**
 * Report a contained failure without the report becoming a second failure.
 *
 * Nothing is interpolated: every value is handed to `console.error` as its own
 * argument, so no `toString`, `valueOf` or `Symbol.toPrimitive` written by a
 * plug-in runs on the way in. The whole call is wrapped because `console.error`
 * itself is replaceable.
 */
function report(label: unknown, extensionId: unknown, error: unknown): void {
  try {
    console.error('FaultBoundary contained a failure.', { label, extensionId }, error);
  } catch {
    // Reporting is best-effort. Rendering the fallback is not.
  }
}

/**
 * A displayable message for a thrown value, or the host's own sentence.
 *
 * Every step that can re-enter plug-in code is inside the `try`: `instanceof`
 * can trap `getPrototypeOf` through a Proxy, and `.message` can be a getter that
 * throws. `String()` is deliberately NOT used on anything — a thrown value that
 * is not a string and not an `Error` with a string `message` gets the host
 * sentence rather than a stringification, because `String()` consults three
 * plug-in-writable hooks and this function's callers are already in a degraded
 * state where a second throw has nowhere to go.
 *
 * Exported so the guarantee can be asserted against hostile values directly
 * rather than only through a rendered tree.
 */
export function describeFault(value: unknown): string {
  try {
    if (typeof value === 'string') {
      return clip(value);
    }
    if (value instanceof Error) {
      const message: unknown = value.message;
      if (typeof message === 'string') {
        return clip(message);
      }
    }
  } catch {
    // A throwing getter or a trapped prototype lookup lands here, and the host
    // sentence below is the answer.
  }
  return UNREADABLE_MESSAGE;
}

/** A message already proven to be a primitive string, cut to a legible length. */
function clip(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') {
    return UNREADABLE_MESSAGE;
  }
  if (trimmed.length <= MAX_MESSAGE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

/**
 * The pane-level error surface.
 *
 * `border-neutral-400` was 2.52:1 against the white it sat on, which is below
 * the 3:1 WCAG 1.4.11 asks of a control's visual boundary — and an alert box IS
 * a boundary somebody has to find. `TOKEN_CLASS.faultBorder` is
 * `--border-default` at 3.95:1, and it needs no dark-theme twin because the
 * token resolves per theme.
 */
const SURFACE =
  'flex flex-col gap-1 rounded-sm border p-1 text-[12px] leading-4 ' +
  `${TOKEN_CLASS.faultBorder} ${TOKEN_CLASS.faultSurface} ${TOKEN_CLASS.faultText}`;

const RETRY_BUTTON =
  'self-start rounded-sm border px-1 min-h-6 text-[12px] leading-4 ' +
  `${TOKEN_CLASS.faultButtonBorder} ${TOKEN_CLASS.faultButtonHover} ` +
  TOKEN_CLASS.faultButtonFocus;

export class FaultBoundary extends Component<FaultBoundaryProps, FaultBoundaryState> {
  constructor(props: FaultBoundaryProps) {
    super(props);
    this.state = {
      caught: null,
      failures: 0,
      generation: 0,
      resetKey: props.resetKey ?? null,
    };
  }

  /**
   * Store the thrown value. Read nothing off it. See point 1 in the banner.
   *
   * The parameter is `unknown` rather than `Error` because `throw` accepts any
   * value and a plug-in is under no obligation to throw an `Error`.
   */
  static getDerivedStateFromError(error: unknown): Partial<FaultBoundaryState> {
    return { caught: { value: error } };
  }

  /**
   * A changed `resetKey` clears the latch and remounts, so a stale error surface
   * cannot outlive the subtree it was about.
   */
  static getDerivedStateFromProps(
    props: FaultBoundaryProps,
    state: FaultBoundaryState,
  ): Partial<FaultBoundaryState> | null {
    const next = props.resetKey ?? null;
    if (next === state.resetKey) {
      return null;
    }
    return { caught: null, failures: 0, generation: state.generation + 1, resetKey: next };
  }

  override componentDidCatch(error: unknown): void {
    this.setState((previous) => ({ failures: previous.failures + 1 }));
    report(this.props.boundaryLabel, this.props.extensionId, error);
  }

  /**
   * A committed render with no error standing is a retry that worked, so the
   * consecutive-failure count goes back to zero.
   *
   * The second `setState` this can schedule settles immediately: the next
   * `componentDidUpdate` sees `failures === 0` and does nothing.
   */
  override componentDidUpdate(): void {
    if (this.state.caught === null && this.state.failures !== 0) {
      this.setState({ failures: 0 });
    }
  }

  private readonly retry = (): void => {
    // `failures` is deliberately carried forward. Clearing it here would make
    // the bound meaningless: a subtree that throws on every attempt would offer
    // an unlimited supply of retries.
    this.setState((previous) => ({ caught: null, generation: previous.generation + 1 }));
  };

  override render(): ReactNode {
    const { caught, failures, generation } = this.state;
    if (caught === null) {
      // Keyed, so that a bumped generation is an unmount and a fresh mount
      // rather than a re-render of the fibers that just failed.
      return <Fragment key={generation}>{this.props.children}</Fragment>;
    }

    const { boundaryLabel, extensionId, variant = 'pane' } = this.props;
    const message = describeFault(caught.value);

    if (variant === 'row') {
      // No `role="alert"` and no control, on purpose. This fallback renders
      // INSIDE the virtualizer's `role="option"` element: an interactive control
      // in an option breaks the listbox pattern, and one live region per failed
      // row would flood the assistive-technology queue during a scroll. The row
      // recovers when recycling remounts it, or when `resetKey` changes.
      return (
        <span data-fault-boundary="row" className={TOKEN_CLASS.faultRowText}>
          {boundaryLabel} could not be displayed. {message}
        </span>
      );
    }

    return (
      <div role="alert" data-fault-boundary="pane" className={SURFACE}>
        <p className="font-semibold">{boundaryLabel} could not be displayed.</p>
        {extensionId === null ? null : (
          <p>
            Extension: <span data-fault-extension="">{extensionId}</span>
          </p>
        )}
        <p data-fault-message="">{message}</p>
        {failures < MAX_CONSECUTIVE_FAILURES ? (
          <button type="button" className={RETRY_BUTTON} onClick={this.retry}>
            Retry
          </button>
        ) : (
          <p>
            Retried {MAX_CONSECUTIVE_FAILURES} times without success. Switch extension, or reload
            the shell.
          </p>
        )}
      </div>
    );
  }
}
