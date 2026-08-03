import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_VIEW_LIMITS } from '../../../core/ledger/blockData';
import { createPayloadChannelStore } from '../../../core/payload/PayloadChannel';
import { createRevocableShellAPI, createShellStateStore } from '../../../core/ShellAPI';
import { createThemeBridge } from '../../../core/theme/ThemeBridge';
import { LEDGER_CONTEXT_KEY } from '../../../core/ledger/ledgerIndex';
import type { IShellAPI, RibbonContext } from '../../../core/types';
import { createFakeRenderer } from '../../chart/__tests__/fakeRenderer';
import { BlockLedger } from '../BlockLedger';

/**
 * ============================================================================
 * PANE 3'S BLOCK LEDGER, OVER A REAL PAYLOAD CHANNEL AND A REAL THEME BRIDGE
 * ============================================================================
 * The stores here are the production ones — `createPayloadChannelStore`,
 * `createShellStateStore`, `createThemeBridge` and the real revocable
 * `IShellAPI` — because everything this component is FOR happens at those
 * seams: the index is a context key, the content is a channel payload, and the
 * palette is the bridge's frozen record. Faking any of them would leave the
 * wiring untested and only the JSX checked.
 *
 * The one thing that is faked is the chart ENGINE, and it has to be: jsdom has
 * no canvas 2D context, so `echartsRenderer.isSupported()` is false here and a
 * real chart cannot be built at all. `e2e/` is the lane that sees a pixel.
 * ============================================================================
 */

/** A real host handle over real stores, plus a live view of the context. */
function makeShell() {
  // The probe is the FOREGROUND, because `contextKeys` publishes the foreground
  // extension's record and nobody else's — see `RibbonContext.contextKeys`. A
  // ledger index written by a backgrounded extension is correctly invisible.
  const store = createShellStateStore({ activeExtensionId: 'probe' });
  const payloads = createPayloadChannelStore();
  const themes = createThemeBridge(document.documentElement);
  const { api } = createRevocableShellAPI(store, 'probe', () => true, payloads, themes);
  return {
    shell: api,
    themes,
    context: (): Readonly<RibbonContext> => store.getContext(),
  };
}

interface HarnessProps {
  readonly shell: IShellAPI;
  readonly context: Readonly<RibbonContext>;
  readonly renderer: ReturnType<typeof createFakeRenderer>['renderer'];
  readonly onSubmit?: (blockId: string, values: Readonly<Record<string, string>>) => void;
}

function Harness({ shell, context, renderer, onSubmit }: HarnessProps) {
  return (
    <BlockLedger
      shell={shell}
      context={context}
      renderer={renderer}
      onSubmit={onSubmit ?? ((): void => undefined)}
    />
  );
}

/** A box, so the chart wrapper's "no box, no instance" rule is not what is measured. */
function stubBox(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    right: 800,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockLedger — the index', () => {
  it('renders one block per id in the order the extension asked for', () => {
    const host = makeShell();
    host.shell.publishPayload('alpha', 'text', { text: 'first' });
    host.shell.publishPayload('beta', 'text', { text: 'second' });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'beta,alpha');

    const { container } = render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    const ids = [...container.querySelectorAll('[data-block-id]')].map((node) =>
      node.getAttribute('data-block-id'),
    );
    // The EXTENSION's order, not the publish order. The index is what orders
    // the ledger; the channel only says what is in each block.
    expect(ids).toEqual(['beta', 'alpha']);
  });

  it('draws nothing but a note when the extension declares no ledger', () => {
    const host = makeShell();
    const { container } = render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(container.querySelector('[data-shell-region="ledger-empty"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(0);
  });

  it('drops an unusable id without dropping the blocks beside it', () => {
    const host = makeShell();
    host.shell.publishPayload('alpha', 'text', { text: 'first' });
    // `Alpha` has a capital and `a/b` a path separator; `useChannelPayload`
    // would throw `INVALID_ID` during the shell's own render for either.
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'Alpha,a/b,alpha');

    const { container } = render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(1);
    expect(screen.getByText('first')).toBeInTheDocument();
  });
});

describe('LedgerBlock — the five kinds', () => {
  it('draws a chart block through the wrapper and never through a library', () => {
    stubBox();
    const host = makeShell();
    const fake = createFakeRenderer();
    host.shell.publishPayload('chart-block', 'chart', {
      kind: 'line',
      title: 'Throughput',
      series: [{ name: 'requests', values: [1, 2, 3] }],
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'chart-block');

    const { container } = render(
      <Harness shell={host.shell} context={host.context()} renderer={fake.renderer} />,
    );

    // The engine reached the chart by INJECTION, from one point at the top of
    // the ledger. No component under `src/components/` imports one.
    expect(fake.log).toEqual(['create:div', 'setOption:Throughput']);
    expect(container.querySelector('[data-chart-canvas="fake"]')).toBeInTheDocument();
    // ...and the accessible alternative came with it.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('reports why a chart was refused, in the pane, without taking the ledger down', () => {
    const host = makeShell();
    host.shell.publishPayload('bad-chart', 'chart', {
      kind: 'line',
      title: 'T',
      series: [{ name: 'a', values: [1], color: '#ff0000' }],
    });
    host.shell.publishPayload('good-text', 'text', { text: 'still here' });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'bad-chart,good-text');

    const { container } = render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(container.querySelector('[data-block-refusal]')?.textContent).toContain('colour alone');
    // The block beside it is untouched: one bad payload is one bad block.
    expect(screen.getByText('still here')).toBeInTheDocument();
  });

  it('renders a table block as a real table with the publisher’s own columns', () => {
    const host = makeShell();
    host.shell.publishPayload('rows', 'table', {
      columns: ['sku', 'stock'],
      rows: [['FST-1', 12]],
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'rows');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'sku' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'FST-1' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument();
  });

  it('draws the truncation rather than letting a long table claim to be all of it', () => {
    const host = makeShell();
    host.shell.publishPayload('rows', 'table', {
      columns: ['n'],
      rows: Array.from({ length: BLOCK_VIEW_LIMITS.MAX_ROWS + 10 }, (_unused, index) => [index]),
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'rows');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    // A bound that is not drawn is a table quietly claiming to be the whole
    // dataset. The inspector still holds all of it.
    expect(screen.getByText(/Showing the first 500 rows/)).toBeInTheDocument();
  });

  it('says a table block published no columns rather than drawing an empty grid', () => {
    const host = makeShell();
    host.shell.publishPayload('rows', 'table', { rows: [] });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'rows');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );
    expect(screen.getByText(/published no columns/)).toBeInTheDocument();
  });

  it('renders a form block as real labelled inputs and reports what was submitted', async () => {
    const user = userEvent.setup();
    const submissions: { blockId: string; values: Readonly<Record<string, string>> }[] = [];
    const host = makeShell();
    host.shell.publishPayload('filter', 'form', {
      fields: [
        { name: 'category', label: 'Category', value: 'valves' },
        { name: 'minimum', label: 'Minimum stock', value: '0' },
      ],
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'filter');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
        onSubmit={(blockId, values) => {
          submissions.push({ blockId, values });
        }}
      />,
    );

    // REAL inputs with REAL labels — §11 item 6 refuses a read-only detail pane.
    const minimum = screen.getByRole('textbox', { name: 'Minimum stock' });
    await user.clear(minimum);
    await user.type(minimum, '25');
    // Named after the block: pane 3 already has a docked "Submit" of its own.
    await user.click(screen.getByRole('button', { name: 'Submit filter' }));

    // The submission goes to the CALLER. Writing it back onto the publisher's
    // channel would be host chrome publishing under an extension's scope.
    expect(submissions).toEqual([
      { blockId: 'filter', values: { category: 'valves', minimum: '25' } },
    ]);
  });

  it('says a form block published no fields rather than drawing an empty form', () => {
    const host = makeShell();
    host.shell.publishPayload('filter', 'form', { fields: [] });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'filter');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );
    expect(screen.getByText(/nothing to fill in/)).toBeInTheDocument();
  });

  it('renders an agent block as prose, and an empty one as a note', () => {
    const host = makeShell();
    host.shell.publishPayload('answer', 'agent', { text: 'The stock is falling.' });
    host.shell.publishPayload('silence', 'agent', {});
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'answer,silence');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(screen.getByText('The stock is falling.')).toBeInTheDocument();
    expect(screen.getByText('This block published no text.')).toBeInTheDocument();
  });

  it('says a block has published nothing rather than drawing an empty one', () => {
    const host = makeShell();
    // Named in the index and never published on. The ordinary mount order for
    // two panes produces exactly this for a frame.
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'pending');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    expect(screen.getByText(/Nothing has been published on this channel yet/)).toBeInTheDocument();
    expect(screen.getByText('empty')).toBeInTheDocument();
  });
});

describe('BlockLedger — what a render that changed nothing costs', () => {
  it('re-applies no chart option on a render where nothing was republished', () => {
    stubBox();
    const host = makeShell();
    const fake = createFakeRenderer();
    host.shell.publishPayload('chart-block', 'chart', {
      kind: 'line',
      title: 'Throughput',
      series: [{ name: 'requests', values: [1, 2, 3] }],
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'chart-block');

    const { rerender } = render(
      <Harness shell={host.shell} context={host.context()} renderer={fake.renderer} />,
    );
    fake.log.length = 0;

    // The shell re-renders on every context write, and `DatabasePlugin` writes
    // on a 200ms timer — so "a render where nothing was republished" is several
    // a second in production. `normalizeChartSpec` builds a FRESH frozen spec on
    // every call, so normalising inline would miss `Chart`'s memo every time and
    // push a full `notMerge` setOption through on each of those renders.
    rerender(<Harness shell={host.shell} context={host.context()} renderer={fake.renderer} />);
    rerender(<Harness shell={host.shell} context={host.context()} renderer={fake.renderer} />);

    expect(fake.log).toEqual([]);
  });
});

describe('BlockLedger — the theme, and what a theme change costs', () => {
  it('rebuilds every chart in the stack when the theme bridge broadcasts', () => {
    stubBox();
    const host = makeShell();
    const fake = createFakeRenderer();
    host.shell.publishPayload('chart-block', 'chart', {
      kind: 'line',
      title: 'Throughput',
      series: [{ name: 'requests', values: [1, 2, 3] }],
    });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'chart-block');

    render(<Harness shell={host.shell} context={host.context()} renderer={fake.renderer} />);
    fake.log.length = 0;

    // A theme picker's door. R7: ECharts cannot swap a registered theme on a
    // live instance, so this is a real teardown and not a repaint — and the one
    // subscription that drives it is `useShellTheme`, taken once for the whole
    // ledger rather than once per chart.
    act(() => {
      host.themes.applyTheme({ '--chart-1': '#123456' });
    });

    expect(fake.log).toEqual(['dispose', 'create:div', 'setOption:Throughput']);
    expect(fake.palettes.at(-1)?.series[0]).toBe('#123456');
  });
});

describe('LedgerBlock — the inspector', () => {
  it('reveals the channel, the kind and the revision in the inspector', async () => {
    const user = userEvent.setup();
    const host = makeShell();
    host.shell.publishPayload('note', 'text', { text: 'hello' });
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'note');

    const { container } = render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    // Shut by default: an inspector that is always open is a debug pane.
    expect(container.querySelector('[data-block-inspector]')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Inspect note' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    const inspector = container.querySelector('[data-block-inspector="note"]');
    expect(inspector).toBeInTheDocument();
    expect(inspector?.textContent).toContain('note');
    expect(inspector?.textContent).toContain('text');
    // The host-assigned change token, which is the only thing a subscriber
    // should compare — and the only way to tell a republish that changed
    // nothing from one that never arrived.
    expect(inspector?.textContent).toContain('revision');
    expect(inspector?.textContent).toContain('hello');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(container.querySelector('[data-block-inspector]')).toBeNull();
  });

  it('shows a chart’s own data visibly in the inspector, from the same component', async () => {
    stubBox();
    const user = userEvent.setup();
    const host = makeShell();
    host.shell.publishPayload('chart-block', 'chart', {
      kind: 'bar',
      title: 'Stock',
      categories: ['a'],
      series: [{ name: 'on hand', values: [7] }],
    });
    host.shell.publishPayload('bad-chart', 'chart', 'not a chart');
    host.shell.setContextKey(LEDGER_CONTEXT_KEY, 'chart-block,bad-chart');

    render(
      <Harness
        shell={host.shell}
        context={host.context()}
        renderer={createFakeRenderer().renderer}
      />,
    );

    // One table before: the `sr-only` one beside the canvas.
    expect(screen.getAllByRole('table')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Inspect chart-block' }));
    // Two after: the same component, drawn visibly. An accessible alternative
    // that sighted users also read is one that gets noticed when it rots.
    expect(screen.getAllByRole('table')).toHaveLength(2);

    // A chart the normaliser refused has no table to show, and the inspector
    // still opens on the raw payload rather than failing with it.
    await user.click(screen.getByRole('button', { name: 'Inspect bad-chart' }));
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });
});
