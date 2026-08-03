import { Component } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { describeFault } from './FaultBoundary';

/**
 * ============================================================================
 * THE ROOT BOUNDARY. THE LAST THING BETWEEN A THROW ABOVE `ShellLayout` AND A
 * BLANK WINDOW.
 * ============================================================================
 * `FaultBoundary` contains a PANE. This contains the APPLICATION, and the two
 * are deliberately different components rather than one component with a
 * variant, because almost every decision below comes out the other way when the
 * boundary is the outermost element in the tree.
 *
 * **The gap this closes.** `App` is
 * `<ExtensionRegistryProvider><ShellHostProvider><ShellLayout /></…></…>`, and
 * `ShellLayout` composes its `FaultBoundary` instances INSIDE itself. A boundary
 * never catches itself or a parent, so a throw in either provider's own render,
 * or in `ShellLayout`'s own render above its inner boundaries, unmounts the whole
 * React root and leaves an empty `<div id="root">`. In a browser that is a white
 * page; under Electron it is a blank native window with no address bar, no
 * devtools a normal user can reach, and nothing to report. This component is what
 * stands there instead.
 *
 * 1. `getDerivedStateFromError` STORES THE THROWN VALUE AND READS NOTHING OFF
 *    IT. Verbatim in spirit from `FaultBoundary` decision 1, and for the same
 *    reason: that static runs inside React's error path, where a *second* throw
 *    is not recoverable — React aborts the root rather than catching again — and
 *    at this level there is no outer boundary left to abort into. Not
 *    `error.message`, not `String(error)`, not `instanceof`. The value is boxed
 *    into state untouched and every attempt to read it happens in `render`.
 *
 *    The boxing is part of the same decision: stored bare, a thrown `null` would
 *    be indistinguishable from "nothing has thrown" and the fallback would never
 *    appear at all. *Tests:*
 *    `src/components/__tests__/RootBoundary.test.tsx` — "survives a thrown null,
 *    which is legal and is not the same as nothing thrown", which is the case
 *    that bites: a mutation making this static read `error.message` is killed by
 *    the thrown-`null` row rather than by the armed-getter row, because React's
 *    own dev diagnostics read `message` before this component ever sees the
 *    value. Also "survives an error whose message getter throws, and shows host
 *    text instead" and "survives a thrown value that is not an Error at all".
 *
 * 2. THE MESSAGE IS READ THROUGH `describeFault`, IMPORTED RATHER THAN COPIED,
 *    AND THAT IS A DECISION. The argument for duplicating it here is "the
 *    last-resort boundary should depend on nothing" — and it is weaker than it
 *    sounds. `describeFault` is a pure function in a sibling module, not
 *    something *below* this boundary: it takes a value and returns a string, it
 *    closes over nothing, its module has no top-level side effect, and it is
 *    already in the bundle because `ShellLayout` imports `FaultBoundary`
 *    regardless. A second copy of the same guard would be a second thing to keep
 *    correct, and the guard is the part that must not drift. It reads the message
 *    only under `try`/`catch` and only after `typeof` has proved the value is a
 *    primitive string; `String()` is never reached, because `String()` consults
 *    three plug-in-writable hooks. The guard's own rows live with the function,
 *    in `src/components/__tests__/FaultBoundary.test.tsx`; what is pinned HERE is
 *    that this component reaches it correctly, by "survives a thrown value that
 *    is not an Error at all".
 *
 * 3. THE FALLBACK IS STYLED INLINE, AND ONLY THE FALLBACK. Every other surface in
 *    this repository is styled with Tailwind classes, and this one is not,
 *    because this is the one surface that must render legibly when the reason
 *    nothing works is that nothing loaded. A stylesheet that 404s, a CSS chunk
 *    that fails to fetch on a subpath deployment, an Electron `file://` load with
 *    a bad asset path — in every one of those the class names resolve to nothing
 *    and a class-styled fallback is unstyled black-on-transparent text of
 *    unknown size on a page of unknown colour. So the container owns BOTH sides
 *    of the contrast pair: an opaque `#ffffff` background and `#111827` text,
 *    which is 17.4:1 and clears WCAG 2.2 §1.4.3 (4.5:1, Level AA) whatever the
 *    page behind it is, light or dark, themed or not yet themed. The border is
 *    `#4b5563` — 7.4:1 against the surface, well past the 3:1 §1.4.11 asks of a
 *    non-text boundary. Nothing here sets `outline`, because with no stylesheet
 *    the user agent's own focus ring is the only focus indicator there is.
 *    *Test:* "owns both sides of the contrast pair inline, so it is legible with
 *    no stylesheet", which computes the ratio from the declared colours rather
 *    than trusting the number in this sentence, and asserts the absent
 *    `outline` in the same place.
 *
 * 4. THE FALLBACK RENDERS NO PLUG-IN COMPONENT AND NO PLUG-IN MARKUP. Same
 *    structural answer as `FaultBoundary` decision 2, and it has to be, because
 *    "anything thrown by the fallback itself" is uncatchable here in a way it is
 *    not one level down: there is no boundary above this one to land in. The only
 *    non-host value that reaches the fallback is the guarded message, and it
 *    arrives as a JSX text node. No `dangerouslySetInnerHTML`, no `innerHTML`, no
 *    URL-bearing attribute, no render prop, no `children` in the fallback branch.
 *    *Tests:* "the outermost fallback reaches no markup sink of any kind", "the
 *    outermost fallback names no URL-bearing attribute at all" and "renders no
 *    element from the failed subtree in the fallback"; the two source scans are
 *    kept honest by "reports a planted sink, so the two scans above cannot pass
 *    vacuously".
 *
 * 5. THE RECOVERY VERB IS **RELOAD**, NOT **RETRY**, AND THE RETRY BOUND IS ZERO.
 *    This is the decision that most obviously is not a copy of `FaultBoundary`,
 *    which offers three bounded retries. A pane can plausibly recover from a
 *    transient render failure while the shell around it keeps its registry, its
 *    host store and its layout. A root failure cannot: what threw is a provider's
 *    own render, so there is no state below to preserve — remounting in place
 *    would rebuild the registry empty and the host store empty, which is a reload
 *    that lies about itself by keeping the module graph. Offering "Retry" here
 *    would name an operation the component cannot perform. So the fallback offers
 *    one control, it says Reload, and this boundary never re-renders the failed
 *    tree on its own: no timer, no interval, no automatic re-arm, no bounded
 *    in-place retry either. A deterministic throw plus an automatic retry is an
 *    unbounded render loop that pins a core, and at the root there is nothing
 *    left to contain it. *Tests:* "never retries the failed subtree on its own —
 *    the bound is zero" and "offers exactly one control, and it says Reload
 *    rather than Retry".
 *
 * 6. THE RECOVERY AFFORDANCE ASSUMES NO ELECTRON API, BECAUSE NONE IS WIRED.
 *    `window.location.reload()` is the whole of it. It works in a browser tab and
 *    it works in an Electron renderer, where it reloads the renderer without
 *    involving the main process. There is no `ipcRenderer`, no preload bridge and
 *    no `window.electron` in this repository today, and inventing a call to one
 *    would be a fallback that throws a `TypeError` in the one place a throw has
 *    nowhere to go. When a bridge exists, this is the site to revisit — and the
 *    revisit must keep the guard in `requestReload`, not remove it. *Tests:*
 *    "invents no Electron API, because none is wired up yet" and "asks the host
 *    environment to reload when the control is pressed".
 *
 * 7. THE REPORT IS DOUBLE-GUARDED, AND SO IS THE RELOAD. `console` is no more the
 *    host's object than the code that threw — same reasoning as `FaultBoundary`
 *    decision 6 — and `window.location` is no more the host's object either. Both
 *    calls sit inside a `try`/`catch` whose `catch` does nothing, because
 *    reporting and reloading are best-effort and rendering the fallback is not.
 *    Nothing is interpolated into the report: the thrown value is passed as its
 *    own argument, so no `toString`, `valueOf` or `Symbol.toPrimitive` runs.
 *    *Tests:* "survives a console.error that itself throws", "survives a
 *    location.reload that itself throws" and "reports under its own marker, so
 *    the tier that caught is identifiable".
 *
 * 8. ACCESSIBILITY. `role="alert"` on the container, so the surface is announced
 *    the moment it replaces the shell; a real `<h1>`, because when this renders
 *    there is no other heading on the page and a screen-reader user arriving by
 *    heading navigation must find something; and a real `<button>`, which is in
 *    the tab order by construction and needs no `tabIndex`. The colours in
 *    decision 3 are part of this, not separate from it. *Tests:* "gives the
 *    fallback a real heading, because no other heading is left on the page",
 *    "reaches the reload control by keyboard alone, and activates it with the
 *    keyboard" and "contains a provider that throws in its own render, and
 *    announces the failure".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT CATCH. It is an ordinary React error boundary and catches
 * render, lifecycle and constructor errors on the subtree below it. Being the
 * outermost boundary widens what "below it" means; it changes nothing about the
 * KIND of failure a boundary sees. This component must never be described as
 * covering:
 *
 *   - **Errors thrown in event handlers.** Including the ones inside its own
 *     fallback — decision 4 is why there is nothing in there to throw.
 *   - **`setTimeout`, `setInterval` and `requestAnimationFrame` callbacks.** They
 *     run on a fresh task with no React stack above them.
 *   - **Unhandled promise rejections.** Async work is not part of any render.
 *   - **Server-side rendering.** `componentDidCatch` does not run during
 *     `renderToString`. This shell does not server-render.
 *   - **Anything thrown in `App`'s own render body, or in module scope.** A
 *     boundary composed INSIDE `App`'s returned tree is below `App`'s own render,
 *     and a module-scope throw happens while `main.tsx` is still evaluating its
 *     imports — before any React code runs at all. Neither is reachable by any
 *     boundary, including one wrapped around `createRoot(...).render(...)`, which
 *     is why `src/main.tsx` does not compose a second one. `App`'s body today is
 *     a bare `return` with no hooks and no expressions, so there is nothing in it
 *     that can throw; that is a property of the current file rather than a
 *     guarantee, and it is stated here so a future edit to `App` knows what it is
 *     stepping outside of.
 *   - **Anything thrown by this fallback itself.** There is no boundary above
 *     this one. That is what makes decision 4 structural rather than stylistic.
 *
 * The same list is in `DEVELOPER.md` under "Fault containment — and its real
 * limits", which describes both tiers.
 * ============================================================================
 */

/**
 * Ask the host environment to reload the document, without the ask becoming a
 * second failure.
 *
 * Exported so the guard can be exercised directly against a `location` whose
 * `reload` throws, rather than only through a rendered tree — the same reason
 * `describeFault` is exported from `FaultBoundary`. The `catch` is empty on
 * purpose: if the environment refuses to reload there is nothing further this
 * component can do, and the fallback is still on screen with its text intact.
 */
export function requestReload(): void {
  try {
    window.location.reload();
  } catch {
    // Best-effort. A refused reload leaves the fallback standing, which is
    // strictly better than a throw inside a click handler at the root.
  }
}

/**
 * Report the failure without the report becoming a second failure.
 *
 * The marker string is deliberately different from `FaultBoundary`'s, so that a
 * log, a crash reporter or a test can tell which tier caught. Nothing is
 * interpolated — the value is handed over as its own argument.
 */
function report(error: unknown): void {
  try {
    console.error('RootBoundary contained a failure above the shell.', error);
  } catch {
    // Reporting is best-effort. Rendering the fallback is not.
  }
}

export interface RootBoundaryProps {
  readonly children: ReactNode;
}

interface RootBoundaryState {
  /**
   * The thrown value, boxed.
   *
   * Boxed rather than stored bare so that a throw of `null` or `undefined` —
   * both legal — stays distinguishable from "nothing has thrown".
   */
  readonly caught: { readonly value: unknown } | null;
}

/**
 * Inline styles, and only for the fallback. See decision 3 for why this one
 * surface does not use the class names every other surface uses.
 */
const SURFACE: CSSProperties = {
  boxSizing: 'border-box',
  margin: '0',
  padding: '24px',
  minHeight: '100%',
  backgroundColor: '#ffffff',
  color: '#111827',
  border: '1px solid #4b5563',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  fontSize: '14px',
  lineHeight: '1.5',
};

const HEADING: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '18px',
  lineHeight: '1.4',
  fontWeight: 600,
  color: '#111827',
};

const PARAGRAPH: CSSProperties = {
  margin: '0 0 12px',
  color: '#111827',
};

const BUTTON: CSSProperties = {
  // No `outline` of any kind: with no stylesheet the user agent's focus ring is
  // the only focus indicator on the page.
  margin: '0',
  padding: '6px 12px',
  minHeight: '32px',
  backgroundColor: '#ffffff',
  color: '#111827',
  border: '1px solid #4b5563',
  borderRadius: '2px',
  fontFamily: 'inherit',
  fontSize: '14px',
  lineHeight: '1.5',
  cursor: 'pointer',
};

export class RootBoundary extends Component<RootBoundaryProps, RootBoundaryState> {
  override state: RootBoundaryState = { caught: null };

  /**
   * Store the thrown value. Read nothing off it. See decision 1.
   *
   * The parameter is `unknown` rather than `Error` because `throw` accepts any
   * value and nothing obliges the code above to throw an `Error`.
   */
  static getDerivedStateFromError(error: unknown): RootBoundaryState {
    return { caught: { value: error } };
  }

  override componentDidCatch(error: unknown): void {
    report(error);
  }

  private readonly handleReload = (): void => {
    requestReload();
  };

  override render(): ReactNode {
    const { caught } = this.state;
    if (caught === null) {
      // Unkeyed, deliberately. There is no retry and no reset, so there is no
      // path on which a generation counter would ever change — a key here would
      // be decoration claiming a remount semantics this component does not have.
      return this.props.children;
    }

    const message = describeFault(caught.value);

    return (
      <div role="alert" data-root-boundary="" style={SURFACE}>
        <h1 style={HEADING}>The application could not start.</h1>
        <p style={PARAGRAPH} data-root-message="">
          {message}
        </p>
        <p style={PARAGRAPH}>
          This failure is above the shell, so nothing below it is running. Reloading is the only
          recovery from here.
        </p>
        <button type="button" style={BUTTON} onClick={this.handleReload}>
          Reload
        </button>
      </div>
    );
  }
}
