import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useRef } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider, useActivation } from '../core/ActivationContext';
import type { ActivationController } from '../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../core/RegistryContext';
import type { ExtensionRegistry } from '../core/RegistryContext';
import { useShellContext, useShellStore } from '../core/ShellAPI';
import type { ShellStateStore } from '../core/ShellAPI';
import { TOKEN_CLASS } from '../core/theme/tokenClasses';
import { SCHEMA_VERSION, STORAGE_KEY, createHydrationEngine } from '../core/services/HydrationEngine';
import type { HydrationEngine, ShellStorage } from '../core/services/HydrationEngine';
import type {
  ExtensionViewProps,
  IShellAPI,
  LEAPExtensionBlueprintInput,
  RibbonContext,
  ShellUXError,
} from '../core/types';
import { useExtensionUiState } from '../hooks/useLocalStorageState';
import { ShellLayout } from '../components/layout/ShellLayout';
import { VirtualizedList } from '../components/shared/VirtualizedList';

/**
 * ============================================================================
 * THE INTEGRATION SUITE. THE FIRST PLACE AN OPERATIONAL PLUG-IN IS EVER MOUNTED.
 * ============================================================================
 * The 915 tests that stood before this file were adversarial and complete, and
 * every one of them mounted ONE unit against fixtures whose views are
 * `(): null => null`. Nothing in this repository had ever mounted a plug-in that
 * holds state, owns a timer, fetches asynchronously, or fails on purpose. This
 * file drives the ASSEMBLED shell — real registry, real activation, real hydration
 * engine, real panel group, real fault boundaries, real hotkey dispatcher — through
 * the two verification remotes in `src/mocks/`, and asserts the things that only
 * exist once several units are wired together.
 *
 * ---------------------------------------------------------------------------
 * JSDOM, NOT PLAYWRIGHT — AND WHERE THAT COSTS SOMETHING, THE TEST NAME SAYS SO
 * ---------------------------------------------------------------------------
 * `README.md` states this project's acceptance test as "a fresh clone on a
 * different operating system runs `npm ci && npm run verify` with no local setup
 * and no edits". Playwright — and Vitest's browser mode, whose default provider is
 * Playwright — needs `npx playwright install`, a browser download that is neither
 * `npm ci` nor in the lockfile, on all three CI legs. None of ISSUE-005's
 * adversarial edge cases is geometric: they are rapid switching, listener and
 * timer cleanup, keyboard mapping, cross-pane ordering, id conflicts, activation
 * failure, badge updates while inactive, test-order leakage and fake-timer
 * flakiness. All of those are reachable here.
 *
 * Three places where jsdom genuinely cannot reach, handled by narrowing the claim
 * rather than by faking the environment:
 *
 *  - **`Element.prototype.scrollIntoView` does not exist in jsdom.** The Definition
 *    of Done's "the selected row is scrolled into view" is therefore asserted as
 *    "the list assigned `scrollTop` on its own container", which is what
 *    `VirtualizedList` really does and why it does it — see decision 3 in that
 *    module's banner.
 *  - **`ResizeObserver` and `IntersectionObserver` do not exist either.** The
 *    virtualizer has a documented fallback for that, and it is driven deliberately
 *    below rather than papered over with a global stub.
 *  - **A pane resize needs geometry, and a pointer DRAG needs more than that.**
 *    `getBoundingClientRect` is stubbed to `new DOMRect(0, 0, 1000, 800)`, exactly
 *    as `ShellLayout.test.tsx` does, and under that stub the panel library's own
 *    arithmetic really runs and really moves the panes — so the resize case below
 *    is exercising `react-resizable-panels` against geometry THIS FILE supplied,
 *    and says so in its own name. A POINTER drag is a step further and is not
 *    reachable at all: **this jsdom implements no `PointerEvent`**, so
 *    `fireEvent.pointerMove` falls back to a plain `Event` that carries no
 *    `clientX`, and the library's delta arithmetic is never handed a coordinate.
 *    That is measured rather than assumed, in its own case below, and the
 *    keyboard window-splitter path — which is the library's own, and the
 *    accessible one — is what the resize cases drive instead.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CASE RE-IMPORTS THE MOCKS
 * ---------------------------------------------------------------------------
 * Both verification remotes keep module-scoped state — a mailbox with read and
 * deleted ids, a catalogue whose stock levels move on a timer — and neither
 * exports a reset. That is deliberate on their side: a test-only back door in
 * shipping plug-in code would stop it being a verification remote. So a case that
 * needs a pristine remote calls `loadRemotes()`, which does `vi.resetModules()`
 * followed by a dynamic `import`. That is the only reset that is not also a hole
 * in the thing being verified. It is safe for React: both mocks import `react` and
 * nothing else at runtime, and `react` is externalised rather than transformed, so
 * the reset does not mint a second copy of it.
 *
 * ---------------------------------------------------------------------------
 * FAKE TIMERS EVERYWHERE, AND THE ONE TRAP THAT COMES WITH THEM
 * ---------------------------------------------------------------------------
 * `DatabasePlugin` owns a 200ms interval and `MailPlugin` a 120ms body fetch. Both
 * fire outside `act()` under real timers, which is exactly the flakiness ISSUE-005
 * names. Every case here runs on fake timers and advances them explicitly inside
 * `act`, so nothing is racing.
 *
 * **`@testing-library/user-event` is not used in this file at all, and the reason
 * is worth writing down because the obvious fix does not work.** The usual advice
 * is `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, which handles
 * `user-event`'s OWN inter-event wait. It does not handle the deadlock that
 * actually happens here, which is one layer up: `@testing-library/react` installs
 * an `asyncWrapper` that, after every async user interaction, drains the microtask
 * queue by awaiting a real `setTimeout(resolve, 0)` and advances the clock only
 * `if (jestFakeTimersAreEnabled())`. That helper begins with
 * `typeof jest !== 'undefined'`, and Vitest defines no global `jest` — measured in
 * this environment: `jest` is `undefined` while `setTimeout` DOES carry sinon's
 * `clock`, so the detection is false and the awaited timer is faked and never
 * fires. Every `await user.click(...)` then hangs until the case times out, which
 * is exactly what it did before this file was converted.
 *
 * So every interaction here is `fireEvent`, which is synchronous and goes through
 * no async wrapper, plus `act` where React work has to be flushed. `waitFor` is
 * avoided for the same underlying reason: its own timeout is faked while it waits
 * for it. Everything is advanced by hand, which is deterministic rather than
 * merely lucky.
 * ============================================================================
 */

/**
 * A longer per-case budget than Vitest's 5s default, for THIS FILE only.
 *
 * `vi.setConfig` rather than `vitest.config.ts`, because that file is shared by
 * all 29 suites and none of the others needs this: raising the default there
 * would hide a genuine hang in a unit test somewhere else.
 *
 * The budget is needed because the workload is real. `DatabasePlugin` puts 280
 * records into a plain `<ul>` — it does not use the virtualizer, which is the gap
 * pinned at the bottom of this file — so one activation of it renders 280 rows,
 * and the churn case below does that ten times over five mount/unmount cycles.
 * Isolated, the slowest case here takes about 7s; on a loaded machine it takes
 * longer, and a 5s budget makes this suite fail for the machine's reasons rather
 * than for the shell's. Measured, not guessed: the churn case was observed at
 * 7.2s isolated and was cancelled at 5s during a full-suite run.
 */
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

/* -------------------------------------------------------------------------- */
/* Loading the verification remotes                                            */
/* -------------------------------------------------------------------------- */

interface Remotes {
  readonly mail: LEAPExtensionBlueprintInput;
  readonly database: LEAPExtensionBlueprintInput;
}

/**
 * Fresh copies of both mocks, with their module state at its opening values.
 *
 * See the banner: this is the only reset that does not require a back door in the
 * shipping mock. It is called by every case that touches a remote, which is what
 * makes this file safe to run in a randomised order.
 */
async function loadRemotes(): Promise<Remotes> {
  vi.resetModules();
  const [mailModule, databaseModule] = await Promise.all([
    import('../mocks/MailPlugin'),
    import('../mocks/DatabasePlugin'),
  ]);
  return { mail: mailModule.MailPlugin, database: databaseModule.DatabasePlugin };
}

/* -------------------------------------------------------------------------- */
/* Storage and the hydration engine                                            */
/* -------------------------------------------------------------------------- */

interface Recorder {
  readonly storage: ShellStorage;
  raw(): string | null;
}

/** A `ShellStorage` over a `Map`, so no case can see another case's writes. */
function memoryStorage(seeded?: string): Recorder {
  const entries = new Map<string, string>();
  if (seeded !== undefined) {
    entries.set(STORAGE_KEY, seeded);
  }
  return {
    storage: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
      },
    },
    raw: (): string | null => entries.get(STORAGE_KEY) ?? null,
  };
}

/** A well-formed record of the current schema, with `overrides` applied. */
function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: { pane1: 24, pane2: 36, pane3: 40 },
    isPane1Collapsed: false,
    activeExtensionId: null,
    extensions: {},
    ...overrides,
  });
}

/**
 * The engine the harness last handed the shell.
 *
 * A plug-in reaching persistence would import `getDefaultHydrationEngine()` — a
 * public module export, and the reason the namespacing limit below is a limit at
 * all. The probes here read this holder instead, so that each case gets an engine
 * of its own rather than sharing the process-wide singleton, which has no reset
 * and would make this file order-dependent. The property being pinned is a
 * property of the engine's public surface and is the same either way.
 */
const injected: { engine: HydrationEngine | null } = { engine: null };

function requireEngine(): HydrationEngine {
  const engine = injected.engine;
  if (engine === null) {
    throw new Error('the test harness did not publish an engine');
  }
  return engine;
}

/* -------------------------------------------------------------------------- */
/* The harness — App.tsx's provider order, with somewhere to register           */
/* -------------------------------------------------------------------------- */

/** Registers each blueprint once, from inside the provider, as a plug-in would. */
function Registrar({ blueprints }: { readonly blueprints: readonly unknown[] }): null {
  const registry = useRegistry();
  const registered = useRef(false);
  useEffect(() => {
    if (registered.current) {
      return;
    }
    registered.current = true;
    for (const blueprint of blueprints) {
      registry.register(blueprint);
    }
  }, [blueprints, registry]);
  return null;
}

interface HostHandles {
  activation: ActivationController | null;
  registry: ExtensionRegistry | null;
  store: ShellStateStore | null;
  context: Readonly<RibbonContext> | null;
}

/** What the HOST-side probe captured on its last render. Reset per case. */
const host: HostHandles = { activation: null, registry: null, store: null, context: null };

/**
 * A host-territory probe: above every `ExtensionHostBoundary`, so it holds the
 * capabilities a host holds and a plug-in subtree is refused.
 *
 * It also renders THREE of `RibbonContext`'s fields as text — the extension, the
 * navigation node and the derived single selection — which is how the cross-pane
 * and handover cases below read the context without reaching into React
 * internals. It is deliberately not all of them: the interface carries five, and
 * `selectedItemIds` and the context-key map are read directly off the store by
 * the cases that care rather than being flattened into this string.
 */
function HostProbe(): ReactElement {
  const activation = useActivation();
  const registry = useRegistry();
  const store = useShellStore();
  const context = useShellContext();
  host.activation = activation;
  host.registry = registry;
  host.store = store;
  host.context = context;
  return (
    <div data-testid="host-context">
      {[context.activeExtensionId, context.activeNavNodeId, context.selectedItemId]
        .map((field) => String(field))
        .join('|')}
    </div>
  );
}

interface HarnessProps {
  readonly blueprints: readonly unknown[];
  readonly engine: HydrationEngine;
  /** Extra HOST-side children, inside both providers and above the shell. */
  readonly extras?: ReactNode;
}

/**
 * The two providers and the shell, in the order `src/App.tsx` composes them.
 *
 * `ShellHostProvider` INSIDE `ExtensionRegistryProvider`, because it resolves
 * blueprints through the registry and watches the registry's revision. The
 * inversion is asserted to throw in "the composition wiring" group below, which is
 * the only place that claim of `App.tsx`'s docblock is actually exercised.
 */
function Harness({ blueprints, engine, extras }: HarnessProps): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <Registrar blueprints={blueprints} />
        <HostProbe />
        {extras}
        <ShellLayout engine={engine} />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Driving it                                                                  */
/* -------------------------------------------------------------------------- */

/** Advance the faked clock inside `act`, so React sees the work it schedules. */
function advance(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

/**
 * Advance the clock AND drain the microtask queue.
 *
 * `MailPlugin`'s body fetch is a `setTimeout` that resolves a promise whose
 * `.then` performs the store write, so the timer alone is not enough: the
 * continuation runs in a microtask after it.
 */
async function advanceAsync(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Click a control by its accessible name. */
function click(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Dispatch one bubbling, cancelable `keydown`, defaulting to the window. */
function press(init: KeyboardEventInit & { readonly key: string }, target: EventTarget = window): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

/**
 * Send a run of keys to one element, the way a focused list receives them.
 *
 * `fireEvent` rather than `user-event` — see the banner. `keyDown` is the only
 * event `VirtualizedList` and the panel library's splitter handler read, and
 * dispatching it directly is what keeps this file off the deadlocking async path.
 */
function pressKeys(target: Element, ...keys: readonly string[]): void {
  for (const key of keys) {
    fireEvent.keyDown(target, { key });
  }
}

/** The `data-panel-size` of every panel currently in the group, as numbers. */
function panelSizes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-panel-size]')).map((element) =>
    Number(element.getAttribute('data-panel-size')),
  );
}

/** A width the shell — and the panel library's hit-testing — can measure. */
function measureAt(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, 800),
  );
}

const ORIGINAL_CLIENT_HEIGHT = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');

/** Give every element a measurable height, which jsdom otherwise refuses to. */
function stubViewportHeight(height: number): void {
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
}

interface ConsoleCapture {
  readonly errors: unknown[][];
  readonly warns: unknown[][];
}

/**
 * Every `console.error` and `console.warn` the shell emits, captured rather than
 * printed.
 *
 * Used in two opposite ways below: to assert that a churn produces NONE, and to
 * keep a deliberately provoked fault's report out of the run's output.
 */
function captureConsole(): ConsoleCapture {
  const errors: unknown[][] = [];
  const warns: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args);
  });
  return { errors, warns };
}

/* -------------------------------------------------------------------------- */
/* Test-authored extensions, for what the remotes deliberately do not do        */
/* -------------------------------------------------------------------------- */

/**
 * Compose a probe INTO an extension's own pane-2 subtree.
 *
 * Three of the known limits below are statements about what one plug-in can do to
 * another from inside its own subtree, and neither shipped mock reaches for any of
 * it — deliberately, because a verification remote that used `useShellStore` or
 * `useRegistry` would stop being evidence about the plug-in contract. The mocks
 * are not editable from a test either, and a test-only back door in one would be
 * the same violation.
 *
 * So the hostile cases register the REAL blueprint, under its real id, with the
 * real pane-2 view mounted and one extra component beside it — "the Mail vendor,
 * plus the one line a hostile version of that vendor would have written". The
 * probe runs inside the same `ExtensionHostBoundary`, holds nothing the host did
 * not publish, and uses only exports a plug-in can import.
 */
function withProbe(
  blueprint: LEAPExtensionBlueprintInput,
  Probe: ComponentType,
): LEAPExtensionBlueprintInput {
  const RealPane2 = blueprint.views.pane2;
  function ProbedPane2(props: ExtensionViewProps): ReactElement {
    return (
      <>
        <RealPane2 {...props} />
        <Probe />
      </>
    );
  }
  return {
    ...blueprint,
    views: { pane2: ProbedPane2, pane3: blueprint.views.pane3 },
  };
}

const BENCH_ROW_HEIGHT = 20;
const BENCH_ROW_COUNT = 400;
const BENCH_ROWS: readonly { readonly id: string; readonly label: string }[] = Array.from(
  { length: BENCH_ROW_COUNT },
  (_unused, index) => ({ id: `bench-${String(index)}`, label: `Bench row ${String(index)}` }),
);

/** Every chord the bench extension's action ran, in order. Reset per case. */
const benchExecutions: string[] = [];

/**
 * Pane 2 for the bench extension: the real `VirtualizedList`, plus a text input.
 *
 * **NEITHER SHIPPED MOCK RENDERS `VirtualizedList`.** `MailPlugin` lists a dozen
 * messages and `DatabasePlugin` maps all 280 records into a plain `<ul>`; the host
 * deliberately does not wrap pane 2 in a windowed list, because it does not know
 * what a row is. So ISSUE-004's virtualizer has, as of this change, no consumer in
 * `src/` at all, and the Definition of Done's keyboard-navigation clause cannot be
 * met through either remote. This extension is the consumer — a third extension,
 * registered through the same public contract, whose pane 2 is the real
 * virtualizer inside the real shell. The gap it stands in for is reported rather
 * than hidden.
 *
 * The `<input>` is here because the hotkey dispatcher's suppression list is only
 * reachable through an editable surface, and neither remote renders one.
 */
function BenchList({ shell }: ExtensionViewProps): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <input aria-label="Bench filter" data-testid="bench-filter" />
      <VirtualizedList
        items={BENCH_ROWS}
        label="Bench rows"
        extensionId="bench"
        rowHeight={BENCH_ROW_HEIGHT}
        rowKey={(item) => item.id}
        onSelect={(index) => {
          const row = BENCH_ROWS[index];
          if (row !== undefined) {
            shell.setSelectedItem(row.id);
          }
        }}
        renderRow={(item) => <span>{item.label}</span>}
      />
    </div>
  );
}

function BenchDetail({ context }: ExtensionViewProps): ReactElement {
  return <p data-testid="bench-detail">{context.selectedItemId ?? 'nothing selected'}</p>;
}

const benchPlugin: LEAPExtensionBlueprintInput = Object.freeze({
  id: 'bench',
  name: 'Bench',
  version: '1.0.0',
  navigationTree: [{ id: 'bench-root', label: 'Bench root' }],
  ribbonActions: [
    {
      id: 'bench-chord',
      label: 'Bench chord',
      icon: 'save',
      hotkey: { key: 'b', ctrl: true, alt: true },
      isVisible: (): boolean => true,
      onExecute: (): void => {
        benchExecutions.push('bench-chord');
      },
    },
  ],
  views: { pane2: BenchList, pane3: BenchDetail },
});

/** What the async-fault extensions handed back for the test to inspect. */
const asyncFault: { rejection: Promise<unknown> | null } = { rejection: null };

function TimerFaultPane(_props: ExtensionViewProps): ReactElement {
  useEffect(() => {
    // Deliberately NOT cleared on unmount: the point of the case is that the
    // callback runs and that its throw lands nowhere React can see.
    setTimeout(() => {
      throw new Error('a plug-in threw from a setTimeout callback');
    }, 5);
  }, []);
  return <p data-testid="timer-fault-pane">the timer-fault pane is mounted</p>;
}

function RejectionFaultPane(_props: ExtensionViewProps): ReactElement {
  useEffect(() => {
    asyncFault.rejection = Promise.reject(new Error('a plug-in rejected a promise'));
  }, []);
  return <p data-testid="rejection-fault-pane">the rejection-fault pane is mounted</p>;
}

function QuietPane(_props: ExtensionViewProps): null {
  return null;
}

function faultBlueprint(id: string, name: string, pane2: ComponentType<ExtensionViewProps>): LEAPExtensionBlueprintInput {
  return Object.freeze({
    id,
    name,
    version: '1.0.0',
    navigationTree: [{ id: 'fault-root', label: 'Fault root' }],
    ribbonActions: [
      {
        id: 'throwing-action',
        label: 'Throwing action',
        icon: 'save',
        isVisible: (): boolean => true,
        onExecute: (): void => {
          throw new Error('a plug-in command threw');
        },
      },
    ],
    views: { pane2, pane3: QuietPane },
  });
}

const timerFaultPlugin = faultBlueprint('timer-fault', 'Timer Fault', TimerFaultPane);
const rejectionFaultPlugin = faultBlueprint(
  'rejection-fault',
  'Rejection Fault',
  RejectionFaultPane,
);

/**
 * A second extension that names a node `inbox` and an action `compose`, exactly
 * as `MailPlugin` does.
 *
 * This is the correct-behaviour half of the badge-scoping pin: two vendors picking
 * the same node id must not overwrite each other. It has to be a third blueprint
 * because both shipped remotes were written to be *different* from one another,
 * and neither reuses the other's ids.
 */
const rivalPlugin: LEAPExtensionBlueprintInput = Object.freeze({
  id: 'rival-mail',
  name: 'Rival Mail',
  version: '1.0.0',
  navigationTree: [{ id: 'inbox', label: 'Inbox' }],
  ribbonActions: [
    {
      id: 'compose',
      label: 'Compose',
      icon: 'add',
      isVisible: (): boolean => true,
      onExecute: (): void => undefined,
    },
  ],
  views: { pane2: QuietPane, pane3: QuietPane },
});

/* -------------------------------------------------------------------------- */
/* Per-case isolation                                                          */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  vi.useFakeTimers();
  // The shell's default engine is a process-wide singleton over this storage.
  // Nothing in this file uses it — every mount is handed an engine of its own over
  // a `Map` — and clearing the entry is belt and braces against a case that ever
  // reaches it by accident.
  globalThis.localStorage.clear();
  injected.engine = null;
  host.activation = null;
  host.registry = null;
  host.store = null;
  host.context = null;
  asyncFault.rejection = null;
  benchExecutions.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_CLIENT_HEIGHT !== undefined) {
    Object.defineProperty(Element.prototype, 'clientHeight', ORIGINAL_CLIENT_HEIGHT);
  }
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1. Registration                                                             */
/* -------------------------------------------------------------------------- */

describe('the two verification remotes, through the public registry contract', () => {
  it('registers both remotes, lists both, and activates each one in turn', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    expect(screen.getByRole('button', { name: 'Mail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inventory Database' })).toBeInTheDocument();

    click('Mail');
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();

    click('Inventory Database');
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh stock' })).toBeInTheDocument();
  });

  it('keeps the two ids apart: the sidebar lists two rows and only one is current', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Mail');
    expect(screen.getByRole('button', { name: 'Mail' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Inventory Database' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(host.context?.activeExtensionId).toBe('mail');
  });

  it('reports a duplicate id as a failure rather than throwing it', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    const registry = host.registry;
    expect(registry).not.toBeNull();
    // A DIFFERENT blueprint under an id that is taken. Re-registering the same
    // object is idempotent by design and would not reach this rejection.
    const impostor = { ...remotes.database, name: 'Impostor Database' };
    let result: ReturnType<ExtensionRegistry['register']> | null = null;
    expect(() => {
      result = registry?.register(impostor) ?? null;
    }).not.toThrow();
    expect(result).not.toBeNull();
    const failure = result as unknown as { ok: boolean; error: ShellUXError };
    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe('DUPLICATE_ID');
    // The victim is untouched: the sidebar still names the real one.
    expect(screen.getByRole('button', { name: 'Inventory Database' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Impostor Database' })).toBeNull();
  });

  it('lets two extensions declare the same command id, because command ids are per-extension', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(
      <Harness blueprints={[remotes.mail, rivalPlugin]} engine={injected.engine} />,
    );

    // Both blueprints declare an action with id `compose`, and both registered.
    click('Mail');
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();
    click('Rival Mail');
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();
    expect(host.registry?.listExtensions().map((entry) => entry.id)).toEqual([
      'mail',
      'rival-mail',
    ]);
  });

  it('keeps the healthy remote fully usable while the other fails during activation', async () => {
    const remotes = await loadRemotes();
    const capture = captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    // A blueprint whose pane-2 view throws the moment the host mounts it, which is
    // the only "fails during activation" a blueprint can express: there is no
    // lifecycle hook to fail in (GitHub issue #17).
    function ExplodingPane(_props: ExtensionViewProps): ReactElement {
      throw new Error('this extension cannot start');
    }
    const broken = faultBlueprint('broken-ext', 'Broken Extension', ExplodingPane);
    render(<Harness blueprints={[broken, remotes.mail]} engine={injected.engine} />);

    click('Broken Extension');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);

    // The healthy one is still completely usable.
    click('Mail');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
    click(/^Drafts/);
    expect(screen.getByText('drafts — 2 messages')).toBeInTheDocument();
    expect(capture.errors.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Extension switching                                                      */
/* -------------------------------------------------------------------------- */

describe('extension switching, with two operational modules', () => {
  it('keeps each module pane-2 selection its own across Mail → Database → Mail', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Mail');
    fireEvent.click(document.querySelector('[data-message-id="msg-1002"]') as Element);
    expect(host.context?.selectedItemId).toBe('msg-1002');
    expect(
      within(screen.getByRole('region', { name: 'Detail' })).getByText(
        'Nightly build 4821 succeeded',
      ),
    ).toBeInTheDocument();

    click('Inventory Database');
    // The host cleared the handover fields, and the database module then restored
    // its OWN remembered selection, which is nothing yet.
    expect(host.context?.selectedItemId).toBeNull();
    expect(screen.getByText('No record selected. Choose one in the list.')).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-record-id="rec-fasteners-003"]') as Element);
    expect(host.context?.selectedItemId).toBe('rec-fasteners-003');

    click('Mail');
    // Mail put ITS selection back on remount; the database's never leaked in.
    expect(host.context?.selectedItemId).toBe('msg-1002');
    expect(
      within(screen.getByRole('region', { name: 'Detail' })).getByText(
        'Nightly build 4821 succeeded',
      ),
    ).toBeInTheDocument();

    click('Inventory Database');
    expect(host.context?.selectedItemId).toBe('rec-fasteners-003');
  });

  it('clears the selected item on a foreground handover, and the incoming context bar shows it', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Mail');
    fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
    // Mail's selection-gated commands are visible, which is the user-visible
    // proof that `selectedItemId` holds one of Mail's ids.
    //
    // Scoped to the context bar BY NAME, because a selection-gated command now
    // appears on two surfaces: the bar and the selection-triggered floating
    // toolbar. An unscoped `getByRole` finds both and fails on the ambiguity,
    // which would be the right failure for the wrong reason — so each surface is
    // asserted where it lives, and the floating toolbar's presence is asserted
    // rather than left as an accident.
    const bar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Shell commands' });
    expect(within(bar()).getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('toolbar', { name: 'Selection commands' })).getByRole('button', {
        name: 'Reply',
      }),
    ).toBeInTheDocument();

    click('Inventory Database');
    // The database module's own predicates never see a mail id, because the host
    // cleared the field rather than because the module defended itself.
    expect(host.context?.selectedItemId).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Reply' })).toBeNull();
    // And the floating toolbar is gone entirely, because nothing is selected.
    expect(screen.queryByRole('toolbar', { name: 'Selection commands' })).toBeNull();
  });

  it('clears the active navigation node on a foreground handover, and the incoming context bar shows it', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Inventory Database');
    click(/^Fasteners/);
    expect(host.context?.activeNavNodeId).toBe('fasteners');
    // `add-record` and `audit-category` are keyed on `activeNavNodeId`.
    expect(screen.getByRole('button', { name: 'Add record' })).toBeInTheDocument();

    click('Mail');
    expect(host.context?.activeNavNodeId).toBeNull();

    click('Inventory Database');
    // Nothing republished the node, so the two nav-keyed actions are gone and the
    // list is back to the whole catalogue.
    expect(host.context?.activeNavNodeId).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add record' })).toBeNull();
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
  });

  it('drives pane 2 from pane 1 through a host field, in both modules', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Mail');
    click(/^Sent/);
    expect(screen.getByText('sent — 2 messages')).toBeInTheDocument();

    click('Inventory Database');
    click(/^Valves/);
    expect(screen.getByText('valves — 40 records')).toBeInTheDocument();
    click(/^Assemblies/);
    expect(screen.getByText('assemblies — 80 records')).toBeInTheDocument();
  });

  it('changes the visible command set from in-module state, through a host field', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    const { container } = render(
      <Harness blueprints={[remotes.mail]} engine={injected.engine} />,
    );
    const contextual = (): string =>
      container.querySelector('[data-command-side="extension"]')?.textContent ?? '';

    click('Mail');
    expect(contextual()).toContain('Compose');
    expect(contextual()).not.toContain('Reply');

    fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
    expect(contextual()).toContain('Reply');
    expect(contextual()).toContain('Forward');
    // Five visible against an inline limit of four, so Delete is in the overflow
    // menu rather than the bar — which is a rendering decision, not a gate.
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The cross-pane loop                                                      */
/* -------------------------------------------------------------------------- */

describe('the write → notify → render loop across two unrelated subtrees', () => {
  it('carries a pane-2 selection into pane 3 through the host store, not through the module', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail]} engine={injected.engine} />);
    click('Mail');

    const detail = screen.getByRole('region', { name: 'Detail' });
    expect(within(detail).getByText('No message selected. Choose one in the list.')).toBeVisible();

    fireEvent.click(document.querySelector('[data-message-id="msg-1004"]') as Element);
    // Pane 2 called `shell.setSelectedItem`, the one host store notified, the
    // shell re-rendered, and pane 3 — a sibling subtree with no provider in
    // common — is showing the message.
    expect(within(detail).getByText('Invoice 20261-B is awaiting approval')).toBeInTheDocument();
    expect(screen.getByTestId('host-context').textContent).toContain('msg-1004');
  });

  it('settles interleaved rapid selections on the last one, in both directions', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail]} engine={injected.engine} />);
    click('Mail');
    const detail = screen.getByRole('region', { name: 'Detail' });

    for (const id of ['msg-1001', 'msg-1006', 'msg-1002', 'msg-1007', 'msg-1003']) {
      fireEvent.click(document.querySelector(`[data-message-id="${id}"]`) as Element);
    }
    expect(host.context?.selectedItemId).toBe('msg-1003');
    expect(within(detail).getByText('Re: pane divider keyboard behaviour')).toBeInTheDocument();
    // Not the intermediate ones. Pane 3 never renders detail for a row a later
    // event has already replaced.
    expect(within(detail).queryByText('Warehouse cutover — revised dates')).toBeNull();
  });

  it('orders the cross-pane activity stream monotonically, module state before host state', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail]} engine={injected.engine} />);
    click('Mail');

    fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
    fireEvent.click(document.querySelector('[data-message-id="msg-1002"]') as Element);

    const activity = document.querySelector('[data-mail-activity]') as HTMLElement;
    const entries = Array.from(activity.querySelectorAll('li')).map(
      (item) => item.textContent ?? '',
    );
    const sequences = entries.map((entry) => Number(entry.split('.')[0]));
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(entries.some((entry) => entry.includes('selected msg-1001'))).toBe(true);
    expect(entries.some((entry) => entry.includes('selected msg-1002'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Badges at runtime                                                        */
/* -------------------------------------------------------------------------- */

describe('navigation badges, written at runtime by an operational module', () => {
  it('moves the Inbox badge when the module marks a message read', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail]} engine={injected.engine} />);
    click('Mail');

    // Eight inbox messages, three seeded as read.
    expect(screen.getByRole('button', { name: 'Inbox badge 5' })).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
    fireEvent.click(document.querySelector('[data-mail-action="mark-read"]') as Element);

    expect(screen.getByRole('button', { name: 'Inbox badge 4' })).toBeInTheDocument();
  });

  it('shows a runtime badge in the collapsed 48px icon track as well', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    const { container } = render(
      <Harness blueprints={[remotes.mail]} engine={injected.engine} />,
    );
    click('Mail');
    fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
    fireEvent.click(document.querySelector('[data-mail-action="mark-read"]') as Element);

    click('Collapse navigation');
    // Wave 3, W3-3: `TOKEN_CLASS.railWidth` (`--rail-w`), not an inline style;
    // jsdom does not compute custom properties, so the class is what a jsdom
    // case can assert — `e2e/shell-layout.spec.ts` still measures the box.
    expect(
      (container.querySelector('[data-shell-region="nav-track"]') as HTMLElement).className,
    ).toContain(TOKEN_CLASS.railWidth);
    expect(screen.getByRole('button', { name: 'Inbox badge 4' })).toBeInTheDocument();
  });

  it('shows a badge written while the extension was NOT in the foreground, on re-activation', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    // Activate the database once so the host mints its handle, then take the
    // foreground away. `blur` and a handover revoke nothing, so the handle stays
    // live and its writes keep landing.
    click('Inventory Database');
    const handle = host.activation?.getActive()?.shell as IShellAPI;
    expect(handle).toBeDefined();
    click('Mail');
    expect(host.context?.activeExtensionId).toBe('mail');

    act(() => {
      // A LEAF node, deliberately. The module republishes its three TOP-LEVEL
      // badges from its pane-2 mount effect, so a write to one of those would be
      // overwritten by the module itself the moment it came back to the
      // foreground — which is correct behaviour and would make this case assert
      // the wrong thing. Leaf badges are the blueprint's and are never rewritten.
      handle.setBadgeCount('sensors', 41);
    });
    // Nothing on screen shows it yet: the sidebar draws the FOREGROUND extension's
    // tree, and that is Mail's.
    expect(screen.queryByRole('button', { name: 'Sensors badge 41' })).toBeNull();

    click('Inventory Database');
    expect(screen.getByRole('button', { name: 'Sensors badge 41' })).toBeInTheDocument();
  });

  /**
   * WHY THE NUMBERS BELOW ARE EXACT, AND WHY THAT IS THE ONLY HONEST SHAPE.
   *
   * The badge is `lowStockCount`, and the only thing that moves it here is the
   * module's own 200ms interval: no click, no keystroke, no host call happens
   * between the two reads. So a shape-only assertion — "it is still some number"
   * — is true whether the interval fires or not, and an earlier version of this
   * case asserted exactly that and survived having the interval body emptied.
   *
   * `tickStock` is deterministic ON PURPOSE and says so in its own docblock: the
   * records that move are chosen by a rotating cursor and their deltas come from
   * the seeded `nextRandom`, never from `Math.random`. Combined with
   * `loadRemotes()`'s `vi.resetModules()`, which hands this case a pristine
   * catalogue, the whole trajectory is fixed and can be named rather than
   * described.
   *
   * **The direction is NOT a law, and is not asserted as one.** The measured
   * Components trajectory over the first forty ticks is 35 → 34 (tick 3) → 33
   * (tick 13) → back to 34 (tick 17), where it stays: a random walk with a
   * reflecting floor at zero stock, not a drift. What is guaranteed is that the
   * timer moves the count and that it moves it to a specific place, so the
   * assertions name the specific place and the direction of that one step.
   */
  it('drives the badges from the module timer, without the user doing anything', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.database]} engine={injected.engine} />);
    click('Inventory Database');

    /** The number inside a top-level badge, read off the rendered button. */
    const badgeOf = (label: string): number => {
      const button = screen.getByRole('button', { name: new RegExp(`^${label} badge `) });
      const digits = /badge (\d+)$/.exec(button.textContent ?? '');
      if (digits === null) {
        throw new Error(`${label} rendered no badge: ${String(button.textContent)}`);
      }
      return Number(digits[0].slice('badge '.length));
    };

    // Read BEFORE the clock moves. `publishBadges` already ran once from the
    // pane-2 mount effect, so these are the opening low-stock counts.
    const opening = badgeOf('Components');
    const openingAssemblies = badgeOf('Assemblies');
    const openingConsumables = badgeOf('Consumables');
    expect(opening).toBe(35);
    expect(openingAssemblies).toBe(19);
    expect(openingConsumables).toBe(21);

    // Twelve ticks of the 200ms stock ticker, all inside `act`. Nothing else is
    // touched between here and the next read.
    advance(12 * 200);

    // THE ASSERTION THIS CASE IS NAMED FOR: the count moved, and it moved to
    // where the interval puts it. One component record climbed back above its
    // reorder level, so the low-stock count fell by exactly one.
    const afterTwelve = badgeOf('Components');
    expect(afterTwelve).toBe(34);
    expect(afterTwelve).toBeLessThan(opening);

    // Twenty-eight more ticks, and a SECOND category moves — so the case does not
    // rest on one record crossing one threshold.
    advance(28 * 200);
    const afterForty = badgeOf('Assemblies');
    expect(afterForty).toBe(17);
    expect(afterForty).toBeLessThan(openingAssemblies);

    // And the third is untouched across all forty ticks, which is the other half
    // of `publishBadges`: it republishes only what moved.
    expect(badgeOf('Consumables')).toBe(openingConsumables);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Keyboard navigation through the real virtualizer                         */
/* -------------------------------------------------------------------------- */

describe('keyboard navigation in pane 2, through the real virtualizer', () => {
  /** Mount the bench extension with a measurable pane and no `ResizeObserver`. */
  function mountBench(viewportHeight = 100): void {
    // Asserted rather than assumed: the fallback branch below is only the branch
    // under test while this holds, and `src/test/setup.ts` deliberately installs
    // no global stub for it.
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe('undefined');
    expect(typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver).toBe(
      'undefined',
    );
    stubViewportHeight(viewportHeight);
    measureAt(1000);
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[benchPlugin]} engine={injected.engine} />);
    click('Bench');
  }

  function listbox(): HTMLElement {
    return screen.getByRole('listbox', { name: 'Bench rows' });
  }

  function activeRowIndex(): number {
    const id = listbox().getAttribute('aria-activedescendant');
    return Number((id ?? '').replace(/^.*-row-/, ''));
  }

  function mountedIndices(): number[] {
    return screen
      .queryAllByRole('option')
      .map((option) => Number(option.getAttribute('data-row-index')));
  }

  it('moves the pane-2 selection with the arrow keys, and the selection reaches pane 3', async () => {
    mountBench();
    act(() => {
      listbox().focus();
    });
    expect(listbox()).toHaveFocus();

    pressKeys(listbox(), 'ArrowDown', 'ArrowDown', 'ArrowDown');
    expect(activeRowIndex()).toBe(3);
    // The full loop: the list's `onSelect` wrote through `IShellAPI`, the host
    // store notified, and pane 3 — an unrelated subtree — re-rendered.
    expect(screen.getByTestId('bench-detail')).toHaveTextContent('bench-3');

    pressKeys(listbox(), 'ArrowUp');
    expect(activeRowIndex()).toBe(2);
    expect(screen.getByTestId('bench-detail')).toHaveTextContent('bench-2');
  });

  it('moves to the first and last rows with Home and End', async () => {
    mountBench();
    act(() => {
      listbox().focus();
    });

    pressKeys(listbox(), 'End');
    expect(activeRowIndex()).toBe(BENCH_ROW_COUNT - 1);
    expect(screen.getByTestId('bench-detail')).toHaveTextContent(
      `bench-${String(BENCH_ROW_COUNT - 1)}`,
    );

    pressKeys(listbox(), 'Home');
    expect(activeRowIndex()).toBe(0);
    expect(screen.getByTestId('bench-detail')).toHaveTextContent('bench-0');
  });

  it('moves a viewport at a time with PageDown and PageUp', async () => {
    // 100px of viewport over 20px rows is five whole rows to a page.
    mountBench(100);
    act(() => {
      listbox().focus();
    });

    pressKeys(listbox(), 'PageDown');
    expect(activeRowIndex()).toBe(5);
    pressKeys(listbox(), 'PageDown');
    expect(activeRowIndex()).toBe(10);
    pressKeys(listbox(), 'PageUp');
    expect(activeRowIndex()).toBe(5);
  });

  it('asks for the selected row to be scrolled into view by assigning scrollTop, which is what jsdom can observe', async () => {
    // `Element.prototype.scrollIntoView` does not exist in jsdom, and the
    // virtualizer deliberately does not call it — it scrolls exactly one box by
    // assigning `scrollTop`. So the Definition of Done's "scrolled into view" is
    // asserted as the assignment that implements it.
    expect(
      (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView,
    ).toBeUndefined();
    mountBench(100);
    act(() => {
      listbox().focus();
    });
    expect(listbox().scrollTop).toBe(0);

    pressKeys(listbox(), 'End');
    // Row 399 sits at 7980px, is 20px tall, and the viewport is 100px: the bottom
    // of the row minus the viewport is 7900.
    expect(listbox().scrollTop).toBe(BENCH_ROW_COUNT * BENCH_ROW_HEIGHT - 100);

    pressKeys(listbox(), 'Home');
    expect(listbox().scrollTop).toBe(0);
  });

  it('keeps the single tab stop on the container while the selection moves, so focus stays visible', async () => {
    mountBench();
    act(() => {
      listbox().focus();
    });
    pressKeys(listbox(), 'ArrowDown', 'ArrowDown');
    // Focus never moves onto a row, because a virtualizer recycles row elements
    // and roving focus would drop to `<body>` when the focused row unmounted.
    expect(listbox()).toHaveFocus();
    expect(listbox()).toHaveAttribute('tabindex', '0');
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
  });

  it('windows the list rather than mounting every row, and re-windows on the next interaction', async () => {
    mountBench(100);
    // 100px of viewport over 20px rows is six rows including the partial one at
    // the bottom edge, plus four rows of overscan at each end.
    expect(mountedIndices()).toHaveLength(14);
    expect(mountedIndices()[0]).toBe(0);
    expect(BENCH_ROW_COUNT).toBe(400);

    // The pane grows. With no `ResizeObserver` in the environment the list is not
    // told, and re-measures on the next render it performs for any reason — which
    // is the documented fallback, driven here on purpose.
    stubViewportHeight(300);
    act(() => {
      listbox().focus();
    });
    pressKeys(listbox(), 'ArrowDown');
    expect(mountedIndices()).toHaveLength(24);
  });

  it('does not fire a chord while focus is in the extension own text input', async () => {
    mountBench();
    const input = screen.getByTestId('bench-filter');
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'bench' } });
    expect(input).toHaveValue('bench');
    expect(document.activeElement).toBe(input);

    // The chord, dispatched from inside the input. The dispatcher's suppression
    // list recognises an `input` element and never reaches the action.
    press({ key: 'b', ctrlKey: true, altKey: true }, input);
    expect(benchExecutions).toEqual([]);

    // The same chord from outside the editable surface does fire, so the case
    // above is a suppression rather than a chord that never worked.
    press({ key: 'b', ctrlKey: true, altKey: true });
    expect(benchExecutions).toEqual(['bench-chord']);
  });

  it('leaves an unhandled key to the page rather than swallowing it in the list', async () => {
    mountBench();
    act(() => {
      listbox().focus();
    });
    pressKeys(listbox(), 'ArrowDown');
    expect(activeRowIndex()).toBe(1);

    // A chord dispatched at the list is not a list key, so the list returns
    // without preventing it and the shell dispatcher runs it.
    press({ key: 'b', ctrlKey: true, altKey: true }, listbox());
    expect(benchExecutions).toEqual(['bench-chord']);
    expect(activeRowIndex()).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Hotkey chords end to end                                                 */
/* -------------------------------------------------------------------------- */

describe('hotkey chords, through the assembled shell', () => {
  it('fires a foreground chord end to end, and the module state and the sidebar both move', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);
    click('Mail');
    expect(screen.getByRole('button', { name: 'Drafts badge 2' })).toBeInTheDocument();

    // Ctrl+Shift+N is `MailPlugin`'s Compose. It composes a draft, selects it, and
    // republishes the drafts badge — three effects of one keystroke, none of them
    // routed by this test.
    press({ key: 'N', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: 'Drafts badge 3' })).toBeInTheDocument();
    expect(host.context?.selectedItemId).toBe('msg-9101');
    expect(
      within(screen.getByRole('region', { name: 'Detail' })).getByText('Untitled draft 1'),
    ).toBeInTheDocument();
  });

  it('does not fire a background extension chord while another extension is in front', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);
    click('Inventory Database');

    // Mail's Compose chord, with the database in the foreground.
    press({ key: 'N', ctrlKey: true, shiftKey: true });
    click('Mail');
    // Nothing was composed while Mail was in the background.
    expect(screen.getByRole('button', { name: 'Drafts badge 2' })).toBeInTheDocument();
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
  });

  it('fires the database low-stock chord, which changes what pane 2 renders', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);
    click('Inventory Database');
    click(/^Valves/);
    expect(screen.getByText('valves — 40 records')).toBeInTheDocument();

    press({ key: 'L', ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/^valves — \d+ records — low stock only$/)).toBeInTheDocument();
  });

  it('refuses a chord whose action its own predicate is hiding', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.database]} engine={injected.engine} />);
    click('Inventory Database');
    // `audit-category` binds F9 and is visible only with one of its own nav nodes
    // selected. With nothing selected the chord reaches no handler at all.
    expect(screen.queryByRole('button', { name: 'Audit category' })).toBeNull();
    const before = screen.getByRole('button', { name: /^Components badge / }).textContent;
    press({ key: 'F9' });
    expect(screen.getByRole('button', { name: /^Components badge / }).textContent).toBe(before);

    click(/^Fasteners/);
    expect(screen.getByRole('button', { name: 'Audit category' })).toBeInTheDocument();
    press({ key: 'F9' });
    // The audit is a forced recount and is observable as the badge still standing
    // rather than disappearing — the point is that the handler ran at all.
    expect(screen.getByRole('button', { name: /^Components badge / })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Layout seams                                                             */
/* -------------------------------------------------------------------------- */

describe('the layout seams, with plug-in content really mounted in the panes', () => {
  it('clamps a restored-but-illegal pane size into the pane band before the panel group sees it', async () => {
    const remotes = await loadRemotes();
    measureAt(1000);
    const capture = captureConsole();
    // 89 / 3 / 8 is inside the ENGINE band of [2, 90], so the record is restored
    // rather than discarded — and it is outside the PANE band at this width, where
    // pane 1 may be 17.6%–40% and pane 2 24%–64%. This is the seam between
    // ISSUE-003's storage validation and ISSUE-002's live clamp.
    const storage = memoryStorage(record({ paneSizes: { pane1: 89, pane2: 3, pane3: 8 } }));
    injected.engine = createHydrationEngine({ storage: storage.storage });
    const { container } = render(
      <Harness blueprints={[remotes.mail]} engine={injected.engine} />,
    );
    click('Mail');

    expect(panelSizes(container)).toEqual([40, 24, 36]);
    for (const separator of screen.getAllByRole('separator')) {
      const now = Number(separator.getAttribute('aria-valuenow'));
      expect(now).toBeGreaterThanOrEqual(Number(separator.getAttribute('aria-valuemin')));
      expect(now).toBeLessThanOrEqual(Number(separator.getAttribute('aria-valuemax')));
    }
    // The library warns on every render when a layout does not add up. It did not.
    expect(capture.warns).toEqual([]);
  });

  it('resizes a pane through the library own window-splitter keyboard path, against geometry this file supplied', async () => {
    const remotes = await loadRemotes();
    // jsdom computes no layout, so the library's arithmetic is being run against
    // `new DOMRect(0, 0, 1000, 800)` from this file rather than against a real
    // box. What is exercised is `react-resizable-panels`' own splitter handling
    // over a supplied geometry, with a real plug-in mounted inside the panes.
    measureAt(1000);
    injected.engine = createHydrationEngine({ storage: null });
    const { container } = render(
      <Harness blueprints={[remotes.mail]} engine={injected.engine} />,
    );
    click('Mail');
    const before = panelSizes(container);
    // 240px of a measured 1000px group is the pixel intent in `PANE_PX`.
    expect(before[0]).toBe(24);

    const [handle] = screen.getAllByRole('separator');
    act(() => {
      (handle as HTMLElement).focus();
    });
    fireEvent.keyDown(handle as Element, { key: 'ArrowRight' });

    const after = panelSizes(container);
    expect(after[0]).toBeGreaterThan(before[0] as number);
    expect(after.reduce((total, size) => total + size, 0)).toBeCloseTo(100, 1);
    // The plug-in is still mounted and still working underneath the resize.
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
  });

  it('cannot be driven by a POINTER drag at all, because this jsdom implements no PointerEvent', async () => {
    // Stated in the test name rather than faked. `fireEvent.pointerMove` falls
    // back to a plain `Event` when `window.PointerEvent` is missing, and a plain
    // `Event` carries no `clientX` — so the library is never handed a coordinate
    // and its delta arithmetic never runs. A test that dispatched the sequence and
    // then asserted a moved pane would be asserting against a no-op; this asserts
    // the no-op instead, and the keyboard case above is what really covers resize.
    const remotes = await loadRemotes();
    measureAt(1000);
    expect((globalThis as { PointerEvent?: unknown }).PointerEvent).toBeUndefined();
    injected.engine = createHydrationEngine({ storage: null });
    const { container } = render(
      <Harness blueprints={[remotes.mail]} engine={injected.engine} />,
    );
    click('Mail');
    const before = panelSizes(container);

    const [handle] = screen.getAllByRole('separator');
    act(() => {
      fireEvent.pointerDown(handle as Element, { pointerId: 1, clientX: 240, clientY: 400 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 400, clientY: 400, buttons: 1 });
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 400, clientY: 400 });
    });

    expect(panelSizes(container)).toEqual(before);
    // The shell is unharmed by the sequence, which is the half that does mean
    // something: an abandoned gesture leaves no half-applied layout behind.
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
    expect(panelSizes(container).reduce((total, size) => total + size, 0)).toBeCloseTo(100, 1);
  });

  it('keeps the context bar interactive beside a pane that has failed, and recovers the pane', async () => {
    const remotes = await loadRemotes();
    captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.database]} engine={injected.engine} />);
    click('Inventory Database');
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();

    // Armed through the context bar, exactly as a user would. With no pane-1 node
    // selected this action is inline rather than in the overflow menu.
    click('Arm record fault');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The list view could not be displayed.');
    expect(within(alert).getByText('inventory-db')).toBeInTheDocument();

    // The context bar beside the failed pane is still a working control surface, and
    // pane 3 is still rendering.
    expect(screen.getByRole('button', { name: 'Clear record fault' })).toBeInTheDocument();
    expect(screen.getByText('No record selected. Choose one in the list.')).toBeInTheDocument();
    click('Clear record fault');
    click('Retry');
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('clears a pane fault surface when the foreground moves to the other remote', async () => {
    const remotes = await loadRemotes();
    captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);
    click('Inventory Database');
    click('Arm record fault');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    click('Mail');
    // A stale error surface must not stand over a fresh extension's view.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
  });

  it('contains a throwing command inside the shared command guard, without taking the shell down', async () => {
    const capture = captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[timerFaultPlugin]} engine={injected.engine} />);
    click('Timer Fault');

    expect(() => {
      click('Throwing action');
    }).not.toThrow();
    // Reported, contained, and the shell is still standing.
    expect(capture.errors.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByTestId('timer-fault-pane')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Persistence across a simulated reload                                    */
/* -------------------------------------------------------------------------- */

describe('persistence across a simulated reload', () => {
  it('brings back the layout and the foreground extension over the same storage', async () => {
    const remotes = await loadRemotes();
    measureAt(1000);
    const storage = memoryStorage();

    const first = createHydrationEngine({ storage: storage.storage });
    injected.engine = first;
    const initial = render(
      <Harness blueprints={[remotes.mail, remotes.database]} engine={first} />,
    );
    click('Inventory Database');
    const [handle] = screen.getAllByRole('separator');
    act(() => {
      (handle as HTMLElement).focus();
    });
    fireEvent.keyDown(handle as Element, { key: 'ArrowLeft' });
    const arranged = panelSizes(initial.container);
    expect(arranged[0]).toBeLessThan(24);
    // The engine coalesces; flush the window rather than guessing at it.
    act(() => {
      first.flush();
    });
    expect(storage.raw()).not.toBeNull();

    // The reload: this tree goes away entirely, and a NEW engine hydrates from the
    // same storage in its constructor.
    initial.unmount();
    const second = createHydrationEngine({ storage: storage.storage });
    injected.engine = second;
    const reloaded = render(
      <Harness blueprints={[remotes.mail, remotes.database]} engine={second} />,
    );

    expect(panelSizes(reloaded.container)).toEqual(arranged);
    expect(screen.getByRole('button', { name: 'Inventory Database' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
  });

  it('persists the collapsed pane 1 and reopens collapsed, with a plug-in mounted', async () => {
    const remotes = await loadRemotes();
    measureAt(1000);
    const storage = memoryStorage();

    const first = createHydrationEngine({ storage: storage.storage });
    injected.engine = first;
    const initial = render(<Harness blueprints={[remotes.mail]} engine={first} />);
    click('Mail');
    click('Collapse navigation');
    act(() => {
      first.flush();
    });
    initial.unmount();

    const second = createHydrationEngine({ storage: storage.storage });
    injected.engine = second;
    const reloaded = render(<Harness blueprints={[remotes.mail]} engine={second} />);
    expect(
      (reloaded.container.querySelector('[data-shell-region="nav-track"]') as HTMLElement)
        .className,
    ).toContain(TOKEN_CLASS.railWidth);
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
  });

  it('does not persist the selected item or the selected navigation node', async () => {
    const remotes = await loadRemotes();
    measureAt(1000);
    const storage = memoryStorage();

    const first = createHydrationEngine({ storage: storage.storage });
    injected.engine = first;
    const initial = render(<Harness blueprints={[remotes.mail]} engine={first} />);
    click('Mail');
    click(/^Sent/);
    fireEvent.click(document.querySelector('[data-message-id="msg-3001"]') as Element);
    act(() => {
      first.flush();
    });
    const raw = storage.raw() ?? '';
    expect(raw).not.toContain('msg-3001');
    expect(raw).not.toContain('activeNavNodeId');
    initial.unmount();

    const second = createHydrationEngine({ storage: storage.storage });
    injected.engine = second;
    render(<Harness blueprints={[remotes.mail]} engine={second} />);
    // The foreground came back; the per-extension context deliberately did not.
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
    expect(host.context?.activeNavNodeId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Churn and cleanup                                                        */
/* -------------------------------------------------------------------------- */

describe('mount and unmount churn, with cleanup accounted for', () => {
  it('releases the database module 200ms interval, so the timer count returns to its baseline', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    const baseline = vi.getTimerCount();

    const mounted = render(<Harness blueprints={[remotes.database]} engine={injected.engine} />);
    click('Inventory Database');
    // The module owns exactly one interval, and it is running.
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    advance(400);

    mounted.unmount();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('does not accumulate timers or window listeners over repeated mount and unmount cycles', async () => {
    const remotes = await loadRemotes();
    // The store is `Object.freeze`d, so it cannot be spied on. Listener accounting
    // is done where it can be: `window`, which is where the shell's one keyboard
    // listener goes, counted by registration rather than by reaching inside.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const baseline = vi.getTimerCount();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      injected.engine = createHydrationEngine({ storage: null });
      const mounted = render(
        <Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />,
      );
      click('Inventory Database');
      advance(200);
      click('Mail');
      fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
      mounted.unmount();
      expect(vi.getTimerCount(), `timers after cycle ${String(cycle)}`).toBe(baseline);
    }

    const keydownAdds = added.mock.calls.filter((call) => call[0] === 'keydown').length;
    const keydownRemoves = removed.mock.calls.filter((call) => call[0] === 'keydown').length;
    expect(keydownAdds).toBe(5);
    expect(keydownRemoves).toBe(5);
  });

  it('emits no console error or warning while extensions are switched faster than a fetch settles', async () => {
    const remotes = await loadRemotes();
    const capture = captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    // The Definition of Done asks for "no update-after-unmount warning". React 18
    // REMOVED that warning and this project is on `react@^18.3.1`, so asserting its
    // absence would pass whatever the shell did. What is asserted instead is the
    // observable thing: nothing at all is reported, over a churn tight enough that
    // the mail body fetch is always in flight when its module is unmounted.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      click('Mail');
      fireEvent.click(document.querySelector('[data-message-id="msg-1001"]') as Element);
      await advanceAsync(40);
      click('Inventory Database');
      await advanceAsync(40);
    }
    await advanceAsync(500);

    expect(capture.errors).toEqual([]);
    expect(capture.warns).toEqual([]);
  });

  it('lets an unmounted module resolving fetch write nothing, into its own store or the live one', async () => {
    const remotes = await loadRemotes();
    const capture = captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Mail');
    fireEvent.click(document.querySelector('[data-message-id="msg-1005"]') as Element);
    // 40ms into a 120ms fetch, the module is unmounted by the switch.
    await advanceAsync(40);
    click('Inventory Database');
    await advanceAsync(400);

    // Nothing of Mail's reached the live module.
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('fetched asynchronously by the extension');

    // And nothing reached Mail's own store either: coming back starts a FRESH
    // fetch, which is only true if the aborted one recorded no body.
    click('Mail');
    const detail = screen.getByRole('region', { name: 'Detail' });
    expect(within(detail).getByText('Fetching body…')).toBeInTheDocument();
    await advanceAsync(200);
    expect(
      within(detail).getByText(/fetched asynchronously by the extension/),
    ).toBeInTheDocument();
    expect(capture.errors).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Composition wiring                                                      */
/* -------------------------------------------------------------------------- */

describe('the composition wiring App.tsx performs', () => {
  it('brings both remotes up under the provider order App.tsx composes', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    // `Harness` is `App`'s composition with somewhere to register: the registry
    // provider outermost, the host provider inside it, the shell inside that.
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
    click('Mail');
    expect(screen.getByText('inbox — 8 messages')).toBeInTheDocument();
  });

  it('throws the message App.tsx documents when the two providers are inverted', () => {
    // `App.tsx`'s docblock says inverting them throws
    // "useRegistry must be called inside an <ExtensionRegistryProvider>" at mount.
    // Nothing asserted that until now: `src/App.tsx` is not in the coverage include
    // list, and no test had ever built the inverted tree.
    captureConsole();
    const engine = createHydrationEngine({ storage: null });
    expect(() =>
      render(
        <ShellHostProvider>
          <ExtensionRegistryProvider>
            <ShellLayout engine={engine} />
          </ExtensionRegistryProvider>
        </ShellHostProvider>,
      ),
    ).toThrow('useRegistry must be called inside an <ExtensionRegistryProvider>');
  });
});

/* -------------------------------------------------------------------------- */
/* 11. Untrusted content at the verification-remote render sites               */
/* -------------------------------------------------------------------------- */

const MOCKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'mocks');

/** Every identifier, string literal and template chunk in a module's CODE. */
function codeWords(path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const words: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      words.push(node.text);
    }
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      words.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return words;
}

describe('untrusted content at the two verification-remote render sites', () => {
  it.each(['MailPlugin.tsx', 'DatabasePlugin.tsx'])(
    'the %s source contains no HTML-injection sink at all',
    (file) => {
      const sinks = codeWords(join(MOCKS_DIR, file)).filter((word) =>
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
          word,
        ),
      );
      expect(sinks).toEqual([]);
    },
  );

  it.each(['MailPlugin.tsx', 'DatabasePlugin.tsx'])(
    'the %s source names no URL-bearing attribute a plug-in value could reach',
    (file) => {
      const urlAttributes = codeWords(join(MOCKS_DIR, file)).filter((word) =>
        /^(?:href|xlinkHref|src|srcSet|formAction|poster)$/.test(word),
      );
      expect(urlAttributes).toEqual([]);
    },
  );

  it('reports a planted sink, so the two scans above cannot pass vacuously', () => {
    const planted = ts.createSourceFile(
      'planted.tsx',
      'export const Bad = () => <a href={url} dangerouslySetInnerHTML={{ __html: row }} />;\n',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && /dangerouslySetInnerHTML|^href$/.test(node.text)) {
        found.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(planted);
    expect(found).toEqual(expect.arrayContaining(['dangerouslySetInnerHTML', 'href']));
  });

  it('renders a markup-shaped extension string as a text node in the mounted shell', async () => {
    injected.engine = createHydrationEngine({ storage: null });
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const markupPlugin: LEAPExtensionBlueprintInput = Object.freeze({
      id: 'markup-ext',
      name: hostile,
      version: '1.0.0',
      navigationTree: [{ id: 'markup-node', label: hostile }],
      ribbonActions: [
        {
          id: 'markup-action',
          label: hostile,
          icon: 'save',
          isVisible: (): boolean => true,
          onExecute: (): void => undefined,
        },
      ],
      views: { pane2: QuietPane, pane3: QuietPane },
    });
    const { container } = render(
      <Harness blueprints={[markupPlugin]} engine={injected.engine} />,
    );
    click(hostile);

    // No element was created from it anywhere in the tree.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(document.querySelectorAll('script')).toHaveLength(0);
    // It is on screen, as a text node, in the sidebar and in the context bar alike.
    expect(screen.getAllByText(hostile).length).toBeGreaterThan(0);
    for (const node of screen.getAllByText(hostile)) {
      expect(node.childElementCount).toBe(0);
      expect(node.textContent).toBe(hostile);
    }
    // The string DOES appear inside `title="..."` in the serialised HTML, and an
    // attribute value is not markup: nothing parses it, and the assertions above
    // are what say so. Asserting `innerHTML` has no `<img` in it would fail here
    // for a reason that has nothing to do with injection.
    expect(container.innerHTML).toContain('title=');
  });
});

/* -------------------------------------------------------------------------- */
/* 12. The known limits, pinned                                                */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * EVERY CASE BELOW ASSERTS CURRENT BEHAVIOUR. NONE OF THEM IS A SAFETY CLAIM.
 * ============================================================================
 * A characterisation test says "this is what the code does today", and its whole
 * value is that changing the behaviour breaks it on purpose rather than by
 * accident. Read every `expect` below as a description, never as a guarantee: each
 * one describes something the architecture has ACCEPTED, and several of them
 * describe something a reader might otherwise assume is prevented.
 *
 * Where an open GitHub issue proposes changing the behaviour it is named. Where
 * none is filed that is said outright rather than left to be inferred: ADR-0001's
 * "No sandbox" and Amendment E record most of these as accepted properties of a
 * single-origin, same-page shell, and an ownership or capability model is
 * explicitly deferred to its own issue by the `unregister` docblock in
 * `RegistryContext.tsx`.
 * ============================================================================
 */

/** Writes a badge into a scope that is not its own, using only public exports. */
function ForeignBadgeProbe(): ReactElement {
  const store = useShellStore();
  return (
    <button
      type="button"
      onClick={() => {
        // A LEAF node of the sibling's tree. The sibling republishes its three
        // TOP-LEVEL badges from its own pane-2 mount effect, so a foreign write to
        // one of those is overwritten by the victim itself a moment later — which
        // would make this case pass or fail on the victim's timing rather than on
        // the property being pinned.
        store.setBadgeCount('inventory-db', 'sensors', 777);
      }}
    >
      write a badge into the sibling scope
    </button>
  );
}

/** Reads and overwrites another extension persisted scope. */
function ForeignScopeProbe({ owner }: { readonly owner: string }): ReactElement {
  const [scope, setScope] = useExtensionUiState('inventory-db', { engine: requireEngine() });
  const seen = scope['owner'];
  return (
    <div>
      <span data-testid={`scope-seen-by-${owner}`}>
        {typeof seen === 'string' ? seen : 'nothing stored'}
      </span>
      <button
        type="button"
        onClick={() => {
          setScope({ owner, lastCategory: 'valves' });
        }}
      >
        {`write the inventory-db scope as ${owner}`}
      </button>
    </div>
  );
}

/** Mutates a sibling view component obtained from the public registry. */
function SiblingViewProbe(): ReactElement {
  const registry = useRegistry();
  return (
    <button
      type="button"
      onClick={() => {
        const sibling = registry.getExtension('inventory-db');
        const view = sibling?.views.pane3 as unknown as {
          prototype: Record<string, unknown>;
        };
        // The registry's RECORD is deep-frozen and host-owned. The plug-in
        // FUNCTION inside it is the plug-in's, and is not frozen — so its
        // `prototype` takes a property, and React reads that property to decide
        // how to call the component.
        view.prototype['isReactComponent'] = {};
      }}
    >
      mutate the sibling view component
    </button>
  );
}

/** Unregisters a sibling, from inside a plug-in subtree, on a delay. */
function SiblingUnregisterProbe(): ReactElement {
  const registry = useRegistry();
  return (
    <button
      type="button"
      onClick={() => {
        // Deferred so the removal lands while the VICTIM is in the foreground and
        // this subtree is long gone. The reference survives its own unmount, which
        // is half of what makes the absence of an authorisation model reachable.
        setTimeout(() => {
          registry.unregister('inventory-db');
        }, 1);
      }}
    >
      arm the removal of the sibling extension
    </button>
  );
}

describe('known limits of the assembled shell, pinned', () => {
  it('PINS A KNOWN LIMIT — badge scoping is collision-resistance, not confinement: a plug-in writes into a sibling scope and the sibling sidebar renders it (no issue filed; ADR-0001 Amendment E records it as accepted)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. `IShellAPI.setBadgeCount`
    // offers no parameter through which to aim at another extension, and that is
    // real — but `useShellStore()` is public, works inside a plug-in subtree, and
    // its `setBadgeCount` takes the scope as an argument.
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(
      <Harness
        blueprints={[withProbe(remotes.mail, ForeignBadgeProbe), remotes.database]}
        engine={injected.engine}
      />,
    );

    click('Mail');
    click('write a badge into the sibling scope');
    click('Inventory Database');
    expect(screen.getByRole('button', { name: 'Sensors badge 777' })).toBeInTheDocument();
  });

  it('two extensions that both name a node inbox do not collide, which is the property the scope really has', async () => {
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, rivalPlugin]} engine={injected.engine} />);

    click('Mail');
    // Mail's own inbox badge, five unread, written into Mail's scope.
    expect(screen.getByRole('button', { name: 'Inbox badge 5' })).toBeInTheDocument();
    const store = host.store;
    expect(store).not.toBeNull();
    act(() => {
      store?.setBadgeCount('rival-mail', 'inbox', 12);
    });
    // Mail's is untouched by a write to a different extension's node of the same
    // name — two vendors picking `inbox` do not overwrite each other.
    expect(screen.getByRole('button', { name: 'Inbox badge 5' })).toBeInTheDocument();

    click('Rival Mail');
    expect(screen.getByRole('button', { name: 'Inbox badge 12' })).toBeInTheDocument();
  });

  it('PINS A KNOWN LIMIT — persisted-state namespacing is collision-resistance too: one extension reads and overwrites another persisted scope through the public HydrationEngine (no issue filed; the engine banner records it as accepted, and GitHub issue #4 covers only documenting it)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM.
    const remotes = await loadRemotes();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    injected.engine = engine;
    render(
      <Harness
        blueprints={[
          withProbe(remotes.mail, () => <ForeignScopeProbe owner="mail" />),
          withProbe(remotes.database, () => <ForeignScopeProbe owner="inventory-db" />),
        ]}
        engine={engine}
      />,
    );

    click('Inventory Database');
    expect(screen.getByTestId('scope-seen-by-inventory-db')).toHaveTextContent('nothing stored');
    click('write the inventory-db scope as inventory-db');
    expect(screen.getByTestId('scope-seen-by-inventory-db')).toHaveTextContent('inventory-db');

    click('Mail');
    // Mail READS the sibling's scope, which nothing prevents.
    expect(screen.getByTestId('scope-seen-by-mail')).toHaveTextContent('inventory-db');
    // And OVERWRITES it.
    click('write the inventory-db scope as mail');

    click('Inventory Database');
    expect(screen.getByTestId('scope-seen-by-inventory-db')).toHaveTextContent('mail');
    expect(engine.getExtensionState('inventory-db')?.['owner']).toBe('mail');
  });

  it('PINS A KNOWN LIMIT — the IShellAPI deep-freeze does not reach plug-in-supplied functions: a sibling view component obtained from the public registry is mutable, and the sibling rendered output changes (no issue filed; ADR-0001 records it as accepted, because freezing a component breaks memo and forwardRef)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. Every CONTAINER the host owns
    // is frozen — the `ActiveExtension`, the record, `views`, `ribbonActions`, the
    // `IShellAPI` — and none of that is what is bypassed here. The plug-in's own
    // function object is carried across unfrozen, which is deliberate, and
    // `useRegistry` is deliberately not severed inside a plug-in subtree.
    const remotes = await loadRemotes();
    captureConsole();
    injected.engine = createHydrationEngine({ storage: null });
    render(
      <Harness
        blueprints={[withProbe(remotes.mail, SiblingViewProbe), remotes.database]}
        engine={injected.engine}
      />,
    );

    click('Inventory Database');
    expect(screen.getByText('No record selected. Choose one in the list.')).toBeInTheDocument();

    click('Mail');
    click('mutate the sibling view component');

    click('Inventory Database');
    // React now constructs the sibling's pane-3 view as a class, and it is not
    // one. The host's fault boundary contains the consequence — which is the
    // shell behaving correctly about a thing it could not prevent.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The detail view could not be displayed.');
    expect(within(alert).getByText('inventory-db')).toBeInTheDocument();
    // Pane 2 is untouched, so the blast radius really is one view.
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();
  });

  it('PINS A KNOWN LIMIT — unregister has no authorisation model: one extension removes another while the victim holds the foreground, and the shell simply carries on (no issue filed; the unregister docblock defers an ownership model to its own issue)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. Any holder of the registry
    // can remove any extension. ADR-0001 "No sandbox" is the argument: these are
    // same-origin scripts in one page, and an unregister token would move the lock
    // while leaving the door open.
    const remotes = await loadRemotes();
    injected.engine = createHydrationEngine({ storage: null });
    render(
      <Harness
        blueprints={[withProbe(remotes.mail, SiblingUnregisterProbe), remotes.database]}
        engine={injected.engine}
      />,
    );

    click('Inventory Database');
    const handle = host.activation?.getActive()?.shell as IShellAPI;
    expect(handle).toBeDefined();

    click('Mail');
    click('arm the removal of the sibling extension');
    click('Inventory Database');
    expect(screen.getByText('all categories — 280 records')).toBeInTheDocument();

    // The armed removal lands with the victim in the foreground.
    advance(5);

    // The shell is still up, and both panes are empty because nothing is active.
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(screen.getByText('Select an extension to fill this pane.')).toBeInTheDocument();
    expect(
      screen.getByText('No extension is active, so there is nothing to detail.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inventory Database' })).toBeNull();
    // The victim's handle is revoked rather than merely orphaned.
    expect(() => {
      handle.setBadgeCount('components', 1);
    }).toThrow(/revoked|REVOKED/i);
  });

  it('PINS A KNOWN LIMIT — the host tells a plug-in nothing about where keyboard focus is, so no ribbon predicate can key on it (GitHub issue #13)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. `RibbonContext` carries no
    // field naming the focused pane, and no host code writes one: moving real DOM
    // focus across all three panes and the ribbon leaves the context object the
    // plug-in is handed IDENTICAL, by reference.
    //
    // The narrower form this case used to take — "`RibbonContext.focusedPane` is
    // declared and never populated" — was true of the field as it stood, and the
    // field is not what the limit is about. Written this way the case survives the
    // field existing, not existing, or being reinstated, and still fails on purpose
    // the day the host starts publishing focus.
    const remotes = await loadRemotes();
    measureAt(1000);
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail]} engine={injected.engine} />);
    click('Mail');
    click(/^Inbox/);

    const store = host.store;
    expect(store).not.toBeNull();
    const before = store?.getContext();
    expect(before).toBeDefined();
    // Not one of the published context fields is about focus.
    expect(Object.keys(before ?? {}).filter((key) => /focus/i.test(key))).toEqual([]);

    // Focus really does move, across all three panes and the ribbon.
    const focusTargets: HTMLElement[] = [
      screen.getByRole('button', { name: /^Inbox/ }),
      document.querySelector('[data-message-id="msg-1001"]') as HTMLElement,
      document.querySelector('[data-mail-activity]') as HTMLElement,
      screen.getByRole('button', { name: 'Compose' }),
      screen.getAllByRole('separator')[0] as HTMLElement,
    ];
    for (const target of focusTargets) {
      act(() => {
        target.focus();
      });
    }
    // The last one really took focus, so the loop was not a no-op.
    expect(document.activeElement).toBe(focusTargets[focusTargets.length - 1]);

    // Same object, not merely an equal one: nothing wrote to the context at all.
    expect(store?.getContext()).toBe(before);
  });

  it('PINS A KNOWN LIMIT — a FaultBoundary does not catch a plug-in throw from a setTimeout callback: it escapes to the host environment and no fallback is rendered (no issue filed; this is React error-boundary semantics and the FaultBoundary banner records it)', () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. An error boundary catches
    // throws that happen during React's own render, lifecycle and commit work.
    // A timer callback is none of those: it runs on the host task queue, and the
    // throw goes wherever an uncaught exception goes in that environment. Under
    // fake timers that is this frame, which is what makes it observable at all.
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[timerFaultPlugin]} engine={injected.engine} />);
    click('Timer Fault');
    expect(screen.getByTestId('timer-fault-pane')).toBeInTheDocument();

    expect(() => {
      vi.advanceTimersByTime(10);
    }).toThrow('a plug-in threw from a setTimeout callback');

    // Nothing was contained, because nothing was caught: the pane is still showing
    // its normal content and no boundary rendered a fallback.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByTestId('timer-fault-pane')).toBeInTheDocument();
  });

  it('PINS A KNOWN LIMIT — a FaultBoundary does not catch a plug-in rejected promise: the rejection is delivered to the promise and no fallback is rendered (no issue filed; this is React error-boundary semantics and the FaultBoundary banner records it)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM.
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[rejectionFaultPlugin]} engine={injected.engine} />);
    click('Rejection Fault');

    const rejection = asyncFault.rejection;
    expect(rejection).not.toBeNull();
    // Attaching the handler here, in the same tick the effect created it, is also
    // what keeps this from becoming an unhandled rejection somewhere else.
    await expect(rejection).rejects.toThrow('a plug-in rejected a promise');

    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByTestId('rejection-fault-pane')).toBeInTheDocument();
  });

  it('PINS A KNOWN LIMIT — with no ResizeObserver in the environment, moving a divider does not re-window the list: it corrects on the next render the list performs for any other reason (no issue filed; VirtualizedList decision 4 records the fallback as accepted)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. In a browser the observer
    // re-measures immediately. In jsdom — and in older embedded WebViews — there is
    // no observer, and a panel resize re-renders the PANEL rather than the
    // extension subtree inside it, so the list is not told anything.
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe('undefined');
    stubViewportHeight(100);
    measureAt(1000);
    injected.engine = createHydrationEngine({ storage: null });
    const { container } = render(
      <Harness blueprints={[benchPlugin]} engine={injected.engine} />,
    );
    click('Bench');
    const mounted = (): number => screen.queryAllByRole('option').length;
    expect(mounted()).toBe(14);

    const before = panelSizes(container);
    stubViewportHeight(300);
    const [, second] = screen.getAllByRole('separator');
    act(() => {
      (second as HTMLElement).focus();
    });
    fireEvent.keyDown(second as Element, { key: 'ArrowRight' });
    expect(panelSizes(container)[1]).toBeGreaterThan(before[1] as number);

    // The pane moved and the window did NOT.
    expect(mounted()).toBe(14);

    // One interaction with the list itself is all it takes to correct.
    act(() => {
      screen.getByRole('listbox', { name: 'Bench rows' }).focus();
    });
    pressKeys(screen.getByRole('listbox', { name: 'Bench rows' }), 'ArrowDown');
    expect(mounted()).toBe(24);
  });

  it('PINS A KNOWN LIMIT — neither shipped verification remote renders VirtualizedList, so ISSUE-004 has no consumer in src/ outside this suite (no issue filed; reported with this change)', async () => {
    // ASSERTS CURRENT BEHAVIOUR. NOT A SAFETY CLAIM. `ShellLayout` deliberately does
    // not window pane 2 — it does not know what a row is — so windowing is an
    // extension's own decision, and neither mock takes it. `DatabasePlugin` maps
    // all 280 records into a plain `<ul>`. The keyboard-navigation clause of the
    // Definition of Done is therefore met against the test-authored `bench`
    // extension above, and this case is why.
    const remotes = await loadRemotes();
    for (const file of ['MailPlugin.tsx', 'DatabasePlugin.tsx']) {
      expect(codeWords(join(MOCKS_DIR, file))).not.toContain('VirtualizedList');
    }
    injected.engine = createHydrationEngine({ storage: null });
    render(<Harness blueprints={[remotes.mail, remotes.database]} engine={injected.engine} />);

    click('Inventory Database');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Every one of the 280 records is really in the DOM.
    expect(document.querySelectorAll('[data-record-id]')).toHaveLength(280);

    click('Mail');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
