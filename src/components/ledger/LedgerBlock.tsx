import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ChartRenderer } from '../../core/chart/ChartRenderer';
import {
  BLOCK_VIEW_LIMITS,
  readChart,
  readFields,
  readTable,
  readText,
} from '../../core/ledger/blockData';
import { useChannelPayload } from '../../core/payload/PayloadChannel';
import type { ResolvedTheme } from '../../core/theme/normalizeTheme';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { IShellAPI, StructuredPayload } from '../../core/types';
import { Chart } from '../chart/Chart';
import { ChartDataTable } from '../chart/ChartDataTable';

/**
 * ============================================================================
 * ONE ADDRESSABLE BLOCK, AND THE INSPECTOR THAT SHOWS WHAT IS BEHIND IT.
 * ============================================================================
 * §3.1's pane 3 is "a vertically scrolling stack of addressable blocks, each one
 * of: chart | table | form | text | agent". This is one of them, and three of
 * its properties are the design rather than the implementation:
 *
 * **1. Its ADDRESS is its channel name.** `blockId` is both the id the ledger
 * index names and the channel `useChannelPayload` subscribes to, so a block
 * cannot exist without a channel and two blocks cannot share one address. It is
 * on the DOM as `data-block-id`, which is what a deep link, a focus restore or a
 * `scrollIntoView` will need and none of which have to invent a second key.
 *
 * **2. The INSPECTOR is a disclosure, not a route.** Grafana's inspector earns
 * its place by revealing the data without navigating away, and the cheapest
 * honest version of that is a `<details>`: the block stays where it is, the raw
 * payload appears under it, and nothing about the ledger's scroll position
 * moves. It shows the channel, the kind, the host-assigned `revision` and the
 * data itself — and for a chart it shows `ChartDataTable`, which is the SAME
 * component the chart renders `sr-only` beside its canvas. One implementation,
 * two placements: an accessible alternative that sighted users also read is one
 * that gets noticed when it rots.
 *
 * **3. Nothing here can throw on a plug-in's data.** Every reader in
 * `blockData.ts` is total and `readChart` converts `normalizeChartSpec`'s
 * rejection into text. A block that published nonsense draws a visible,
 * publisher-readable complaint; it does not take pane 3 to a fault surface, and
 * it does not draw a guess.
 *
 * ---------------------------------------------------------------------------
 * THE `form` ARM IS THE INPUT HALF OF REQUIREMENT 4, AND IT IS HONEST ABOUT
 * WHERE THE SUBMISSION GOES
 * ---------------------------------------------------------------------------
 * §11 item 6 refuses "a read-only detail pane". A `form` block therefore renders
 * REAL inputs with real labels and a real submit, through a `<form>` element for
 * exactly the reason `OmniboxComposer` uses one: Enter, IME composition and
 * default-button semantics come free and no key handler is added to `src/`.
 *
 * What it does NOT do is write back into the publisher's channel. Host chrome
 * publishing under an extension's scope would be the host impersonating the
 * extension, which is a capability nothing in this repository grants. The
 * submission goes to the caller, and `ShellLayout` echoes it in the host's own
 * words — the same answer, and for the same reason, that the composer's
 * submission gets today.
 *
 * *Tests:* `src/components/ledger/__tests__/BlockLedger.test.tsx` — "draws a
 * chart block through the wrapper and never through a library", "reports why a
 * chart was refused, in the pane, without taking the ledger down", "reveals the
 * channel, the kind and the revision in the inspector", "renders a form block as
 * real labelled inputs and reports what was submitted" and "says a block has
 * published nothing rather than drawing an empty one".
 * ============================================================================
 */

/** What a form block hands back. Keyed by field name. */
export type BlockSubmission = Readonly<Record<string, string>>;

export interface LedgerBlockProps {
  /** The block's address, which is also its payload channel. */
  readonly blockId: string;
  /** The foreground extension's handle. The block reads its channel through it. */
  readonly shell: IShellAPI;
  /** The resolved palette source, from `useShellTheme`. */
  readonly theme: ResolvedTheme;
  /** The chart engine. Passed down so no component here imports one. */
  readonly renderer: ChartRenderer;
  /** Told about a `form` block submission. */
  readonly onSubmit: (blockId: string, values: BlockSubmission) => void;
}

/** The 13px tier, which §3.7 gives to block titles the density scan can measure. */
const TITLE_CLASS = 'text-[13px] font-semibold';

/** A table block. */
function TableBody({ payload }: { readonly payload: StructuredPayload }): ReactElement {
  const view = readTable(payload.data);
  if (view.columns.length === 0) {
    return <BlockNote>This block published no columns, so there is no table to draw.</BlockNote>;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr>
            {view.columns.map((column, index) => (
              <th key={`${String(index)}:${column}`} scope="col" className="text-left font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {view.rows.length === BLOCK_VIEW_LIMITS.MAX_ROWS ? (
        // VISIBLE truncation. `readTable` stops at the bound, and a bound that
        // is not drawn is a table quietly claiming to be all of the data.
        <p className={`text-[11px] ${TOKEN_CLASS.mutedText}`}>
          {`Showing the first ${String(BLOCK_VIEW_LIMITS.MAX_ROWS)} rows. The inspector has the rest.`}
        </p>
      ) : null}
    </div>
  );
}

/** A form block. Real inputs, and a submission the caller decides about. */
function FormBody({
  blockId,
  payload,
  onSubmit,
}: {
  readonly blockId: string;
  readonly payload: StructuredPayload;
  readonly onSubmit: (blockId: string, values: BlockSubmission) => void;
}): ReactElement {
  const fields = readFields(payload.data);
  // Uncontrolled inputs with a ref-held override, so a republish on the channel
  // does not wipe what the user has half-typed. A controlled `useState` seeded
  // from `fields` would do exactly that on every revision bump, and the
  // verification remotes republish on a timer.
  const edited = useRef(new Map<string, string>());

  if (fields.length === 0) {
    return <BlockNote>This block published no fields, so there is nothing to fill in.</BlockNote>;
  }
  return (
    <form
      aria-label={`Block ${blockId}`}
      className="flex min-w-0 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const values: Record<string, string> = {};
        for (const field of fields) {
          values[field.name] = edited.current.get(field.name) ?? field.value;
        }
        onSubmit(blockId, Object.freeze(values));
      }}
    >
      {fields.map((field) => (
        <label key={field.name} className="flex min-w-0 flex-col gap-px text-[11px]">
          <span className={TOKEN_CLASS.secondaryText}>{field.label}</span>
          <input
            type="text"
            name={field.name}
            defaultValue={field.value}
            onChange={(event) => {
              edited.current.set(field.name, event.target.value);
            }}
            className={
              'min-h-6 min-w-0 rounded-sm border p-1 text-[12px] leading-none ' +
              `${TOKEN_CLASS.chipBorder} ${TOKEN_CLASS.paneSurface} ${TOKEN_CLASS.paneText}`
            }
          />
        </label>
      ))}
      <button
        type="submit"
        className={
          'self-start rounded-sm border p-1 text-[11px] leading-none ' +
          `${TOKEN_CLASS.chipBorder} ${TOKEN_CLASS.paneText} ${TOKEN_CLASS.faultButtonHover}`
        }
      >
        {/*
          NAMED AFTER THE BLOCK, in the register the inspect button is. Pane 3
          already has one docked "Submit" — the omnibox composer's — and a
          second control with the same accessible name in the same pane is a
          screen-reader user being offered two identical choices. The block id
          is the disambiguator that already exists.
        */}
        {`Submit ${blockId}`}
      </button>
    </form>
  );
}

/** A sentence the host says about a block, in the host's own voice. */
function BlockNote({ children }: { readonly children: string }): ReactElement {
  return <p className={`text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}>{children}</p>;
}

/**
 * A chart block's body.
 *
 * **A COMPONENT, so the memo is not inside a conditional.** `normalizeChartSpec`
 * builds a fresh frozen `ChartSpec` on every call, and `Chart` keys both its
 * option and its instance lifetime on that object's IDENTITY — so normalising
 * inline would miss the memo on every render and push a full `notMerge`
 * `setOption` through on renders where no data moved. That is not hypothetical:
 * `DatabasePlugin` republishes on a timer and the shell re-renders on every
 * context write, so "every render" is several a second.
 *
 * `payload` is the right memo key rather than `payload.data`, because
 * `StructuredPayload`'s identity is stable until the channel is republished —
 * which is the property `useChannelPayload`'s docblock already leans on.
 *
 * The refusal is memoised with it: the same normalisation answers both.
 */
function ChartBody({
  payload,
  theme,
  renderer,
}: {
  readonly payload: StructuredPayload;
  readonly theme: ResolvedTheme;
  readonly renderer: ChartRenderer;
}): ReactElement {
  const read = useMemo(() => readChart(payload.data), [payload]);
  return read.ok ? (
    <Chart spec={read.spec} theme={theme} renderer={renderer} />
  ) : (
    // The publisher's own rejection message, in the pane. A publisher who
    // supplied a colour reads "a series never does" here rather than in a
    // debugger, and the ledger stays up.
    <p data-block-refusal="" className={`text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}>
      {read.reason}
    </p>
  );
}

/** The body for one payload, dispatched on its declared kind. */
function BlockBody({
  blockId,
  payload,
  theme,
  renderer,
  onSubmit,
}: {
  readonly blockId: string;
  readonly payload: StructuredPayload;
  readonly theme: ResolvedTheme;
  readonly renderer: ChartRenderer;
  readonly onSubmit: (blockId: string, values: BlockSubmission) => void;
}): ReactElement {
  if (payload.kind === 'chart') {
    return <ChartBody payload={payload} theme={theme} renderer={renderer} />;
  }
  if (payload.kind === 'table') {
    return <TableBody payload={payload} />;
  }
  if (payload.kind === 'form') {
    return <FormBody blockId={blockId} payload={payload} onSubmit={onSubmit} />;
  }
  // `text` and `agent` share a body and differ in their header, which is the
  // honest difference: both are prose, and only one of them was written by
  // something that should be labelled as not a person.
  const text = readText(payload.data);
  return text === '' ? (
    <BlockNote>This block published no text.</BlockNote>
  ) : (
    <p className="text-[12px] leading-4">{text}</p>
  );
}

/** One block of the ledger. */
export function LedgerBlock({
  blockId,
  shell,
  theme,
  renderer,
  onSubmit,
}: LedgerBlockProps): ReactElement {
  const payload = useChannelPayload(shell, blockId);
  const [isInspectorOpen, setInspectorOpen] = useState(false);

  return (
    <section
      data-block-id={blockId}
      aria-label={`Block ${blockId}`}
      className={
        'flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border p-1 ' +
        TOKEN_CLASS.sectionEdge
      }
    >
      <div className="flex min-w-0 flex-row items-center gap-1">
        <h3 className={`min-w-0 flex-1 truncate ${TITLE_CLASS}`}>{blockId}</h3>
        <span className={`flex-none text-[11px] ${TOKEN_CLASS.mutedText}`}>
          {payload === null ? 'empty' : payload.kind}
        </span>
        <button
          type="button"
          aria-expanded={isInspectorOpen}
          onClick={() => {
            setInspectorOpen((open) => !open);
          }}
          className={
            'flex-none rounded-sm border p-1 text-[11px] leading-none ' +
            `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.controlHoverBorder} ` +
            TOKEN_CLASS.secondaryText
          }
        >
          {`Inspect ${blockId}`}
        </button>
      </div>

      {payload === null ? (
        <BlockNote>Nothing has been published on this channel yet.</BlockNote>
      ) : (
        <BlockBody
          blockId={blockId}
          payload={payload}
          theme={theme}
          renderer={renderer}
          onSubmit={onSubmit}
        />
      )}

      {isInspectorOpen && payload !== null ? (
        <div
          data-block-inspector={blockId}
          className={`min-w-0 overflow-hidden border-t pt-1 ${TOKEN_CLASS.sectionEdge}`}
        >
          <dl className={`break-words text-[11px] tabular-nums ${TOKEN_CLASS.mutedText}`}>
            <dt className="inline">channel </dt>
            <dd className="inline">{payload.channel}</dd>
            <dt className="inline"> · kind </dt>
            <dd className="inline">{payload.kind}</dd>
            <dt className="inline"> · revision </dt>
            {/*
              The host-assigned change token, and the ONLY thing a subscriber
              should compare. It is surfaced because it is how a publisher tells
              a republish that changed nothing from one that never arrived —
              `StructuredPayload.revision` bumps on both, and says so.
            */}
            <dd className="inline">{String(payload.revision)}</dd>
          </dl>
          {payload.kind === 'chart' ? <ChartInspector payload={payload} /> : null}
          <pre className={`overflow-x-auto text-[11px] ${TOKEN_CLASS.mutedText}`}>
            {JSON.stringify(payload.data, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The chart's own data, visibly — the same table the canvas hides beside it.
 *
 * Memoised on the payload for the reason `ChartBody` is: an open inspector
 * re-normalises on every render of the ledger otherwise, and the ledger
 * re-renders on every context write.
 */
function ChartInspector({ payload }: { readonly payload: StructuredPayload }): ReactElement | null {
  const read = useMemo(() => readChart(payload.data), [payload]);
  return read.ok ? <ChartDataTable spec={read.spec} className="min-w-0 overflow-x-auto" /> : null;
}
