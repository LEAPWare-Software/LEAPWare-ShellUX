import { EMPTY_THEME } from '../../theme/normalizeTheme';
import type { ResolvedTheme } from '../../theme/normalizeTheme';

/**
 * A resolved theme whose every chart token holds a value that names itself.
 *
 * Not a colour, deliberately. These fixtures are asserted against by EQUALITY,
 * and a hex here would be a colour literal in a file the shipped stylesheet
 * never sees — which is exactly the sort of value `noRawColor.test.ts` exists to
 * keep out of `src/`. A marker string proves the same thing better: it says
 * WHICH token the palette read, not merely that it read something.
 */
export function markedTheme(): ResolvedTheme {
  const record: Record<string, string> = { ...EMPTY_THEME };
  for (const name of Object.keys(record)) {
    record[name] = `value-of${name}`;
  }
  return Object.freeze(record) as ResolvedTheme;
}
