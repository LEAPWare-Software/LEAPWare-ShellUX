# Project Status

> **Historical.** This was the Project Status section of `README.md` until 2026-09-18. Much of it was already stale when it moved (it describes ISSUE-002 as unmerged). It is kept as the record and must not be read as current; the current state is `HANDOFF.md` and `docs/plans/v1-production.md`.

> **Pre-alpha. Under active construction. Not usable, not installable, not
> released.**
>
> This repository is at the very beginning of its life. **ISSUE-001 (the IoC
> registry and type primitives) has landed, and ISSUE-002 (the three-pane layout
> and the ribbon) is implemented and passing but not yet merged.** The host now
> boots to a real three-pane shell rather than a placeholder. **ISSUE-003's
> hydration engine is implemented, tested and now consumed by the shell**: pane
> sizes, the pane-1 collapsed flag and the foreground extension survive a reload,
> and nothing else does. **ISSUE-004 (the row virtualizer
> and the fault boundaries) is implemented and passing but not yet merged.**
> Everything else described in this README is specified but unbuilt.
>
> There is no published package, no demo, and no release tag. The contract in
> `src/core/types.ts` is real and is the reference for anything written against it;
> everything downstream of it may still move.

What that means for a reader:

| Area | State |
|---|---|
| IoC extension registry (ISSUE-001) | **Landed.** `src/core/types.ts`, `src/core/RegistryContext.tsx`, `src/core/ShellAPI.ts`, `src/core/ActivationContext.tsx`, `src/core/hotkeys.ts`, under a 100% coverage gate |
| Three-pane resizable layout (ISSUE-002) | **Implemented and green, not yet merged.** `src/components/layout/ShellLayout.tsx`, `src/components/layout/PaneWrapper.tsx`, `src/components/command/ContextBar.tsx`, with 126 tests across `ShellLayout.test.tsx`, `PaneWrapper.test.tsx`, `ContextBar.test.tsx`, `ShellLayoutPersistence.test.tsx` and `ShellLayoutBadges.test.tsx` in `src/components/__tests__/` — five of which are ISSUE-004 fault-containment cases added to `ShellLayout.test.tsx`, and 33 of which are the ISSUE-003 persistence and issue-#12 badge cases, all inside the same 100% coverage gate. Not marked "landed" because it is unmerged — see [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) |
| State hydration and persistence (ISSUE-003) | **Engine implemented, green, and now consumed by the shell — not yet merged.** `src/core/services/HydrationEngine.ts` and `src/hooks/useLocalStorageState.ts`, with 146 tests in `src/core/services/__tests__/hydrationEngine.test.ts` and `src/hooks/__tests__/useLocalStorageState.test.tsx`, plus 25 tests in `src/components/__tests__/ShellLayoutPersistence.test.tsx` driving the assembled shell over a real storage, inside the same 100% coverage gate. `ShellLayout.tsx` restores and writes **three** slots — pane sizes, the pane-1 collapsed flag and the foreground extension id — and the utility drawer is deliberately not one of them |
| Row virtualizer and fault boundaries (ISSUE-004) | **Implemented and green, not yet merged.** `src/components/error/FaultBoundary.tsx`, `src/components/shared/VirtualizedList.tsx` and its pure arithmetic in `src/components/shared/virtualWindow.ts`, with 76 tests in `src/components/__tests__/FaultBoundary.test.tsx` and `src/components/__tests__/VirtualizedList.test.tsx`, inside the same 100% coverage gate. The virtualizer is a component an extension's own Pane 2 view renders — the host does not window your pane for you |
| Verification remotes and integration suite (ISSUE-005) | **Implemented and green, not yet merged.** The two verification remotes `src/mocks/MailPlugin.tsx` and `src/mocks/DatabasePlugin.tsx`, driven by 60 tests in `src/__tests__/IntegrationSuite.test.tsx` — the first place in this repository where an operational plug-in is mounted at all. It runs the assembled shell, not a double of it, and nine of its cases are `PINS A KNOWN LIMIT` characterisations of behaviour the architecture has accepted rather than prevented. It is outside the coverage `include` list on purpose: it exercises code the gate already covers, and adding an integration file to a 100% gate measures nothing new. See [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) |

**What ISSUE-002 did change:** ribbon action `isVisible` predicates are now
evaluated on every command-surface render, `onExecute` handlers are invoked on click, and
both are called inside a guard so that a plug-in throwing from either is reported
and contained rather than taking the shell down. *Tests:*
`src/components/command/__tests__/ContextBar.test.tsx` — "the context bar hides a command whose isVisible predicate throws and still renders the rest", "the context bar survives an onExecute that throws, leaving the surface interactive".

**What it did not change, stated plainly because a working-looking shell invites
the opposite assumption:**

- **There was no fault boundary, and ISSUE-004 added one.** The ribbon guards
  above are around two *calls*, not around a component's render, and that gap was
  live from the moment ISSUE-002 started mounting plug-in components. Since
  ISSUE-004, `ShellLayout` wraps the children of every pane — pane 1 included — the
  extension subtree inside panes 2 and 3, and the ribbon, each in its own
  `FaultBoundary`. A view that throws during render degrades to a contained host
  surface inside its own pane, naming the extension, with a bounded retry.
  *Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "contains a throwing pane-2 view to pane 2, leaving the context bar and pane 3 interactive" and "contains a throwing context bar without taking the panes down".
- **The host does not virtualize your pane for you.** Pane 2 is still a plain
  scroll container; `VirtualizedList` is a component an extension's `views.pane2`
  mounts, because the host does not know what a row is or how tall one should be.
  An extension that renders a thousand rows directly still has a thousand rows in
  the DOM. *Tests:* `src/components/__tests__/VirtualizedList.test.tsx` — "mounts a
  window bounded by the viewport rather than by the item count".
- **Persistence is now wired, and it covers exactly three things.** This entry
  used to read "nothing the shell renders is persisted", and that stopped being
  true when `src/components/layout/ShellLayout.tsx` started consuming ISSUE-003's
  engine. A divider you drag, a pane 1 you collapse and the extension you had in
  the foreground all come back on the next load. **The utility drawer does not,
  the selected navigation node does not, and the measured window width does
  not** — the drawer is a transient inspection of pane 3 rather than a layout you
  arranged, the two selections belong to the shell store and are cleared on every
  foreground handover by design, and the width is a fact about this window rather
  than about you. Pane sizes changed *while pane 1 is collapsed* are also not
  written: the two panes then in the group divide a width that excludes the 48px
  track, so their percentages are a ratio against a different denominator. Nor
  are the sizes that come out of pane 1 coming *back*: re-adding it makes the
  layout library renormalise a two-panel group into a three-panel one, and none
  of the numbers that fall out of that is a width you chose — writing them used
  to discard the layout you had, over a collapse and a re-expansion that changed
  nothing. What is written is always all three panes at once, so the record is a
  layout rather than three slots patched at different moments. And **a record
  existing is not the same fact as you having chosen a layout**: one written
  because you collapsed pane 1 or opened an extension carries the engine's
  default pane sizes, and the shell keeps its own 240px navigation intent for
  those rather than reading them back as your choice.
  *Tests:* `src/components/__tests__/ShellLayoutPersistence.test.tsx` — "persists a
  pane size the user changed, and a second shell over the same storage opens into
  it", "persists the pane-1 collapsed flag, and a second shell over the same
  storage opens collapsed", "brings the persisted extension back to the foreground
  once it registers", "persists no drawer state, so a reload opens with the drawer
  shut", "does not persist a pane size while pane 1 is collapsed, because the
  two panes divide a different width", "records one three-pane layout, so the
  persisted percentages divide the whole", "leaves the persisted layout exactly as
  it was across a collapse and a re-expansion" and "keeps the pixel intent after a
  write nobody made about the panes, at a width where the two differ";
  `e2e/shell-layout.spec.ts` — "leaves the stored layout alone, so a reload still
  opens on the dragged widths" and "survives a reload whose stored record was
  written for another slot entirely".
- **A runtime badge write is now rendered, and it was not.** `IShellAPI.setBadgeCount`
  has been implemented and validated since ISSUE-001, and until issue #12 the value
  it wrote reached no renderer: pane 1 drew `NavigationNode.badgeCount` off the
  registry's frozen blueprint record, which is fixed at registration. The nav tree
  now subscribes through `useBadgeCount(extensionId, nodeId)` and a store value
  **overrides** the blueprint's, falling back to the blueprint when the store holds
  nothing for that node — including in the collapsed 48px icon track, and including
  a count written back down to `0`, which a truthiness test would have dropped.
  *Tests:* `src/components/__tests__/ShellLayoutBadges.test.tsx` — "lets a
  setBadgeCount write through a live IShellAPI change what the sidebar renders",
  "overrides a blueprint badge with the store value, including down to zero",
  "shows a runtime badge in the collapsed 48px icon track too" and "renders the
  blueprint badge for a node the store has never been written for".
- **Hotkey dispatch has landed, and it is narrow.** A command's optional
  `hotkey` now fires: `src/core/hotkeyDispatch.ts` holds the shell's one `keydown`
  listener, called once by `ShellLayout`, and a chord is live only for the
  **foreground** extension and only for an action that is visible and not disabled
  — the same two gates the button passes. Chord-bearing enabled actions advertise
  themselves with `aria-keyshortcuts`; disabled ones deliberately do not. Exactly
  two modules under `src/` touch a key event, and both are allowlisted by name and
  by exact spelling.
  *Tests:* `src/core/__tests__/hotkeyDispatch.test.tsx` — "fires a visible,
  enabled chord on the foreground extension", "does not fire a background
  extension chord while another extension is in the foreground" and "adds exactly
  one keydown listener and removes the identical handler on unmount";
  `src/__tests__/noEventListener.test.ts` — "finds no listener registration
  in any module outside the hotkey-dispatch allowlist" and "finds no key-event name
  in any module outside the key-event allowlist".

**What ISSUE-005 added, and it is a different kind of thing from the four above.**
Every one of the 915 tests that stood before it mounted **one unit** against
fixtures whose pane views are `(): null => null`. Nothing in this repository had
ever mounted a plug-in that holds state, owns a timer, fetches asynchronously or
fails on purpose. `src/__tests__/IntegrationSuite.test.tsx` drives the assembled
shell — real registry, real activation, real hydration engine, real panel group,
real fault boundaries, real hotkey dispatcher — through the two verification
remotes in `src/mocks/`, and asserts the things that only exist once several units
are wired together: a selection made in pane 2 arriving in pane 3 through the host
store rather than through the module, an extension's layout state surviving a round
trip through another extension, a module's 200ms interval really being released on
unmount, a persisted layout coming back across a simulated reload.

**Nine of its cases are titled `PINS A KNOWN LIMIT`, and that is the part worth
reading.** Each describes something the architecture has ACCEPTED rather than
prevented, and each carries a comment in its own body saying it asserts current
behaviour and is not a safety claim: that badge scoping and persisted-state
namespacing are collision-resistance rather than confinement; that the `IShellAPI`
deep-freeze does not reach the plug-in's own function objects, so one extension can
reach a sibling's view component through the public registry and change what it
renders; that `unregister` has no authorisation model; and that a `FaultBoundary`
catches neither a throw from a `setTimeout` callback nor a rejected promise. The
contained case is asserted beside the uncontained ones so that "a fault boundary
catches nothing" is not the reading anybody takes away.
*Tests:* `src/__tests__/IntegrationSuite.test.tsx` — "carries a pane-2 selection
into pane 3 through the host store, not through the module", "keeps each module
pane-2 selection its own across Mail → Database → Mail", "releases the database
module 200ms interval, so the timer count returns to its baseline", "brings back
the layout and the foreground extension over the same storage" and "contains a throwing command inside the shared command guard, without taking the shell down".

**What ISSUE-003 added, and what it does not yet touch:**
`src/core/services/HydrationEngine.ts` owns the serialization and deserialization
of shell UI state — pane sizes, the pane-1 collapsed flag, the active extension id
and a per-extension scope of JSON-shaped state — and writes all of it into **one**
`localStorage` entry with a single `setItem`, so a record is replaced whole and a
half-written one is not constructible. A schema version travels with the payload,
and a version that is not the current one is **discarded, never migrated and never
spread into live state**: older, newer, missing and wrong-typed alike. There has
only ever been one version, so a migration would be a migration from a version that
never shipped. Every read is treated as untrusted input — corrupt or truncated
JSON, a payload of the wrong shape, `__proto__` and `constructor` keys, over-long
strings, an oversized entry and a payload nested past the depth cap are all refused
— and a payload that fails anywhere contributes **nothing**, rather than
contributing its good fields. Writes are debounced, so a whole divider drag
coalesces into one write. When storage is unavailable, disabled or throwing —
private mode, site data off, quota exhausted — the engine degrades silently to
in-memory rather than taking the shell down.
*Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — the whole of
"createHydrationEngine — a payload that is refused, one path at a time", which
walks corrupt JSON, truncated JSON and every wrong-shaped entry one at a time,
plus "discards a payload from an older schema version", "discards a payload from
a FUTURE schema version, rather than guessing at it", "discards a payload with no
version at all", "discards a version of the wrong type, so \"1\" is not 1" and
"discards an entry longer than MAX_RAW_LENGTH without even parsing it"; the whole
of "createHydrationEngine — hostile payloads", including "refuses a __proto__ key
inside an extension scope" and "refuses a deeply nested payload rather than
following it"; "applies none of a payload whose LATER field is illegal" for the
all-or-nothing rule; "coalesces a whole drag into one write"; and "runs with
persistence degraded to memory, and nothing throws" beside "degrades to memory
when reading localStorage throws".

Two tabs over the one entry are last-write-wins, and the unit of that is the whole
record: one `setItem` of one key means the loser's record is replaced rather than
interleaved with the winner's, and a write refused on quota leaves the previous
record exactly where it was.
*Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "the loser's whole
record is replaced, never interleaved with the winner's", "interleaving the two
tabs still produces one complete record" and "a write that fails on quota leaves
the previous record exactly as it was".

`src/hooks/useLocalStorageState.ts` is the React binding over it, and it hydrates
during the first render rather than in an effect, so a bound component paints the
restored value instead of painting a default and correcting it one commit later.
*Test:* `src/hooks/__tests__/useLocalStorageState.test.tsx` — "renders the persisted
value on the very first paint, and never the default".

**And what it is connected to, now that it is connected to something.** This
paragraph used to say the engine reached no component at all.
`src/components/layout/ShellLayout.tsx` now binds the pane-1 collapsed flag
through `useLocalStorageState`, takes a mount-time snapshot of the pane sizes for
its `defaultSize` props, writes every layout the panel group commits back through
`setSlot`, and restores the foreground extension through the engine's own
`selectActiveExtensionId`. `src/App.tsx` composes nothing for it: `ShellLayout`
resolves `getDefaultHydrationEngine()` when no engine is supplied, which is the
one instance the running shell uses.

**Three properties are worth stating exactly, because each is easy to claim and
easy to get wrong.** There is *no flash of the default layout* — the engine
hydrates synchronously in its constructor and the value is read during render, so
the restored number is in the shell's first render rather than applied by an
effect one commit later, and that is asserted on the render log rather than on the
final DOM. A *whole divider drag is one storage write*, because every frame is a
`setSlot` into one debounce window. And a *restored size that is no longer legal
never reaches a panel*: the engine discards a whole record holding a pane size
outside its `[2, 90]` band, and `ShellLayout` then clamps whatever survives into
each pane's own minimum and maximum at the width measured on this load.
*Tests:* `src/components/__tests__/ShellLayoutPersistence.test.tsx` — "renders the
restored pane sizes on the panel group first render, and the measured default
never", "renders the collapsed icon track on the first render, and the expanded
navigation panel never", "coalesces a keyboard-driven resize into one storage
write rather than one per frame", "discards a hand-edited record whose pane size
is outside the engine band, and renders the measured defaults", "clamps a restored
pane size that no longer fits the pane minimums at this width" and "renders,
resizes and collapses with a storage that throws on every access";
`src/__tests__/App.test.tsx` — "restores a layout the shell persisted through the
process-wide engine, with nothing wired up here".

**A persisted extension id the registry does not know activates nothing and
throws nothing, and is not erased either.** A lazily loaded extension is
indistinguishable from an uninstalled one, so the id is retained and the restore
is retried on every registry revision until it lands or until the user activates
something themselves. *Tests:* same file — "activates nothing and throws nothing
for a persisted extension id the registry does not know" and "stops waiting for
the persisted extension once the user activates a different one".

Registration and activation are complete. Registration validates, rejects
duplicates deterministically, and never throws. Activation
(`src/core/ActivationContext.tsx`) mints a real per-extension `IShellAPI` —
deep-frozen, badge-scoped to the extension it was minted for, and revoked by
**exactly two events**: that extension being released, and that extension being
unregistered. After either, every call through it throws `ShellUXError` with code
`REVOKED`. **Provider teardown is deliberately not a third**, and an earlier version
of this paragraph listed it as one; ADR-0001 Amendment F records why the two
implementations of it were both development-only outages that bought no security.
Revocation is immediate rather than eventual: liveness is re-checked on every
call and is keyed on the blueprint record the handle was minted against, so a
handle is dead from the statement after `unregister` — including when the same id
is immediately re-registered by somebody else in the same commit. The activation
*controller* — `activate`, `blur`, `release` — is kept out of an extension's
subtree by `ExtensionHostBoundary`, which is a **guardrail against an honest
mistake and not an enforced boundary**; see ADR-0001 Amendments D and E and the
"Security posture" section below. The surface that *uses* all of it now exists:
`ShellLayout` lists registered extensions in pane 1, activates one on selection,
mounts its `views.pane2` and `views.pane3` inside `ExtensionHostBoundary`, and
feeds its `commands` to the command registry. *Test:*
`src/components/__tests__/ShellLayout.test.tsx` — "renders both plug-in views
inside an ExtensionHostBoundary once activated".

The authoritative work breakdown is [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md).

This README deliberately carries no status badges. A badge asserting build
health, coverage or release state would be asserting something nobody has
measured on a codebase this young.

---

# The README's Documentation and Contributing sections, as they stood

> Also moved verbatim on 2026-09-18. The four standing rules below are still in force;
> their live home is `CLAUDE.md` ("Also standing" and "Vocabulary you must use
> precisely") and `CONTRIBUTING.md`.

## Documentation

| Document | Purpose |
|---|---|
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | The rules for anything written into this repository, including the no-local-environment-dependencies mandate and what to do when its checker fails. |
| [`DEVELOPER.md`](../../DEVELOPER.md) | Onboarding guide for third-party extension authors. |
| [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) | The five-issue work breakdown, with specs, edge cases and definitions of done. |
| [`docs/adr/0001-ioc-registry-architecture.md`](../adr/0001-ioc-registry-architecture.md) | Why a registry-based IoC contract, and what was rejected. Read **Amendment E** for why there is no boundary between extensions, **Amendment F** for the store freeze, and **Amendment G** for the rule that no security claim may be written without naming its test. |
| [`docs/adr/0002-no-local-environment-dependencies.md`](../adr/0002-no-local-environment-dependencies.md) | Why no tracked file may depend on one developer's machine, why the rule is enforced by a script rather than by review, and what the script cannot decide. |

---

## Contributing

The full rules are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md). The short version:

The project is pre-alpha and the core contract is still being written. The most
useful contribution right now is review of the specification in
`.github/ISSUES_MANIFEST.md` and of the architecture decision in
`docs/adr/0001-ioc-registry-architecture.md`.

Standing rules for anything written into this repository, including
documentation:

1. **Do not assert unmeasured results.** If it has not been benchmarked,
   audited or measured, label it a target and say so.
2. **Label aspiration as aspiration.** A reader must always be able to tell what
   exists from what is planned.
3. **Name the test, narrow the claim, or delete it.** No security claim goes into a
   `.md` file or a docblock without naming the test that exercises it. See "The rule
   that governs how those words may be used" under Security posture, and ADR-0001
   Amendment G for the seven rounds of evidence behind it.
4. **Nothing tracked may depend on one developer's machine.** No absolute path, no
   home or scratch directory, no login or machine name, no hardcoded host, address
   or undocumented port, no undeclared environment assumption, no platform-only
   script or path separator, no case-colliding filename, no committed line ending
   that contradicts `.gitattributes`. The acceptance test for any change is that a
   **fresh clone on a different operating system runs `npm ci && npm run verify`
   with no local setup and no edits.**

   Unlike rule 3, this one is not a convention: `npm run check:portability` decides
   every clause of it, it is the first step of `npm run verify`, and it is a CI step
   on all three operating systems. See
   [`docs/adr/0002-no-local-environment-dependencies.md`](../adr/0002-no-local-environment-dependencies.md).
