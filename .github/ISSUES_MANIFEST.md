# LEAPWare-ShellUX — Issues Manifest

This manifest is the authoritative work breakdown for the initial build of
LEAPWare-ShellUX. Except where an issue is explicitly marked `LANDED`, it is a
**specification of intended work**, not a record of completed work. Nothing
marked otherwise should be read as a claim that the described behaviour
currently exists.

## Status legend

| Marker | Meaning |
|---|---|
| `LANDED` | Merged. The source files exist, are tested, and pass the coverage gate. |
| `IN PROGRESS` | Someone is actively writing this code now. |
| `NOT STARTED` | Specified only. No source file exists. |
| `BLOCKED` | Cannot start until a listed dependency lands. |

## Current state

| Issue | Title | Status |
|---|---|---|
| ISSUE-001 | Type-Safe IoC Extension Registry & Primitives | `LANDED` |
| ISSUE-002 | Compact Desktop 3-Pane Resizable Layout Matrix | `NOT STARTED` |
| ISSUE-003 | UI State Hydration & Serialization Engine | `NOT STARTED` |
| ISSUE-004 | High-Throughput Row Virtualizer & Fault Boundaries | `BLOCKED` (on 002) |
| ISSUE-005 | Verification Remotes & Adversarial Integration Suite | `BLOCKED` (on 002–004) |

ISSUE-001 was verified against running code by an independent adversarial
verification on **2026-07-29**. What that verification actually did, so the
claim is checkable rather than decorative:

- Re-ran `npm run lint`, `npm run typecheck`, `npm run test:coverage` and
  `npm run build` itself rather than trusting a reported result.
  `src/core/types.ts`, `src/core/RegistryContext.tsx` and `src/core/ShellAPI.ts`
  exist and hold a 100% statement/branch/function/line gate over `src/core/**`.
- Reproduced eight attack classes against the built registry and confirmed all
  eight are closed. Each is a standing test in the suite, not a one-off session
  transcript — per ADR-0001 Amendment G the class is only listed here if it can
  name the test that holds it:
  1. Registration hijack via a mutating `id` getter — `registrySecurity.test.tsx`,
     "register — a shifting id cannot hijack another extension > registers under
     the id that was validated, leaving the victim untouched".
  2. Reserved-id bypass — `registrySecurity.test.tsx`, "register — a shifting id
     cannot smuggle a reserved key into the store > never stores \"__proto__\" as
     a live key".
  3. `register` throwing rather than returning a failure — `registry.test.tsx`,
     "register — hostile payloads never crash the host > rejects a payload whose
     getter throws an Error, without propagating it".
  4. A hostile `setBadgeCount` — `shellApi.test.ts`, "setBadgeCount rejects an
     unstringifiable nodeId with a ShellUXError > never runs a plugin-supplied
     toJSON".
  5. A hostile `setSelectedItem` — `shellApi.test.ts`, "setSelectedItem validates
     its argument > does not stringify the rejected value".
  6. `Proxy` `length` mutation between the bounds check and the walk —
     `registryNormalization.test.tsx`, "register — a lying `length` cannot grow
     the payload after it is measured > stores exactly the ribbon actions it
     bounds-checked, and nothing past them".
  7. Post-registration mutation of the stored record —
     `registryNormalization.test.tsx`, "register — the stored record is
     host-owned > is unaffected by the plugin mutating its own blueprint
     afterwards".
  8. A weaponised `ShellUXError` relocated into the host —
     `registryNormalization.test.tsx`, "register — a weaponised ShellUXError
     cannot be relocated into the host > rejects an attacker-chosen code and
     defuses a detonating message getter".
- Measured, through a logging `Proxy`, that every untrusted property is read
  exactly once — not asserted from reading the source. *Test:*
  `registrySecurity.test.tsx` — "reads the id exactly once, so no later read can
  differ from the checked one", plus the duplicate-id and StrictMode variants
  beside it.

**The caveat that stood here is closed.** The same verification found that
`validateBlueprint` could escape a raw `TypeError` rather than a `ShellUXError`
on exotic input. That was fixed in Phase 1 — all five `Array.isArray` sites are
now guarded — and is pinned by "validateBlueprint — a revoked Proxy" in
`src/core/__tests__/validation.test.ts`. The history is kept under "Follow-up
defects" below rather than deleted. One narrower exposure remains open and is
recorded there: a throwing property getter on the payload still propagates out of
`validateBlueprint` untyped, which is why callers of that export must guard it.
Neither was ever reachable through `register`.

Its unblocking of ISSUE-002 is why that row now reads `NOT STARTED` rather than
`BLOCKED`. **No other issue has been verified against running code**, and every
remaining "Definition of Done" is a gate that still has to be passed.

---

## ISSUE-001 — Type-Safe IoC Extension Registry & Primitives

**Status:** `LANDED`

### Technical Specification

Establish the inversion-of-control contract that every other part of the system
depends on. The shell host owns lifecycle, layout and routing; it owns **no**
business logic. Extensions are supplied to the host, not imported by it.

The work has three parts:

1. **Type primitives (`src/core/types.ts`).** Define the extension contract —
   referred to throughout the docs as `LEAPExtensionBlueprint` — and the shell
   service contract, `IShellAPI`. The blueprint must at minimum carry: a stable
   unique extension id, a human-readable display label, an optional icon
   reference, the Pane 1 navigation entry, the Pane 2 (master/list) view
   component, the Pane 3 (detail) view component, and a collection of ribbon
   actions. Ribbon actions must each carry an id, a label, an invoke handler,
   and a **visibility predicate** evaluated against current shell state so that
   contextual actions can appear and disappear without the host knowing what
   they mean.

2. **Registry container (`src/core/RegistryContext.tsx`).** A React context
   plus provider that accepts a set of blueprints, validates them, indexes them
   by id, and exposes read access to consumers. Registration is the only way an
   extension becomes reachable; there is no side-channel. The registry must
   reject duplicate ids deterministically rather than silently last-write-wins,
   and must survive a malformed blueprint without taking the host down.

3. **Shell API construction (`src/core/ShellAPI.ts`).** Build the per-extension
   `IShellAPI` instance handed to each extension at activation. The object
   handed out must be **deeply frozen** before it crosses the boundary, so that
   a plugin cannot monkey-patch shell services for other plugins. Frozen means
   recursively frozen — a shallow `Object.freeze` on the root is not sufficient
   and will not pass review. As landed this holds for every container the **host**
   owns, and deliberately not for the plug-in functions carried inside them — see
   ADR-0001 Amendments D and E, and the accepted limit in `README.md`. *Tests:* the
   deep-freeze gate in the Definition of Done below names them.

The precise TypeScript signatures are settled *by this issue*. Downstream
documents must not assume signatures ahead of this issue landing.

### Explicit File Paths

- `src/core/types.ts`
- `src/core/RegistryContext.tsx`
- `src/core/ShellAPI.ts`

### Adversarial Edge-Cases to Handle

- Two extensions registering the same id. Must be a deterministic, reported
  failure — not a silent overwrite.
- A blueprint missing required fields, or with fields of the wrong runtime type
  (a string where a component was expected). Must be rejected at registration
  with the offending id named, not thrown at first render.
- An extension mutating the `IShellAPI` object it was given, or mutating a
  nested service object on it. Deep freeze must make this a no-op in sloppy
  mode and a `TypeError` in strict mode; either way no other extension may
  observe the change.
- An extension retaining a reference to the API object after it is deactivated
  and calling into it later.
- Circular references inside a blueprint (e.g. a ribbon action closing over the
  blueprint itself). The deep-freeze walk must not infinite-loop.
- An extension id that is not a safe key — `__proto__`, `constructor`,
  `prototype`, the empty string. Prototype pollution via the id index is the
  specific attack to close.
- A ribbon action whose visibility predicate throws. A throwing predicate must
  be treated as "not visible" and reported, never allowed to break the ribbon.
- Zero registered extensions. The shell must boot to an empty but usable state.

### Dependencies

None. This is the root of the dependency graph.

### Definition of Done

- `src/core/types.ts`, `src/core/RegistryContext.tsx` and `src/core/ShellAPI.ts`
  exist and type-check under the project's `tsconfig.json` with no `any` in the
  public contract surface and no `@ts-ignore`.
- Deep freeze is verified by test: a nested property of a handed-out
  `IShellAPI` cannot be reassigned, and the attempt is observable in a test.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "is deep-frozen: strict-mode
  reassignment throws" and "is deep-frozen: sloppy-mode reassignment is a silent
  no-op"; the `deepFreeze` walk itself in "freezes nested objects and arrays",
  "freezes function-valued properties", "freezes symbol-keyed properties too" and
  "terminates on a cyclic graph".
- Duplicate-id registration is covered by a test asserting the deterministic
  failure behaviour. *Tests:* `src/core/__tests__/registry.test.tsx` — "register —
  duplicate ids > rejects a different blueprint claiming an id that is already
  taken" and "treats re-registering the identical blueprint object as an
  idempotent no-op".
- Prototype-pollution-shaped ids are covered by a test. *Tests:*
  `src/core/__tests__/validation.test.ts` — "validateBlueprint — identifier
  hardening > rejects the prototype-pollution identifier \"%s\" as RESERVED_ID"
  and "leaves Object.prototype untouched after a __proto__ registration attempt";
  `src/core/__tests__/registrySecurity.test.tsx` — "never stores \"__proto__\" as
  a live key", which asserts the `Map` store as well as the filter.
- ~~A throwing visibility predicate is covered by a test asserting the action is
  hidden and the ribbon still renders.~~ **Carried to ISSUE-002.** This gate
  cannot be met by ISSUE-001: containing a throwing predicate requires a call
  site, and the ribbon renderer that would evaluate predicates is ISSUE-002.
  What ISSUE-001 does enforce is that `isVisible` and `onExecute` are functions
  at registration. Recorded here rather than quietly dropped.
- The Vitest coverage gate passes for `src/core/**`.
- `DEVELOPER.md` is updated to replace its "signature not yet settled" notes
  with the real, as-shipped signatures.
- **Every security claim in prose names the test that exercises it.** No sentence
  asserting a security property may land in a `.md` file or a docblock unless it
  names the test file and `it(...)` description that asserts it. A claim with no
  such test is **narrowed** until an existing test does assert it, or **deleted**;
  deleting it is a correct outcome, not a failure. A claim that genuinely cannot be
  tested yet — because the call site it would need does not exist — is kept only if
  it is explicitly labelled as untested and attributed to the issue that will
  provide the call site.

  This is a **review-time convention. No script checks it**, and ADR-0001
  **Amendment G** says so plainly rather than implying enforcement. Amendment G also
  records the seven consecutive review rounds that produced the rule: in every one of
  them the code was sound and the sentence was wider than the premise licensing it,
  so six correct code fixes in a row did nothing to stop the seventh. The reviewer's
  question is mechanical — *which test?* — and a sentence that cannot answer it is a
  finding.

### As landed — decisions taken during implementation

- **The registry stores a normalised copy, not the caller's object.**
  Validating a payload and then keeping the plugin's live object leaves every
  check revocable: fields stay re-readable through getters and mutable through
  ordinary assignment, so a bounds check measures a number the plugin can
  revise afterwards. Registration therefore reads each untrusted value once and
  writes it into a host-owned, deeply frozen record, which is what
  `getExtension` returns. Function and React-component references are carried
  across unchanged — they must stay callable and keep their identity — and the
  plugin's original object is retained privately for the StrictMode
  reference-identity check and nothing else.
  *Tests:* `src/core/__tests__/registryNormalization.test.tsx` — "register — the
  stored record is host-owned > is frozen at every host-owned level", "is
  unaffected by the plugin mutating its own blueprint afterwards", "carries
  functions and components across by reference, unfrozen and callable", and "keeps
  StrictMode idempotency keyed on the plugin object, not on the copy".
- **`unregister` has no authorisation, deliberately.** See ADR-0001 and the
  declaration comment in `src/core/RegistryContext.tsx`. This issue never
  specified an ownership model and one was not invented here. The absence is
  pinned rather than only stated — *test:*
  `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling", which performs the removal from
  inside a plug-in subtree.

### Follow-up defects — one closed, two open, none blocking

Found by the 2026-07-29 adversarial verification. Each was reproduced, not
inferred. None of them blocked ISSUE-001 from landing, and none was a reason to
weaken its status — but they were real, and they are recorded here rather than
quietly dropped, in the same spirit as the struck-through carried-forward gate
above. The history stays even once an entry is closed.

- **~~`validateBlueprint` can throw a raw `TypeError`.~~ CLOSED in Phase 1.**
  `Array.isArray` throws when handed a revoked `Proxy`, and five call sites in
  `src/core/RegistryContext.tsx` reached it with an unvalidated value: `isRecord`,
  `describeType`, the `children` check in `normalizeNavigationNode`, and the
  `navigationTree` and `ribbonActions` checks in `normalizeBlueprint`. Every field
  position in the blueprint could steer a revoked `Proxy` into one of them, and the
  path that actually bit was `describeType` rather than `isRecord`: `validateId`,
  `validateText`, `validateFunction` and `validateViewComponent` `typeof`-check
  first, `typeof` does not trap, and the failure path then builds its message.
  **Never reachable through `register`** — its `try`/`catch` absorbed the throw and
  returned a `ShellUXError`, so the "never throws" contract was intact throughout;
  only the exported `validateBlueprint`, which has no catch, leaked it.
  **Fixed:** all five sites now go through a total `checkArray` helper that cannot
  throw, and a revoked `Proxy` is an ordinary typed rejection naming the field.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — a revoked
  Proxy", which walks every field position that can reach one of the five sites,
  asserts `ShellUXError` at each, and asserts the message names the value rather
  than guessing its type. It was written failing first: 21 of its 23 cases failed
  against the unguarded code with *"expected TypeError: Cannot perform 'IsArray' on
  a … to be an instance of ShellUXError"*.
- **`validateBlueprint` still propagates a throwing property getter untyped.**
  OPEN, and narrower than the entry above. Reading a field off the payload is a
  call into plugin code, a getter may throw anything, and the exported
  `validateBlueprint` has no catch, so that value reaches its caller unchanged. It
  is not a rejection the validator decided on, but a consumer catching only
  `ShellUXError` is still surprised by it. **Not reachable through `register`.**
  Not closed here because the fix is a contract decision — wrap every field read,
  or give the export a result type — and not a guard. *Test:* pinned as a
  known-current behaviour by `src/core/__tests__/validation.test.ts` —
  "validateBlueprint — a revoked Proxy > still propagates whatever a throwing
  property getter threw", so a future fix has to change that test deliberately.
- **A revoked `Proxy` over a function passes `validateFunction` and
  `validateViewComponent`.** OPEN. Its `typeof` is `'function'`, so it satisfies
  the check and is stored by reference like any other handler; calling it later
  throws. This sits within ADR-0001's stated limit — the host validates shape at
  registration and does not vouch for what a handler does when invoked — but the
  host has **no invocation guard**, so the first caller wears the throw. Worth
  closing when a call site exists (ISSUE-002 for `isVisible`/`onExecute`,
  ISSUE-004 for the view components). **Untested, and untestable from here:** there
  is no invocation site in `src/` to assert against, only the registration-time
  acceptance, which is the current behaviour rather than the defect.
- **Untrusted fields are read through the prototype chain.** OPEN. Field reads use
  plain property access with no `Object.hasOwn` guard, so a polluted
  `Object.prototype.badgeCount` is inherited by a navigation node that declares
  none. **No unvalidated value can be smuggled in this way** — an inherited
  value goes through exactly the same checks as an own value, so the type and
  bound guarantees hold either way. *Test:* the guarantee those checks provide is
  pinned by `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  navigation tree > rejects %s as badgeCount" and the bound tests beside it, which
  hold irrespective of where the value came from. **The inheritance itself has no
  test** — nothing asserts that an inherited field is read at all — so the
  "robustness and least-surprise" framing below is reasoning about the code, not a
  measured property. It is a robustness defect, **not a validation bypass**, and it
  is stated that way deliberately rather than inflated.

---

## ISSUE-002 — Compact Desktop 3-Pane Resizable Layout Matrix

**Status:** `NOT STARTED` (unblocked — ISSUE-001 has landed)

### Technical Specification

Build the Outlook-paradigm shell chrome: a full-width contextual ribbon above
three horizontally resizable panes.

**Ribbon (`src/components/ui/RibbonToolbar.tsx`).** Full container width.
Global host actions are left-aligned. Plugin-injected contextual actions are
right-aligned and are sourced from the active extension's `ribbonActions`, each
filtered through its visibility predicate against current shell state. The
ribbon **must** render plugin-supplied labels as **text nodes only** — no HTML
injection path may exist in this component. Nothing renders plug-in content today,
so this is a gate on this issue, not a description of the host.

**Panes (`src/components/layout/ShellLayout.tsx`,
`src/components/layout/PaneWrapper.tsx`).** Three panes using
`react-resizable-panels` with draggable dividers:

- **Pane 1 — navigation sidebar.** 240px default. Collapsible to a 48px icon
  track. Collapse is a distinct state, not merely a small width: at 48px the
  pane shows icons only, with accessible names preserved.
- **Pane 2 — master/list.** 360px default. Hosts the virtualized list from
  ISSUE-004.
- **Pane 3 — detail.** Flexes to fill. Owns its own header region, its own
  scroll container, and a utility drawer slot on its trailing edge.

`PaneWrapper` is the shared shell for a pane: border, overflow discipline, and
the slot contract that lets a pane declare a header and a scrollable body
independently.

**Design system.** High-density desktop, explicitly not airy mobile-web
spacing. Padding stays in the `p-1`–`p-3` range. Base type is 11px–13px.
Borders are 1px, `border-neutral-200` in light theme and `border-neutral-800`
in dark.

### Explicit File Paths

- `src/components/layout/ShellLayout.tsx`
- `src/components/layout/PaneWrapper.tsx`
- `src/components/ui/RibbonToolbar.tsx`

### Adversarial Edge-Cases to Handle

- Viewport narrower than the sum of the minimum pane widths. Panes must degrade
  predictably rather than overflowing the document and producing a horizontal
  page scrollbar.
- Dragging a divider fully to one edge. A pane must not become a 0px unfocusable
  void that the user cannot recover by dragging back.
- Collapse toggled while a drag is in flight.
- Restored persisted sizes (from ISSUE-003) that do not sum to 100%, or that
  encode a pane width no longer legal after a min-width change.
- Ribbon overflow: more contextual actions than fit. Must not wrap into a second
  row that shifts the panes downward.
- An extension supplying a very long label, or a label containing markup
  characters. Renders as text, truncates, does not break layout.
- Keyboard-only divider adjustment and focus order across ribbon → Pane 1 →
  Pane 2 → Pane 3.
- No active extension selected. Ribbon right side is empty; layout still valid.

### Dependencies

- **ISSUE-001** — needs the registry to read the active extension and its
  `ribbonActions`, and needs the visibility-predicate contract.

### Definition of Done

- The three files exist, type-check, and render a working three-pane shell.
- Pane 1 collapses to a 48px icon track and expands back, with accessible names
  present in both states.
- Dividers are operable by mouse and by keyboard.
- Density rules hold: no padding above `p-3` in shell chrome, base type within
  11px–13px, 1px borders using the specified neutral tokens in both themes.
- Ribbon renders contextual actions from the registry, honouring visibility
  predicates, with plugin labels as text nodes.
- Overflow, zero-width and no-extension cases are covered by tests.
- The Vitest coverage gate passes for the files in scope.

---

## ISSUE-003 — UI State Hydration & Serialization Engine

**Status:** `NOT STARTED`

### Technical Specification

Persist and restore shell UI state locally so a reload returns the user to the
layout they left. Local-first: no network dependency, no server round trip.

**`src/core/services/HydrationEngine.ts`.** Owns serialization and
deserialization of persisted shell state — pane sizes, Pane 1 collapsed state,
active extension id, and per-extension scoped UI state. Requirements:

- A **schema version** is written alongside the payload. Reads of an unknown or
  older version must migrate or discard, never blindly spread into live state.
- Every read is **validated**, not trusted. Persisted data is user-writable via
  devtools and must be treated as untrusted input.
- Per-extension state is **namespaced by extension id**, so two extensions cannot
  collide on a key.
  > **Read ADR-0001 Amendment E before writing this.** Namespacing delivers
  > collision-resistance, not confinement, and this line previously specified
  > "so one extension cannot read or clobber another's persisted state" — a
  > requirement that **cannot be met in-page** by namespacing, exactly as badge
  > scoping does not meet it today. Either this issue records the same limit
  > honestly, or it depends on the real-isolation work Amendment E's trigger calls
  > for. It must not ship with the stronger sentence and the weaker mechanism.
- Writes are debounced. Dragging a divider must not produce a write per frame.

**`src/hooks/useLocalStorageState.ts`.** The React binding: a state hook backed
by the hydration engine. Must render correctly on first paint without a flash
of default layout, and must not throw when storage is unavailable.

### Explicit File Paths

- `src/core/services/HydrationEngine.ts`
- `src/hooks/useLocalStorageState.ts`

### Adversarial Edge-Cases to Handle

- `localStorage` throwing on access: Safari private mode, disabled storage,
  and quota exhaustion on write. The shell must run with persistence silently
  degraded to in-memory, not crash.
- Corrupt JSON, truncated JSON, or valid JSON of the wrong shape.
- A persisted payload from a future schema version (user downgraded the app).
- Hand-crafted hostile payloads: `__proto__` keys, enormous strings, deeply
  nested objects intended to blow the stack during a recursive validate.
- Two browser tabs writing concurrently — last write wins is acceptable, silent
  interleaved corruption is not.
- Persisted state referencing an extension id that is no longer registered.
- Values that do not survive JSON round-tripping (`undefined`, `NaN`,
  `Infinity`, `Date`, `Map`, `Set`) being handed to the hook.
- Quota exceeded mid-write leaving a partial record.

### Dependencies

- **ISSUE-001** — needs extension ids to namespace per-extension state.
- **ISSUE-002** — consumes pane sizes and collapse state; the two must agree on
  the shape and on what happens when restored sizes are illegal.

### Definition of Done

- Both files exist and type-check.
- Schema version is written and honoured; an unknown version is handled by an
  explicit, tested path.
- All reads pass validation before entering state; a corrupt-payload test and a
  `__proto__`-payload test both pass.
- Storage-unavailable and quota-exceeded paths are tested and degrade to
  in-memory without throwing.
- Writes are debounced, verified by a test that a drag produces one write rather
  than one per frame.
- No flash of default layout on reload.
- The Vitest coverage gate passes for the files in scope.

---

## ISSUE-004 — High-Throughput Row Virtualizer & Fault Boundaries

**Status:** `BLOCKED` on ISSUE-002

### Technical Specification

**`src/components/shared/VirtualizedList.tsx`.** Windowed list for Pane 2.
Only rows intersecting the viewport (plus a small overscan) are mounted. The
component is generic over the row item type and takes a row renderer from the
extension; it does not know what a row means. Selection, keyboard navigation
(arrow keys, Home/End, Page Up/Down) and scroll-into-view for the selected row
are the virtualizer's responsibility. Row content supplied by an extension **must** be
rendered as text nodes, and the virtualizer **must** offer no HTML-injection path.
Nothing renders plug-in content today, so this is a gate on this issue, not a
description of the host.

**`src/components/error/FaultBoundary.tsx`.** A React error boundary placed
around each pane and around each extension-supplied subtree. A plugin that
throws during render must degrade to a contained error surface inside its own
pane, naming the failing extension, with the rest of the shell still
interactive. The boundary must offer a retry that remounts the subtree.

Note the deliberate limitation, and document it rather than overselling it:
React error boundaries catch render, lifecycle and constructor errors. They do
**not** catch errors thrown in event handlers, in `setTimeout`, or in unhandled
promise rejections. Those need separate handling and must not be described as
covered by `FaultBoundary`.

### Explicit File Paths

- `src/components/shared/VirtualizedList.tsx`
- `src/components/error/FaultBoundary.tsx`

### Adversarial Edge-Cases to Handle

- Empty list, single-item list, and a list whose length changes while scrolled
  deep into it.
- Variable row heights and rows whose height changes after mount.
- The container being 0px tall during initial layout, producing a divide-by-zero
  or a zero-item window that never recovers.
- Fast scroll producing blank regions where recycling has not kept up.
- Selection index pointing past the end of the list after items are removed.
- A row renderer that throws for one specific item — must not take out the whole
  list.
- A plugin that throws *inside* the `FaultBoundary` fallback itself.
- A plugin that throws on every retry, producing a retry loop.
- Rapid extension switching while a fetch or render is in flight.
- Pane resize (ISSUE-002) forcing a recompute of the visible window mid-scroll.

### Dependencies

- **ISSUE-001** — the row renderer and detail view arrive through the registry.
- **ISSUE-002** — the virtualizer is hosted inside Pane 2 and must react to
  `PaneWrapper` sizing.

### Definition of Done

- Both files exist and type-check.
- Mounted row count is asserted by test to be bounded by viewport plus overscan,
  not by total item count.
- Keyboard navigation and scroll-into-view are tested.
- A throwing row renderer is contained: test asserts the rest of the list still
  renders.
- A throwing extension subtree is contained to its pane: test asserts the ribbon
  and other panes remain interactive.
- The documented limits of `FaultBoundary` (handlers, timers, promise
  rejections) are stated in the source doc comment and in `DEVELOPER.md`.
- The Vitest coverage gate passes for the files in scope.

---

## ISSUE-005 — Verification Remotes & Adversarial Integration Suite

**Status:** `BLOCKED` on ISSUE-002 through ISSUE-004

### Technical Specification

Two complete, operational mock extensions plus the integration suite that drives
the assembled shell through them. The mocks are *verification remotes*: they
exist to exercise the public registry contract from the outside, exactly as a
third party would, with no privileged access to host internals. If a mock needs
something the public contract does not expose, that is a finding against
ISSUE-001, not a licence to reach inside.

**Mail module (`src/mocks/MailPlugin.tsx`).** The Outlook-shaped case. Folder
tree in Pane 1 with unread badge counts, message list in Pane 2, message body in
Pane 3 with the utility drawer in use.

**Inventory Database module (`src/mocks/DatabasePlugin.tsx`).** The deliberately
different case, proving the shell is not quietly shaped around mail. Schema or
category tree in Pane 1 with stock-level badges, record list in Pane 2, record
detail in Pane 3.

Both modules must be genuinely operational, not stubs. Between them they must:

- **Independently drive layout state** — each module owns its own Pane 1
  selection, Pane 2 selection and drawer state, and switching modules must not
  bleed one module's layout state into the other.
- **Dynamically alter ribbon action sets** — the set of contextual ribbon
  actions must change in response to in-module state (for example, selection
  versus no selection, or multi-selection), driven through the ISSUE-001
  visibility predicates rather than by the host special-casing anything.
- **Mutate unread/badge counts on navigation nodes** — badge values on Pane 1
  nodes change at runtime and the sidebar reflects the change, including while
  Pane 1 is collapsed to the 48px icon track.
- **Pass event streams across panes** — a selection or action in one pane emits
  events consumed by another pane, so cross-pane ordering is genuinely
  exercised rather than assumed.

**Integration suite (`src/__tests__/IntegrationSuite.test.tsx`).** End-to-end
tests through the real assembled shell — real registry, real layout, real
hydration, real virtualizer — never through test doubles of the host. Registers
both modules and drives extension switching, pane resize and collapse,
persisted-state reload, virtualized scrolling, keyboard navigation, and a forced
plugin fault to confirm containment.

### Explicit File Paths

- `src/mocks/MailPlugin.tsx`
- `src/mocks/DatabasePlugin.tsx`
- `src/__tests__/IntegrationSuite.test.tsx`

### Adversarial Edge-Cases to Handle

- **Rapid extension switching (mount/unmount churn).** Switching back and forth
  faster than a module's async work can settle. A resolving fetch or a pending
  state update belonging to an unmounted module must not write into the live
  one, and must not produce an update-after-unmount warning.
- **Listener and timer cleanup on unmount.** Every subscription, event listener,
  interval, timeout, observer and abort controller a module creates is released
  when it unmounts. Repeated mount/unmount cycles must not accumulate
  registrations. This is asserted, not assumed.
- **Keyboard navigation mapping.** Arrow keys plus `J`/`K` move the Pane 2
  selection. The `J`/`K` bindings must not fire while focus is in a text input
  or any editable surface, and must not conflict with the host's own shortcuts.
  Focus must remain visible and the selected row scrolled into view.

  > **Constraint — see ADR-0001 Amendment H, Decision 8.** `J` and `K` must be
  > implemented as key handling **local to the Pane 2 list view**, live only while
  > that list holds focus, and must never be declared as a `RibbonAction.hotkey`
  > or otherwise registered as a global shortcut — bare single-character keys
  > fail WCAG 2.2 §2.1.4 Character Key Shortcuts at Level A. This constraint is a
  > requirement on Phase 5 work and **has no test**, because no hotkey dispatcher
  > exists. What *is* tested today is the narrower thing: `normalizeRibbonAction`
  > rejects a modifier-less character-key `hotkey` at registration, per
  > "validateBlueprint — the WCAG 2.1.4 modifier rule for character keys" in
  > `src/core/__tests__/validation.test.ts`.
- **Cross-pane event ordering.** Events emitted by one pane and consumed by
  another must arrive in a defined order, with no case where Pane 3 renders
  detail for a Pane 2 row that a later-arriving event has already replaced.
  Interleaved rapid selections must settle on the last selection, not a race
  winner.
- Both modules registering conflicting ids, or conflicting ribbon action ids.
- One module throwing during activation while the other is healthy — the healthy
  module must remain fully usable.
- A badge count updating for a module that is not currently active.
- Integration tests that pass only because of test ordering, or that leak
  persisted state between cases. Each case starts from clean storage.
- Timer-driven module logic making tests flaky under fake timers.

### Dependencies

- **ISSUE-001** — modules register through the registry and drive ribbon
  visibility predicates.
- **ISSUE-002** — integration tests drive the real pane layout, collapse and
  resize.
- **ISSUE-003** — reload-and-restore cases need the hydration engine, including
  per-module state namespacing.
- **ISSUE-004** — list scrolling, keyboard navigation and fault containment
  cases need the virtualizer and the fault boundary.

### Definition of Done

- All three files exist and type-check.
- Both modules are operational — each drives its own layout state, alters its
  ribbon action set from in-module state, mutates navigation badge counts at
  runtime, and passes events across panes.
- Both modules register and run through the public registry contract only, with
  no privileged import of host internals.
- **Extension switching** is proven by integration flow: switch Mail → Database
  → Mail, asserting each module's layout state is independent and correctly
  restored, with no state bleed.
- **Memory and listener cleanup is verified**, not asserted in prose: a test
  performs repeated mount/unmount cycles and asserts that listener, timer and
  subscription counts return to their pre-mount baseline, and that no
  update-after-unmount warning is emitted.
- **Keyboard navigation** is proven: Arrow keys and `J`/`K` move selection,
  the bindings are suppressed while focus is in an editable surface, and the
  selected row is scrolled into view.
- Cross-pane event ordering is covered by a test that interleaves rapid
  selections and asserts the final rendered detail matches the final selection.
- Integration tests pass in a randomized order and with storage cleared between
  cases.
- The Vitest coverage gate passes for the files in scope.

---

## Cross-cutting gates

These apply to every issue above and are not restated per ticket.

- **Type safety.** No `any` in a public contract. No `@ts-ignore` without a
  written justification in the same commit.
- **Coverage.** The Vitest coverage threshold is enforced as a build gate by
  `.github/workflows/ci.yml`, whose `Test with coverage` step runs
  `npm run test:coverage` on every push to `main` and every pull request;
  `vitest.config.ts` sets the threshold and Vitest exits non-zero when it is
  unmet, failing the job. The threshold applies per module as each module lands.
  There is no project-wide coverage figure to report yet, and none should be
  claimed.
- **Accessibility.** WCAG 2.2 **AA** is the target. See `README.md` for the
  known conflicts that keep AAA out of scope.
- **Untrusted plugin content.** Any surface that renders extension-supplied
  strings **must** render them as text nodes, and `dangerouslySetInnerHTML` is
  prohibited in extension-content paths. **This is a requirement on future work,
  explicitly untested, and must not be read as a protection the host delivers:**
  no component in `src/` renders plug-in content today, so there is no render site
  to test at. It becomes testable with the ribbon and pane chrome (ISSUE-002) and
  the row virtualizer (ISSUE-004), and the gate for each of those is that the rule
  arrives with a test at the render site. See `README.md`, "Stated as intent, with
  no test — do not read as a control", which holds the same label and forbids
  restating this as delivered until such a test exists.
- **Performance.** Targets are stated in `README.md` and are explicitly
  unmeasured. No ticket may be closed on a performance claim that has not been
  benchmarked.
