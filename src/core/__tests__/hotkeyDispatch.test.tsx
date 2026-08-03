import { StrictMode } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController } from '../ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { useHotkeyDispatch } from '../hotkeyDispatch';
import type { HostChordId } from '../hotkeyDispatch';
import type { RibbonContext } from '../types';
import { makeAction, makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * THE SHELL'S ONE KEYBOARD LISTENER, AND EVERYTHING IT REFUSES TO DO.
 * ============================================================================
 * `useHotkeyDispatch` is the first and only `addEventListener` under `src/`. Two
 * families of case live here, and they are not the same kind of claim:
 *
 *  - **WHAT FIRES.** A visible, enabled chord on the FOREGROUND extension, with
 *    the live context and that extension's own revocable handle. These are
 *    ordinary behaviour tests.
 *  - **WHAT DOES NOT.** Hidden, disabled, background, released, suppressed. These
 *    are the containment tests, and the reason the dispatcher is defensible at
 *    all: ADR-0001 Amendment H Decision 1 licenses a hotkey as a second way to
 *    fire an action's `onExecute` "gated by the same `isVisible` and the same
 *    `isDisabled`", so a chord that fired where the button would not would make
 *    the chord the WIDER route and collapse that argument.
 *
 * **The suppression list is a guardrail, not a boundary, and no test here says
 * otherwise.** `isEditableTarget` recognises the surfaces the platform names —
 * the three form elements, `contenteditable`, and three ARIA text roles. A
 * plug-in that renders a custom editor out of a bare `div` gets a chord fired
 * into it while the user types, and that is stated in the module rather than
 * papered over. What is asserted below is that the recognised surfaces really are
 * recognised.
 *
 * `element.isContentEditable` is not used by the module and must not be: it
 * returns `undefined` in this jsdom, so a check built on it would pass every case
 * in this file while doing nothing in a browser. `closest()` is used instead, and
 * it works correctly here — which is why the `contenteditable` cases below are
 * evidence rather than decoration.
 * ============================================================================
 */

/** The chord every "fires" case below uses. */
const CHORD = { key: 'k', ctrl: true, shift: true } as const;

function Providers({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

interface Harness {
  readonly registry: ExtensionRegistry;
  readonly activation: ActivationController;
  readonly store: ShellStateStore;
  /** Every host chord the dispatcher routed, in order. */
  readonly hostChords: readonly HostChordId[];
}

/** The host, with dispatch switched on exactly as `ShellLayout` switches it on. */
function mountHost(): { result: { current: Harness }; unmount: () => void } {
  const hostChords: HostChordId[] = [];
  const { result, unmount } = renderHook(
    (): Harness => {
      useHotkeyDispatch((id) => {
        hostChords.push(id);
      });
      return {
        hostChords,
        registry: useRegistry(),
        activation: useActivation(),
        store: useShellStore(),
      };
    },
    { wrapper: Providers },
  );
  return { result, unmount };
}

/** Register `blueprint` and bring it to the foreground. */
function activate(host: { current: Harness }, blueprint: Record<string, unknown>): void {
  act(() => {
    expect(host.current.registry.register(blueprint).ok).toBe(true);
  });
  act(() => {
    expect(host.current.activation.activate(blueprint.id as string).ok).toBe(true);
  });
}

/** Register `blueprint` without activating it. */
function registerOnly(host: { current: Harness }, blueprint: Record<string, unknown>): void {
  act(() => {
    expect(host.current.registry.register(blueprint).ok).toBe(true);
  });
}

/** A blueprint whose single ribbon action carries `overrides`. */
function blueprintWith(
  overrides: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return makeBlueprint({ ribbonActions: [makeAction({ hotkey: CHORD, ...overrides })], ...extra });
}

/** Every field of a `keydown` this suite ever varies. */
type PressInit = KeyboardEventInit & { readonly key: string };

/**
 * Dispatch one `keydown` and hand back the event, so a case can inspect what the
 * dispatcher did to it.
 *
 * `bubbles` and `cancelable` are always on: the listener is registered in the
 * BUBBLE phase on `window`, so a non-bubbling event would never reach it, and
 * `preventDefault` on a non-cancelable event is a silent no-op that would make
 * the `defaultPrevented` assertions vacuous.
 */
function press(init: PressInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** The full chord as a `keydown` init, with `overrides` applied. */
function chordPress(overrides: Partial<KeyboardEventInit> = {}): PressInit {
  return { key: 'k', ctrlKey: true, shiftKey: true, ...overrides };
}

/** An element appended to the document body for the duration of one case. */
function mountTarget(html: string): Element {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild;
  if (element === null) {
    throw new Error('the test fixture produced no element');
  }
  document.body.append(holder);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useHotkeyDispatch — what fires', () => {
  it('fires a visible, enabled chord on the foreground extension', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const event = press(chordPress());

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    host.unmount();
  });

  it('hands onExecute the live context and the extension own shell handle', () => {
    const seen: { context?: Readonly<RibbonContext>; shell?: unknown } = {};
    const onExecute = vi.fn((context: Readonly<RibbonContext>, shell: unknown) => {
      seen.context = context;
      seen.shell = shell;
    });
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const active = host.result.current.activation.getActive();
    expect(active).not.toBeNull();

    press(chordPress());

    // The same object the store holds right now, and the same revocable handle
    // the ribbon passes — not a copy, and not the unscoped store.
    expect(seen.context).toBe(host.result.current.store.getContext());
    expect(seen.shell).toBe(active?.shell);
    host.unmount();
  });

  it('fires a chord belonging to an action that renders in the overflow menu', () => {
    // Placement is a RENDERING decision — `INLINE_ACTION_LIMIT` is 4 — and the
    // dispatcher must not inherit it. This chord is on the seventh action, which
    // the ribbon puts in the overflow menu.
    const onExecute = vi.fn();
    const actions = Array.from({ length: 7 }, (_unused, index) =>
      makeAction({ id: `act-${index}`, label: `Action ${index}` }),
    );
    actions[6] = makeAction({ id: 'act-6', label: 'Action 6', hotkey: CHORD, onExecute });

    const host = mountHost();
    activate(host.result, makeBlueprint({ ribbonActions: actions }));

    press(chordPress());

    expect(onExecute).toHaveBeenCalledTimes(1);
    host.unmount();
  });

  it('reads the context off the store at dispatch time, not from a snapshot captured when the listener was attached', () => {
    // The listener is attached ONCE, on mount, when `selectedItemId` is null. If
    // the context had been captured then, this predicate would see null on every
    // keystroke for the rest of the session and the action would never appear.
    const seen: (string | null)[] = [];
    const onExecute = vi.fn();
    const host = mountHost();
    activate(
      host.result,
      blueprintWith({
        isVisible: (context: RibbonContext): boolean => {
          seen.push(context.selectedItemId);
          return context.selectedItemId === 'row-2';
        },
        onExecute,
      }),
    );

    const store = host.result.current.store;
    // No `act`: nothing in this tree subscribes to the context, so this write
    // schedules no React work at all. That is the point — the dispatcher does not
    // need a commit to see it.
    store.setSelectedItem('row-1');
    press(chordPress());
    expect(seen).toEqual(['row-1']);
    expect(onExecute).not.toHaveBeenCalled();

    store.setSelectedItem('row-2');
    press(chordPress());

    expect(seen).toEqual(['row-1', 'row-2']);
    expect(onExecute).toHaveBeenCalledTimes(1);
    // The authoritative object itself, not a copy and not a re-derived snapshot,
    // and the SAME one the handler was given.
    expect(seen).toHaveLength(2);
    expect(onExecute.mock.calls[0]?.[0]).toBe(store.getContext());
    host.unmount();
  });
});

/**
 * ============================================================================
 * HOST CHRONE BEFORE PLUG-IN CHORDS. NOT A PRIORITY COLUMN — A DIFFERENT TABLE.
 * ============================================================================
 * `HOST_CHORDS` is consulted before `activation.getActive()` is even called, so
 * an extension declaring Ctrl+K is not REJECTED — it simply never receives the
 * keystroke while the host wants it. That is what makes "host chrome is not
 * plug-in-declarable" a structure rather than a rule written down somewhere, and
 * it is the same reason `HostCommand` carries no `hotkey` field.
 * ============================================================================
 */
describe('useHotkeyDispatch — the host own chords', () => {
  it('opens the command palette on the host own chord', () => {
    const host = mountHost();
    const event = press({ key: 'k', ctrlKey: true });
    expect(host.result.current.hostChords).toEqual(['open-command-palette']);
    expect(event.defaultPrevented).toBe(true);
    host.unmount();
  });

  it('accepts Meta as well as Ctrl, because Cmd-K and Ctrl-K are one command', () => {
    const host = mountHost();
    press({ key: 'k', metaKey: true });
    // Upper case too: the comparison lowercases `event.key`, which a Shift-less
    // Caps Lock still produces.
    press({ key: 'K', ctrlKey: true });
    expect(host.result.current.hostChords).toEqual([
      'open-command-palette',
      'open-command-palette',
    ]);
    host.unmount();
  });

  it('fires on no bare key and on no chord carrying alt or shift', () => {
    const host = mountHost();
    press({ key: 'k' });
    press({ key: 'k', ctrlKey: true, altKey: true });
    press({ key: 'k', ctrlKey: true, shiftKey: true });
    press({ key: 'j', ctrlKey: true });
    expect(host.result.current.hostChords).toEqual([]);
    host.unmount();
  });

  it('reaches the host chord before the extension chord table, so an extension declaring Ctrl+K never sees it', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(
      host.result,
      makeBlueprint({
        ribbonActions: [
          makeAction({ id: 'act-k', hotkey: { key: 'k', ctrl: true }, onExecute }),
        ],
      }),
    );

    const event = press({ key: 'k', ctrlKey: true });

    // The declaration was ACCEPTED — nothing rejects it, and rejecting it would
    // make load order semantically load-bearing. It is simply unreachable while
    // the host claims the chord.
    expect(onExecute).not.toHaveBeenCalled();
    expect(host.result.current.hostChords).toEqual(['open-command-palette']);
    expect(event.defaultPrevented).toBe(true);
    host.unmount();
  });

  it('fires the host chord while the user is typing, which a plug-in chord may not do', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const input = document.createElement('input');
    document.body.append(input);

    // A PLUG-IN chord is suppressed on an editable target, because it would fire
    // on top of what the user is typing.
    press(chordPress(), input);
    expect(onExecute).not.toHaveBeenCalled();

    // A HOST chord is not. It carries Ctrl or Meta, so it produces no character,
    // and the omnibox composer is the surface a user is most likely to want the
    // palette from. One rule, applied to one of the two tables, stated rather than
    // left to inference.
    press({ key: 'k', ctrlKey: true }, input);
    expect(host.result.current.hostChords).toEqual(['open-command-palette']);
    host.unmount();
  });

  it('is suppressed by every event-level rule a plug-in chord is suppressed by', () => {
    const host = mountHost();
    // Auto-repeat, an IME composition in flight, and a key something below already
    // handled. None of these is about WHERE the keystroke landed, so all three
    // apply to both tables.
    press({ key: 'k', ctrlKey: true, repeat: true });
    press({ key: 'k', ctrlKey: true, isComposing: true });
    press({ key: 'k', ctrlKey: true, keyCode: 229 });
    const prevented = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'k',
      ctrlKey: true,
    });
    prevented.preventDefault();
    act(() => {
      window.dispatchEvent(prevented);
    });
    expect(host.result.current.hostChords).toEqual([]);
    host.unmount();
  });

  it('routes to whichever callback the caller holds now, not the one it mounted with', () => {
    // The callback is read through a ref rather than listed as an effect
    // dependency, so an inline arrow — which every caller will pass — does not
    // detach and reattach the shell one listener on every render. What has to
    // survive that is that the CURRENT callback is the one called.
    const first: string[] = [];
    const second: string[] = [];
    const { rerender, unmount } = renderHook(
      ({ sink }: { readonly sink: string[] }): void => {
        useHotkeyDispatch((id) => {
          sink.push(id);
        });
      },
      { initialProps: { sink: first }, wrapper: Providers },
    );
    press({ key: 'k', ctrlKey: true });
    rerender({ sink: second });
    press({ key: 'k', ctrlKey: true });
    expect(first).toEqual(['open-command-palette']);
    expect(second).toEqual(['open-command-palette']);
    unmount();
  });
});

describe('useHotkeyDispatch — what does not fire', () => {
  it('fires nothing when no extension is in the foreground', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    registerOnly(host.result, blueprintWith({ onExecute }));

    const event = press(chordPress());

    expect(onExecute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    host.unmount();
  });

  it('does not fire a background extension chord while another extension is in the foreground', () => {
    // ADR-0001 Amendment H Decision 6 makes this collision LEGAL: two extensions
    // may both declare Ctrl+Shift+K and both registrations succeed. Scoping the
    // lookup to the foreground is what makes it unambiguous, so the background
    // extension's handler must not run — not even alongside the foreground one.
    const foreground = vi.fn();
    const background = vi.fn();
    const backgroundOnly = vi.fn();

    const host = mountHost();
    registerOnly(
      host.result,
      makeBlueprint({
        id: 'background-ext',
        ribbonActions: [
          makeAction({ id: 'act-collide', hotkey: CHORD, onExecute: background }),
          makeAction({
            id: 'act-alone',
            hotkey: { key: 'j', ctrl: true },
            onExecute: backgroundOnly,
          }),
        ],
      }),
    );
    activate(host.result, blueprintWith({ onExecute: foreground }, { id: 'foreground-ext' }));

    press(chordPress());
    // A chord only the BACKGROUND extension declared reaches nothing at all.
    press({ key: 'j', ctrlKey: true });

    expect(foreground).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    expect(backgroundOnly).not.toHaveBeenCalled();
    host.unmount();
  });

  it('does not fire a chord on an action whose predicate hides it', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ isVisible: () => false, onExecute }));

    const event = press(chordPress());

    expect(onExecute).not.toHaveBeenCalled();
    // Not handled, so the key is left alone for whatever else wanted it.
    expect(event.defaultPrevented).toBe(false);
    host.unmount();
  });

  it('does not fire a chord whose isVisible predicate throws, and reports it once', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onExecute = vi.fn();
    const host = mountHost();
    activate(
      host.result,
      blueprintWith({
        id: 'act-detonates',
        isVisible: () => {
          throw new Error('predicate refused');
        },
        onExecute,
      }),
    );

    const event = press(chordPress());

    expect(onExecute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // The same guard the ribbon uses, so the same report: named action, one line.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
    expect(String(errors.mock.calls[0]?.[0])).toContain('isVisible predicate');
    host.unmount();
  });

  it('does not fire a chord on a disabled action', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ isDisabled: true, onExecute }));

    const event = press(chordPress());

    expect(onExecute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    host.unmount();
  });

  it('ignores a key that is not the chord, and an action that declares no chord', () => {
    const withChord = vi.fn();
    const withoutChord = vi.fn();
    const host = mountHost();
    activate(
      host.result,
      makeBlueprint({
        ribbonActions: [
          makeAction({ id: 'act-plain', onExecute: withoutChord }),
          makeAction({ id: 'act-chord', hotkey: CHORD, onExecute: withChord }),
        ],
      }),
    );

    // Right key, wrong modifiers — `matchesHotkey` is exact in both directions.
    //
    // `altKey` is set as well as `ctrlKey`, and that is not padding: bare Ctrl+K
    // is the HOST's own chord and would be claimed before the extension table is
    // consulted at all, so this case would stop measuring what it names. Alt is
    // deliberately outside `HOST_CHORDS`, which is asserted directly in "reaches
    // the host chord before the extension chord table, so an extension declaring
    // Ctrl+K never sees it".
    const event = press({ key: 'k', ctrlKey: true, altKey: true });

    expect(withChord).not.toHaveBeenCalled();
    expect(withoutChord).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    host.unmount();
  });

  it('stops firing after the extension is released', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    press(chordPress());
    expect(onExecute).toHaveBeenCalledTimes(1);

    act(() => {
      expect(host.result.current.activation.release('sample-ext')).toBe(true);
    });
    press(chordPress());

    expect(onExecute).toHaveBeenCalledTimes(1);
    host.unmount();
  });

  it('stops firing from the statement after unregister, without waiting for a commit', () => {
    // `getActive()` re-checks liveness against the registry rather than trusting
    // the last commit, so the chord is dead immediately rather than until the
    // sweep effect runs. The un-flushed update React complains about is the setup.
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const consoleError = console.error;
    console.error = (): void => undefined;
    try {
      expect(host.result.current.registry.unregister('sample-ext')).toBe(true);
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...chordPress(),
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      console.error = consoleError;
    }

    expect(onExecute).not.toHaveBeenCalled();
    host.unmount();
  });

  it('survives an onExecute that throws, leaving the dispatcher live', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    const host = mountHost();
    activate(
      host.result,
      makeBlueprint({
        ribbonActions: [
          makeAction({
            id: 'act-detonates',
            hotkey: CHORD,
            onExecute: () => {
              throw new Error('handler refused');
            },
          }),
          makeAction({ id: 'act-after', hotkey: { key: 'j', ctrl: true }, onExecute: after }),
        ],
      }),
    );

    expect(() => {
      press(chordPress());
    }).not.toThrow();
    // Still attached, still dispatching: the next chord runs normally.
    press({ key: 'j', ctrlKey: true });

    expect(after).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('act-detonates');
    expect(String(errors.mock.calls[0]?.[0])).toContain('onExecute handler');
    host.unmount();
  });
});

describe('useHotkeyDispatch — suppression', () => {
  it('ignores an event something below already handled', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    // Capture on `window` runs before the dispatcher's bubble-phase listener on
    // the same target, which is how `defaultPrevented` is already true by the
    // time the dispatcher sees it.
    const claim = (event: Event): void => {
      event.preventDefault();
    };
    window.addEventListener('keydown', claim, true);
    try {
      press(chordPress());
    } finally {
      window.removeEventListener('keydown', claim, true);
    }

    expect(onExecute).not.toHaveBeenCalled();
    host.unmount();
  });

  it('ignores auto-repeat, so holding a chord down does not fire it thirty times a second', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    press(chordPress({ repeat: true }));

    expect(onExecute).not.toHaveBeenCalled();
    host.unmount();
  });

  it('ignores a keystroke belonging to an IME composition, by either signal', () => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    // Two different signals for one state, and browsers disagree about which
    // they send, so both are checked and both are asserted.
    press(chordPress({ isComposing: true }));
    press(chordPress({ keyCode: 229 }));

    expect(onExecute).not.toHaveBeenCalled();
    host.unmount();
  });

  it.each([
    ['input', '<input />'],
    ['textarea', '<textarea></textarea>'],
    ['select', '<select><option>one</option></select>'],
    ['a contenteditable descendant', '<div contenteditable><span>typing here</span></div>'],
    ['role=textbox', '<div role="textbox"></div>'],
    ['role=searchbox', '<div role="searchbox"></div>'],
    ['role=combobox', '<div role="combobox"></div>'],
  ])('does not fire while focus is in %s', (_label, html) => {
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const element = mountTarget(html);
    // The contenteditable fixture — and only that one — carries a `span`, and the
    // event is dispatched from it: that is where the caret really is, and it is
    // what makes `closest()` load-bearing rather than an elaborate `===`.
    const event = press(chordPress(), element.querySelector('span') ?? element);

    expect(onExecute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    host.unmount();
  });

  it('still fires from an ordinary element, and from contenteditable="false"', () => {
    // The other side of every case above. Without this, "suppressed" and "broken"
    // are indistinguishable — and `contenteditable="false"` is an explicit opt-OUT
    // that must not be read as an editable ancestor.
    const onExecute = vi.fn();
    const host = mountHost();
    activate(host.result, blueprintWith({ onExecute }));

    const plain = mountTarget('<div><span>ordinary</span></div>');
    press(chordPress(), plain.querySelector('span') ?? plain);
    expect(onExecute).toHaveBeenCalledTimes(1);

    const locked = mountTarget('<div contenteditable="false"><span>read only</span></div>');
    press(chordPress(), locked.querySelector('span') ?? locked);
    expect(onExecute).toHaveBeenCalledTimes(2);

    // A target that is not an `Element` at all — every other case in this file
    // dispatches on `window`, and this says so rather than leaving it implied.
    press(chordPress(), window);
    expect(onExecute).toHaveBeenCalledTimes(3);
    host.unmount();
  });
});

/**
 * ============================================================================
 * THE PAIRING, PINNED AT RUNTIME RATHER THAN BY SOURCE SCAN.
 * ============================================================================
 * `src/__tests__/noEventListener.test.ts` used to forbid `addEventListener`
 * anywhere under `src/` and now allows it in exactly one file. What a source scan
 * can still see is the COUNT — one add, one remove. What it cannot see, and what
 * actually matters, is that the two name the same event and that the cleanup
 * passes the SAME function reference: a cleanup that rebuilt the closure would
 * leak one listener per mount while satisfying every count that file can take.
 * These two cases are the honest replacement for what the absolute scan used to
 * give for free.
 * ============================================================================
 */
describe('useHotkeyDispatch — one listener, and it is removed', () => {
  it('adds exactly one keydown listener and removes the identical handler on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const host = mountHost();

    const added = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(added).toHaveLength(1);

    host.unmount();

    const removed = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(removed).toHaveLength(1);
    // IDENTITY, not shape. `removeEventListener` with a fresh closure is a no-op
    // that leaves the old listener attached, and nothing else in this suite would
    // notice.
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
  });

  it('registers once under StrictMode, whose simulated remount is symmetric', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(
      (): void => {
        useHotkeyDispatch(() => undefined);
      },
      {
        wrapper: ({ children }: { readonly children: ReactNode }) => (
          <StrictMode>
            <Providers>{children}</Providers>
          </StrictMode>
        ),
      },
    );

    // StrictMode mounts, unmounts and remounts every effect. Two adds and one
    // remove is a SINGLE net registration; two adds and no cleanup at all would
    // be the leak this case catches. It counts CALLS, so a cleanup that removed
    // the wrong function reference would still balance here — that is the case
    // above's job, and the two are not redundant.
    const addedWhileMounted = add.mock.calls.filter(([type]) => type === 'keydown').length;
    const removedWhileMounted = remove.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(addedWhileMounted - removedWhileMounted).toBe(1);

    unmount();

    const added = add.mock.calls.filter(([type]) => type === 'keydown').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(added - removed).toBe(0);
  });
});
