import { useEffect, useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  LEDGER_CONTEXT_KEY,
  RowMetric,
  TOKEN_CLASS,
  useChannelPayload,
} from '@shellux/sdk';
import type {
  ExtensionViewProps,
  IShellAPI,
  LEAPExtensionBlueprintInput,
  NavigationMetric,
  NavigationNode,
  RibbonAction,
  RibbonContext,
  StructuredPayload,
} from '@shellux/sdk';

/**
 * ============================================================================
 * THE SECOND VERIFICATION REMOTE, AND IT IS NOT A SECOND MAILBOX.
 * ============================================================================
 * ISSUE-005 asks for two mock extensions for a reason that is easy to lose: a
 * host validated against two modules that are the same shape underneath has been
 * validated against one. `MailPlugin` is the Outlook-shaped case — a small list,
 * a slow body fetch, a ribbon gated on selection. This module is deliberately
 * built out of the workloads that one does not have:
 *
 *  - **A long record list.** Hundreds of rows in pane 2 rather than a dozen, so
 *    that the ISSUE-004 virtualizer has something that actually needs
 *    virtualizing, and so that "the selected row is scrolled into view" is a
 *    question with a real answer.
 *  - **A running timer.** Stock levels move on an interval whether or not the
 *    user does anything, which is the cleanup workload: every mount starts one
 *    interval and every unmount must end it, and a suite that mounts and
 *    unmounts repeatedly must not accumulate them.
 *  - **A ribbon keyed on a different context field.** Mail's actions turn on
 *    `ctx.selectedItemId`; these turn on `ctx.activeNavNodeId`, so the two
 *    modules exercise two different host fields rather than the same one twice.
 *  - **A render that can be made to throw on demand.** One row renderer fails
 *    when this module has been told to fail, which is what a fault-containment
 *    test needs and what nothing else in the repository currently provides.
 *
 * Everything the banner in `MailPlugin.tsx` says about being a *remote party*
 * applies here unchanged and is not repeated: types-only import from the host,
 * no `useShellStore`, no registry internals, no capability beyond the `shell` and
 * `context` the host passes in. The two constraints worth restating because they
 * shape this file's code rather than its imports:
 *
 * **The two views share a HOST CHANNEL, not a React context and — since ADR-0001
 * Amendment L — not a module-scoped store either.** `views.pane2` and
 * `views.pane3` mount in unrelated subtrees, each under its own
 * `ExtensionHostBoundary`, so no provider written here could sit above both. A
 * module-scoped `let` spanned them and is correct in exactly one process: under
 * the process split `docs/plans/native-host-pivot.md` §3.2 describes this module
 * loads twice, the static catalogue still resolves so pane 3 looks right on first
 * paint, and every stock tick committed in pane 2 becomes invisible to pane 3
 * with nothing to say why. The state therefore travels on
 * `IShellAPI.publishPayload` / `readPayload` / `subscribePayload`, and
 * `useChannelPayload` is the host's own `useSyncExternalStore` binding over it.
 * See ADR-0001 Amendment L Decision 7.
 *
 * **No visibility predicate reads this module's state.** A command surface
 * re-renders on host context change, not on this module's changes, so a predicate
 * closing over the state would be evaluated against a stale snapshot and would
 * produce a surface that lies. Every predicate below is a pure function of `ctx`.
 * The channel does not weaken that: `getContext()` does not return a payload and
 * `isVisible(ctx)` has no argument through which to reach one — see ADR-0001
 * Amendment L Decision 1.
 *
 * UNTRUSTED CONTENT: every string this module supplies reaches the DOM as a JSX
 * text node. No `dangerouslySetInnerHTML`, no `innerHTML`, nothing interpolated
 * into an attribute that could execute; `icon` is a key into the host's own
 * table and this module renders no icons. As in `MailPlugin.tsx`, that is an
 * obligation met in code and NOT YET pinned by a test at this site — the
 * integration suite is blocked on ISSUE-003 and ISSUE-004 — and it must not be
 * read as a control until one exists.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Catalogue shape                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Prefix on every id this extension writes into `RibbonContext.selectedItemId`.
 *
 * Same position as `MailPlugin`'s, and read that docblock for the detail. The
 * premise both prefixes were written against — that `selectedItemId` is one
 * host-wide field which activation does not clear — is **no longer true of the
 * clearing half.** `publishForeground` in `src/core/ActivationContext.tsx` clears
 * `selectedItemId` and `activeNavNodeId` in the same patch that moves the
 * foreground, so this module is never handed a mail message id to open. *Tests:*
 * `src/core/__tests__/activationHandover.test.tsx` — "clears the selected item when
 * a different extension takes the foreground" and "never lets a subscriber observe
 * the new extension beside the old selection"; and for the case that must NOT
 * clear, "does not clear a live selection when the same foreground is republished".
 *
 * The field is still one host-wide field, and the prefix is still the id format
 * this module's records use, so it stays — belt-and-braces rather than required.
 */
const RECORD_ID_PREFIX = 'rec-';

/**
 * Top-level categories, in pane-1 order. Each owns the leaves below it.
 *
 * **The `icon` keys are why this module has three distinguishable rows in the
 * collapsed 48px track.** Components, Assemblies and Consumables begin C, A and
 * C, so the monogram pane 1 drew before GitHub issue #19 read "C A C" and two of
 * the three were the same glyph. Each key is one the host publishes in
 * `SHELL_ICONS` — `box`, `layers`, `droplet` — and this module resolves none of
 * them itself: it supplies a string and the host does the lookup, which is the
 * whole of the contract for an icon.
 */
const TOP_LEVEL_CATEGORIES: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}[] = [
  { id: 'components', label: 'Components', icon: 'box' },
  { id: 'assemblies', label: 'Assemblies', icon: 'layers' },
  { id: 'consumables', label: 'Consumables', icon: 'droplet' },
];

interface LeafCategory {
  readonly id: string;
  readonly label: string;
  readonly parentId: string;
  /** Leading segment of every SKU in this leaf. */
  readonly skuPrefix: string;
  /** Vocabulary the generated record names are drawn from. */
  readonly nouns: readonly string[];
}

const LEAF_CATEGORIES: readonly LeafCategory[] = [
  {
    id: 'fasteners',
    label: 'Fasteners',
    parentId: 'components',
    skuPrefix: 'FST',
    nouns: ['Hex bolt', 'Flat washer', 'Split pin', 'Cage nut'],
  },
  {
    id: 'connectors',
    label: 'Connectors',
    parentId: 'components',
    skuPrefix: 'CON',
    nouns: ['Ring terminal', 'Backshell', 'Ferrule', 'Pin header'],
  },
  {
    id: 'sensors',
    label: 'Sensors',
    parentId: 'components',
    skuPrefix: 'SNS',
    nouns: ['Thermocouple', 'Load cell', 'Rotary encoder', 'Proximity probe'],
  },
  {
    id: 'pumps',
    label: 'Pumps',
    parentId: 'assemblies',
    skuPrefix: 'PMP',
    nouns: ['Diaphragm pump', 'Gear pump', 'Peristaltic head', 'Impeller set'],
  },
  {
    id: 'valves',
    label: 'Valves',
    parentId: 'assemblies',
    skuPrefix: 'VLV',
    nouns: ['Ball valve', 'Check valve', 'Solenoid valve', 'Relief valve'],
  },
  {
    id: 'lubricants',
    label: 'Lubricants',
    parentId: 'consumables',
    skuPrefix: 'LUB',
    nouns: ['Bearing grease', 'Chain oil', 'Dry film spray', 'Gear oil'],
  },
  {
    id: 'abrasives',
    label: 'Abrasives',
    parentId: 'consumables',
    skuPrefix: 'ABR',
    nouns: ['Flap disc', 'Sanding belt', 'Wire brush', 'Cut-off wheel'],
  },
];

/** Every category id, so a foreign `activeNavNodeId` can be recognised as foreign. */
const CATEGORY_IDS: ReadonlySet<string> = new Set([
  ...TOP_LEVEL_CATEGORIES.map((category) => category.id),
  ...LEAF_CATEGORIES.map((leaf) => leaf.id),
]);

interface InventoryRecord {
  readonly id: string;
  /** Leaf category this record belongs to. */
  readonly categoryId: string;
  readonly sku: string;
  readonly name: string;
  /** Stock at or below this level counts as low. */
  readonly reorderLevel: number;
}

/**
 * Records per leaf category. Seven leaves, so pane 2 holds 280 rows with nothing
 * selected in pane 1 — chosen to be well past the point where rendering every
 * row is the obviously wrong strategy, because that is the workload ISSUE-004's
 * virtualizer has to be measured against.
 */
const RECORDS_PER_CATEGORY = 40;

/**
 * Lehmer generator, so the catalogue is identical on every run and on every
 * machine.
 *
 * Determinism is not a nicety here: a mock whose data came from `Math.random`
 * would make every assertion about a specific row unrepeatable, and would make a
 * failure impossible to reproduce from the test name alone. The multiplier is
 * small enough that `seed * 48271` stays inside `Number.MAX_SAFE_INTEGER` for
 * every seed the modulus can produce, so no term is ever silently rounded.
 */
function nextRandom(seed: number): number {
  return (seed * 48271) % 2147483647;
}

/** The seeded catalogue. Records added at runtime live in the store. */
function buildCatalogue(): readonly InventoryRecord[] {
  const built: InventoryRecord[] = [];
  let seed = 20260731;
  for (const leaf of LEAF_CATEGORIES) {
    for (let index = 1; index <= RECORDS_PER_CATEGORY; index += 1) {
      seed = nextRandom(seed);
      const noun = leaf.nouns[seed % leaf.nouns.length] ?? leaf.label;
      seed = nextRandom(seed);
      const millimetres = 4 + (seed % 24);
      built.push({
        id: `${RECORD_ID_PREFIX}${leaf.id}-${String(index).padStart(3, '0')}`,
        categoryId: leaf.id,
        sku: `${leaf.skuPrefix}-${String(1000 + index)}`,
        name: `${noun} ${String(millimetres)}mm`,
        reorderLevel: 8 + (seed % 5),
      });
    }
  }
  return built;
}

const SEED_RECORDS: readonly InventoryRecord[] = buildCatalogue();

/** Opening stock, generated from its own seed so it does not track the names. */
function buildOpeningStock(): ReadonlyMap<string, number> {
  const levels = new Map<string, number>();
  let seed = 991;
  for (const record of SEED_RECORDS) {
    seed = nextRandom(seed);
    levels.set(record.id, seed % 40);
  }
  return levels;
}

/**
 * The record this module falls back to when asked to arm a fault with nothing of
 * its own selected. Fixed, so a suite can arm the fault without first having to
 * arrange a selection.
 */
const FALLBACK_FAULT_RECORD_ID = `${RECORD_ID_PREFIX}fasteners-001`;

/* -------------------------------------------------------------------------- */
/* The state, and the host channel it travels on                               */
/* -------------------------------------------------------------------------- */

/** One observed stock movement. The cross-pane stream pane 3 reads. */
interface StockTick {
  /** Monotonic, module-wide. */
  readonly seq: number;
  readonly recordId: string;
  readonly level: number;
}

interface InventoryState {
  /** This module's own memory of its selection, independent of the host's. */
  readonly selectedId: string | null;
  readonly stockById: ReadonlyMap<string, number>;
  /** Records created at runtime by the Add record action. */
  readonly added: readonly InventoryRecord[];
  /** Newest last, bounded by `MAX_HISTORY`. */
  readonly history: readonly StockTick[];
  readonly showLowStockOnly: boolean;
  /**
   * The record whose row renderer must throw, or `null`.
   *
   * This is the fault-containment handle, and it is deliberately reachable only
   * through a ribbon action — no exported mutator, no test-only door. A suite
   * arms it the way a user would.
   */
  readonly faultedRecordId: string | null;
  /**
   * The tick counters, and the count of records added so far.
   *
   * **They live on the state rather than beside it**, which they did not have to
   * while the state was a module-scope `let` and four module-scope counters could
   * sit next to it. Once the state crosses a channel, a counter left in module
   * scope is the very defect the migration removes: it would reset in the second
   * process, reissue sequence numbers the first one had already used, and restart
   * the deterministic tick sequence that makes a timer-cleanup test falsifiable.
   */
  readonly tickSequence: number;
  readonly tickCursor: number;
  readonly tickSeed: number;
  readonly addedCount: number;
}

/** How much stock history is kept. An unbounded log in a long-lived module is a leak. */
const MAX_HISTORY = 48;

const INITIAL_STATE: InventoryState = {
  selectedId: null,
  stockById: buildOpeningStock(),
  added: [],
  history: [],
  showLowStockOnly: false,
  faultedRecordId: null,
  tickSequence: 0,
  tickCursor: 0,
  tickSeed: 7919,
  addedCount: 0,
};

/**
 * The channel this module's whole cross-pane state travels on.
 *
 * A registry-valid identifier, because `publishPayload` holds a channel name to
 * exactly the rule the registry holds a node id to.
 */
const STATE_CHANNEL = 'inventory-state';

/**
 * The state as it crosses the channel: leaves only, no `Map`.
 *
 * `PayloadLeaf` is `ContextKeyValue` — ADR-0001 Amendment L Decision 2 preserves
 * that at the leaves — so the stock levels travel as a record of numbers and
 * `decode` rebuilds the `Map`.
 */
interface InventoryWire {
  readonly selectedId: string | null;
  readonly stockById: Readonly<Record<string, number>>;
  readonly added: readonly InventoryRecord[];
  readonly history: readonly StockTick[];
  readonly showLowStockOnly: boolean;
  readonly faultedRecordId: string | null;
  readonly tickSequence: number;
  readonly tickCursor: number;
  readonly tickSeed: number;
  readonly addedCount: number;
}

function encode(next: InventoryState): InventoryWire {
  return {
    selectedId: next.selectedId,
    stockById: Object.fromEntries(next.stockById),
    added: next.added,
    history: next.history,
    showLowStockOnly: next.showLowStockOnly,
    faultedRecordId: next.faultedRecordId,
    tickSequence: next.tickSequence,
    tickCursor: next.tickCursor,
    tickSeed: next.tickSeed,
    addedCount: next.addedCount,
  };
}

/**
 * Rebuild this module's working shape from the host's frozen copy.
 *
 * A channel nothing has published on reads `null`, which is the seed state — so
 * the first render of either pane sees what the module used to start with, and no
 * ordering between the two panes' mounts matters.
 */
function decode(payload: StructuredPayload | null): InventoryState {
  if (payload === null) {
    return INITIAL_STATE;
  }
  const wire = payload.data as unknown as InventoryWire;
  return {
    selectedId: wire.selectedId,
    stockById: new Map(Object.entries(wire.stockById)),
    added: wire.added,
    history: wire.history,
    showLowStockOnly: wire.showLowStockOnly,
    faultedRecordId: wire.faultedRecordId,
    tickSequence: wire.tickSequence,
    tickCursor: wire.tickCursor,
    tickSeed: wire.tickSeed,
    addedCount: wire.addedCount,
  };
}

/**
 * Read this module's state back out of the host.
 *
 * **This takes a `shell` and used to take nothing**, and that is the migration
 * ADR-0001 Amendment L Decision 7 records. A module-scope `let` is correct in
 * exactly one process; under the process split
 * `docs/plans/native-host-pivot.md` §3.2 describes, this module would load twice,
 * the static catalogue would still resolve — so pane 3 would look right on first
 * paint — and every stock tick committed in pane 2 would be invisible to pane 3,
 * with nothing to say why.
 */
function getSnapshot(shell: IShellAPI): InventoryState {
  return decode(shell.readPayload(STATE_CHANNEL));
}

/**
 * Commit and notify, through the host.
 *
 * The host deep-copies, assigns a revision and notifies every subscriber of this
 * channel synchronously — including the added-during-pass and removed-during-pass
 * discipline this function used to implement for itself.
 */
function commit(shell: IShellAPI, next: InventoryState): void {
  guarded('publishing the inventory state', () => {
    shell.publishPayload(STATE_CHANNEL, 'table', encode(next));
  });
}

/**
 * Subscribe a view to this module's channel.
 *
 * `useChannelPayload` is the host's own `useSyncExternalStore` binding, and the
 * snapshot it hands React is the frozen `StructuredPayload` whose identity is
 * stable until the channel is republished. The decode is memoised on that
 * identity, so it runs once per publish rather than once per render.
 */
function useInventoryState(shell: IShellAPI): InventoryState {
  const payload = useChannelPayload(shell, STATE_CHANNEL);
  return useMemo(() => decode(payload), [payload]);
}

/** Seeded catalogue plus anything added at runtime. */
function allRecords(snapshot: InventoryState): readonly InventoryRecord[] {
  return snapshot.added.length === 0 ? SEED_RECORDS : [...SEED_RECORDS, ...snapshot.added];
}

function stockOf(snapshot: InventoryState, recordId: string): number {
  return snapshot.stockById.get(recordId) ?? 0;
}

function isLowStock(snapshot: InventoryState, record: InventoryRecord): boolean {
  return stockOf(snapshot, record.id) <= record.reorderLevel;
}

/* -------------------------------------------------------------------------- */
/* The pane-3 ledger blocks                                                    */
/* -------------------------------------------------------------------------- */

/** The three channels this remote publishes blocks on. Registry-valid ids. */
const STOCK_BLOCK = 'stock-levels';
const FILTER_BLOCK = 'stock-filter';
const TABLE_BLOCK = 'stock-table';

/** How many records a pane-3 block shows. A bar per record stops reading long before this. */
const BLOCK_RECORD_LIMIT = 12;

/**
 * The current stock levels as a chart spec, and the same numbers as a table.
 *
 * Two blocks over one dataset on purpose: the ledger's job is to be addressable,
 * so a reader who wants the shape scrolls to the chart and a reader who wants
 * the numbers scrolls to the table — and neither has to navigate away from the
 * other. The chart's own accessible alternative is a third rendering of the same
 * data, `sr-only` beside its canvas; the block inspector shows that one visibly.
 */
function stockBlocks(
  snapshot: InventoryState,
  records: readonly InventoryRecord[],
): { chart: unknown; table: unknown } {
  const shown = records.slice(0, BLOCK_RECORD_LIMIT);
  const skus = shown.map((record) => record.sku);
  const onHand = shown.map((record) => stockOf(snapshot, record.id));
  const reorder = shown.map((record) => record.reorderLevel);
  return {
    chart: {
      kind: 'bar',
      title: 'Stock against reorder level',
      xLabel: 'sku',
      yLabel: 'units',
      categories: skus,
      series: [
        { name: 'on hand', values: onHand },
        { name: 'reorder level', values: reorder },
      ],
    },
    table: {
      columns: ['sku', 'name', 'on hand', 'reorder level'],
      rows: shown.map((record, index) => [
        record.sku,
        record.name,
        onHand[index] ?? 0,
        record.reorderLevel,
      ]),
    },
  };
}

/**
 * Where one record's stock sits on its own track, as a tier-0 `bar`.
 *
 * ==========================================================================
 * THE FULL-SCALE POINT IS THE ONLY DECISION HERE, AND IT IS A DECISION
 * ==========================================================================
 * `NavigationMetric.value` is a FRACTION, host-clamped to `[0, 1]`, so drawing
 * a stock level means choosing what "full" means. Four times the reorder level
 * is this catalogue's answer: it puts the reorder line a quarter of the way
 * along the track, so a bar that is visibly short is a record that is visibly
 * near reordering, and the same bar means the same thing on a record whose
 * reorder level is 4 and on one whose level is 40.
 *
 * The clamp is written here as well as being applied by the host. It is not
 * belt-and-braces for its own sake: a runtime-added record can hold stock far
 * above four times its level, and an unclamped `1.4` would be REJECTED at the
 * door with `INVALID_FIELD` rather than drawn — so clamping is this module
 * deciding what an over-stocked record looks like instead of failing.
 *
 * `description` is required and carries the real numbers, which is the channel
 * that survives a monochrome display, a 32px collapsed track and a screen
 * reader. The bar is the fast read; the sentence is the accurate one.
 */
function stockMetric(record: InventoryRecord, stock: number): NavigationMetric {
  const fullScale = record.reorderLevel * 4;
  return {
    kind: 'bar',
    value: Math.min(1, Math.max(0, stock / fullScale)),
    description: `${String(stock)} in stock against a reorder level of ${String(record.reorderLevel)}`,
  };
}

/** The leaf categories a pane-1 selection covers: itself, or its children. */
function leavesUnder(categoryId: string): readonly string[] {
  const children = LEAF_CATEGORIES.filter((leaf) => leaf.parentId === categoryId).map(
    (leaf) => leaf.id,
  );
  return children.length > 0 ? children : [categoryId];
}

/** The badge this extension wants on `categoryId` right now. */
function lowStockCount(snapshot: InventoryState, categoryId: string): number {
  const scope = new Set(leavesUnder(categoryId));
  return allRecords(snapshot).filter(
    (record) => scope.has(record.categoryId) && isLowStock(snapshot, record),
  ).length;
}

/** The rows pane 2 shows for a pane-1 selection, after the low-stock filter. */
function visibleRecords(
  snapshot: InventoryState,
  categoryId: string | null,
): readonly InventoryRecord[] {
  const scope = categoryId === null ? null : new Set(leavesUnder(categoryId));
  return allRecords(snapshot).filter(
    (record) =>
      (scope === null || scope.has(record.categoryId)) &&
      (!snapshot.showLowStockOnly || isLowStock(snapshot, record)),
  );
}

function findRecord(snapshot: InventoryState, recordId: string): InventoryRecord | undefined {
  return allRecords(snapshot).find((record) => record.id === recordId);
}

function withHistory(next: InventoryState, ticks: readonly StockTick[]): InventoryState {
  const history = [...next.history, ...ticks];
  return { ...next, history: history.slice(Math.max(0, history.length - MAX_HISTORY)) };
}

// Every mutator below reads the CURRENT state through the shell and publishes
// the next one back. There is no module variable between them, so pane 2 and
// pane 3 read and write the same host-owned record however many times this
// module has been loaded.

function selectRecord(shell: IShellAPI, recordId: string | null): void {
  commit(shell, { ...getSnapshot(shell), selectedId: recordId });
}

/** How many records move on each tick. Small enough to stay legible in the log. */
const RECORDS_PER_TICK = 4;

/**
 * Advance the stock levels.
 *
 * The records that move are chosen by a rotating cursor rather than at random,
 * so that every record is eventually visited and so that the sequence is the
 * same on every run — a timer whose effects are unpredictable makes a
 * timer-cleanup test unfalsifiable, because "nothing changed after unmount" and
 * "nothing happened to change" look identical.
 */
function tickStock(shell: IShellAPI): void {
  const state = getSnapshot(shell);
  const records = allRecords(state);
  if (records.length === 0) {
    return;
  }
  const levels = new Map(state.stockById);
  const moved: StockTick[] = [];
  let { tickCursor, tickSeed, tickSequence } = state;
  for (let index = 0; index < RECORDS_PER_TICK; index += 1) {
    tickCursor = (tickCursor + 1) % records.length;
    const record = records[tickCursor];
    if (record === undefined) {
      continue;
    }
    tickSeed = nextRandom(tickSeed);
    const delta = (tickSeed % 7) - 3;
    const level = Math.max(0, (levels.get(record.id) ?? 0) + delta);
    levels.set(record.id, level);
    tickSequence += 1;
    moved.push({ seq: tickSequence, recordId: record.id, level });
  }
  commit(
    shell,
    withHistory({ ...state, stockById: levels, tickCursor, tickSeed, tickSequence }, moved),
  );
}

/** Take one unit off a record, from pane 3. */
function reserveStock(shell: IShellAPI, recordId: string): void {
  const state = getSnapshot(shell);
  const levels = new Map(state.stockById);
  const level = Math.max(0, (levels.get(recordId) ?? 0) - 1);
  levels.set(recordId, level);
  const tickSequence = state.tickSequence + 1;
  commit(
    shell,
    withHistory({ ...state, stockById: levels, tickSequence }, [
      { seq: tickSequence, recordId, level },
    ]),
  );
}

/** Add a record to a leaf category and return it, so the caller can select it. */
function addRecord(shell: IShellAPI, categoryId: string): InventoryRecord {
  const state = getSnapshot(shell);
  const addedCount = state.addedCount + 1;
  const record: InventoryRecord = {
    id: `${RECORD_ID_PREFIX}${categoryId}-new-${String(addedCount).padStart(3, '0')}`,
    categoryId,
    sku: `NEW-${String(1000 + addedCount)}`,
    name: `Unclassified part ${String(addedCount)}`,
    reorderLevel: 10,
  };
  const levels = new Map(state.stockById);
  levels.set(record.id, 0);
  commit(shell, {
    ...state,
    addedCount,
    added: [...state.added, record],
    stockById: levels,
    selectedId: record.id,
  });
  return record;
}

function setLowStockFilter(shell: IShellAPI, enabled: boolean): void {
  const state = getSnapshot(shell);
  if (state.showLowStockOnly === enabled) {
    return;
  }
  commit(shell, { ...state, showLowStockOnly: enabled });
}

function setFaultedRecord(shell: IShellAPI, recordId: string | null): void {
  const state = getSnapshot(shell);
  if (state.faultedRecordId === recordId) {
    return;
  }
  commit(shell, { ...state, faultedRecordId: recordId });
}

/* -------------------------------------------------------------------------- */
/* Talking to the host                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Call the shell from view code without letting the shell's failure become this
 * extension's crash. See the fuller account on the twin helper in
 * `MailPlugin.tsx`; the short version is that `REVOKED`, `REENTRANT_NOTIFY` and
 * anything a foreign store listener throws can all come back out of `IShellAPI`,
 * and none of them is a bug in this caller.
 *
 * It matters more here than it does in the mail module, because this one calls
 * the shell **from an interval**: a tick that fires between the unregistration
 * of this extension and the effect cleanup that stops the timer would otherwise
 * throw `REVOKED` from a timer callback, where there is no frame to catch it and
 * nothing to attribute it to.
 *
 * `Command.onExecute` does not need this — `execute` in `src/core/command.ts` guards it.
 */
function guarded(what: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    try {
      console.error(`DatabasePlugin: ${what} did not reach the shell.`, error);
    } catch {
      // Reporting is best-effort; staying mounted is not.
    }
  }
}

/**
 * Badge values this module has already pushed, so a tick that changes nothing a
 * category cares about writes nothing.
 *
 * Every `setBadgeCount` notifies the host store synchronously and re-renders the
 * shell, so an interval that republished three unchanged numbers five times a
 * second would be a self-inflicted render storm. Cleared when a view mounts
 * against a new shell handle, so the opening values are always published once.
 */
const publishedBadges = new Map<string, number>();

/** Push any top-level badge whose value has moved. Never called unguarded. */
function publishBadges(shell: IShellAPI): void {
  const snapshot = getSnapshot(shell);
  for (const category of TOP_LEVEL_CATEGORIES) {
    const count = lowStockCount(snapshot, category.id);
    if (publishedBadges.get(category.id) === count) {
      continue;
    }
    publishedBadges.set(category.id, count);
    shell.setBadgeCount(category.id, count);
  }
}

/**
 * The selected item, but only if this extension put it there. Pure, and a
 * function of `ctx` alone, so a predicate may call it.
 */
function ownSelection(ctx: RibbonContext): string | null {
  const selected = ctx.selectedItemId;
  return selected !== null && selected.startsWith(RECORD_ID_PREFIX) ? selected : null;
}

/**
 * The active navigation node, but only if it is one of ours.
 *
 * This is the field this module's ribbon is keyed on, and the reason it can be:
 * `activeNavNodeId` is written by the HOST when pane 1 is clicked, so the shell
 * re-renders and every predicate is re-evaluated against a context that really
 * moved. A predicate keyed on module state would not have that property.
 */
function ownCategory(ctx: RibbonContext): string | null {
  const nodeId = ctx.activeNavNodeId;
  return nodeId !== null && CATEGORY_IDS.has(nodeId) ? nodeId : null;
}

/** Leaf categories accept new records; a branch category does not. */
function isLeafCategory(categoryId: string): boolean {
  return LEAF_CATEGORIES.some((leaf) => leaf.id === categoryId);
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How often stock moves.
 *
 * Long enough that a suite is not fighting the clock, short enough that one tick
 * lands well inside a default `waitFor` window. It is a real interval rather
 * than a `requestAnimationFrame` loop because the property being exercised is
 * cleanup on unmount, and an interval that outlives its component is the exact
 * leak ISSUE-005 asks to be asserted against.
 */
const STOCK_TICK_INTERVAL_MS = 200;

interface InventoryRecordRowProps {
  readonly record: InventoryRecord;
  readonly stock: number;
  readonly isSelected: boolean;
  /** When true this renderer throws. See `InventoryState.faultedRecordId`. */
  readonly isFaulted: boolean;
  readonly onSelect: () => void;
}

/**
 * One record row — and the one renderer in this repository that can be made to
 * fail on purpose.
 *
 * The throw is a plain render-time exception, which is what a fault boundary has
 * to contain and what nothing currently does: `PaneWrapper` says in as many
 * words that it is not a fault boundary, and `FaultBoundary` is ISSUE-004. Until
 * that lands, arming this fault takes the shell down — which is precisely the
 * observation the ISSUE-004 test needs to be able to make before and after.
 */
function InventoryRecordRow({
  record,
  stock,
  isSelected,
  isFaulted,
  onSelect,
}: InventoryRecordRowProps): ReactElement {
  if (isFaulted) {
    throw new Error(
      `DatabasePlugin: the row renderer for record "${record.id}" was armed to fail, and did. ` +
        'This is a deliberate fault raised by a mock extension to exercise host containment.',
    );
  }
  const isLow = stock <= record.reorderLevel;
  return (
    <button
      type="button"
      data-record-id={record.id}
      aria-current={isSelected ? 'true' : undefined}
      onClick={onSelect}
      className={
        'flex w-full min-w-0 flex-row items-center gap-1 overflow-hidden rounded-sm border p-1 ' +
        'text-left text-[12px] leading-4 ' +
        `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.navSelectedBorder} ` +
        `${TOKEN_CLASS.navSelectedSurface} ${TOKEN_CLASS.controlHoverBorder}`
      }
    >
      <span className={`w-20 flex-none truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
        {record.sku}
      </span>
      <span className="min-w-0 flex-1 truncate">{record.name}</span>
      {/*
        TIER 0, AND A `bar` RATHER THAN A `sparkline`, WHICH IS THE HONEST SHAPE.

        This remote holds no stock HISTORY — the ticker moves one number and
        keeps no series behind it — so a sparkline here would be a line drawn
        through readings that were never taken. A bar says exactly what this
        module knows: where the current level sits against the headroom this
        record is allowed. Synthesising eight fake readings to get a prettier
        glyph is the thing `MetricGlyph`'s `dot` docblock refuses in the other
        direction, and it is refused here too.
      */}
      <RowMetric
        metric={stockMetric(record, stock)}
        value={String(stock)}
        delta={stock - record.reorderLevel}
      />
      <span className={isLow ? 'flex-none font-semibold' : `flex-none ${TOKEN_CLASS.mutedText}`}>
        {isLow ? 'low' : 'ok'}
      </span>
    </button>
  );
}

/**
 * Pane 2: the record list, and the owner of this module's timer.
 *
 * The list is scoped by `context.activeNavNodeId`, so pane 1 drives pane 2
 * through a host field rather than through anything this module wired up. With
 * no category selected it renders the whole catalogue, which is the case the
 * virtualizer exists for.
 */
function InventoryRecordList({ shell, context }: ExtensionViewProps): ReactElement {
  const snapshot = useInventoryState(shell);
  const categoryId = ownCategory(context);
  const records = visibleRecords(snapshot, categoryId);

  // One interval per mount, and exactly one. The cleanup ends it, so repeated
  // mount/unmount cycles cannot accumulate timers — and because the effect
  // depends only on `shell`, a selection or a stock tick does not tear the timer
  // down and build a new one.
  //
  // The mount also republishes this module's own remembered selection — to restore
  // it, not to defend against a leak. The host clears `selectedItemId` on a real
  // foreground handover ("clears the selected item when a different extension takes
  // the foreground" in `src/core/__tests__/activationHandover.test.tsx`), so after a
  // switch the field is null rather than holding whatever extension ran in between.
  // Putting this module's remembered selection back is what makes its own pane-2
  // selection survive that round trip.
  useEffect(() => {
    publishedBadges.clear();
    const remembered = getSnapshot(shell).selectedId;
    guarded('restoring the remembered selection', () => {
      shell.setSelectedItem(remembered);
    });
    guarded('publishing the opening stock badges', () => {
      publishBadges(shell);
    });
    const ticker = setInterval(() => {
      tickStock(shell);
      guarded('publishing a stock badge', () => {
        publishBadges(shell);
      });
    }, STOCK_TICK_INTERVAL_MS);
    return (): void => {
      clearInterval(ticker);
    };
  }, [shell]);

  // The pane-3 ledger: three blocks and the index that orders them.
  //
  // Keyed on the SNAPSHOT rather than driven from the ticker, and that is the
  // difference between a live chart and a picture of the moment it mounted: the
  // ticker moves stock, the stock lands on this module's own channel, the
  // snapshot identity changes, and this effect republishes. One writer, one
  // reason to republish. It is also why `toEChartsOption` sets
  // `animation: false` — a chart that animated every tick would never be still.
  useEffect(() => {
    guarded('publishing the ledger blocks', () => {
      const current = getSnapshot(shell);
      const blocks = stockBlocks(current, visibleRecords(current, categoryId));
      shell.publishPayload(STOCK_BLOCK, 'chart', blocks.chart);
      shell.publishPayload(TABLE_BLOCK, 'table', blocks.table);
      shell.publishPayload(FILTER_BLOCK, 'form', {
        fields: [
          { name: 'category', label: 'Category', value: categoryId ?? 'all' },
          { name: 'minimum', label: 'Minimum stock', value: '0' },
        ],
      });
    });
  }, [shell, categoryId, snapshot]);

  // The INDEX is written separately, and only when it could actually have
  // changed. It is the same three ids on every tick, and writing it back into
  // the context moves the host store — which re-renders the whole shell. A
  // context write on a 200ms timer is a re-render of every surface on a 200ms
  // timer, for a string that did not change.
  useEffect(() => {
    guarded('publishing the ledger index', () => {
      shell.setContextKey(LEDGER_CONTEXT_KEY, `${STOCK_BLOCK},${TABLE_BLOCK},${FILTER_BLOCK}`);
    });
  }, [shell]);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1 p-1">
      <p className={`px-1 text-[11px] uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}>
        {categoryId ?? 'all categories'} — {String(records.length)} records
        {snapshot.showLowStockOnly ? ' — low stock only' : ''}
      </p>
      <ul className="flex min-w-0 flex-col gap-px" data-record-list={categoryId ?? 'all'}>
        {records.map((record) => (
          <li key={record.id} className="min-w-0">
            <InventoryRecordRow
              record={record}
              stock={stockOf(snapshot, record.id)}
              isSelected={context.selectedItemId === record.id}
              isFaulted={snapshot.faultedRecordId === record.id}
              onSelect={() => {
                // Module state first, host second — both synchronous, so the
                // order is observable and is what a cross-pane ordering test
                // should expect.
                selectRecord(shell, record.id);
                guarded(`selecting ${record.id}`, () => {
                  shell.setSelectedItem(record.id);
                });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pane 3: the detail for whatever pane 2 selected, and the stock history for it.
 *
 * The selection arrives through `context.selectedItemId` — the host field — not
 * through the module store, because that is the path that has to work. The store
 * carries what the host does not: stock levels, the tick history, the filter.
 */
function InventoryRecordDetail({ shell, context }: ExtensionViewProps): ReactElement {
  const snapshot = useInventoryState(shell);
  const recordId = ownSelection(context);
  const record = recordId === null ? undefined : findRecord(snapshot, recordId);
  const ticks =
    recordId === null
      ? []
      : snapshot.history.filter((tick) => tick.recordId === recordId).slice(-6);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 p-1">
      {record === undefined ? (
        <p className={`text-[12px] leading-5 ${TOKEN_CLASS.mutedText}`}>
          {recordId === null
            ? 'No record selected. Choose one in the list.'
            : 'That record is no longer in the catalogue.'}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-[12px] font-semibold">{record.name}</h3>
          <p className={`truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
            {record.sku} — {record.categoryId}
          </p>
          <p className="text-[12px] leading-5">
            In stock: {String(stockOf(snapshot, record.id))} — reorder at{' '}
            {String(record.reorderLevel)}
            {isLowStock(snapshot, record) ? ' — below reorder level' : ''}
          </p>
          <button
            type="button"
            data-inventory-action="reserve"
            disabled={stockOf(snapshot, record.id) === 0}
            className={
              `w-fit rounded-sm border ${TOKEN_CLASS.chipBorder} p-1 text-[12px] leading-none ` +
              'disabled:cursor-not-allowed disabled:opacity-40'
            }
            onClick={() => {
              reserveStock(shell, record.id);
              // Recomputed from the state AFTER the mutation, not from the
              // snapshot this render closed over.
              guarded('publishing a stock badge', () => {
                publishBadges(shell);
              });
            }}
          >
            Reserve one unit
          </button>
        </div>
      )}
      <div className={`flex min-w-0 flex-col gap-px border-t ${TOKEN_CLASS.sectionEdge} pt-1`}>
        <h4 className={`text-[11px] uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}>
          Stock movements
        </h4>
        <ol className="flex flex-col gap-px" data-inventory-history="">
          {ticks.length === 0 ? (
            <li className={`text-[11px] ${TOKEN_CLASS.mutedText}`}>No movements recorded yet.</li>
          ) : (
            ticks.map((tick) => (
              <li key={tick.seq} className={`truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
                {String(tick.seq)}. {tick.recordId} — {String(tick.level)}
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ribbon                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Six actions. Two are gated on `ctx.activeNavNodeId` — the pane-1 selection —
 * which is the field this module keys on and which `MailPlugin` does not touch.
 *
 * The fault pair is deliberately NOT gated on anything. Their visibility would
 * otherwise have to depend on `faultedRecordId`, which is module state, and a
 * predicate reading module state produces a ribbon that only updates when the
 * host happens to re-render it for some unrelated reason. Two always-visible
 * actions say the truth; one stale toggle would not.
 *
 * `audit-category` carries a modifier-less `F9`. That is legal precisely because
 * a function key is exempt from WCAG 2.2 §2.1.4 — it cannot be produced by
 * dictation or by typing into a field — whereas the two character-key chords
 * below carry `ctrl` because they would otherwise be refused at registration.
 *
 * **All three chords now fire.** `src/core/hotkeyDispatch.ts` holds the shell's
 * one `keydown` listener — on `window`, bubble phase, attached by `ShellLayout` —
 * and it walks the FOREGROUND extension's ribbon actions and nothing else, so
 * `Ctrl+Alt+R`, `Ctrl+Shift+L` and `F9` are dead keys while `MailPlugin` is in
 * front. That scoping is Amendment H Decision 6 arriving in the dispatcher:
 * cross-extension chord collisions are legal by design, so a shell-wide table
 * would be ambiguous where a per-foreground lookup is total. *Tests:* "fires a
 * visible, enabled chord on the foreground extension" and "does not fire a
 * background extension chord while another extension is in the foreground" in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * **A chord is a second route to the button's action, never a wider one.** `F9`
 * is gated by the same `isVisible` as the Audit category button, so with no
 * pane-1 category selected it does nothing; the other two are unconditionally
 * visible and so are live whenever this extension is in front. An `isDisabled`
 * action is refused the same way, though none of these six declares one. *Tests:*
 * "does not fire a chord on an action whose predicate hides it", "does not fire a
 * chord on a disabled action" and "ignores a key that is not the chord, and an
 * action that declares no chord" in `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * Visibility rather than placement decides it. Six actions against an
 * `INLINE_ACTION_LIMIT` of 4 can push the fault pair into the overflow menu, but
 * neither of those carries a chord and the three that do are always inline here —
 * so this module never exercises the overflow case, which the dispatcher handles
 * regardless because it consults visibility and never the inline slice. *Test:*
 * "fires a chord belonging to an action that renders in the overflow menu" in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * Each chord-bearing, enabled button carries `aria-keyshortcuts` in UI Events
 * key-value spelling — `Control+Alt+R`, `Control+Shift+L`, `F9`, not the `Ctrl+…`
 * display spelling the tooltip uses — and the attribute is omitted from a
 * disabled command because the chord is suppressed there too. *Tests:*
 * "advertises a chord-bearing command with aria-keyshortcuts, in key values
 * rather than display spelling" and "omits aria-keyshortcuts from a disabled
 * command, because the chord will not fire" in
 * `src/components/command/__tests__/ContextBar.test.tsx`.
 *
 * **The dispatcher's suppression list is a guardrail, not a boundary**, in the
 * same register as ADR-0001's "No sandbox". It skips auto-repeat, an event
 * something below already handled, an IME composition, and a target inside an
 * `input`, `textarea`, `select`, `contenteditable` or an ARIA `textbox`,
 * `searchbox` or `combobox`. This module renders none of those, so nothing here
 * exercises it — and a plug-in whose custom editor is a `div` with no recognised
 * role WILL receive these chords while the user is typing, and has to call
 * `stopPropagation()` itself, which the bubble-phase listener deliberately leaves
 * working. A modifier-less `F9` makes that limit worth reading twice. *Tests:*
 * the "useHotkeyDispatch — suppression" group in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * One ordering is worth knowing and is NOT pinned by a test: `matchesHotkey` is
 * consulted before `isVisible`, so a keystroke that is none of these three chords
 * runs none of the predicates above. That is read off `hotkeyDispatch.ts` rather
 * than asserted, and is recorded here as a reading rather than as evidence.
 */
const RIBBON_ACTIONS: readonly RibbonAction[] = [
  {
    id: 'refresh-stock',
    label: 'Refresh stock',
    icon: 'refresh',
    hotkey: { key: 'r', ctrl: true, alt: true },
    isVisible: (): boolean => true,
    onExecute: (_ctx, shell): void => {
      tickStock(shell);
      publishBadges(shell);
    },
  },
  {
    id: 'low-stock-filter',
    label: 'Show low stock only',
    icon: 'search',
    hotkey: { key: 'l', ctrl: true, shift: true },
    isVisible: (): boolean => true,
    onExecute: (_ctx, shell): void => {
      setLowStockFilter(shell, !getSnapshot(shell).showLowStockOnly);
    },
  },
  {
    id: 'add-record',
    label: 'Add record',
    icon: 'add',
    // A record needs a home, and only a leaf category is one. A branch category
    // selected in pane 1 hides this action rather than disabling it, because
    // there is nothing the user could do to the branch to make it work.
    isVisible: (ctx): boolean => {
      const category = ownCategory(ctx);
      return category !== null && isLeafCategory(category);
    },
    onExecute: (ctx, shell): void => {
      const category = ownCategory(ctx);
      if (category === null || !isLeafCategory(category)) {
        return;
      }
      const record = addRecord(shell, category);
      shell.setSelectedItem(record.id);
      publishBadges(shell);
    },
  },
  {
    id: 'audit-category',
    label: 'Audit category',
    icon: 'settings',
    hotkey: { key: 'f9' },
    isVisible: (ctx): boolean => ownCategory(ctx) !== null,
    onExecute: (ctx, shell): void => {
      const category = ownCategory(ctx);
      if (category === null) {
        return;
      }
      // An audit is a forced recount: clear what this module believes it has
      // already published, then publish again from the live state.
      publishedBadges.clear();
      publishBadges(shell);
    },
  },
  {
    id: 'arm-record-fault',
    label: 'Arm record fault',
    icon: 'edit',
    isVisible: (): boolean => true,
    onExecute: (ctx, shell): void => {
      setFaultedRecord(shell, ownSelection(ctx) ?? FALLBACK_FAULT_RECORD_ID);
    },
  },
  {
    id: 'clear-record-fault',
    label: 'Clear record fault',
    icon: 'close',
    isVisible: (): boolean => true,
    onExecute: (_ctx, shell): void => {
      setFaultedRecord(shell, null);
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The category tree, with the low-stock badges the catalogue opens with.
 *
 * Ten nodes against a `MAX_NAV_NODES` of 512, two levels against a
 * `MAX_NAV_DEPTH` of 8, six ribbon actions against a `MAX_RIBBON_ACTIONS` of
 * 128, and no string within reach of the 256-character text limit.
 *
 * These badge values are what the REGISTRY stores. Everything after registration
 * goes through `shell.setBadgeCount` from the interval in pane 2.
 */
/**
 * The registered tree, built from the two tables above.
 *
 * **`icon` is copied through, and for eight months it was not.** #19 fixed the
 * collapsed 48px track host-side — `NavigationNode.icon` exists, `ShellLayout`
 * resolves it through `SHELL_ICONS` and falls back to the monogram only when a
 * node declares nothing — and this builder then dropped the field on the floor.
 * So `TOP_LEVEL_CATEGORIES` declared `box`, `layers` and `droplet`, the docblock
 * above them explained why, and all three were dead data: the registered nodes
 * carried `icon: undefined`, every root took the monogram, and the collapsed rail
 * read **C A C** — the exact string #19 is named after and that three documents
 * record as fixed. See #81.
 *
 * **Leaves declare no icon deliberately, and that is a decision rather than the
 * same omission twice.** A leaf is only ever drawn in the expanded tree, beside
 * its own label and indented under a root that already carries a glyph; the
 * collapsed track shows roots only, which is where an icon is doing the work of
 * a label rather than decorating one. Fourteen leaves would need fourteen keys
 * from a host table of fifteen glyphs, and the result would be decoration that
 * makes the tree noisier without disambiguating anything. If the collapsed track
 * ever renders leaves, this decision is the one to revisit.
 */
const NAVIGATION_TREE: readonly NavigationNode[] = TOP_LEVEL_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  icon: category.icon,
  badgeCount: lowStockCount(INITIAL_STATE, category.id),
  children: LEAF_CATEGORIES.filter((leaf) => leaf.parentId === category.id).map((leaf) => ({
    id: leaf.id,
    label: leaf.label,
    badgeCount: lowStockCount(INITIAL_STATE, leaf.id),
  })),
}));

/**
 * The manifest, and the ONLY export this module has.
 *
 * Frozen for the same reason `MailPlugin` is — the registry copies what it
 * validates because a plug-in's object stays mutable otherwise, and a
 * well-behaved remote does not make the host depend on that — and named in
 * PascalCase for the same mechanical reason, which is written out in full over
 * there rather than repeated here: `react-refresh/only-export-components` is a
 * build gate and classifies a `.tsx` export by its name.
 */
export const DatabasePlugin: LEAPExtensionBlueprintInput = Object.freeze({
  id: 'inventory-db',
  name: 'Inventory Database',
  version: '1.0.0',
  navigationTree: NAVIGATION_TREE,
  ribbonActions: RIBBON_ACTIONS,
  views: { pane2: InventoryRecordList, pane3: InventoryRecordDetail },
});

/**
 * The SAME object, as the module's default export — see the identical note on
 * `plugins/hello/src/HelloExtension.tsx`. ADR-0006 §7's running surface and
 * the conformance kit's Registration check (decision 10 / step 8) both read a
 * built bundle's DEFAULT export; the named export above is kept for
 * `src/dev/DevShell.tsx` and this plugin's own tests.
 */
export default DatabasePlugin;
