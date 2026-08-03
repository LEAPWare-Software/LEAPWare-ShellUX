import type { PaneSurfaceId } from './surfaces.js';
import { PANE_SURFACE_IDS } from './surfaces.js';

/**
 * ============================================================================
 * THE HOST-OWNED FOCUS RING. MANDATORY, NOT OPTIONAL, AND HERE IS THE NUMBER.
 * ============================================================================
 * electron/electron#42339 — open since 2024-06-02, labelled
 * `component/accessibility`, checked again 2026-08-03 — says that adding a
 * `WebContentsView` to a window steals keyboard focus. The topology spike
 * reproduced it on **Electron 43.2.0 / Chromium 150.0.7871.129**, and found two
 * things the issue does not say. Both of them decide the shape of this file:
 *
 *  1. **The steal is not synchronous with `addChildView`.** At the first reading
 *     — immediately after `contentView.addChildView(second)`, before any load —
 *     pane A still held focus. By the second reading — after `loadFile()`
 *     resolved, plus 400 ms — it did not. **A host that re-asserts focus on the
 *     line after `addChildView` re-asserts it too early**, which is why this ring
 *     asserts on READINESS (`noteReady`) and never on creation.
 *  2. **The losing renderer is never told.** After the steal, pane A's document
 *     still reported `activeElement: pane-a-text` and `document.hasFocus():
 *     true`; in every reading of the two-view build BOTH pane documents reported
 *     `document.hasFocus() === true` simultaneously. Nothing inside a renderer
 *     can detect that it lost focus. **Only the main process can**, which is why
 *     this arbitration is here and not in a hook.
 *
 * And the consequence of having neither, measured over five identical launches
 * of the same binary and the same host code:
 *
 * | Launch | 1 | 2 | 3 | 4 | 5 |
 * |---|---|---|---|---|---|
 * | Focused web contents id | 2 | 2 | **1** | 2 | 2 |
 *
 * Four of five went to the last view added and one to the first. **Which pane
 * the user is typing into after startup was undefined.** That is the defect this
 * module exists to remove, and `electron/__tests__/focusRing.test.ts` reproduces
 * both orders and asserts one answer.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A SEAM RATHER THAN A FUNCTION OVER `WebContentsView`
 * ---------------------------------------------------------------------------
 * `FocusableSurface` is four members and no Electron types, in exactly the shape
 * and for exactly the reason `ShellStorage` is two members in
 * `HydrationEngine.ts` and `PortLike` is two in `src/core/ipc/PortLike.ts`: the
 * untestable half is put behind a narrow interface and left outside, so the
 * decision logic is exercisable with no Electron anywhere.
 *
 * The alternative was to prove this by launching the application, and the
 * spike's own numbers are why that is not sufficient: a single launch of the
 * unarbitrated build lands on the right view 80% of the time, so ONE green
 * launch is not evidence of anything. A test against fakes can assert the
 * property that actually matters — *whichever* view the platform focuses, the
 * ring ends on the intended one — which no number of launches can.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not make `Tab` cross a view boundary. The spike measured that `Tab`
 * from the last control of pane A **wraps inside pane A** and that getting focus
 * across required `webContents.focus()` from main. Moving focus deliberately —
 * `request` and `advance` below — is host mediation, and it is a different thing
 * from sequential focus navigation. Whether a screen reader's own traversal
 * crosses is arm B of ADR-0005 and is unanswered.
 * ============================================================================
 */

/**
 * One surface the ring may point at.
 *
 * `isFocused` is the main-process reading and is the only trustworthy one — see
 * finding 2 in the banner. `isAlive` exists because a view can be destroyed
 * (a crash, a teardown) between the ring learning about it and the ring being
 * asked to focus it, and calling into a destroyed `webContents` throws.
 */
export interface FocusableSurface {
  readonly id: PaneSurfaceId;
  /** Move keyboard focus to this surface. Called only when it is alive. */
  focus(): void;
  /** Whether the platform says this surface holds keyboard focus, per main. */
  isFocused(): boolean;
  /** Whether this surface still exists. A destroyed view is skipped, never focused. */
  isAlive(): boolean;
}

export interface FocusRingOptions {
  /** Every surface, in cycle order. */
  readonly surfaces: readonly FocusableSurface[];
  /**
   * Where focus lands once every surface has reported ready.
   *
   * A required parameter with no default, for the reason
   * `AuthoritativeStoreOptions.now` has no default: the value this ring exists to
   * make deterministic must not be decided by a fallback nobody reads.
   */
  readonly initial: PaneSurfaceId;
  /**
   * Where a steal, or a call this ring refuses, is reported.
   *
   * Required, and not optional, because a focus steal is invisible everywhere
   * else in the system — the losing renderer does not know, and neither document
   * reports anything unusual. If this ring swallowed it, the event would have no
   * observer at all.
   */
  readonly warn: (message: string) => void;
}

export interface FocusRing {
  /**
   * One surface finished loading its document.
   *
   * **This is the only trigger that asserts focus, and that is finding 1.** The
   * first assertion happens when every alive surface has reported once — the
   * point at which the spike observed the steal to have already happened. A
   * report that arrives AFTER settling is a surface that reloaded, which is a
   * fresh opportunity for the same steal, so it reconciles.
   */
  noteReady(surface: PaneSurfaceId): void;
  /** Point the ring at one surface, and assert it if the ring has settled. */
  request(surface: PaneSurfaceId): void;
  /** Move to the next living surface in cycle order. Returns where it went. */
  advance(): PaneSurfaceId;
  /**
   * Re-assert the intent if the platform has drifted from it.
   *
   * Idempotent by construction: it reads `isFocused` first and calls `focus`
   * only when the answer is wrong, so a caller may run it on any signal at all
   * without generating focus churn.
   */
  reconcile(): void;
  /** The surface the ring intends to hold focus. */
  intended(): PaneSurfaceId;
  /** Whether every alive surface has reported ready at least once. */
  isSettled(): boolean;
}

/**
 * Build the ring.
 *
 * It holds no timers and subscribes to nothing: every input arrives through a
 * method, which is what lets one test drive the exact interleaving the spike
 * observed and the opposite one, in the same file, without a clock.
 */
export function createFocusRing(options: FocusRingOptions): FocusRing {
  const { surfaces, warn } = options;
  const byId = new Map<PaneSurfaceId, FocusableSurface>();
  for (const surface of surfaces) {
    byId.set(surface.id, surface);
  }

  /** Surfaces that have reported a completed load at least once. */
  const ready = new Set<PaneSurfaceId>();
  let intent: PaneSurfaceId = options.initial;
  let settled = false;

  /** The surfaces the ring may point at right now, in cycle order. */
  function living(): FocusableSurface[] {
    const alive: FocusableSurface[] = [];
    for (const id of PANE_SURFACE_IDS) {
      const surface = byId.get(id);
      if (surface !== undefined && surface.isAlive()) {
        alive.push(surface);
      }
    }
    return alive;
  }

  /**
   * The surface the intent resolves to, or `null` when nothing is left to focus.
   *
   * An intent naming a destroyed surface falls through to the first living one
   * rather than being honoured or thrown on. A pane-3 crash under the two-process
   * topology destroys the whole extension view, and the shell must not be left
   * with keyboard focus pointing at a realm that no longer exists.
   */
  function resolveIntent(): FocusableSurface | null {
    const alive = living();
    if (alive.length === 0) {
      return null;
    }
    for (const surface of alive) {
      if (surface.id === intent) {
        return surface;
      }
    }
    const fallback = alive[0] as FocusableSurface;
    warn(
      `focus ring: "${intent}" is no longer alive; focus falls through to "${fallback.id}".`,
    );
    intent = fallback.id;
    return fallback;
  }

  /**
   * Make the platform agree with the intent, if it does not already.
   *
   * The `isFocused` test in front of the `focus` call is what makes every caller
   * of `reconcile` free: a ring that focused unconditionally would fight a user
   * who had just clicked into the other pane, on every signal that reached it.
   */
  function assert(reason: string): void {
    const target = resolveIntent();
    if (target === null) {
      return;
    }
    if (target.isFocused()) {
      return;
    }
    warn(`focus ring: ${reason} — re-asserting focus on "${target.id}".`);
    target.focus();
  }

  return Object.freeze({
    noteReady(surface: PaneSurfaceId): void {
      if (!byId.has(surface)) {
        warn(`focus ring: "${surface}" is not a surface this ring knows. Ignored.`);
        return;
      }
      ready.add(surface);
      if (settled) {
        // A surface that reports ready again has navigated — a reload after a
        // severed port, or a crashed extension view coming back. The spike's
        // steal happens on a view's load completing, so this is exactly the
        // moment it can recur.
        assert(`"${surface}" finished loading again`);
        return;
      }
      for (const candidate of living()) {
        if (!ready.has(candidate.id)) {
          return;
        }
      }
      settled = true;
      assert('every surface has loaded');
    },

    request(surface: PaneSurfaceId): void {
      if (!byId.has(surface)) {
        warn(`focus ring: "${surface}" is not a surface this ring knows. Ignored.`);
        return;
      }
      intent = surface;
      if (settled) {
        assert(`"${surface}" was requested`);
      }
    },

    advance(): PaneSurfaceId {
      const alive = living();
      if (alive.length === 0) {
        return intent;
      }
      const at = alive.findIndex((surface) => surface.id === intent);
      // `-1` is an intent whose surface has died; `+ 1` then lands on index 0,
      // which is the first living surface — the same answer `resolveIntent`
      // gives, reached by arithmetic rather than by a second branch.
      const next = alive[(at + 1) % alive.length] as FocusableSurface;
      intent = next.id;
      if (settled) {
        assert('the focus ring advanced');
      }
      return next.id;
    },

    reconcile(): void {
      if (!settled) {
        return;
      }
      assert('a reconciliation was requested');
    },

    intended(): PaneSurfaceId {
      return intent;
    },

    isSettled(): boolean {
      return settled;
    },
  });
}
