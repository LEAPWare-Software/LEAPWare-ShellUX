import { afterEach, describe, expect, it, vi } from 'vitest';
import * as hotkeysModule from '../hotkeys';
import { describeHotkey, hotkeyToken, matchesHotkey } from '../hotkeys';
import type { Hotkey } from '../types';

/**
 * `src/core/hotkeys.ts` is three pure functions and nothing else.
 *
 * The last describe block in this file is the scope line for Phase 1: the module
 * must attach no listener and export no dispatcher. That is asserted rather than
 * promised, because "we did not build it yet" is exactly the kind of claim that
 * quietly stops being true.
 */

/** The five fields `matchesHotkey` reads, all optional. */
type KeyEventFields = Partial<
  Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
>;

/** A keyboard event reduced to the five fields `matchesHotkey` reads. */
function keyEvent(
  overrides: KeyEventFields,
): Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> {
  return {
    key: 'k',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('hotkeyToken', () => {
  it('spells a bare key as the lowercased key alone', () => {
    expect(hotkeyToken({ key: 'f5' })).toBe('f5');
  });

  it('spells every modifier in the fixed ctrl, alt, shift, meta order', () => {
    expect(hotkeyToken({ key: 'k', ctrl: true, alt: true, shift: true, meta: true })).toBe(
      'ctrl+alt+shift+meta+k',
    );
  });

  it('spells each modifier alone, and combinations, in that same order', () => {
    expect(hotkeyToken({ key: 'k', ctrl: true })).toBe('ctrl+k');
    expect(hotkeyToken({ key: 'k', alt: true })).toBe('alt+k');
    expect(hotkeyToken({ key: 'k', shift: true })).toBe('shift+k');
    expect(hotkeyToken({ key: 'k', meta: true })).toBe('meta+k');
    expect(hotkeyToken({ key: 'k', ctrl: true, shift: true })).toBe('ctrl+shift+k');
    expect(hotkeyToken({ key: 'arrowup', alt: true, meta: true })).toBe('alt+meta+arrowup');
  });

  it('is independent of the order the author declared the fields in', () => {
    const declaredOneWay: Hotkey = { key: 'k', ctrl: true, shift: true };
    const declaredTheOther: Hotkey = { shift: true, ctrl: true, key: 'k' };
    expect(hotkeyToken(declaredOneWay)).toBe(hotkeyToken(declaredTheOther));
  });

  it('treats an absent modifier and an explicit false as one chord', () => {
    expect(hotkeyToken({ key: 'k', ctrl: true })).toBe(
      hotkeyToken({ key: 'k', ctrl: true, alt: false, shift: false, meta: false }),
    );
  });

  it('lowercases the key, so casing cannot produce two tokens for one chord', () => {
    expect(hotkeyToken({ key: 'K', ctrl: true })).toBe('ctrl+k');
    expect(hotkeyToken({ key: 'ArrowUp', ctrl: true })).toBe('ctrl+arrowup');
  });
});

describe('describeHotkey', () => {
  it('spells the worked example from the design as Ctrl+Shift+K', () => {
    expect(describeHotkey({ key: 'k', ctrl: true, shift: true })).toBe('Ctrl+Shift+K');
  });

  it('spells every modifier, in the same fixed order, with Meta named Meta', () => {
    expect(describeHotkey({ key: 'k', ctrl: true, alt: true, shift: true, meta: true })).toBe(
      'Ctrl+Alt+Shift+Meta+K',
    );
  });

  it('upper-cases the first character of every other key', () => {
    expect(describeHotkey({ key: 'f5' })).toBe('F5');
    expect(describeHotkey({ key: 'escape' })).toBe('Escape');
    expect(describeHotkey({ key: 'home' })).toBe('Home');
    expect(describeHotkey({ key: 'backspace' })).toBe('Backspace');
    expect(describeHotkey({ key: '7', ctrl: true })).toBe('Ctrl+7');
  });

  it('gives each multi-word key its camel-cased label rather than "Arrowup"', () => {
    expect(describeHotkey({ key: 'arrowup' })).toBe('ArrowUp');
    expect(describeHotkey({ key: 'arrowdown' })).toBe('ArrowDown');
    expect(describeHotkey({ key: 'arrowleft' })).toBe('ArrowLeft');
    expect(describeHotkey({ key: 'arrowright' })).toBe('ArrowRight');
    expect(describeHotkey({ key: 'pageup' })).toBe('PageUp');
    expect(describeHotkey({ key: 'pagedown' })).toBe('PageDown');
  });

  it('normalises the key casing before labelling it', () => {
    expect(describeHotkey({ key: 'ARROWLEFT', alt: true })).toBe('Alt+ArrowLeft');
  });
});

describe('matchesHotkey', () => {
  it('matches when the key and all four modifier states agree', () => {
    const hotkey: Hotkey = { key: 'k', ctrl: true, shift: true };
    expect(
      matchesHotkey(hotkey, keyEvent({ key: 'k', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it('matches a bare chord against an event holding no modifier', () => {
    expect(matchesHotkey({ key: 'f5' }, keyEvent({ key: 'F5' }))).toBe(true);
  });

  it('compares the event key case-insensitively', () => {
    expect(matchesHotkey({ key: 'k', ctrl: true }, keyEvent({ key: 'K', ctrlKey: true }))).toBe(
      true,
    );
  });

  it('does not match a different key', () => {
    expect(matchesHotkey({ key: 'k', ctrl: true }, keyEvent({ key: 'j', ctrlKey: true }))).toBe(
      false,
    );
  });

  it('does not match when a declared modifier is not held', () => {
    expect(matchesHotkey({ key: 'k', ctrl: true }, keyEvent({ key: 'k' }))).toBe(false);
    expect(matchesHotkey({ key: 'k', alt: true }, keyEvent({ key: 'k' }))).toBe(false);
    expect(
      matchesHotkey({ key: 'k', ctrl: true, shift: true }, keyEvent({ key: 'k', ctrlKey: true })),
    ).toBe(false);
    expect(matchesHotkey({ key: 'k', meta: true }, keyEvent({ key: 'k' }))).toBe(false);
  });

  it('does not match when an undeclared modifier is held — no chord swallows its supersets', () => {
    expect(matchesHotkey({ key: 'f5' }, keyEvent({ key: 'f5', ctrlKey: true }))).toBe(false);
    expect(matchesHotkey({ key: 'f5' }, keyEvent({ key: 'f5', altKey: true }))).toBe(false);
    expect(
      matchesHotkey({ key: 'k', ctrl: true }, keyEvent({ key: 'k', ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(matchesHotkey({ key: 'f5' }, keyEvent({ key: 'f5', metaKey: true }))).toBe(false);
  });

  it('reads only the five fields it declares, so a plain record is enough', () => {
    // No KeyboardEvent is constructed anywhere in this file. If `matchesHotkey`
    // ever reaches for `preventDefault`, `target` or `repeat`, every case above
    // starts throwing rather than returning a boolean.
    const record = { key: 'enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(matchesHotkey({ key: 'enter' }, record)).toBe(true);
  });
});

describe('hotkeys module — does not attach anything', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports exactly the three pure helpers and no dispatcher', () => {
    expect(Object.keys(hotkeysModule).sort()).toEqual([
      'describeHotkey',
      'hotkeyToken',
      'matchesHotkey',
    ]);
  });

  it('registers no keyboard listener when its functions are called', () => {
    const onWindow = vi.spyOn(window, 'addEventListener');
    const onDocument = vi.spyOn(document, 'addEventListener');

    const hotkey: Hotkey = { key: 'k', ctrl: true };
    hotkeyToken(hotkey);
    describeHotkey(hotkey);
    matchesHotkey(hotkey, keyEvent({ key: 'k', ctrlKey: true }));

    expect(onWindow).not.toHaveBeenCalled();
    expect(onDocument).not.toHaveBeenCalled();
  });
});
