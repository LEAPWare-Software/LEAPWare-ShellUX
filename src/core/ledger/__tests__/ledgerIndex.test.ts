import { describe, expect, it } from 'vitest';
import { LEDGER_CONTEXT_KEY, MAX_LEDGER_BLOCKS, parseLedgerIndex } from '../ledgerIndex';

/**
 * ============================================================================
 * THE LEDGER INDEX, WHICH IS PLUG-IN TEXT ON A HOST RENDER PATH
 * ============================================================================
 * `parseLedgerIndex` is TOTAL, and every case below is a case where the obvious
 * alternative — throwing — would take pane 3 to a fault surface over a typo in a
 * context key. What it must nonetheless guarantee is the property its caller
 * depends on: every id it RETURNS is one `readPayload` will accept, because
 * `useChannelPayload` throws `INVALID_ID` during render for anything else.
 * ============================================================================
 */

describe('parseLedgerIndex', () => {
  it('reads a comma-separated list in the order it was written', () => {
    expect(parseLedgerIndex('one,two,three')).toEqual(['one', 'two', 'three']);
    // Whitespace around an entry is a formatting choice, not a different id.
    expect(parseLedgerIndex(' one , two ')).toEqual(['one', 'two']);
  });

  it('drops an entry the payload channel would refuse, and keeps the rest', () => {
    // `Firstblock` has a capital, `__proto__` is reserved, `a/b` carries a path
    // separator, and the empty entry is what a trailing comma leaves behind.
    // Each would be an `INVALID_ID` thrown during the shell's own render.
    expect(parseLedgerIndex('good-one,Firstblock,__proto__,a/b,,good-two,')).toEqual([
      'good-one',
      'good-two',
    ]);
  });

  it('refuses to grow past the block bound', () => {
    const many = Array.from({ length: MAX_LEDGER_BLOCKS + 5 }, (_unused, index) => `b${String(index)}`);
    const parsed = parseLedgerIndex(many.join(','));
    expect(parsed).toHaveLength(MAX_LEDGER_BLOCKS);
    // The FIRST n, not the last: the order is the extension's stated order, and
    // truncating from the front would silently reorder the ledger.
    expect(parsed[0]).toBe('b0');
  });

  it('de-duplicates, because two blocks cannot share one address', () => {
    // A block id is an ADDRESS — the inspector, a focus restore and a deep link
    // all name a block by it, and two answering to one make all three ambiguous.
    expect(parseLedgerIndex('a,b,a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('reads a non-string context value as no ledger at all', () => {
    // `ContextKeyValue` admits a number, a boolean and `null`, and an extension
    // that has set none of them leaves `undefined`. None of the four is a list.
    for (const value of [undefined, null, 7, true, false]) {
      expect(parseLedgerIndex(value)).toEqual([]);
    }
    expect(parseLedgerIndex('')).toEqual([]);
    expect(parseLedgerIndex(',,,')).toEqual([]);
  });

  it('freezes what it returns, and names one key rather than a namespace', () => {
    expect(Object.isFrozen(parseLedgerIndex('a'))).toBe(true);
    expect(Object.isFrozen(parseLedgerIndex(null))).toBe(true);
    // A reserved NAME, because `contextKeys` is collision-resistant and not
    // confined — see `RibbonContext.contextKeys`.
    expect(LEDGER_CONTEXT_KEY).toBe('ledger');
  });
});
