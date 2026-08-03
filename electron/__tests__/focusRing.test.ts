import { describe, expect, it } from 'vitest';
import { createFocusRing } from '../main/focusRing';
import type { FocusableSurface } from '../main/focusRing';
import type { PaneSurfaceId } from '../main/surfaces';

/**
 * ============================================================================
 * THE STARTUP CASE IS THE POINT OF THIS FILE.
 * ============================================================================
 * The topology spike launched the unarbitrated two-view build five times and
 * recorded which web contents held focus once both had loaded:
 *
 * | Launch | 1 | 2 | 3 | 4 | 5 |
 * |---|---|---|---|---|---|
 * | Focused web contents id | 2 | 2 | **1** | 2 | 2 |
 *
 * Four to the last view added, one to the first, from the same binary and the
 * same host code. **A single launch of a broken ring passes 80% of the time**,
 * which is why "launch it and look" is not the test for this and why the
 * arbitration is written against an injected seam.
 *
 * `platformFocusesLast` and `platformFocusesFirst` below are those two outcomes,
 * driven deliberately. The ring has to end on the same surface in both.
 * ============================================================================
 */

/** One fake surface, plus the counters the assertions read. */
interface FakeSurface extends FocusableSurface {
  /** How many times the ring called `focus()` on this surface. */
  readonly calls: () => number;
  /** Kill it, as a crash or a teardown would. */
  readonly destroy: () => void;
}

/**
 * A platform: N surfaces, at most one of which holds focus.
 *
 * `focus()` moving focus AWAY from whoever held it is the property that makes
 * these fakes worth anything — a set of independent booleans would let a test
 * pass with two surfaces focused at once, which is a state the ring is supposed
 * to make impossible and which the real platform never reports through
 * `webContents.isFocused()`.
 */
function makePlatform(ids: readonly PaneSurfaceId[]): {
  readonly surfaces: FakeSurface[];
  readonly get: (id: PaneSurfaceId) => FakeSurface;
  /** Simulate the #42339 steal: the platform, not the ring, moves focus. */
  readonly platformFocus: (id: PaneSurfaceId) => void;
  readonly focused: () => PaneSurfaceId | null;
} {
  let holder: PaneSurfaceId | null = null;
  const alive = new Set<PaneSurfaceId>(ids);
  const counts = new Map<PaneSurfaceId, number>();

  const platformFocus = (id: PaneSurfaceId): void => {
    holder = id;
  };

  const surfaces = ids.map((id): FakeSurface => {
    counts.set(id, 0);
    return {
      id,
      focus: (): void => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        platformFocus(id);
      },
      isFocused: (): boolean => holder === id,
      isAlive: (): boolean => alive.has(id),
      calls: (): number => counts.get(id) ?? 0,
      destroy: (): void => {
        alive.delete(id);
        if (holder === id) holder = null;
      },
    };
  });

  return {
    surfaces,
    get: (id) => surfaces.find((surface) => surface.id === id) as FakeSurface,
    platformFocus,
    focused: () => holder,
  };
}

function ring(platform: ReturnType<typeof makePlatform>, warnings: string[] = []) {
  return createFocusRing({
    surfaces: platform.surfaces,
    initial: 'chrome',
    warn: (message) => warnings.push(message),
  });
}

describe('createFocusRing — startup is deterministic, whichever view the platform picks', () => {
  it('lands on host chrome when the platform focused the LAST view added, which it did four times in five', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);

    // Exactly the observed sequence: both views load, and by the time the second
    // one has, the platform has moved focus to it and told nobody.
    focusRing.noteReady('chrome');
    platform.platformFocus('extension');
    focusRing.noteReady('extension');

    expect(platform.focused()).toBe('chrome');
    expect(focusRing.intended()).toBe('chrome');
  });

  it('lands on host chrome when the platform focused the FIRST view, which is launch 3', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);

    platform.platformFocus('chrome');
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    expect(platform.focused()).toBe('chrome');
    // And it did NOT churn: the platform already agreed, so no focus call was
    // made. A ring that focused unconditionally would fight a user who clicked
    // into the other pane during startup.
    expect(platform.get('chrome').calls()).toBe(0);
  });

  it('does not assert until every surface has reported ready, because the steal is not synchronous with addChildView', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);

    platform.platformFocus('extension');
    focusRing.noteReady('chrome');

    // The spike read pane A as still focused immediately after `addChildView`
    // and not focused once the new view's document had loaded. A host that
    // asserted here would assert before the steal and lose the race it was
    // trying to win.
    expect(focusRing.isSettled()).toBe(false);
    expect(platform.focused()).toBe('extension');

    focusRing.noteReady('extension');
    expect(focusRing.isSettled()).toBe(true);
    expect(platform.focused()).toBe('chrome');
  });

  it('re-asserts when a surface finishes loading AGAIN, which is what a reload after a severed port is', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    // The extension view reloads. Its document loading is the same trigger that
    // stole focus the first time.
    platform.platformFocus('extension');
    focusRing.noteReady('extension');

    expect(platform.focused()).toBe('chrome');
  });
});

describe('createFocusRing — arbitration after startup', () => {
  it('reconciles a steal the losing renderer was never told about', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    platform.platformFocus('extension');
    focusRing.reconcile();

    expect(platform.focused()).toBe('chrome');
  });

  it('is idempotent: reconciling when the platform already agrees calls nothing', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');
    focusRing.reconcile();

    const before = platform.get('chrome').calls();
    focusRing.reconcile();
    focusRing.reconcile();

    expect(platform.get('chrome').calls()).toBe(before);
  });

  it('does nothing at all before it has settled, so an early signal cannot pre-empt the startup answer', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    platform.platformFocus('extension');

    focusRing.reconcile();

    expect(platform.focused()).toBe('extension');
    expect(platform.get('chrome').calls()).toBe(0);
  });

  it('moves focus on request, which is the only way across a view boundary', () => {
    // The spike measured that `Tab` from the last control of one view wraps
    // inside it and never reaches the other. Host mediation is the whole route.
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    focusRing.request('extension');

    expect(platform.focused()).toBe('extension');
    expect(focusRing.intended()).toBe('extension');
  });

  it('remembers a request made before it settled, and honours it when it does', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);

    focusRing.request('extension');
    focusRing.noteReady('chrome');
    platform.platformFocus('chrome');
    focusRing.noteReady('extension');

    expect(platform.focused()).toBe('extension');
  });

  it('cycles, and wraps', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    expect(focusRing.advance()).toBe('extension');
    expect(platform.focused()).toBe('extension');
    expect(focusRing.advance()).toBe('chrome');
    expect(platform.focused()).toBe('chrome');
  });

  it('refuses a surface it does not know, and says so rather than throwing into a port callback', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const warnings: string[] = [];
    const focusRing = ring(platform, warnings);

    focusRing.request('pane4' as PaneSurfaceId);
    focusRing.noteReady('pane4' as PaneSurfaceId);

    expect(focusRing.intended()).toBe('chrome');
    expect(warnings.filter((line) => line.includes('pane4'))).toHaveLength(2);
  });
});

describe('createFocusRing — a surface that dies', () => {
  it('settles on the surfaces that are alive, so a view destroyed before it loads cannot hang startup', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);

    platform.get('extension').destroy();
    focusRing.noteReady('chrome');

    expect(focusRing.isSettled()).toBe(true);
    expect(platform.focused()).toBe('chrome');
  });

  it('falls through to a living surface when the intent names a dead one', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const warnings: string[] = [];
    const focusRing = ring(platform, warnings);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');
    focusRing.request('extension');

    // The extension view crashes. Under the two-process topology that is the
    // whole extension realm, and keyboard focus must not be left pointing at it.
    platform.get('extension').destroy();
    focusRing.reconcile();

    expect(focusRing.intended()).toBe('chrome');
    expect(platform.focused()).toBe('chrome');
    expect(warnings.some((line) => line.includes('no longer alive'))).toBe(true);
  });

  it('advancing past a dead intent lands on the first living surface rather than throwing', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');
    focusRing.request('extension');
    platform.get('extension').destroy();

    expect(focusRing.advance()).toBe('chrome');
  });

  it('has nowhere to put focus when every surface is gone, and does not pretend otherwise', () => {
    const platform = makePlatform(['chrome', 'extension']);
    const focusRing = ring(platform);
    focusRing.noteReady('chrome');
    focusRing.noteReady('extension');

    platform.get('chrome').destroy();
    platform.get('extension').destroy();
    focusRing.reconcile();

    expect(platform.focused()).toBeNull();
    expect(focusRing.advance()).toBe('chrome');
  });
});
