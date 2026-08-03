import { describe, expect, it } from 'vitest';
import { matchEscapeChord } from '../main/paneKeyBridge';
import type { KeyInput } from '../main/paneKeyBridge';

/**
 * The escape hatch is the ONE thing `before-input-event` is used for, so the
 * only thing worth testing about it is the boundary: which inputs are it, and
 * which are near misses. A hatch that fires on an ordinary keystroke is a defect
 * that looks exactly like the one it was added to fix.
 */

const CHORD: KeyInput = {
  type: 'keyDown',
  key: 'F',
  control: true,
  meta: false,
  alt: true,
  shift: true,
};

describe('matchEscapeChord', () => {
  it('matches the chord with Ctrl', () => {
    expect(matchEscapeChord(CHORD)).toBe('focus-host-chrome');
  });

  it('matches the chord with Meta, because Cmd and Ctrl are one command', () => {
    expect(matchEscapeChord({ ...CHORD, control: false, meta: true })).toBe('focus-host-chrome');
  });

  it('is case-insensitive on the key, because the platform reports the shifted letter', () => {
    expect(matchEscapeChord({ ...CHORD, key: 'f' })).toBe('focus-host-chrome');
  });

  it.each<[string, Partial<KeyInput>]>([
    ['a key-up', { type: 'keyUp' }],
    ['a raw key event that is not a keyDown', { type: 'rawKeyDown' }],
    ['auto-repeat, which would fire at the OS repeat rate', { isAutoRepeat: true }],
    ['no Alt', { alt: false }],
    ['no Shift', { shift: false }],
    ['neither Ctrl nor Meta', { control: false, meta: false }],
    ['a different letter', { key: 'k' }],
  ])('does not match %s', (_label, override) => {
    expect(matchEscapeChord({ ...CHORD, ...override })).toBeNull();
  });

  it('does not match the host palette chord, which the renderer owns', () => {
    // `HOST_CHORDS` in `src/core/hotkeyDispatch.ts` is Ctrl/Cmd+K with alt and
    // shift ABSENT. The two tables cannot collide, and this is that stated as a
    // value rather than as a comment.
    expect(
      matchEscapeChord({
        type: 'keyDown',
        key: 'k',
        control: true,
        meta: false,
        alt: false,
        shift: false,
      }),
    ).toBeNull();
  });
});
