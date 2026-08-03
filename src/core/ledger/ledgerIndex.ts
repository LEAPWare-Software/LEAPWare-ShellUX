import { EXTENSION_ID_PATTERN, RESERVED_IDS } from '../RegistryContext';
import type { ContextKeyValue } from '../types';

/**
 * ============================================================================
 * THE LEDGER'S INDEX RIDES ON THE CONTEXT. ITS CONTENT RIDES ON THE CHANNEL.
 * ============================================================================
 * Pane 3 is a stack of ADDRESSABLE blocks, and something has to say which blocks
 * exist and in what order. Two mechanisms were available and the split between
 * them is this module's only real decision:
 *
 *  - **`publishPayload` carries a block's CONTENT.** It is the structured
 *    channel; it takes objects, arrays and numbers; it costs a deep copy and a
 *    revision bump per publish. That is the right price for a chart's data.
 *  - **A context key carries the block LIST.** `ContextKeyValue` is primitives
 *    only, which is exactly what makes it cheap, synchronously readable in every
 *    replica (§5) and free to send across a process boundary. A list of ids is a
 *    cheap primitive fact about the foreground extension, which is what a
 *    context key is FOR.
 *
 * Putting the index in the payload channel instead would have needed a new
 * enumeration door on `IShellAPI` and a second subscription shape; putting the
 * content in a context key is impossible, because a context key cannot hold a
 * series. So the two halves travel on the two mechanisms that already fit them,
 * and neither contract widens.
 *
 * **The index is a comma-separated string, and that is the primitives-only rule
 * showing rather than a shortcut.** ADR-0001 Amendment K Decision 2 keeps a
 * context key to `string | number | boolean | null`; a list therefore has to be
 * encoded, and the encoding is the plainest one that a `when` expression could
 * still match on.
 *
 * ---------------------------------------------------------------------------
 * TOTAL, AND THAT IS THE ASYMMETRY `ThemeBridge` ALREADY DRAWS
 * ---------------------------------------------------------------------------
 * This function NEVER THROWS. Its caller is host chrome on a render path with
 * nobody to report a rejection to, so a malformed entry is DROPPED and the rest
 * of the list is honoured — the same posture `resolveFrom` in `ThemeBridge.ts`
 * takes towards a document property outside the grammar, and the opposite of the
 * posture `normalizeChartSpec` takes at its imperative door.
 *
 * Dropping rather than rejecting is safe because of what is dropped: an entry
 * that survives has passed `EXTENSION_ID_PATTERN` and `RESERVED_IDS`, which are
 * the registry's own rules, so every id this returns is one `readPayload` will
 * accept. A block the user asked for and does not get is a visible absence; a
 * malformed id reaching `useChannelPayload` would be a `ShellUXError` thrown
 * during the shell's own render, which is a fault surface over the whole pane.
 *
 * *Tests:* `src/core/ledger/__tests__/ledgerIndex.test.ts` — "drops an entry the
 * payload channel would refuse, and keeps the rest", "refuses to grow past the
 * block bound", "de-duplicates, because two blocks cannot share one address" and
 * "reads a non-string context value as no ledger at all".
 * ============================================================================
 */

/**
 * The context key the host reads the ledger index from.
 *
 * A reserved NAME rather than a reserved namespace, because `contextKeys` is
 * collision-resistant and not confined — `RibbonContext.contextKeys` says so at
 * length. An extension that writes something else under `ledger` gets no ledger,
 * which is the same failure as writing nothing.
 */
export const LEDGER_CONTEXT_KEY = 'ledger';

/**
 * How many blocks pane 3 will render at once.
 *
 * Half of `PAYLOAD_LIMITS.MAX_CHANNELS`, which is 32, and deliberately not equal
 * to it: an extension is entitled to hold channels that are not blocks — both
 * verification remotes hold one for their own cross-pane state — so a ledger
 * bound equal to the channel bound would imply every channel is a block.
 */
export const MAX_LEDGER_BLOCKS = 16;

/**
 * The blocks pane 3 should draw, in order, from one context value.
 *
 * Total. Duplicates are collapsed onto their first occurrence, because a block
 * id is an ADDRESS — the inspector, the focus ring and the eventual deep link
 * all name a block by it, and two blocks answering to one address make every one
 * of those ambiguous.
 */
export function parseLedgerIndex(value: ContextKeyValue | undefined): readonly string[] {
  if (typeof value !== 'string') {
    return Object.freeze([]);
  }
  const seen = new Set<string>();
  for (const raw of value.split(',')) {
    const id = raw.trim();
    if (id === '' || seen.has(id) || RESERVED_IDS.has(id) || !EXTENSION_ID_PATTERN.test(id)) {
      continue;
    }
    seen.add(id);
    if (seen.size === MAX_LEDGER_BLOCKS) {
      break;
    }
  }
  return Object.freeze([...seen]);
}
