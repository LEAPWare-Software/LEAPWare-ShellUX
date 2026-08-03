import { describe, expect, it } from 'vitest';
import {
  EMPTY_THEME,
  isThemeValue,
  normalizeTheme,
} from '../normalizeTheme';
import { SEMANTIC_TOKEN_NAME_LIST } from '../tokens.generated';
import { ShellUXError } from '../../types';

/**
 * ============================================================================
 * A THEME IS UNTRUSTED INPUT REACHING A STYLESHEET
 * ============================================================================
 * Two rules, defending two different things, and both are asserted here:
 *
 *   1. The KEYS are the host's. The candidate's key list is never obtained, so a
 *      primitive-tier name is not filtered out — it is never looked at.
 *   2. The VALUES match an allowlist. A denylist over CSS is a losing game, so
 *      the grammar is closed and a statement terminator is not in it.
 *
 * And one thing that is NOT true, asserted in the direction that is: contrast is
 * not measured here, and a legal theme can be unreadable.
 * ============================================================================
 */

const BASE = EMPTY_THEME;

function expectRejection(candidate: unknown, code: 'INVALID_PAYLOAD' | 'INVALID_FIELD'): ShellUXError {
  let caught: unknown;
  try {
    normalizeTheme(candidate, BASE);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  expect((caught as ShellUXError).code).toBe(code);
  return caught as ShellUXError;
}

describe('normalizeTheme — the key allowlist', () => {
  it('reads only the host’s own token names, so a primitive-tier key is never looked at', () => {
    let primitiveReads = 0;
    const hostile: Record<string, unknown> = {
      '--surface-app': '#101010',
    };
    // A getter on a name the host does not publish. If the implementation ever
    // enumerated the CANDIDATE's keys, this would run.
    for (const smuggled of ['--gray-7', '--accent-9', '__proto__', 'constructor']) {
      Object.defineProperty(hostile, smuggled, {
        enumerable: true,
        get(): string {
          primitiveReads += 1;
          return '#ff0000';
        },
      });
    }

    const resolved = normalizeTheme(hostile, BASE);
    expect(primitiveReads).toBe(0);
    // Exactly the contract's names, in the contract's order, and no others.
    expect(Object.keys(resolved)).toEqual([...SEMANTIC_TOKEN_NAME_LIST]);
    expect(resolved['--surface-app']).toBe('#101010');
    // A null-prototype record, so a `__proto__` key could not have polluted it
    // even if it had been read.
    expect(Object.getPrototypeOf(resolved)).toBeNull();
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(({} as Record<string, unknown>)['--gray-7']).toBeUndefined();
  });

  it('fills every name the theme omits from the base, and keeps the ones it supplies', () => {
    const partial = { '--text-primary': 'oklch(0.2 0.01 250)' };
    const resolved = normalizeTheme(partial, BASE);
    expect(resolved['--text-primary']).toBe('oklch(0.2 0.01 250)');
    for (const name of SEMANTIC_TOKEN_NAME_LIST) {
      if (name === '--text-primary') {
        continue;
      }
      expect(resolved[name], name).toBe(BASE[name]);
    }
    // The empty theme is the base, exactly.
    expect(normalizeTheme({}, BASE)).toEqual(BASE);
  });

  it('refuses a theme that is not an object, or that refuses to be read', () => {
    for (const bad of [null, undefined, 'a-theme', 7]) {
      expectRejection(bad, 'INVALID_PAYLOAD');
    }
    const throwing = {};
    Object.defineProperty(throwing, '--surface-app', {
      enumerable: true,
      get(): never {
        throw new TypeError('nope');
      },
    });
    const error = expectRejection(throwing, 'INVALID_PAYLOAD');
    expect(error.field).toBe('--surface-app');
    expect(error.message).toContain('Nothing was applied');

    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    expectRejection(revocable.proxy, 'INVALID_PAYLOAD');
  });
});

describe('normalizeTheme — the value grammar', () => {
  it('accepts exactly the three value shapes the contract has', () => {
    for (const value of [
      '#fff',
      '#ffff',
      '#a1b2c3',
      '#a1b2c3d4',
      'oklch(0.98 0.005 250)',
      'oklch(98% 0.005 250)',
      'oklch(0.98 0.005 250 / 0.5)',
      'oklch(0.98 0.005 250 / 50%)',
      '2px',
      '0.125rem',
      '0px',
    ]) {
      expect(isThemeValue(value), value).toBe(true);
      expect(normalizeTheme({ '--surface-app': value }, BASE)['--surface-app']).toBe(value);
    }
  });

  it('refuses a value carrying a CSS statement terminator, in every spelling tried', () => {
    // A DENYLIST would have to anticipate each of these. The grammar does not:
    // none of them is a hex colour, an oklch() or a length, so none of them is a
    // value, whatever it is spelled as.
    for (const hostile of [
      '#fff; background: url(evil-payload)',
      '#fff;}',
      'red',
      'url(evil-payload)',
      'expression(alert(1))',
      'var(--gray-7)',
      '#fff /* } */',
      '#fff\\3b background:red',
      '#fff\n;background:red',
      '#fff；background:red',
      'oklch(0.9 0.1 20);--x:y',
      '-1px',
      '10',
      '10%',
      '#12345',
      '#1234567',
      'OKLCH(0.9 0.1 20) ',
    ]) {
      expect(isThemeValue(hostile), hostile).toBe(false);
      const error = expectRejection({ '--surface-app': hostile }, 'INVALID_FIELD');
      expect(error.field).toBe('--surface-app');
      // The rejected value is NOT echoed into the message: it has just failed
      // the grammar, which is exactly when putting it somewhere a log renders is
      // the wrong move.
      expect(error.message).not.toContain(hostile);
    }
    // The empty string is refused too. It is asserted apart from the loop only
    // because `not.toContain('')` is vacuously false for every string.
    expect(isThemeValue('')).toBe(false);
    expectRejection({ '--surface-app': '' }, 'INVALID_FIELD');
  });

  it('refuses a supplied value that is not a string at all, rather than filling from the base', () => {
    for (const bad of [7, true, null, {}, ['#fff']]) {
      expect(isThemeValue(bad)).toBe(false);
      expectRejection({ '--surface-app': bad }, 'INVALID_FIELD');
    }
    // The asymmetry: OMITTED fills, SUPPLIED-AND-BAD rejects. Filling silently
    // over a value the author wrote is the failure this refuses to create.
    expect(normalizeTheme({ '--surface-app': undefined }, BASE)['--surface-app']).toBe(
      BASE['--surface-app'],
    );
  });

  it('accepts a legal theme whose contrast is terrible, because contrast is not measured here', () => {
    // The honest negative. §3.6 of the native-host plan asks for a theme to be
    // "rejected if it fails the contrast manifest"; `design/check-contrast.mjs`
    // runs in Node against the generated stylesheet and never sees a third-party
    // theme, and nothing in `src/` measures one. This test exists so the gap is
    // recorded as behaviour rather than only as prose. See ADR-0001 Amendment M.
    const unreadable = normalizeTheme(
      { '--surface-app': '#000000', '--text-primary': '#010101' },
      BASE,
    );
    expect(unreadable['--surface-app']).toBe('#000000');
    expect(unreadable['--text-primary']).toBe('#010101');
  });
});

describe('the seed theme', () => {
  it('covers every name in the contract and invents a value for none of them', () => {
    expect(Object.keys(EMPTY_THEME)).toEqual([...SEMANTIC_TOKEN_NAME_LIST]);
    for (const name of SEMANTIC_TOKEN_NAME_LIST) {
      // Complete KEYS, empty VALUES. The host does not invent a colour: an
      // untokenised literal in  is invisible to the contrast manifest and
      // is what  exists to stop.
      expect(EMPTY_THEME[name], name).toBe('');
      // ...and the empty string is deliberately NOT a legal value, so it can
      // never be something a third-party theme supplied.
      expect(isThemeValue(EMPTY_THEME[name]), name).toBe(false);
    }
    expect(Object.isFrozen(EMPTY_THEME)).toBe(true);
  });
});
