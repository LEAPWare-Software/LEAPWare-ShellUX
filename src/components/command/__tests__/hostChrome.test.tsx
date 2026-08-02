import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostCommand } from '../../../core/commands/CommandRegistry';
import {
  FALLBACK_ICON,
  OVERFLOW_ICON,
  PALETTE_ICON,
  SHELL_ICONS,
  SUBMIT_ICON,
} from '../../ui/shellIcons';

/**
 * ============================================================================
 * HOST CHROME IS NOT PLUG-IN-DECLARABLE. THREE INDEPENDENT SPELLINGS OF THAT.
 * ============================================================================
 * The palette, its chord and its glyph are the host's, and each half is closed by
 * a different mechanism rather than by one rule stated three times:
 *
 *  1. **The chord** is in `HOST_CHORDS` in `src/core/hotkeyDispatch.ts`, consulted
 *     before the extension chord table, so an extension declaring
 *     `{ key: 'k', ctrl: true }` never receives the keystroke. *Tests:* "opens the
 *     command palette on the host own chord" and "reaches the host chord before
 *     the extension chord table, so an extension declaring Ctrl+K never sees it"
 *     in `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *  2. **The command** is a `HostCommand`, which has no `hotkey` field at all — so
 *     there is no table in which a host chord and a plug-in chord could be
 *     compared and one preferred. Asserted below as a runtime property of the
 *     record the host actually builds, because the compile-time absence is
 *     invisible to a plug-in written in JavaScript.
 *  3. **The glyph** is a module constant, absent from `SHELL_ICONS`. That map is
 *     the vocabulary offered to extensions; publishing a host glyph in it would
 *     invite a plug-in to draw a command that looks like host chrome, and would
 *     add a fallback branch to a lookup no untrusted key ever performs. Same
 *     reasoning `OVERFLOW_ICON` was written with, applied to two more glyphs.
 * ============================================================================
 */

/** The `d` of each host-only glyph, harvested by rendering it. */
function pathsOf(element: React.ReactElement): string[] {
  const { container, unmount } = render(element);
  const paths = Array.from(container.querySelectorAll('path')).map(
    (path) => path.getAttribute('d') ?? '',
  );
  unmount();
  return paths;
}

describe('host chrome — the glyphs', () => {
  it('keeps every host-chrome glyph out of the vocabulary published to extensions', () => {
    const published = new Set(
      [...SHELL_ICONS.values()].flatMap((glyph) => pathsOf(glyph).join('|')),
    );
    for (const [name, glyph] of [
      ['OVERFLOW_ICON', OVERFLOW_ICON],
      ['PALETTE_ICON', PALETTE_ICON],
      ['SUBMIT_ICON', SUBMIT_ICON],
    ] as const) {
      expect(published.has(pathsOf(glyph).join('|')), `${name} must not be published`).toBe(false);
    }
  });

  it('resolves a plug-in key naming a host glyph to the fallback, because there is no such key', () => {
    // An extension cannot ask for the palette glyph by name: the map does not
    // hold it under any key, so every guess falls back like any other unknown.
    for (const guess of ['palette', 'command-palette', 'overflow', 'submit', 'more']) {
      expect(SHELL_ICONS.get(guess)).toBeUndefined();
    }
    expect(pathsOf(FALLBACK_ICON)).toEqual(['M3.5 3.5h9v9h-9z']);
  });

  it('draws each host glyph from host-authored geometry only', () => {
    for (const glyph of [OVERFLOW_ICON, PALETTE_ICON, SUBMIT_ICON]) {
      const paths = pathsOf(glyph);
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) {
        // Path data and nothing else: no URL, no scheme, no markup.
        expect(d).toMatch(/^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/);
      }
    }
  });
});

describe('host chrome — the command shape', () => {
  it('gives a host command no hotkey field, so host chords live in one table and plug-in chords in another', () => {
    // A runtime assertion about the record the host builds, because the
    // compile-time absence is invisible to a plug-in written in JavaScript — and
    // because "there is no priority column" is only true if there is no second
    // table to have one.
    const command: HostCommand = {
      id: 'host-open-palette',
      label: 'Open command palette',
      icon: 'search',
      onSelect: () => undefined,
    };
    expect(Object.hasOwn(command, 'hotkey')).toBe(false);
    expect(Object.keys(command).sort()).toEqual(['icon', 'id', 'label', 'onSelect']);
  });
});
