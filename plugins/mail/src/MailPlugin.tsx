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
 * A VERIFICATION REMOTE. THIRD-PARTY CODE, HOLDING NOTHING THE HOST DID NOT HAND IT.
 * ============================================================================
 * This module is a mock extension in the sense ISSUE-005 means it: a *remote
 * party*. It is written as a third-party vendor would have to write it, against
 * the published contract in `src/core/types.ts` and nothing else. It imports
 * exactly one thing from the host — the TYPES — and holds no host object it was
 * not given as a prop or as an argument.
 *
 * WHAT IT DELIBERATELY DOES NOT REACH FOR, each of which is public and each of
 * which would make this file worthless as a verification remote:
 *
 *  - `useShellStore()` / `useShellContext()`. Both are exported and both work
 *    from inside a plug-in subtree (ADR-0001 records that as an accepted limit).
 *    A mock that used them would be testing the host from the inside and would
 *    stop being evidence about the plug-in contract.
 *  - `useRegistry()`, `useActivation()`, `ExtensionHostBoundary`. Host wiring.
 *  - Any registry internal — `REGISTRY_LIMITS`, `EXTENSION_ID_PATTERN`. The
 *    bounds are respected below; they are not imported to be respected.
 *
 * So the only two capabilities this extension has are the two the host passes
 * into a view: `props.shell` (`IShellAPI`) and `props.context`
 * (`Readonly<RibbonContext>`), plus the `(ctx, shell)` pair a `RibbonAction`
 * receives. Everything else is this module's own state.
 *
 * ---------------------------------------------------------------------------
 * WHY PANE 2 AND PANE 3 SHARE A HOST CHANNEL, AND NOT A REACT CONTEXT — NOR,
 * SINCE ADR-0001 AMENDMENT L, A MODULE-SCOPED STORE
 * ---------------------------------------------------------------------------
 * `ShellLayout` mounts `views.pane2` and `views.pane3` in two *unrelated*
 * subtrees, each inside its own `ExtensionHostBoundary`. Neither is an ancestor
 * of the other, so there is no provider a plug-in could put above both: a React
 * context declared here would be read by whichever view happened to be inside
 * it and by nothing else.
 *
 * **This module used to answer that with a module-scoped external store — a
 * `let`, a listener `Set`, and `useSyncExternalStore` in each view — and that
 * answer is correct in exactly one process.** `docs/plans/native-host-pivot.md`
 * §3.2 puts each pane in its own renderer, and under that split this module
 * loads TWICE. The seeds are static, so they resolve identically in both copies
 * and pane 3 looks right on first paint; every `commit` made in pane 2 then
 * lands in a `let` pane 3 cannot see, and nothing anywhere says so. A
 * verification remote that would fail silently under the architecture it exists
 * to verify is not verifying it.
 *
 * So the state travels on `IShellAPI.publishPayload` / `readPayload` /
 * `subscribePayload` — the structured payload channel ADR-0001 Amendment L adds
 * and whose Decision 7 records this migration. The host owns the copy, assigns
 * the revision and notifies both panes, so a transport change is the only thing
 * a process split costs this file. `useChannelPayload` is the host's own
 * `useSyncExternalStore` binding over it.
 *
 * **The state still outlives a mount**, because it lives in the host's payload
 * store for as long as this extension is registered — which is the honest
 * behaviour of a real plug-in, and is what makes "switching extensions must not
 * bleed layout state" testable at all: this module remembers its own selection
 * across a switch and republishes it on remount (see `MailMessageList`). It is
 * dropped when the extension is released or unregistered, which module state
 * never was.
 *
 * ---------------------------------------------------------------------------
 * WHY NO RIBBON PREDICATE READS MODULE STATE
 * ---------------------------------------------------------------------------
 * `CommandRegistry` evaluates `isVisible` while a surface renders, and every
 * surface re-renders when
 * the HOST context changes — it is not subscribed to this module. A predicate
 * that closed over `mailStore` would therefore be evaluated against whatever the
 * module state happened to be at the last host-driven render, which is a ribbon
 * that is silently stale rather than one that is dynamic. It would also be an
 * impure predicate, which `RibbonAction.isVisible` asks authors not to write.
 *
 * So every predicate below is a pure function of `ctx` alone, and the way this
 * extension *changes* its visible action set is by changing a context field the
 * host owns: `shell.setSelectedItem(...)` writes the host store, the host store
 * notifies, the shell re-renders, and the predicates are re-evaluated against a
 * context that really did move.
 *
 * ---------------------------------------------------------------------------
 * UNTRUSTED CONTENT — WHAT THIS FILE OWES THE RULE
 * ---------------------------------------------------------------------------
 * These views are new render sites for strings this module supplies, so the
 * repository's cross-cutting rule applies to them: every string reaches the DOM
 * as a JSX text node. There is no `dangerouslySetInnerHTML`, no `innerHTML`, no
 * `document.write`, and no value interpolated into `href`, `src`, `style` or any
 * other attribute that could execute. The `icon` on each ribbon action is a KEY
 * into the host's own table, never markup and never a URL — this module does not
 * render icons at all.
 *
 * Per that rule a render site is covered when the rule "arrives with a test at
 * that site", and no test file for these views exists yet: `IntegrationSuite`
 * is blocked on ISSUE-003 and ISSUE-004. So this paragraph is an obligation
 * discharged in code and NOT YET pinned by a test, and it must not be read as a
 * control until one exists.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Prefix on every id this extension puts into `RibbonContext.selectedItemId`.
 *
 * **The host clears this field on a foreground handover, so the leak this prefix
 * was originally written against no longer exists.** `selectedItemId` is still ONE
 * field on ONE host-wide context shared by every extension, but `publishForeground`
 * in `src/core/ActivationContext.tsx` no longer patches `activeExtensionId` alone:
 * when the foreground actually MOVES it clears `selectedItemId` and
 * `activeNavNodeId` in the same patch, so a newly activated extension is never
 * handed its predecessor's selection id. It is one patch rather than three, so a
 * subscriber cannot observe the new extension beside the old selection either.
 * *Tests:* `src/core/__tests__/activationHandover.test.tsx` — "clears the selected
 * item when a different extension takes the foreground", "clears the active
 * navigation node when a different extension takes the foreground", and "never lets
 * a subscriber observe the new extension beside the old selection".
 *
 * The clearing is scoped to a real handover: republishing the SAME foreground is
 * not one and clears nothing, which is what stops a redundant republish from wiping
 * a live selection. *Test:* same file — "does not clear a live selection when the
 * same foreground is republished".
 *
 * **The prefix is kept as belt-and-braces, not as a workaround.** It is also simply
 * the id format this module's data uses, so it is not free-standing defensive code
 * that could be deleted on its own. What it still buys is that `ownSelection` stays
 * a pure question about `ctx` — cheap, local, and independent of the host honouring
 * its side. A third party is entitled to that even when the host is correct.
 */
const MESSAGE_ID_PREFIX = 'msg-';

interface MailMessage {
  readonly id: string;
  /** Navigation node this message hangs under. */
  readonly folderId: string;
  readonly from: string;
  readonly subject: string;
  readonly receivedAt: string;
}

/** The seeded mailbox. Runtime-composed drafts live in the store, not here. */
const SEED_MESSAGES: readonly MailMessage[] = [
  {
    id: 'msg-1001',
    folderId: 'inbox',
    from: 'Priya Raman',
    subject: 'Q3 shipping forecast needs your sign-off',
    receivedAt: '09:14',
  },
  {
    id: 'msg-1002',
    folderId: 'inbox',
    from: 'Build robot',
    subject: 'Nightly build 4821 succeeded',
    receivedAt: '08:52',
  },
  {
    id: 'msg-1003',
    folderId: 'inbox',
    from: 'Tomas Lindqvist',
    subject: 'Re: pane divider keyboard behaviour',
    receivedAt: '08:31',
  },
  {
    id: 'msg-1004',
    folderId: 'inbox',
    from: 'Accounts payable',
    subject: 'Invoice 20261-B is awaiting approval',
    receivedAt: 'Yesterday',
  },
  {
    id: 'msg-1005',
    folderId: 'inbox',
    from: 'Dana Whitfield',
    subject: 'Notes from the accessibility review',
    receivedAt: 'Yesterday',
  },
  {
    id: 'msg-1006',
    folderId: 'inbox',
    from: 'Security digest',
    subject: 'Weekly dependency advisory summary',
    receivedAt: 'Yesterday',
  },
  {
    id: 'msg-1007',
    folderId: 'inbox',
    from: 'Marta Oyelaran',
    subject: 'Warehouse cutover — revised dates',
    receivedAt: 'Monday',
  },
  {
    id: 'msg-1008',
    folderId: 'inbox',
    from: 'Facilities',
    subject: 'Lift maintenance on the 4th floor',
    receivedAt: 'Monday',
  },
  {
    id: 'msg-2001',
    folderId: 'drafts',
    from: 'You',
    subject: 'Re: Q3 shipping forecast',
    receivedAt: '09:20',
  },
  {
    id: 'msg-2002',
    folderId: 'drafts',
    from: 'You',
    subject: 'Onboarding checklist for the new starters',
    receivedAt: 'Yesterday',
  },
  {
    id: 'msg-3001',
    folderId: 'sent',
    from: 'You',
    subject: 'Shipment 88213 has left the depot',
    receivedAt: 'Monday',
  },
  {
    id: 'msg-3002',
    folderId: 'sent',
    from: 'You',
    subject: 'Re: pane divider keyboard behaviour',
    receivedAt: 'Monday',
  },
  {
    id: 'msg-4001',
    folderId: 'archive-2026',
    from: 'Priya Raman',
    subject: 'Archived: 2026 supplier contracts',
    receivedAt: '12 Mar',
  },
  {
    id: 'msg-4002',
    folderId: 'archive-2025',
    from: 'Legal',
    subject: 'Archived: retention policy, revision 4',
    receivedAt: '02 Nov',
  },
];

/** Messages that start life already read. Everything else is unread. */
const SEED_READ_IDS: ReadonlySet<string> = new Set(['msg-1003', 'msg-1005', 'msg-1008']);

/** Folder this extension shows when pane 1 has selected nothing of ours. */
const DEFAULT_FOLDER_ID = 'inbox';

/**
 * Every navigation node id, so that an `activeNavNodeId` belonging to another
 * extension resolves to the default folder rather than to an empty list.
 */
const FOLDER_IDS: ReadonlySet<string> = new Set([
  'inbox',
  'drafts',
  'sent',
  'archive',
  'archive-2026',
  'archive-2025',
]);

/* -------------------------------------------------------------------------- */
/* The state, and the host channel it travels on                               */
/* -------------------------------------------------------------------------- */

/** One entry in the cross-pane activity stream. */
interface MailEvent {
  /** Monotonic, module-wide. Two events never share a sequence number. */
  readonly seq: number;
  readonly label: string;
}

interface MailState {
  /** This module's OWN memory of its selection, independent of the host's. */
  readonly selectedId: string | null;
  readonly readIds: ReadonlySet<string>;
  readonly deletedIds: ReadonlySet<string>;
  /** Messages composed at runtime. Appended to, never edited in place. */
  readonly composed: readonly MailMessage[];
  /** Bodies already fetched, keyed by message id. */
  readonly bodies: ReadonlyMap<string, string>;
  /** Message whose body is in flight, or `null`. */
  readonly pendingId: string | null;
  /** Newest last. Bounded by `MAX_EVENTS`. */
  readonly events: readonly MailEvent[];
  /**
   * The next event sequence number, and the number of drafts composed so far.
   *
   * **They live on the state rather than beside it**, which they did not have to
   * while the state was a module-scope `let` and two module-scope counters could
   * sit next to it. Once the state crosses a channel, a counter left in module
   * scope is the very defect the migration removes — it would reset in the second
   * process and start reissuing sequence numbers the first one had already used.
   */
  readonly eventSequence: number;
  readonly composedCount: number;
}

/**
 * How much of the activity stream is kept.
 *
 * A stream a long-lived module appends to without a bound is a leak, and this
 * module is explicitly expected to survive repeated mount/unmount cycles.
 */
const MAX_EVENTS = 24;

const INITIAL_STATE: MailState = {
  selectedId: null,
  readIds: SEED_READ_IDS,
  deletedIds: new Set<string>(),
  composed: [],
  bodies: new Map<string, string>(),
  pendingId: null,
  events: [],
  eventSequence: 0,
  composedCount: 0,
};

/**
 * The channel this module's whole cross-pane state travels on.
 *
 * A registry-valid identifier, because `publishPayload` holds a channel name to
 * exactly the rule the registry holds a node id to.
 */
const STATE_CHANNEL = 'mail-state';

/**
 * The state as it crosses the channel: leaves only, no `Set` and no `Map`.
 *
 * `PayloadLeaf` is `ContextKeyValue` — ADR-0001 Amendment L Decision 2 preserves
 * that at the leaves — so the two membership sets travel as arrays and the body
 * cache travels as a record. Rebuilding them on read is what `decode` is for.
 */
interface MailWire {
  readonly selectedId: string | null;
  readonly readIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly composed: readonly MailMessage[];
  readonly bodies: Readonly<Record<string, string>>;
  readonly pendingId: string | null;
  readonly events: readonly MailEvent[];
  readonly eventSequence: number;
  readonly composedCount: number;
}

function encode(next: MailState): MailWire {
  return {
    selectedId: next.selectedId,
    readIds: [...next.readIds],
    deletedIds: [...next.deletedIds],
    composed: next.composed,
    bodies: Object.fromEntries(next.bodies),
    pendingId: next.pendingId,
    events: next.events,
    eventSequence: next.eventSequence,
    composedCount: next.composedCount,
  };
}

/**
 * Rebuild this module's working shape from the host's frozen copy.
 *
 * A channel that has never been published on reads `null`, which is the seed
 * state — so the very first render of either pane has the same state the module
 * used to start with, and no ordering between the two panes' mounts matters.
 */
function decode(payload: StructuredPayload | null): MailState {
  if (payload === null) {
    return INITIAL_STATE;
  }
  const wire = payload.data as unknown as MailWire;
  return {
    selectedId: wire.selectedId,
    readIds: new Set(wire.readIds),
    deletedIds: new Set(wire.deletedIds),
    composed: wire.composed,
    bodies: new Map(Object.entries(wire.bodies)),
    pendingId: wire.pendingId,
    events: wire.events,
    eventSequence: wire.eventSequence,
    composedCount: wire.composedCount,
  };
}

/**
 * Read this module's state back out of the host.
 *
 * **This takes a `shell` and used to take nothing**, and that is the whole of
 * the migration recorded in ADR-0001 Amendment L Decision 7. The state used to be
 * a module-scope `let`, which is correct in exactly one process: under the
 * process split `docs/plans/native-host-pivot.md` §3.2 describes, this module
 * would load twice, the static seeds would still resolve — so pane 3 would look
 * right on first paint — and every commit made in pane 2 would be invisible to
 * pane 3, with nothing to say why.
 */
function getSnapshot(shell: IShellAPI): MailState {
  return decode(shell.readPayload(STATE_CHANNEL));
}

/**
 * Commit a new state and tell both panes, through the host.
 *
 * The host takes a deep copy, assigns a revision and notifies every subscriber
 * of this channel synchronously — including the listener-set discipline this
 * function used to implement for itself. What is stored is host-owned, so
 * mutating anything handed in here afterwards changes nothing.
 */
function commit(shell: IShellAPI, next: MailState): void {
  guarded('publishing the mail state', () => {
    shell.publishPayload(STATE_CHANNEL, 'table', encode(next));
  });
}

function withEvent(next: MailState, label: string): MailState {
  const eventSequence = next.eventSequence + 1;
  const events = [...next.events, { seq: eventSequence, label }];
  return {
    ...next,
    eventSequence,
    events: events.slice(Math.max(0, events.length - MAX_EVENTS)),
  };
}

/**
 * Subscribe a view to this module's channel.
 *
 * `useChannelPayload` is the host's own `useSyncExternalStore` binding, and the
 * snapshot it hands React is the frozen `StructuredPayload` whose identity is
 * stable until the channel is republished. The decode is memoised on that
 * identity, so it runs once per publish rather than once per render — which is
 * the property the old module-scope `getSnapshot` had by returning a `let`.
 */
function useMailState(shell: IShellAPI): MailState {
  const payload = useChannelPayload(shell, STATE_CHANNEL);
  return useMemo(() => decode(payload), [payload]);
}

/** Every message currently in `folderId`, seeded and composed alike. */
function messagesIn(snapshot: MailState, folderId: string): readonly MailMessage[] {
  return [...SEED_MESSAGES, ...snapshot.composed].filter(
    (message) => message.folderId === folderId && !snapshot.deletedIds.has(message.id),
  );
}

function findMessage(snapshot: MailState, messageId: string): MailMessage | undefined {
  return [...SEED_MESSAGES, ...snapshot.composed].find((message) => message.id === messageId);
}

/* -------------------------------------------------------------------------- */
/* The pane-2 row metric — tier 0, and a remote's use of a host primitive        */
/* -------------------------------------------------------------------------- */

/**
 * How many readings a thread's activity sparkline holds.
 *
 * Eight, not thirty. `MAX_METRIC_POINTS` is 32 and the host would accept that
 * many, but the glyph is 28 `viewBox` units wide, so a 32-point series draws
 * points less than one unit apart and the shape stops being readable before the
 * host's bound is anywhere near reached. §3.3 puts the tier-0 range at 7–30
 * points and this sits at the bottom of it deliberately: a pane-2 row is a
 * SHAPE, and pane 3 is where a series is a number you can read off an axis.
 */
const ACTIVITY_POINTS = 8;

/**
 * A deterministic pseudo-random stream from one string.
 *
 * A vendor's mock has no telemetry to draw, and this file is verification code
 * that must produce the same picture on every run — a `Math.random()` series
 * would make every screenshot and every browser-lane assertion a coin flip. So
 * the shape is a function of the message id: the same thread always draws the
 * same sparkline, and two threads draw different ones.
 *
 * The multiplier and increment are a small, well-known LCG. Nothing here is
 * cryptographic and nothing pretends to be.
 */
function seededStream(seed: string): () => number {
  let state = 0;
  for (const character of seed) {
    state = (state * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * The thread-activity metric for one message, and the delta beside it.
 *
 * The series is what `MetricGlyph` draws and the delta is the last step of that
 * same series, so the two channels cannot disagree — a rising arrow beside a
 * falling line would be a lie the row tells about itself, and deriving one from
 * the other makes it unrepresentable rather than merely unlikely.
 *
 * `description` is REQUIRED by `NavigationMetric` and is the non-colour,
 * non-shape channel WCAG 1.4.1 asks for. It says what the shape means in words.
 */
function activityMetric(message: MailMessage): {
  metric: NavigationMetric;
  value: string;
  delta: number;
} {
  const next = seededStream(message.id);
  const series = Array.from({ length: ACTIVITY_POINTS }, () => Math.round(next() * 100) / 100);
  const last = series[ACTIVITY_POINTS - 1] as number;
  const previous = series[ACTIVITY_POINTS - 2] as number;
  return {
    value: String(Math.round(last * 100)),
    metric: {
      kind: 'sparkline',
      value: last,
      series,
      description: `thread activity over ${String(ACTIVITY_POINTS)} days`,
    },
    delta: Math.round((last - previous) * 100),
  };
}

/* -------------------------------------------------------------------------- */
/* The pane-3 ledger blocks — tier 1, and the channel's second consumer         */
/* -------------------------------------------------------------------------- */

/**
 * The two channels this remote publishes blocks on.
 *
 * Registry-valid identifiers, because `publishPayload` holds a channel name to
 * `EXTENSION_ID_PATTERN` — and because they are also the ADDRESSES pane 3's
 * ledger index names, so `parseLedgerIndex` has to accept them too. One rule,
 * two readers.
 */
const ACTIVITY_BLOCK = 'mail-activity';
const NOTE_BLOCK = 'mail-note';

/**
 * The folder's activity, as a chart spec — and note what is NOT in it.
 *
 * **No colour anywhere.** `ChartSpecInput` has no `color` member to write, and
 * `normalizeChartSpec` would reject one at runtime if this module found another
 * way to put it there. What the host assigns instead is a `colorIndex`, a `dash`
 * AND a `marker` per series, so these two lines are distinguishable to a reader
 * who cannot see colour at all. A vendor cannot opt out of that, which is the
 * point of it being the host's rotation.
 */
function activityChart(messages: readonly MailMessage[], readIds: ReadonlySet<string>): unknown {
  const totals = new Array<number>(ACTIVITY_POINTS).fill(0);
  const unread = new Array<number>(ACTIVITY_POINTS).fill(0);
  for (const message of messages) {
    const series = activityMetric(message).metric.series ?? [];
    series.forEach((point, index) => {
      totals[index] = Math.round(((totals[index] as number) + point) * 100) / 100;
      if (!readIds.has(message.id)) {
        unread[index] = Math.round(((unread[index] as number) + point) * 100) / 100;
      }
    });
  }
  return {
    kind: 'line',
    title: 'Thread activity',
    xLabel: 'day',
    yLabel: 'activity',
    categories: Array.from({ length: ACTIVITY_POINTS }, (_unused, index) =>
      `Day ${String(index + 1)}`,
    ),
    series: [
      { name: 'all threads', values: totals },
      { name: 'unread', values: unread },
    ],
  };
}

/** The badge this extension wants on `inbox` right now. */
function unreadInboxCount(snapshot: MailState): number {
  return messagesIn(snapshot, 'inbox').filter((message) => !snapshot.readIds.has(message.id))
    .length;
}

/** The badge this extension wants on `drafts` right now. */
function draftCount(snapshot: MailState): number {
  return messagesIn(snapshot, 'drafts').length;
}

// Every mutator below reads the CURRENT state through the shell and publishes
// the next one back. There is no module variable between them, so pane 2 and
// pane 3 are reading and writing the same host-owned record however many times
// this module has been loaded.

function selectMessage(shell: IShellAPI, messageId: string | null): void {
  const state = getSnapshot(shell);
  const label = messageId === null ? 'selection cleared' : `selected ${messageId}`;
  commit(shell, withEvent({ ...state, selectedId: messageId }, label));
}

function markRead(shell: IShellAPI, messageId: string): void {
  const state = getSnapshot(shell);
  if (state.readIds.has(messageId)) {
    return;
  }
  const readIds = new Set(state.readIds);
  readIds.add(messageId);
  commit(shell, withEvent({ ...state, readIds }, `marked ${messageId} read`));
}

function deleteMessage(shell: IShellAPI, messageId: string): void {
  const state = getSnapshot(shell);
  const deletedIds = new Set(state.deletedIds);
  deletedIds.add(messageId);
  commit(
    shell,
    withEvent(
      { ...state, deletedIds, selectedId: state.selectedId === messageId ? null : state.selectedId },
      `deleted ${messageId}`,
    ),
  );
}

/** Append a draft and return it, so the caller can select what it created. */
function composeDraft(shell: IShellAPI): MailMessage {
  const state = getSnapshot(shell);
  const composedCount = state.composedCount + 1;
  const draft: MailMessage = {
    id: `${MESSAGE_ID_PREFIX}9${String(100 + composedCount)}`,
    folderId: 'drafts',
    from: 'You',
    subject: `Untitled draft ${String(composedCount)}`,
    receivedAt: 'Now',
  };
  commit(
    shell,
    withEvent(
      { ...state, composedCount, composed: [...state.composed, draft], selectedId: draft.id },
      `composed ${draft.id}`,
    ),
  );
  return draft;
}

function noteActivity(shell: IShellAPI, label: string): void {
  commit(shell, withEvent(getSnapshot(shell), label));
}

function beginBodyFetch(shell: IShellAPI, messageId: string): void {
  commit(shell, { ...getSnapshot(shell), pendingId: messageId });
}

function endBodyFetch(shell: IShellAPI, messageId: string): void {
  const state = getSnapshot(shell);
  if (state.pendingId !== messageId) {
    return;
  }
  commit(shell, { ...state, pendingId: null });
}

function recordBody(shell: IShellAPI, messageId: string, body: string): void {
  const state = getSnapshot(shell);
  const bodies = new Map(state.bodies);
  bodies.set(messageId, body);
  commit(
    shell,
    withEvent(
      { ...state, bodies, pendingId: state.pendingId === messageId ? null : state.pendingId },
      `body arrived for ${messageId}`,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* The deliberately slow body fetch                                            */
/* -------------------------------------------------------------------------- */

/**
 * How long a message body takes to arrive.
 *
 * Chosen to be LONGER than a test needs to switch extensions and shorter than a
 * default `waitFor` timeout. That gap is the whole point: it makes the
 * rapid-switch case reachable rather than theoretical, so a suite can unmount
 * this view while a fetch is in flight and assert that the resolving fetch never
 * writes into the module that replaced it.
 */
const BODY_FETCH_LATENCY_MS = 120;

/**
 * The outcome of one fetch. A discriminated union rather than a rejection, on
 * purpose: an aborted fetch is an ordinary, expected result of the user changing
 * their mind, and modelling it as a rejection means every call site has to catch
 * — and a call site that forgets produces an unhandled rejection that fails a
 * suite somewhere else entirely.
 */
type BodyFetch = { readonly status: 'ok'; readonly body: string } | { readonly status: 'aborted' };

/**
 * Wait, unless the signal says not to bother.
 *
 * `signal.onabort` rather than a listener registration, and that is not a
 * stylistic choice: the scan parses every non-test module under `src/` and fails
 * on the listener registration names in any code position. That prohibition used
 * to be absolute and is now allowlisted, but the allowlist has one entry —
 * `src/core/hotkeyDispatch.ts`, the shell's keyboard dispatcher — and this file
 * is not it, so nothing changed for this module. *Test:* "finds no listener
 * registration in any module outside the hotkey-dispatch allowlist" in
 * `src/__tests__/noEventListener.test.ts`.
 *
 * A single assignment is also the right shape here, because there is exactly one
 * thing to cancel and it is cancelled once.
 *
 * Resolves `true` when the wait completed and `false` when it was cut short. The
 * timer is cleared on abort, so an aborted fetch leaves nothing pending.
 */
function waitUnlessAborted(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      resolve(true);
    }, milliseconds);
    signal.onabort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

/** Fetch one message body. Slow on purpose; see `BODY_FETCH_LATENCY_MS`. */
async function fetchBody(message: MailMessage, signal: AbortSignal): Promise<BodyFetch> {
  const completed = await waitUnlessAborted(BODY_FETCH_LATENCY_MS, signal);
  if (!completed || signal.aborted) {
    return { status: 'aborted' };
  }
  return {
    status: 'ok',
    body:
      `${message.from} wrote about "${message.subject}" at ${message.receivedAt}. ` +
      'This body was fetched asynchronously by the extension, not supplied by the host, ' +
      'and it arrives one full latency after the selection that asked for it.',
  };
}

/* -------------------------------------------------------------------------- */
/* Talking to the host                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Call the shell from view code without letting the shell's failure become this
 * extension's crash.
 *
 * Three things a plug-in genuinely cannot rule out come back through
 * `IShellAPI`, and none of them is a bug in the caller:
 *
 *  - `REVOKED`, when the handle's extension was released or unregistered between
 *    the render that captured `shell` and the effect or click that used it. That
 *    window is real — it is exactly the rapid-switch case this mock exists to
 *    exercise.
 *  - `REENTRANT_NOTIFY`, raised after the write has already been committed.
 *  - Anything at all thrown by a store listener somebody else registered, which
 *    runs synchronously inside the write and is documented as not necessarily
 *    being a `ShellUXError`.
 *
 * `Command.onExecute` does NOT need this — `execute` in `src/core/command.ts` already wraps it
 * — so it is used only where the host has no guard of its own: the views, which
 * have no fault boundary above them until ISSUE-004 lands one.
 */
function guarded(what: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    try {
      console.error(`MailPlugin: ${what} did not reach the shell.`, error);
    } catch {
      // Reporting is best-effort; staying mounted is not.
    }
  }
}

/**
 * The selected item, but only if this extension put it there.
 *
 * Pure, and a function of `ctx` alone — safe to call from an `isVisible`
 * predicate, which is exactly what it is for.
 */
function ownSelection(ctx: RibbonContext): string | null {
  const selected = ctx.selectedItemId;
  return selected !== null && selected.startsWith(MESSAGE_ID_PREFIX) ? selected : null;
}

/** The folder pane 2 should show for a given pane-1 selection. */
function folderFor(activeNavNodeId: string | null): string {
  return activeNavNodeId !== null && FOLDER_IDS.has(activeNavNodeId)
    ? activeNavNodeId
    : DEFAULT_FOLDER_ID;
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Pane 2: the message list for whichever folder pane 1 has selected.
 *
 * The folder comes from `context.activeNavNodeId` — a host field, so pane 1
 * driving pane 2 costs this module no wiring of its own. The selection goes back
 * out through `shell.setSelectedItem`, which is what moves pane 3 and what
 * re-evaluates the ribbon predicates.
 */
function MailMessageList({ shell, context }: ExtensionViewProps): ReactElement {
  const snapshot = useMailState(shell);
  const folderId = folderFor(context.activeNavNodeId);
  const messages = messagesIn(snapshot, folderId);

  // Republish this module's OWN selection whenever the view mounts.
  //
  // The reason is restoration, not defence. The host CLEARS `selectedItemId` on a
  // real foreground handover, so on remount after a switch the field holds null
  // rather than the other extension's id — see `MESSAGE_ID_PREFIX` above and
  // "clears the selected item when a different extension takes the foreground" in
  // `src/core/__tests__/activationHandover.test.tsx`. Writing this module's
  // remembered selection back is therefore how "each module owns its own pane-2
  // selection" survives a round trip through another extension: the host correctly
  // forgets it, and this module correctly puts its own back. The value read here
  // comes from the store rather than from `snapshot`, so the effect depends on the
  // shell handle alone and does not re-run on every selection.
  useEffect(() => {
    const remembered = getSnapshot(shell).selectedId;
    guarded('restoring the remembered selection', () => {
      shell.setSelectedItem(remembered);
    });
  }, [shell]);

  // The pane-3 ledger: two blocks and the index that orders them.
  //
  // The CONTENT goes on the payload channel, because a chart spec is structured
  // and a context key is a primitive. The INDEX goes on a context key, because
  // a list of addresses is exactly the cheap primitive fact a context key is
  // for — see `src/core/ledger/ledgerIndex.ts`. Both are published from pane 2,
  // which is where this module knows what folder is on screen.
  useEffect(() => {
    guarded('publishing the ledger blocks', () => {
      const snapshot = getSnapshot(shell);
      const listed = messagesIn(snapshot, folderId);
      shell.publishPayload(ACTIVITY_BLOCK, 'chart', activityChart(listed, snapshot.readIds));
      shell.publishPayload(NOTE_BLOCK, 'text', {
        text:
          `${folderId} holds ${String(listed.length)} messages. The chart above is drawn by the ` +
          'host from this extension’s published spec; this extension chose no colours and ' +
          'could not have.',
      });
      shell.setContextKey(LEDGER_CONTEXT_KEY, `${ACTIVITY_BLOCK},${NOTE_BLOCK}`);
    });
  }, [shell, folderId, snapshot]);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1 p-1">
      <p className={`px-1 text-[11px] uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}>
        {folderId} — {String(messages.length)} messages
      </p>
      <ul className="flex min-w-0 flex-col gap-px" data-mail-list={folderId}>
        {messages.map((message) => {
          const isUnread = !snapshot.readIds.has(message.id);
          const activity = activityMetric(message);
          return (
            <li key={message.id} className="min-w-0">
              <button
                type="button"
                data-message-id={message.id}
                aria-current={context.selectedItemId === message.id ? 'true' : undefined}
                className={
                  'flex w-full min-w-0 flex-row items-center gap-1 overflow-hidden rounded-sm border p-1 ' +
                  'text-left text-[12px] leading-4 ' +
                  `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.navSelectedBorder} ` +
                  `${TOKEN_CLASS.navSelectedSurface} ${TOKEN_CLASS.controlHoverBorder}`
                }
                onClick={() => {
                  // Module state first, host second. Both are synchronous, so
                  // the order is observable and is the order a cross-pane
                  // ordering test should expect: this module knows about the
                  // selection before the host tells pane 3 about it.
                  selectMessage(shell, message.id);
                  guarded(`selecting ${message.id}`, () => {
                    shell.setSelectedItem(message.id);
                  });
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col items-start gap-px">
                  <span className={isUnread ? 'truncate font-semibold' : 'truncate'}>
                    {message.subject}
                  </span>
                  <span className={`truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
                    {message.from} — {message.receivedAt}
                    {isUnread ? ' — unread' : ''}
                  </span>
                </span>
                {/*
                  TIER 0, AND THE HOST'S OWN PRIMITIVE RATHER THAN A SECOND ONE.

                  A vendor drawing its own sparkline here is exactly the
                  duplication §3.3 exists to prevent, and it would also be the
                  vendor deciding a colour — which `MetricGlyph` refuses by
                  drawing in `currentColor` and taking no colour field at all.
                  Reaching for a chart library instead would put a chart
                  INSTANCE in every row of a list that virtualizes, which is
                  the failure mode the whole tier is a response to.
                */}
                <RowMetric
                  metric={activity.metric}
                  value={activity.value}
                  delta={activity.delta}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pane 3: the body of whatever pane 2 selected, plus the activity stream.
 *
 * It learns about the selection from `context.selectedItemId` — the host field —
 * and not from the module store, because that is the path that has to work: a
 * selection made in pane 2 reaches this pane through the host, and the module
 * store is only how the two panes share what the host does not carry (bodies,
 * read state, the event log).
 */
function MailMessageBody({ shell, context }: ExtensionViewProps): ReactElement {
  const snapshot = useMailState(shell);
  const messageId = ownSelection(context);
  const message = messageId === null ? undefined : findMessage(snapshot, messageId);
  const body = messageId === null ? undefined : snapshot.bodies.get(messageId);

  // One fetch per selection, cancelled on unmount and on re-selection.
  //
  // `controller.abort()` in the cleanup is what makes rapid switching safe: the
  // resolving fetch reports `aborted` and writes nothing, so a module that has
  // been unmounted cannot land a body in the store that replaced it.
  useEffect(() => {
    if (messageId === null) {
      return;
    }
    const current = getSnapshot(shell);
    if (current.bodies.has(messageId)) {
      return;
    }
    const target = findMessage(current, messageId);
    if (target === undefined) {
      return;
    }
    const controller = new AbortController();
    beginBodyFetch(shell, messageId);
    void fetchBody(target, controller.signal).then((outcome) => {
      if (outcome.status === 'ok') {
        recordBody(shell, messageId, outcome.body);
      }
    });
    return (): void => {
      controller.abort();
      endBodyFetch(shell, messageId);
    };
  }, [messageId, shell]);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 p-1">
      {message === undefined ? (
        <p className={`text-[12px] leading-5 ${TOKEN_CLASS.mutedText}`}>
          {messageId === null
            ? 'No message selected. Choose one in the list.'
            : 'That message is no longer in this mailbox.'}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-[12px] font-semibold">{message.subject}</h3>
          <p className={`truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
            {message.from} — {message.receivedAt}
          </p>
          <p className="text-[12px] leading-5">
            {body ?? (snapshot.pendingId === message.id ? 'Fetching body…' : 'Body not loaded.')}
          </p>
          <button
            type="button"
            data-mail-action="mark-read"
            disabled={snapshot.readIds.has(message.id)}
            className={
              `w-fit rounded-sm border ${TOKEN_CLASS.chipBorder} p-1 text-[12px] leading-none ` +
              'disabled:cursor-not-allowed disabled:opacity-40'
            }
            onClick={() => {
              markRead(shell, message.id);
              // The badge is recomputed from the state AFTER the mutation, not
              // from the snapshot this render closed over.
              guarded('updating the inbox badge', () => {
                shell.setBadgeCount('inbox', unreadInboxCount(getSnapshot(shell)));
              });
            }}
          >
            Mark as read
          </button>
        </div>
      )}
      <div
        className={`flex min-w-0 flex-col gap-px border-t ${TOKEN_CLASS.sectionEdge} pt-1`}
      >
        <h4 className={`text-[11px] uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}>Activity</h4>
        <ol className="flex flex-col gap-px" data-mail-activity="">
          {snapshot.events.slice(-6).map((event) => (
            <li key={event.seq} className={`truncate text-[11px] ${TOKEN_CLASS.mutedText}`}>
              {String(event.seq)}. {event.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ribbon                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Five actions, one always visible and four gated on this extension's own
 * selection.
 *
 * Every `icon` is a key from the host's published vocabulary — `SHELL_ICONS` in
 * `src/components/ui/shellIcons.tsx`, listed for extension authors in
 * `DEVELOPER.md` since GitHub issue #18. An unknown key resolves to the host
 * fallback glyph rather than to anything this module controls, which is the
 * point of the icon being a key at all.
 *
 * The two hotkeys carry `ctrl`, because the registry refuses a bare
 * character-key chord under WCAG 2.2 §2.1.4 — and because a bare `J`/`K`-style
 * binding is required by ADR-0001 Amendment H to be local to a focused list
 * rather than declared here.
 *
 * **Both chords now fire.** `src/core/hotkeyDispatch.ts` holds the shell's one
 * `keydown` listener — on `window`, bubble phase, attached by `ShellLayout` — and
 * it walks the FOREGROUND extension's ribbon actions and nothing else, so
 * `Ctrl+Shift+N` and `Ctrl+Delete` are dead keys while `DatabasePlugin` is in
 * front. That scoping is Amendment H Decision 6 arriving in the dispatcher:
 * cross-extension chord collisions are legal by design, so a shell-wide table
 * would be ambiguous where a per-foreground lookup is total. These two mocks
 * happen to declare disjoint chords, so nothing here exercises a collision.
 * *Tests:* "fires a visible, enabled chord on the foreground extension" and "does
 * not fire a background extension chord while another extension is in the
 * foreground" in `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * **A chord is a second route to the button's action, never a wider one.**
 * `Ctrl+Delete` is gated by the same `isVisible` as the Delete button, so with no
 * message selected it does nothing at all, and an unrelated keystroke reaches no
 * handler here either. An `isDisabled` action is refused the same way, though
 * none of these five declares one. *Tests:* "does not fire a chord on an action
 * whose predicate hides it", "does not fire a chord on a disabled action" and
 * "ignores a key that is not the chord, and an action that declares no chord" in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * **Placement is not the gate.** `delete-message` is the fifth of five actions
 * against an `INLINE_ACTION_LIMIT` of 4, and the four gated on `ownSelection`
 * appear and disappear together — so whenever Delete is visible at all its button
 * sits in the ribbon's overflow menu, and `Ctrl+Delete` fires anyway, because the
 * dispatcher consults visibility and never the inline slice. *Test:* "fires a
 * chord belonging to an action that renders in the overflow menu" in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * The chord-bearing buttons also carry `aria-keyshortcuts` in UI Events key-value
 * spelling — `Control+Shift+N` and `Control+Delete`, not the `Ctrl+…` display
 * spelling the tooltip uses — and the attribute is omitted from a disabled command
 * because the chord is suppressed there too. *Tests:* "advertises a chord-bearing
 * command with aria-keyshortcuts, in key values rather than display spelling",
 * "advertises a chord on an overflow menu item too" and "omits aria-keyshortcuts
 * from a disabled command, because the chord will not fire" in
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
 * working. *Tests:* the "useHotkeyDispatch — suppression" group in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
 *
 * One ordering is worth knowing and is NOT pinned by a test: `matchesHotkey` is
 * consulted before `isVisible`, so a keystroke that is neither chord runs none of
 * the predicates above. That is read off `hotkeyDispatch.ts` rather than
 * asserted, and is recorded here as a reading rather than as evidence.
 */
const RIBBON_ACTIONS: readonly RibbonAction[] = [
  {
    id: 'compose',
    label: 'Compose',
    icon: 'add',
    hotkey: { key: 'n', ctrl: true, shift: true },
    isVisible: (): boolean => true,
    onExecute: (_ctx, shell): void => {
      const draft = composeDraft(shell);
      shell.setSelectedItem(draft.id);
      shell.setBadgeCount('drafts', draftCount(getSnapshot(shell)));
    },
  },
  {
    id: 'reply',
    label: 'Reply',
    icon: 'edit',
    isVisible: (ctx): boolean => ownSelection(ctx) !== null,
    onExecute: (ctx, shell): void => {
      const selected = ownSelection(ctx);
      if (selected !== null) {
        noteActivity(shell, `replied to ${selected}`);
      }
    },
  },
  {
    id: 'forward',
    label: 'Forward',
    icon: 'open',
    isVisible: (ctx): boolean => ownSelection(ctx) !== null,
    onExecute: (ctx, shell): void => {
      const selected = ownSelection(ctx);
      if (selected !== null) {
        noteActivity(shell, `forwarded ${selected}`);
      }
    },
  },
  {
    id: 'mark-read',
    label: 'Mark as read',
    icon: 'save',
    isVisible: (ctx): boolean => ownSelection(ctx) !== null,
    onExecute: (ctx, shell): void => {
      const selected = ownSelection(ctx);
      if (selected === null) {
        return;
      }
      markRead(shell, selected);
      shell.setBadgeCount('inbox', unreadInboxCount(getSnapshot(shell)));
    },
  },
  {
    id: 'delete-message',
    label: 'Delete',
    icon: 'delete',
    hotkey: { key: 'delete', ctrl: true },
    isVisible: (ctx): boolean => ownSelection(ctx) !== null,
    onExecute: (ctx, shell): void => {
      const selected = ownSelection(ctx);
      if (selected === null) {
        return;
      }
      deleteMessage(shell, selected);
      // Clearing the selection is what hides Reply, Forward, Mark as read and
      // Delete again: the action set changes because a HOST field changed, not
      // because a predicate read this module's state.
      shell.setSelectedItem(null);
      shell.setBadgeCount('inbox', unreadInboxCount(getSnapshot(shell)));
      shell.setBadgeCount('drafts', draftCount(getSnapshot(shell)));
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The folder tree, with the badges the mailbox starts out with.
 *
 * Well inside every `REGISTRY_LIMITS` bound: six nodes against 512, two levels
 * against 8, five ribbon actions against 128, and no string near the 256-character
 * text limit.
 *
 * The badge values here are the ones the *registry* stores. They are a snapshot
 * of the seeded mailbox, and every later change goes through
 * `shell.setBadgeCount`.
 */
const NAVIGATION_TREE: readonly NavigationNode[] = [
  { id: 'inbox', label: 'Inbox', badgeCount: unreadInboxCount(INITIAL_STATE) },
  { id: 'drafts', label: 'Drafts', badgeCount: draftCount(INITIAL_STATE) },
  { id: 'sent', label: 'Sent' },
  {
    id: 'archive',
    label: 'Archive',
    children: [
      { id: 'archive-2026', label: '2026' },
      { id: 'archive-2025', label: '2025' },
    ],
  },
];

/**
 * The manifest, and the ONLY export this module has.
 *
 * Two properties of this declaration are load-bearing and neither is decoration:
 *
 * **It is frozen.** The registry copies what it validates precisely because a
 * plug-in's own object stays mutable afterwards; a well-behaved remote does not
 * make the host rely on that. Freezing here means the object the host was handed
 * is the object this module keeps.
 *
 * **It is the module's single export, and it is named in PascalCase.** The
 * exported surface is one manifest and no components — a view exported here as
 * well would be a second way to mount it, outside the registry, which is exactly
 * what a verification remote must not offer. The casing then matters for a
 * mechanical reason: `react-refresh/only-export-components` runs as a build gate
 * (`--max-warnings 0`) and decides what a `.tsx` export is by NAME. A
 * lowercase-named manifest export is classified as a non-component, which makes
 * every component declared beside it a reportable "move your component to a
 * separate file"; a PascalCase name bound to a call expression is classified as a
 * component and the file passes. This repository has zero inline suppressions and
 * `eslint.config.js` is not a plug-in's to edit, so the export is shaped to the
 * rule rather than the rule to the export.
 */
export const MailPlugin: LEAPExtensionBlueprintInput = Object.freeze({
  id: 'mail',
  name: 'Mail',
  version: '1.0.0',
  navigationTree: NAVIGATION_TREE,
  ribbonActions: RIBBON_ACTIONS,
  views: { pane2: MailMessageList, pane3: MailMessageBody },
});

/**
 * The SAME object, as the module's default export — see the identical note on
 * `plugins/hello/src/HelloExtension.tsx`. ADR-0006 §7's running surface and
 * the conformance kit's Registration check (decision 10 / step 8) both read a
 * built bundle's DEFAULT export; the named export above is kept for
 * `src/dev/DevShell.tsx` and this plugin's own tests.
 */
export default MailPlugin;
