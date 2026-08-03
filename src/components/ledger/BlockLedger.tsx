import type { ReactElement } from 'react';
import type { ChartRenderer } from '../../core/chart/ChartRenderer';
import { LEDGER_CONTEXT_KEY, parseLedgerIndex } from '../../core/ledger/ledgerIndex';
import { useShellTheme } from '../../core/theme/ThemeBridge';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { IShellAPI, RibbonContext } from '../../core/types';
import { LedgerBlock } from './LedgerBlock';
import type { BlockSubmission } from './LedgerBlock';

/**
 * ============================================================================
 * PANE 3'S BLOCK LEDGER. HOST CHROME, OUTSIDE THE FAULT BOUNDARY.
 * ============================================================================
 * A vertically scrolling stack of addressable blocks, in the order the
 * foreground extension asked for. §3.1.
 *
 * **The index comes from a context key and the content from the payload
 * channel**, and `src/core/ledger/ledgerIndex.ts` has the whole argument for why
 * the split falls there. What matters at this level is the consequence: this
 * component re-renders when the foreground extension changes its block LIST,
 * because the list is part of the context snapshot every surface already reads,
 * and each block re-renders on its own channel without disturbing its siblings.
 * A republished chart does not re-render the table above it.
 *
 * **It is host chrome and it sits outside the plug-in fault boundary**, for the
 * reason the composer and the floating toolbar do: a plug-in view that throws
 * during render must not take the shell's own surfaces down with it. The
 * corollary is the discipline that makes it safe — every reader under
 * `src/core/ledger/` is total, so no plug-in payload can throw here in the first
 * place.
 *
 * **The theme is read once, here, and passed down.** `useShellTheme` is one
 * subscription for the whole ledger rather than one per chart, and the record it
 * yields has a stable identity — which is what stops every chart in the stack
 * disposing and re-initialising on an unrelated render. See
 * `src/components/chart/Chart.tsx` for what that identity buys.
 *
 * *Tests:* `src/components/ledger/__tests__/BlockLedger.test.tsx` — "renders one
 * block per id in the order the extension asked for", "draws nothing but a note
 * when the extension declares no ledger" and "drops an unusable id without
 * dropping the blocks beside it".
 * ============================================================================
 */

export interface BlockLedgerProps {
  /** The foreground extension's handle, or `null` when none is active. */
  readonly shell: IShellAPI;
  /** The host context. The ledger index is one of its keys. */
  readonly context: Readonly<RibbonContext>;
  /** The chart engine, injected once at the top so no block imports one. */
  readonly renderer: ChartRenderer;
  /** Told about a `form` block submission, which the host does not consume. */
  readonly onSubmit: (blockId: string, values: BlockSubmission) => void;
}

/** The ledger. */
export function BlockLedger({
  shell,
  context,
  renderer,
  onSubmit,
}: BlockLedgerProps): ReactElement {
  const theme = useShellTheme(shell);
  const blockIds = parseLedgerIndex(context.contextKeys[LEDGER_CONTEXT_KEY]);

  if (blockIds.length === 0) {
    return (
      <p
        data-shell-region="ledger-empty"
        className={`p-1 text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}
      >
        This extension has published no blocks.
      </p>
    );
  }

  return (
    <div
      data-shell-region="ledger"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-1"
    >
      {blockIds.map((blockId) => (
        <LedgerBlock
          key={blockId}
          blockId={blockId}
          shell={shell}
          theme={theme}
          renderer={renderer}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}
