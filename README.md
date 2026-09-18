# LEAPWare-ShellUX

A local-first, pluggable application shell for web and desktop, built on the
Microsoft Outlook three-pane paradigm — without its ribbon, which this shell
deletes in favour of one command registry and four surfaces.

The host is a **shell, not an application**. It owns layout, lifecycle, routing
and persistence. It contains zero business logic. Everything a user actually
does comes from an extension that attaches through a type-safe inversion-of-
control registry.

---

## Project Status

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
| Three-pane resizable layout (ISSUE-002) | **Implemented and green, not yet merged.** `src/components/layout/ShellLayout.tsx`, `src/components/layout/PaneWrapper.tsx`, `src/components/command/ContextBar.tsx`, with 126 tests across `ShellLayout.test.tsx`, `PaneWrapper.test.tsx`, `ContextBar.test.tsx`, `ShellLayoutPersistence.test.tsx` and `ShellLayoutBadges.test.tsx` in `src/components/__tests__/` — five of which are ISSUE-004 fault-containment cases added to `ShellLayout.test.tsx`, and 33 of which are the ISSUE-003 persistence and issue-#12 badge cases, all inside the same 100% coverage gate. Not marked "landed" because it is unmerged — see [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) |
| State hydration and persistence (ISSUE-003) | **Engine implemented, green, and now consumed by the shell — not yet merged.** `src/core/services/HydrationEngine.ts` and `src/hooks/useLocalStorageState.ts`, with 146 tests in `src/core/services/__tests__/hydrationEngine.test.ts` and `src/hooks/__tests__/useLocalStorageState.test.tsx`, plus 25 tests in `src/components/__tests__/ShellLayoutPersistence.test.tsx` driving the assembled shell over a real storage, inside the same 100% coverage gate. `ShellLayout.tsx` restores and writes **three** slots — pane sizes, the pane-1 collapsed flag and the foreground extension id — and the utility drawer is deliberately not one of them |
| Row virtualizer and fault boundaries (ISSUE-004) | **Implemented and green, not yet merged.** `src/components/error/FaultBoundary.tsx`, `src/components/shared/VirtualizedList.tsx` and its pure arithmetic in `src/components/shared/virtualWindow.ts`, with 76 tests in `src/components/__tests__/FaultBoundary.test.tsx` and `src/components/__tests__/VirtualizedList.test.tsx`, inside the same 100% coverage gate. The virtualizer is a component an extension's own Pane 2 view renders — the host does not window your pane for you |
| Verification remotes and integration suite (ISSUE-005) | **Implemented and green, not yet merged.** The two verification remotes `src/mocks/MailPlugin.tsx` and `src/mocks/DatabasePlugin.tsx`, driven by 60 tests in `src/__tests__/IntegrationSuite.test.tsx` — the first place in this repository where an operational plug-in is mounted at all. It runs the assembled shell, not a double of it, and nine of its cases are `PINS A KNOWN LIMIT` characterisations of behaviour the architecture has accepted rather than prevented. It is outside the coverage `include` list on purpose: it exercises code the gate already covers, and adding an integration file to a 100% gate measures nothing new. See [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) |

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

The authoritative work breakdown is [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md).

This README deliberately carries no status badges. A badge asserting build
health, coverage or release state would be asserting something nobody has
measured on a codebase this young.

---

## Getting Started

### Prerequisites

| Tool | Requirement | Why this floor |
|---|---|---|
| **Node.js** | `^22.13.0 \|\| >=24` | Declared as `engines` in `package.json`. This is not a preference — it is the intersection of the `engines` constraints the dependency tree already carries. Two of those constraints are what removed the `^20.19.0` arm this project used to accept: **`electron`, which declares `>= 22.12.0`**, and `@testing-library/jest-dom` 7, which declares `>=22`. The arms that remain come from `eslint-visitor-keys` (via `@typescript-eslint`), whose `^20.19.0 \|\| ^22.13.0 \|\| >=24` is also the reason `>=24` is written as a separate arm rather than folding into `>=22` — it is what excludes the 23.x line. `test-exclude` contributes `20 \|\| >=22`, which rules out 21.x on the same principle. Nothing in the tree needs more. |
| **npm** | 10 or newer; 11.16.0 is what the lockfile was written with | Pinned as `packageManager` so a laptop reaching for yarn or pnpm errors instead of silently resolving a different tree from the version ranges in `package.json`. |
| **git** | any recent version | The portability check below enumerates tracked files with `git ls-files`. |

`.nvmrc` tracks the major version CI uses, so `nvm use` (or `fnm use`) picks the
right one without being told. CI reads the same file rather than duplicating the
number.

**Node 20 is no longer supported, and that is a policy change, not a side effect.**
The floor above used to start at `^20.19.0`. It cannot any more: `electron` is a
devDependency of this project and refuses to install below 22.12.0. Dev-only does
not soften that — this package is `private`, so there is no consumer who installs
it without dev dependencies, and the 20.x line stopped being installable here for
everyone regardless of what `engines` claimed. Declaring a
version the tree cannot install is worse than declaring one fewer version, so the
arm was removed rather than left standing as a promise nothing keeps.

**The floor is enforced, not suggested.** The tracked `.npmrc` sets
`engine-strict=true`, so a Node below the floor fails `npm ci` immediately with a
readable message. Without it npm's default is to print `EBADENGINE`, carry on, and
hand you a tree that breaks later somewhere unrelated.

**And the floor is now executed, not only enforced.** Until recently every job in
every workflow took its Node version from `.nvmrc`, and `.nvmrc` has always named
a version comfortably above the floor — so `engine-strict` had nothing to catch
and the lower bound was the one claim in this file that nothing tested. A
dependency could raise its own `engines` past the floor and every check would stay
green while a developer on a supported version got a hard `EBADENGINE` on `npm ci`.
The `Declared Node floor` job in `ci.yml` installs and tests on the exact lowest
supported version, so that gap now fails in CI instead of on a laptop.

No other setup exists. There is nothing to configure, no environment variable to
set, and no `.env` file — nothing in this repository reads one.

### Install and run

```bash
git clone <repository-url>
cd leapware-shellux
npm ci
npm run dev
```

`npm run dev` starts the Vite dev server on its default port, 5173, and prints the
URL. Opening it renders the three-pane shell **with ISSUE-005's two verification
remotes from `src/mocks/` registered** — a navigation tree with entries in it,
rows to select, contextual commands, and live badges. That is the working
demo, and it is what the browser test lane drives.

This is a **dev-server-only rewrite, not a change to what ships.** A middleware in
`vite.config.ts` resolves `/` to `dev.html`; it is installed under
`configureServer`, which `vite build` never calls, and `build.rollupOptions.input`
is still at its default of `index.html` alone. So `dist/` contains exactly what it
contained before, and `dev.html`, `src/dev/` and `src/mocks/` remain unreachable
from anything a user installs. There is no flag to set and no environment
variable — ADR-0002 forbids one without a working default; see
`src/dev/DevShell.tsx`.

**The production shell is still reachable by name.** Open **`/index.html`** on the
same dev server for the real composition root: `src/App.tsx` registers no
extensions, so you get the context bar's host actions, a resizable and collapsible pane
1 with nothing in it, and two empty panes. See Project Status above.
*Tests:* `e2e/dev-routing.spec.ts` — "serves the fixture shell at the bare root,
with both remotes registered", "keeps the URL at / rather than redirecting the
browser to /dev.html" and "leaves /index.html on the production shell, whose
registry is empty".

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot module replacement, on port 5173. |
| `npm run build` | Typechecks, then produces a production bundle in `dist/`. |
| `npm test` | Runs the Vitest suite once. |
| `npm run test:coverage` | Runs the suite and enforces the coverage gate in `vitest.config.ts` — 100% statements, branches, functions and lines over `src/core/**`, `src/components/**` and `src/hooks/**`. Everything else under `src/` is outside the gate. Exits non-zero if a threshold is unmet. |
| `npm run test:integration` | Runs `src/__tests__/IntegrationSuite.test.tsx` a **second** time under `--sequence.shuffle`, which is ISSUE-005's requirement that the integration cases pass in a randomised order. The flag lives here rather than in `vitest.config.ts` because that file is shared by all 35 test files and the wider suite has never been demonstrated to be order-independent. This entry used to assert that `src/core/__tests__/shellApi.test.ts` fails three of its own cases under `--sequence.shuffle`; **that claim has lost its evidence** — it has since passed 109/109 on every re-run, including under shuffle at different seeds — and it is neither reproduced nor disproven, because `--sequence.shuffle` reorders *files*, not cases. Treat it as unverified rather than as a known failure. Vitest prints the seed it used, and the seed defaults to the clock. |
| `npm run typecheck` | `tsc --noEmit`. Emits nothing; only checks. |
| `npm run lint` | ESLint at `--max-warnings 0`. There is no warning tier; a warning fails. |
| `npm run check:portability` | Enforces ADR-0002 — see below. |
| `npm run audit:prod` | `npm audit` over production dependencies at `--audit-level=high`. Needs network access. |
| `npm run verify` | **The gate.** Runs all of the above in order: portability, citations, tokens, lint, typecheck, coverage, the randomised integration run, the script tests, build, audit. **Ten stages, and CI now runs every one of them.** `.github/workflows/ci.yml` runs the first nine on each of three operating systems; `audit:prod` runs in `audit-dependencies.yml` and `audit-schedule.yml`. **This row used to say "CI applies five of those nine", and that was true for as long as it stood** — `check:citations`, `tokens:check`, `test:integration` and `test:scripts` had no leg anywhere, so four stages were backed only by an author ticking a box on a pull request that, per HANDOFF.md §5, nobody is required to review. Tracked as #58, which was closed while every stage it named still ran nowhere. Running `verify` locally is now genuinely redundant with CI, which is the point: it means a green run and a green laptop are the same claim. **One narrower gap survives and is not this one:** `audit:prod` is `npm audit --omit=dev`, so the dev tree is audited by nothing on any leg — that is a separate finding, not this row's. |
| `npm run test:browser:install` | Downloads Chromium for the browser lane. Once per machine, and **not** part of `npm ci` — see "The browser test lane" below. |
| `npm run test:browser` | Runs the Playwright suite in `e2e/` against a real Chromium. Deliberately **not** part of `verify`. |
| `npm run build:desktop` | Compiles the main and preload processes to `dist-electron/` with `electron/tsconfig.json`. A second TypeScript program, not a second opinion — the root config describes a browser document and these files run under Node. |
| `npm run package:desktop` | `electron-builder --publish never`. Names no platform, because `electron-builder` with no platform flag builds for the machine it is running on — which is what `scripts/check-portability.mjs` now requires. Reads `electron-builder.yml`; writes to `release/`. |
| `npm run verify:desktop` | **The packaging acceptance test**, and deliberately **not** a stage of `verify`. Builds the renderer, compiles the host, and packages an installer. Setting no environment variable at all produces a working **unsigned** artifact; `docs/signing.md` declares every name that changes that, and `docs/RELEASE.md` is the checklist for actually releasing one. It is outside `verify` for the reason the browser lane is: an Electron binary and a signing certificate sit outside `npm ci` and outside `package-lock.json`. |

### The acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That is the definition of done for every change in this repository, and it is
mechanically enforced rather than merely stated. `npm run check:portability` runs
`scripts/check-portability.mjs`, which scans every tracked file for absolute paths,
home and scratch directories, developer login names, hardcoded hosts, ports and
addresses, platform-only build commands, case-colliding filenames, committed
carriage returns and byte-order marks, and any relative import in `src/` whose case
does not match the tracked filename. It is a plain Node script with no
dependencies, and it fails the build.

The mandate itself is in [`CONTRIBUTING.md`](CONTRIBUTING.md); the reasoning, the
rejected alternatives and the honest limits of what a checker can decide are in
[`docs/adr/0002-no-local-environment-dependencies.md`](docs/adr/0002-no-local-environment-dependencies.md).

`verify` needs network access, for `npm ci` and for the audit's advisory-database
query. It is not an offline operation, and that is a declared property rather than
a surprise.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the same steps on
`ubuntu-latest`, `macos-latest` and `windows-latest`. Three legs rather than one
because this project is developed on more than one laptop, and because macOS
support used to be *inferred* from the platform-specific optional dependencies in
`package-lock.json` rather than observed. It is now observed.

"The same steps" is meant literally and was not always true — see the `verify` row
above for what CI used to skip and why that mattered. `ci.yml` carries a second job
beside the matrix: **the declared Node floor**, which installs and tests on the exact
lower bound in `package.json`'s `engines` rather than on `.nvmrc`. It exists because
`.nvmrc` has always named a version above the floor, so `engine-strict` never had
anything to catch and a dependency could raise its own floor past this project's with
every leg staying green. That is not hypothetical: it happened, and it is why the job
is there.

A fifth workflow, [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml),
packages the Electron application on Windows and macOS. It is not part of `verify`
for the same reason the browser lane is not — see the `verify:desktop` row above —
and it publishes nothing.

The production-dependency audit is a separate workflow on purpose. An advisory
database that updates daily and a lockfile that does not means the audit result can
change with no commit at all, so a per-push blocking audit would turn `main` red
for a defect nobody introduced. Instead it blocks when `package.json` or
`package-lock.json` changes — the only kind of commit that can introduce a
vulnerable dependency — and blocks weekly on a timer, which is what notices a newly
published advisory without blaming an unrelated commit. See
[`.github/workflows/audit-dependencies.yml`](.github/workflows/audit-dependencies.yml)
and [`.github/workflows/audit-schedule.yml`](.github/workflows/audit-schedule.yml).

[`.github/workflows/browser.yml`](.github/workflows/browser.yml) is a third,
separate workflow, and separate for a reason that is worth stating where a reader
will meet it: it needs a Chromium download, which `npm ci` does not perform and
`package-lock.json` does not pin. Folding it into `ci.yml` would mean the
acceptance test above no longer described what CI runs. It is Ubuntu-only and
Chromium-only, it caches the browser between runs, and it uploads the Playwright
trace when it fails. See "The browser test lane" under Testing and coverage.

---

## What this is

LEAPWare-ShellUX is the container. You bring the product.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONTEXT BAR (32px)  host commands ········ contextual commands     │
├───────────────┬───────────────────┬─────────────────────────────────┤
│  PANE 1       │  PANE 2           │  PANE 3                         │
│  navigation   │  master / list    │  detail                         │
│  240px        │  360px            │  floating toolbar (selection)   │
│  ↕ collapses  │  virtualized      │  header + scroll + drawer slot  │
│    to 48px    │                   │  omnibox composer, docked       │
└───────────────┴───────────────────┴─────────────────────────────────┘
                   Cmd-K opens the command palette, over everything
        ⇕                   ⇕                       ⇕
              all dividers user-resizable
```

An extension supplies a navigation entry, a Pane 2 list view, a Pane 3 detail
view, and a set of commands. The host renders them. The host never knows
whether it is showing email, inventory records, or something else entirely.

### Keyboard shortcuts on commands

A command may carry an optional `hotkey`: a **structured chord**, `key`
plus the optional `ctrl`, `alt`, `shift` and `meta` booleans, rather than a string
like `"Ctrl+Shift+K"` that would need a parser at the trust boundary.

> **Declared, validated and — since ISSUE-006 — dispatched.**
>
> `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener, attached to
> `window` in the **bubble** phase and called once by `ShellLayout`. A chord is
> live only for the **foreground** extension — ADR-0001 Amendment H Decision 6
> makes two extensions claiming `Ctrl+K` legal, so a shell-wide table would be
> ambiguous by construction — and only for an action that is **visible** and **not
> disabled**, through the same `isVisible` and `isDisabled` guards the button
> passes. A chord is suppressed outright when the event was already handled, when
> it is auto-repeat, while an IME composition is in flight, and while focus is in
> an `input`, `textarea`, `select`, a `contenteditable` subtree or an ARIA
> `textbox`/`searchbox`/`combobox`. **That list is a guardrail, not a boundary:** a
> plug-in that builds a custom editor out of a bare `div` will get chords fired
> into it, and its remedy is `stopPropagation()`, which the bubble phase
> deliberately leaves working.
>
> `aria-keyshortcuts` is now emitted, on exactly the actions that will fire — a
> chord-bearing action that is not disabled, on the bar and in the overflow menu.
> A disabled action gets none, because advertising a shortcut that does not fire
> is a lie to assistive technology in either direction.
>
> **The no-listener scan was narrowed rather than deleted, and both halves are now
> allowlisted.** ISSUE-004 scoped the key-event half to one named module for the
> list virtualizer and deliberately left the listener half absolute; a dispatcher
> is a global listener, so ISSUE-006 scoped that half too — to exactly
> `core/hotkeyDispatch.ts`. Both allowlists are exact in both directions, so a
> stale entry and an unreviewed widening each fail. What a source scan cannot see —
> that the one listener is really removed, with the identical function reference —
> is pinned at runtime instead. *Tests:*
> `src/__tests__/noEventListener.test.ts` — "finds no listener registration in any
> module outside the hotkey-dispatch allowlist", "finds no key-event name in any
> module outside the key-event allowlist", "holds the key-event allowlist to the
> exact spellings each listed module contains", "holds the hotkey-dispatch
> allowlist to the exact spellings the dispatcher contains" and "holds the
> dispatcher to exactly one addEventListener and one removeEventListener";
> `src/core/__tests__/hotkeyDispatch.test.tsx` — "adds exactly one keydown listener
> and removes the identical handler on unmount" and "registers once under
> StrictMode, whose simulated remount is symmetric".

What the host does enforce, at registration:

- **`key` must name one of 60 keys on the `HOTKEY_KEYS` allowlist** — the 26
  letters, the 10 digits, `f1`–`f12`, the four arrows and eight named navigation
  and editing keys. `tab` (it owns focus order), `space` (it activates the focused
  control), `escape` (it is the shell's dismissal key — it closes the context bar's
  overflow menu, cancels a drag, leaves fullscreen and dismisses a Radix dialog,
  and this project ships `@radix-ui/react-dialog`) and every modifier named as a
  key are deliberately absent.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — ribbon
  action hotkeys > accepts every key in the host allowlist", which also pins the
  size at 60 and asserts `escape` is not a member, and the `it.each` table
  "rejects %s as a hotkey key" beside it, which walks `escape` alongside `tab` and
  `space`.
- **A bare chord is refused, under two rules that are deliberately kept apart.** A
  **single-character** key (`k`, `7`) carrying no `ctrl`, `alt` or `meta` is
  refused under WCAG 2.2 §2.1.4 Character Key Shortcuts, Level A — see
  Accessibility below. Separately, **`enter`** is refused bare because it
  *activates the focused control* — the default button, a focused link, a table
  row — which is the same reason `space` is off the allowlist entirely. 2.1.4 is
  about *character* keys and does not reach `enter`, so the Enter refusal names no
  criterion and no level. **`Ctrl+Enter` stays legal**, and is the one genuinely
  wanted chord in that family.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
  activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4
  for enter, which is not a character key", "leaves the 2.1.4 message alone for a
  genuine character key" — the two together pin the split in both directions — and
  "accepts ctrl+enter, the one genuinely wanted chord in this family".
- **The same chord twice inside one extension is refused**, with the
  `ShellUXError` code `DUPLICATE_HOTKEY`. Scoped to one extension on purpose:
  chords are live only for the foreground extension, so two *different*
  extensions both claiming `Ctrl+K` is not a conflict and is not rejected.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  duplicate hotkeys within one extension > rejects the same chord twice, with
  DUPLICATE_HOTKEY on the second action" and "lets two DIFFERENT extensions
  declare the same chord".

`src/core/hotkeys.ts` exports four pure functions over a chord and nothing else:
`hotkeyToken` (the canonical token that deduplicates at registration),
`describeHotkey` (`"Ctrl+Shift+K"`, the spelling a user reads in a tooltip),
`ariaKeyShortcuts` (`"Control+Shift+K"`, the UI Events key values ARIA requires —
`Ctrl` is not a valid key value, which is why these are two functions) and
`matchesHotkey` (an exact match against the five keyboard-event fields it
declares). The dispatcher is a separate module, which is what keeps every one of
these callable on a plain record with no DOM.
*Test:* `src/core/__tests__/hotkeys.test.ts` — "hotkeys module — does not attach
anything > exports only pure helpers — the dispatcher is a separate module" and
"ariaKeyShortcuts > spells the control key Control, which describeHotkey
deliberately does not".

The author-facing contract in full is in [`DEVELOPER.md`](DEVELOPER.md) under
"`Hotkey` — a keyboard chord on a command"; the decisions and what was
rejected are ADR-0001 Amendment H.

### Architectural influences

- **Eclipse RCP / OSGi** — the extension registry model. Capabilities are
  declared and discovered through a registry rather than wired by direct
  reference.
- **VS Code** — the *shape* of a restricted API surface: an extension is handed
  one object describing everything it may ask for, rather than a reference to
  host internals. **Borrowed as an API-design idea, not as an isolation
  mechanism**, because VS Code does not provide one either. Microsoft's own
  runtime-security documentation states that the extension host runs with the
  same permissions as VS Code itself, and that an extension can read and write
  files, make network requests and run external processes. Their protection model
  is vetting, publisher verification and a trust prompt — reputation, not
  enforcement. An earlier version of this line said extensions "cannot reach into
  the host or into each other"; that was false about this shell and false about
  VS Code. What ShellUX takes is the restricted-object contract; see "Security
  posture" below for what that contract does and does not deliver here.
- **Vite** — local-first, lazy module loading. Extensions load on demand, from
  local modules, with no build-time coupling to the host and no network
  dependency for the shell to function.

The registry decision and its rejected alternatives are recorded in
[`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md).

---

## Design system: high-density desktop

This is a **desktop information tool**, not a mobile web page. The density is a
deliberate, enforced constraint, not a stylistic preference.

| Property | Rule |
|---|---|
| Padding | `p-1` to `p-3`. Nothing looser in shell chrome. |
| Base type | 11px – 13px. |
| Borders | 1px, `border-border-default`. One declaration, every theme. |
| Colour | Always a semantic token. No palette literal, no `dark:` variant. |
| Pane 1 | 240px default, collapses to a 48px icon track. |
| Pane 2 | 360px default. Virtualized by the extension's own view, with the host's `VirtualizedList`. |
| Pane 3 | Flex. Own header, own scroll container, utility drawer slot. |

Airy mobile-web spacing is explicitly out of scope. A user of this shell is
expected to be looking at a lot of rows on a large screen and to value seeing
more of them over seeing them spaciously.

---

## Performance Targets (unverified)

**No benchmark has been run. Not one.** The figures below are the targets this
project is being designed toward. They are **goals, not measurements**, and
must not be quoted as characteristics of the software.

| Target | Status |
|---|---|
| Smooth scrolling of a 100,000-row list in Pane 2 at 60fps | Unverified — no benchmark has been run |
| Sub-millisecond layout recalculation on pane resize | Unverified — no benchmark has been run |
| Extension activation without a visible frame drop | Unverified — no benchmark has been run |
| Shell boot to interactive without a flash of default layout | Unverified — no benchmark has been run |

These numbers exist to tell implementers what "fast enough" is supposed to mean
and to give the eventual benchmark suite something to fail against. They are not
claims. When a benchmark harness exists and has been run on defined hardware
with a stated methodology, this section will be replaced with measured results
and the hardware they were measured on. Until then, every row above reads
"unverified" because every row above *is* unverified.

If you find any of these figures repeated elsewhere as a statement of fact,
that is a documentation bug — please report it.

---

## Accessibility

> **CHANGED 2026-08-03.** This section said **"This project targets WCAG 2.2
> Level AA"**, and that sentence is withdrawn rather than left standing. The
> owner's decision, recorded in `PRODUCT.md`, is **best effort with no stated
> conformance target.** A target nothing commits to is a claim without a test,
> and this project's own rule is that such a claim is narrowed to what is
> measured or deleted. The old sentence is quoted here rather than erased,
> because the record of what was claimed is worth more than a clean page.
>
> This is a narrowing of a *claim*, not a withdrawal of *work*. Everything below
> that has a test behind it still has that test behind it, and the three floors
> named next are enforced by gates that run on every pull request.

**There is no stated conformance target.** Three floors are real, because each
one is enforced mechanically rather than asserted:

- **Contrast pairs are gated.** `design/check-contrast.mjs` fails a semantic
  colour token with no row in `design/contrast-manifest.json`, and fails a row
  naming a token that does not exist. Individual manifest rows still cite the
  WCAG criterion they were measured against, because a measured ratio is a
  measurement whatever the project's overall posture is.
- **Focus is visible, measured on painted pixels.** `e2e/focus-visibility.spec.ts`
  runs in a real browser, which is the only place this is observable at all.
- **Colour is never the only channel.** Status carries a word or a mark as well
  as a hue.

Not committed to, and named so that no reader infers otherwise: screen-reader
semantics, any assistive-technology verification at all (still open: #60 — none
has ever been run against this application), reduced motion beyond what the two
existing motion tokens imply, and internationalisation or RTL (still open: #66).
Still open: #55, which records that an AA target was unattainable as written
anyway, because extensions render two of the three panes and are given one
accessibility obligation.

Work that was done under the old target, and still stands on its own tests:

- 4.5:1 contrast for body text, 3:1 for large text and for UI component
  boundaries.
- Full keyboard operability, including pane dividers, commands, and list
  navigation.
- Visible focus indication that survives the high-density styling.
- Accessible names preserved when Pane 1 collapses to its 48px icon track.
- Correct landmark and region structure across the context bar and three panes.

**Partly delivered by ISSUE-002, and one deliberate deviation to record.** The last
two items above now have code and tests behind them: pane-1 entries keep their
accessible names in both the expanded and the 48px-collapsed state, each pane is a
labelled region, and the dividers are keyboard-operable — that last one is
`react-resizable-panels`' own window-splitter implementation, not the host's.
*Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "keeps the accessible
name of every pane-1 entry in both states", "names all three panes as regions",
"makes every divider keyboard-reachable and actually resizes with the arrow keys";
`src/components/__tests__/PaneWrapper.test.tsx` — "exposes the pane as a labelled
region carrying its pane id".

**The deviation:** the context bar uses `role="toolbar"` with every button individually
tabbable, *not* the roving-tabindex pattern the ARIA authoring practices recommend
for a toolbar. That was originally decided because a roving pattern needs an
arrow-key handler and no module under `src/` was permitted to name one. ISSUE-004
changed the second half of that: `src/components/shared/VirtualizedList.tsx` is now
allowlisted for exactly that reason, so the context bar's deviation stands on the
narrower ground it always really had — the bar has not needed the pattern. And
ISSUE-006's dispatcher did **not** change it either: that listener is on `window`
and routes declared chords, it puts no arrow-key handler on the toolbar, and every
context-bar control remains individually reachable by Tab. Recorded here rather than
left for an auditor to find. *Tests:*
`src/__tests__/noEventListener.test.ts` — "finds no key-event name in any module
outside the key-event allowlist" and "holds the key-event allowlist to
the exact spellings each listed module contains".

**List navigation is no longer scope.** `VirtualizedList` implements the single-tab-stop
`aria-activedescendant` listbox pattern — arrow keys, Home/End, Page Up/Down, and
scroll-into-view by assigning the container's own `scrollTop` rather than by
calling `scrollIntoView`. *Tests:*
`src/components/__tests__/VirtualizedList.test.tsx` — "keeps a single tab stop on
the container rather than roving focus onto rows", "moves by row with the arrow
keys and clamps at both ends", "moves by a viewport at a time with Page Up and Page
Down" and "scrolls the selected row into view by assigning scrollTop on its
own container".

**The context bar's overflow menu is a second exception, and it is worth being precise
about why that is not a contradiction.** Inside the menu the arrow keys, Home/End,
typeahead, Escape and outside-click dismissal all work, because the menu is
`@radix-ui/react-dropdown-menu`. That handling lives in `node_modules`, not in
`src/`, so the no-listener invariant is untouched — that test's own
docblock states the limit it has always had, under "What is not asserted": "a handler
installed by a third-party module `src/` merely imports — would pass".
`PanelResizeHandle` in `ShellLayout.tsx` is
the same arrangement. The invariant is a claim about the host's own modules, not a
claim that the shell has no keyboard behaviour.

**An accessibility audit on 2026-07-31 found eight blockers, and the fixes closed
those eight. That is the whole of the claim.** It is not an audit against the full
WCAG 2.2 AA criteria set, it was not performed by an external auditor, and it does
**not** move this project to conformance — the paragraph at the top of this section
still stands: there is no stated conformance target, AA included. What changed is
that eight specific, reproducible defects that had been found are no longer present:

- The overflow menu was **clipped to zero height** by two `overflow-hidden`
  ancestors, which made it invisible and unclickable rather than merely awkward. It
  is now portalled under `document.body`, outside every clipping ancestor by
  construction. *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "renders the menu outside the context bar, which is what un-clips it".
- Activating a menu item **dropped focus onto `document.body`**, so the next Tab
  restarted from the top of the document (WCAG 2.4.3). Focus now returns to the
  trigger however the menu closed. *Tests:* same file — "returns focus to the trigger
  after an item is activated, not to document.body" and "closes on Escape and puts
  focus back on the trigger".
- `role="menu"` **promised an interaction model that did not exist** — arrows did
  nothing, Escape did not close, focus never entered, and an outside click left it
  open. Screen readers switch to application mode inside a menu and hand the arrow
  keys to the page, so the role actively misled the user. The full menu-button
  pattern is now real. *Tests:* the whole of "ContextBar — the overflow menu keyboard model", including "moves focus into the menu when it opens", "walks the
  items with the arrow keys, which is what the role promises" and "closes when the
  pointer goes down outside it".
- The menu is deliberately **not modal**, so opening it does not hide the rest of the
  shell from assistive technology. *Tests:* same file — "does not modally hide the
  rest of the shell while the menu is open".
- `aria-controls` **dangled at a non-existent id** while the menu was shut; it is now
  advertised only while the menu exists. *Tests:* same file — "advertises
  aria-controls only while the menu exists, so the id never dangles".
- An unavailable action used the native `disabled` attribute, which **removes it from
  the tab order entirely** — a screen-reader user could not discover that the action
  existed. It is now `aria-disabled`: reachable, announced, and still inert. *Tests:*
  same file — "marks an unavailable command aria-disabled rather than removing it from the tab order, on every surface" and "leaves a disabled menu item focusable, announced, and inert".
- Contrast and target-size defects in the shell chrome: muted body strings that
  failed 4.5:1 in dark mode, selection shown by fill alone, dividers too faint to
  read as controls, and rows below a 24px minimum. *Tests:*
  `src/components/__tests__/ShellLayout.test.tsx` — the whole of "ShellLayout —
  contrast and target size", including "routes every muted body string through one
  token instead of a per-theme patch", "carries the selected navigation state on a
  rule and a weight, not only a fill", "draws the dividers from the control tier
  rather than from the border tier", "gives every navigation row a 24px minimum
  height" and "gives every context-bar control a 24px minimum height".

  The first and third titles were renamed when the colours became design tokens,
  and the rename is the finding rather than a tidy-up: the muted-text case named a
  **dark-mode value**, and there is no longer a per-theme value for it to name —
  `--text-muted` resolves per theme and clears 4.5:1 on all eight surfaces, so the
  hand-written override beside every muted string is gone. What each case can
  still prove in jsdom is structural, and the titles now say so. **The ratio half
  moved to a lane that can measure it**: `npm run tokens:check` re-measures every
  declared pair against the shipped stylesheet, and `e2e/theme.spec.ts` — "clears
  the declared contrast ratios on rendered pixels in the light (the default)
  theme" and "keeps muted body text above 4.5:1 on the pane it is drawn on, in
  every theme" — computes the ratio from the colours a browser actually painted.
- A badge count folded a **bare digit into the button's accessible name**, and
  dividers were not reported as vertical separators. *Tests:* same file — "names the
  badge count instead of folding a bare digit into the button name" and "reports every
  divider as a vertical separator".

**One criterion is already enforced by the host rather than being scoped work.**
A plugin-declared `hotkey` whose `key` is a single character and which carries no
`ctrl`, `alt` or `meta` modifier is **refused at registration**, with a message
naming WCAG 2.2 Success Criterion **2.1.4 Character Key Shortcuts (Level A)**.
`shift` does not satisfy the rule, because Shift produces a character too.
2.1.4's three conformance routes — turn the shortcut off, remap it, or make it
active only on focus — need a settings surface, a remapping UI or a
component-scoped dispatcher, and the shell offers none of the three: ISSUE-006's
dispatcher is extension-scoped, not component-scoped, which is exactly the route
this rule was written not to rely on. So the criterion is met the fourth way: the
declaration does not happen. Function keys and the
named navigation keys are exempt **from this criterion**, because no dictation and
no typing produces them — `enter` is refused bare by a different rule, below, and
not by this one.
*Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the WCAG
2.1.4 modifier rule for character keys > rejects a bare single-character key and
names the criterion", with "rejects shift alone, because Shift produces a
character" and "exempts every non-character key in the allowlist, which may be
bare" beside it.
This is one rule at one door, not an audit: it is **entry-point validation** in
the vocabulary of "Security posture" below. It is enforced at the declaration door
only, and there is deliberately no second suppression inside the dispatcher — see
ADR-0001 Amendment I Decision 3, and "Keyboard shortcuts on commands" above.

**A second bare-chord rule shares that door and is deliberately not this
criterion.** `enter` is on the allowlist but may never be declared bare, because
Enter **activates the focused control** — the default button, a focused link, a
table row — so a bare Enter chord would fire on top of the activation the user
asked for. That is the same failure mode `space` is excluded outright for, and it
has nothing to do with 2.1.4: the criterion governs single printable *character*
keys and genuinely does not reach `enter`, `backspace`, `delete` or `insert`.
Extending the 2.1.4 message to cover Enter would have been the smaller change and
would have stated something false about the criterion, so the refusal carries its
own message, naming the activation and ADR-0001 Amendment I — no criterion, no
level. `shift` satisfies neither rule; `Ctrl+Enter` is accepted and is the chord
this family was wanted for.
*Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4 for
enter, which is not a character key" asserts the Enter message names neither
2.1.4, nor Character Key Shortcuts, nor Level A, and "leaves the 2.1.4 message
alone for a genuine character key" asserts the character-key message still names
the criterion — so a future edit merging the two fails one of them whichever way
it merges; with "rejects a bare enter, which activates the focused control",
"rejects enter with shift only, because Shift does not stop the activation" and
"accepts ctrl+enter, the one genuinely wanted chord in this family" beside them.

**This commitment constrains the architecture, and the constraint is recorded
rather than discovered later.** ARIA IDREF attributes — `aria-labelledby`,
`aria-describedby`, `aria-controls`, `aria-activedescendant`, `aria-owns` — resolve
**within a single document**. A context-bar control cannot point at a listbox in another
document, and focus order and roving-tabindex composite widgets stop at a document
boundary. So full keyboard operability across the context bar and panes **cannot be
delivered if extensions render into separate documents**, which is what real
per-extension isolation via iframes would require. That trade-off is the reason
isolation was not chosen now, and it is written down in ADR-0001 Amendment E
together with the condition that overrides it.

### AAA as a stretch goal — and its known conflicts

Level AAA is recorded here as an aspiration only. It is **not** targeted,
and it is currently contradicted by the design system in specific, concrete
ways:

- **Contrast, 1.4.6 Contrast (Enhanced).** AAA requires a 7:1 contrast ratio for
  text. **The AA half of this is now closed and the AAA half is not.** The border
  token was `border-neutral-200`, roughly **1.2:1** on white — not a near miss
  but an order of magnitude from AAA, and below the 3:1 AA threshold for non-text
  UI boundaries as well. `--border-default` replaces it at **3.95:1** on the pane,
  and the boundaries that must be *perceived* to be operated each got a token
  chosen for that job: `--control-divider` at 5.94:1 on the app background for
  the pane divider, `--focus-ring` at 6.41:1 on its offset, `--border-selected`
  for the selection rule. Measured across three themes by
  `npm run tokens:check`, and measured again on rendered pixels by
  `e2e/theme.spec.ts`.

  **This made the shell visibly heavier, and that was the point.** CHANGELOG.md
  announces it. What remains open is AAA itself: 7:1 for text is met by
  `--text-primary` and not by `--text-muted`, which is specified at 4.5:1 across
  all eight surfaces rather than at 7:1 on one.
- **Visual presentation, 1.4.8.** AAA calls for user-adjustable line spacing of
  at least 1.5× and block spacing of 2.25×, plus text blocks no wider than 80
  characters. A high-density shell built on `p-1`–`p-3` padding and 11px–13px
  type is in direct tension with this. Meeting it would mean abandoning the
  density that is the product's reason for existing.
- **Target size, 2.5.5.** AAA asks for 44×44 CSS pixel targets. A 48px collapsed
  icon track can accommodate this; 11px-type commands at `p-1` cannot,
  without redesigning the context bar.

Anyone who tells you a 1.2:1-hairline interface is WCAG 2.2 AAA compliant is
mistaken. This project has never made that claim, and clearing the 3:1 AA
boundary threshold does not bring it any closer to making one.

---

## Testing and coverage

Tests run under Vitest, in jsdom — with one lane that does not, described below.

Coverage is enforced as a **build gate**, not reported as an achievement, and
the gate is checkable rather than aspirational: `.github/workflows/ci.yml` runs
`npm run test:coverage` on every push to `main` and every pull request, and
Vitest exits non-zero when a threshold set in `vitest.config.ts` is unmet, which
fails the job. The threshold applies **per module, as each module lands** — a
module cannot merge below the gate, and modules that do not exist yet are not
counted for or against anything.

There is deliberately no coverage percentage in this README and no coverage
badge. A project-wide figure would be meaningless while most of the project is
unwritten, and a badge would imply a verified state that does not exist. When
there is a meaningful, measured, project-wide figure produced by CI, it will be
reported with the date and commit it was measured at.

### The browser test lane, and what coverage does not tell you

**A 100% coverage gate over code that is never laid out is a weaker statement
than it sounds.** jsdom has no layout engine: every `getBoundingClientRect`
answers 0×0, no ancestor clips anything, and no pointer ever hit-tests. Two of
the worst defects this project has had were geometric, and the suite was green
through both — the context bar's overflow menu **clipped to zero visible pixels** by
two `overflow-hidden` ancestors while six tests asserted it worked, and a case
named for surviving "a divider drag in flight" that **never started a drag**,
because a 0×0 rect cannot intersect a 12px hit area. Both lines of code were
covered. Neither behaviour was.

`e2e/` closes that gap with Playwright against a real Chromium: measured pixels,
real ancestor clipping, `elementFromPoint`, a real pointer drag, a real reload
and real keyboard focus. It is run with `npm run test:browser`, after a one-time
`npm run test:browser:install`, and
[`.github/workflows/browser.yml`](.github/workflows/browser.yml) runs it on every
pull request and every push to `main`.

**It is not part of `npm run verify`, on purpose.** Playwright needs a browser
download that `npm ci` does not perform and `package-lock.json` does not pin —
which is precisely the "local setup" the acceptance test above rules out. So the
lane gets its own script and its own workflow, and the `npm ci && npm run verify`
promise stays true exactly as written rather than being softened to accommodate a
test. The cost of that choice is stated rather than hidden: a fresh clone runs
`verify` and gets no browser coverage until it runs the install step, and CI is
where the lane is guaranteed to have run.

The two defects above each have a regression case, and both were confirmed to
fail when the fix is reverted rather than merely to pass while it is present.

---

## Security posture

The shell treats every extension as untrusted code running in the same page.
This is honest about its limits: same-origin JavaScript extensions are not
sandboxed from the DOM, and the shell does not pretend otherwise.

### Three words, used precisely

Every claim below is labelled with one of these, and the labels are load-bearing.
If a sentence anywhere in this repository asserts a security property without
being placeable in one of these three categories, treat it as a documentation bug
and report it.

| Term | What it means | What it survives |
|---|---|---|
| **Integrity control** | Real and unconditional. | Any caller, however hostile. |
| **Entry-point validation** | Real at the documented door. | An honest caller and a confused one; **not** a caller who reaches internals another way. |
| **Guardrail** | Prevents honest mistakes only. | A typo, a copied snippet, a misread guide. **Enforces nothing against deliberate action.** |

### The rule that governs how those words may be used

> **No security claim may appear in prose — in any `.md` file or any docblock —
> unless it names the test that exercises it.**

Three ways to satisfy it, and all three are acceptable outcomes:

1. **Name the test.** Append the file and the `it(...)` description that asserts the
   property.
2. **Narrow the claim** until an existing test does assert it. A narrower true
   sentence is worth more than a wider one nobody checked.
3. **Delete the claim.** If nothing exercises it and a test cannot cheaply be
   written, the sentence goes. That is the rule working, not a failure.

**Why this rule exists.** Seven consecutive review rounds found the same defect, and
in every one of them the *code was sound*: a conclusion had been written one step
wider than the premise licensing it. Fixing the mechanism each time did not stop the
next sentence from doing it again, because the mechanism was never what was wrong.
Requiring a named test forces the author to go and look at what is actually asserted
before writing the word *cannot*. The seven-round history and each site is recorded in
ADR-0001 **Amendment G**.

**It is a review-time convention. No script checks it**, and the ADR says so
plainly — see Amendment G. A reader who finds a security sentence in this repository
with no test named beside it has found a documentation bug; please report it.

### The one limit to read before anything else

**There is no enforceable boundary between two extensions, and there will not be
one while extensions are scripts on this page.** Any code on the page reaches
`document.body.firstElementChild`, enumerates its own properties to find React's
`__reactFiber$…` expando, and walks the fiber tree to every hook value in the
application — the activation controller, the map holding every extension's
`revoke`, and the state store. No DOM ref is needed, nothing has to be exported,
and severing a React context does not remove a fiber from the tree.

This is reproduced, not hypothesised: `src/core/__tests__/reflection.test.tsx`
performs the escalation and asserts that it succeeds, precisely so that nobody
later mistakes a guardrail for a guarantee. Mitigations were investigated and
rejected with evidence — see ADR-0001 **Amendment E**, which also records the
firm condition under which this posture is void and real isolation becomes
mandatory.

What follows is therefore about **the host's own integrity** and about
**accidental collision between mutually untrusting extensions**. It is not about
defending one extension from another.

### Integrity controls — unconditional

- **The state store cannot be subverted.** Two halves. Its state is unreachable:
  `createShellStateStore` holds `context`, `badgeCounts`, `listeners` and
  `notifyDepth` as closure variables, and JavaScript has no reflective API for a
  scope — no `Object.keys` for a closure, no `Reflect` operation that enumerates
  one, nothing on a function object that exposes what it captured. A caller who
  walks the fiber tree obtains the store's six *methods* and never the state behind
  them. And its methods are its own: the store object is **frozen**, so no holder
  can replace, delete or add a member, and every one of the six validates its
  arguments. **Therefore no caller, however hostile, can put a value of the wrong
  shape into this store's context** — every value that enters it through this store
  is well-typed, which is what the cross-plugin object-injection argument at
  `src/core/types.ts` needs.
  *Tests:* `src/core/__tests__/reflection.test.tsx` — "gets the store methods, cannot
  replace one, and cannot put an illegal value through one", "never reaches the badge
  map itself, because it is a closure variable"; `capability.test.tsx` — "the store
  handed out by useShellStore is frozen"; `contextPatch.test.ts` — the whole file.

  > **Corrected three times, and the third correction is the reason for the rule
  > above.** (1) The bullet once read "`RibbonContext`'s declared types are true at
  > runtime for every caller, however hostile … the strongest true claim in the
  > codebase" while the store object was a plain mutable literal: a plug-in view
  > swapped `setSelectedItem` through the public `useShellStore()` and swallowed
  > another extension's writes. (2) The store was frozen and the claim narrowed to
  > **this object's** integrity — it is not a promise about what an arbitrary
  > component is handed, because the store is published through React context and a
  > caller who reaches fiber state reaches a published context value the same way
  > (Amendment E). (3) The sentence *still* carried a trailing clause — "or
  > intercept, suppress or forge the writes and reads another holder makes through
  > it" — which is **false and has been deleted.** Same shape as (1): the premise is
  > about *replacing a member*, and `subscribe` needs nothing replaced. See the
  > limit stated immediately below.
- **The limit of the bullet above: a listener is untrusted code inside your write.**
  `subscribe` is one of the six frozen members and is reachable through the public
  `useShellStore()`. A listener runs **synchronously inside another holder's write
  in the same renderer**, so it can *observe* every value written there, *re-enter*
  the store and leave its own value standing instead, and *throw into the writing
  frame* — including a non-`ShellUXError`, and including a throw that starves every
  listener ordered after it, a subscribed pane in that renderer included. Freezing
  the store does not touch any of this, because nothing is replaced. It is not
  closable either: a store that notifies nobody is a store no pane can render off.
  **The "in the same renderer" qualifier is a correction, not a hedge**: once panes
  are separate processes (`src/core/ipc/**`) a write is applied and notified locally
  and then posted, so a listener in another renderer runs a message later and has no
  frame of yours to throw into. The favourable half and the unfavourable half of that
  are both real — see `ShellStateStore.subscribe` in `src/core/ShellAPI.ts`.
  *Tests:* `src/core/__tests__/subscribe.test.tsx` — the whole file, in particular
  "sees the new value synchronously, before the writer returns, within one
  renderer", "leaves the
  attacker's value in place and not the host's", "desynchronises a victim pane that
  subscribed through useShellContext" and "delivers a raw TypeError out of
  patchContext".
- **Deep-frozen API contexts.** `createShellAPI` returns a recursively frozen
  `IShellAPI`, so an extension holding an instance cannot swap a method out from
  under another holder. It does **not** follow that calls through it are unobservable
  — see the listener limit above.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "is deep-frozen: strict-mode
  reassignment throws", "is deep-frozen: sloppy-mode reassignment is a silent no-op",
  "cannot have its prototype swapped", and "deepFreeze — hostile objects cannot make
  it throw".
- **A normalised, host-owned record is what gets stored.** Reading each untrusted
  value once is necessary but not sufficient, because a value the plugin can
  still reach is a value the plugin can still edit. So registration ends by
  building a fresh record: every validated scalar copied into a fresh primitive,
  every collection rebuilt as a fresh array of exactly the length that was
  bounds-checked, the whole thing frozen at every host-owned level before it is
  stored. `getExtension` returns that record, not the plugin's object. A plugin
  editing its blueprint after registration — or a Proxy reporting one `length`
  while it is measured and a larger one afterwards — cannot change what the host
  holds. Component and handler references are deliberately carried across
  unchanged and unfrozen; see the accepted limits below.
  *Tests:* `src/core/__tests__/registryNormalization.test.tsx` — "register — the
  stored record is host-owned", "register — a lying `length` cannot grow the payload
  after it is measured", "is unaffected by the plugin mutating its own blueprint
  afterwards"; `registrySecurity.test.tsx` — "register — a shifting id cannot hijack
  another extension".
- **A `Map`, not an object literal.** This is the one remaining use of the word
  *structural* worth keeping: registry and badge keys come from plugin manifests,
  and a `Map` has no prototype chain, so a key named `__proto__` or `constructor`
  stores a plain entry and can never reach `Object.prototype`. Prototype
  pollution is impossible by construction rather than by filtering.
  *Tests:* `src/core/__tests__/registrySecurity.test.tsx` — "register — a shifting id
  cannot smuggle a reserved key into the store", which asserts both that the id is
  refused and that no live key is ever `__proto__`.
- **A registry that cannot be crashed or hijacked by its input.** `register`
  returns a typed failure instead of throwing, for every malformed payload
  including one that throws or resists inspection from its own property getters.
  Duplicate ids are a deterministic reported failure, never a silent overwrite.
  The failure it returns is always an error the host constructed itself, with a
  `code` from the host's own enum — never an error object handed back out of
  plugin code. This is `register`'s contract, not the exported `validateBlueprint`'s.
  That one throws rather than returning a result, and every rejection it decides on is
  a `ShellUXError` — the raw `TypeError` it used to leak from five `Array.isArray` sites
  on a revoked `Proxy` was closed in Phase 1, *test:*
  `src/core/__tests__/validation.test.ts` — "validateBlueprint — a revoked Proxy". A
  throwing property getter on the payload still propagates out of it untyped, which is
  an open follow-up recorded in `.github/ISSUES_MANIFEST.md`, so prefer `register` for
  input you did not author.
  *Tests:* `src/core/__tests__/registry.test.tsx` — "register — hostile payloads never
  crash the host", "register — duplicate ids"; `registrySecurity.test.tsx` — "register
  — thrown values that resist inspection", "register — a getter that detonates late
  still cannot escape"; `registryNormalization.test.tsx` — "register — a weaponised
  ShellUXError cannot be relocated into the host".
- **Revocation is immediate and cannot be resurrected.** A handle's liveness is
  re-asked on every call and is keyed on the host-owned blueprint record it was
  minted against — not on the id still being registered. So `unregister` kills
  the handle from the very next statement, and `unregister` followed by a
  re-`register` under the same id in the same commit does not hand the previous
  vendor a live handle into the new one's scope.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "revocation on unregister is
  synchronous", "re-registering an id does not resurrect the previous handle";
  `dataflow.test.tsx` — "mints a live IShellAPI on activation and revokes it on
  release", "revokes when the extension is unregistered".

  Two things this does *not* cover, both deliberate: provider teardown revokes
  nothing (Amendment F), pinned by "does not revoke, and the write it lets through
  cannot reach a live shell" in `capability.test.tsx`; and revocation says nothing
  about *who may revoke* — the controller carrying `release` is reachable by
  reflection, pinned in `reflection.test.tsx`.

- **The host constants cannot be replaced.** `EXTENSION_ID_PATTERN`,
  `RESERVED_IDS`, `REGISTRY_LIMITS`, `HOTKEY_KEYS`, `HOTKEY_MODIFIER_REQUIRED_KEYS`
  and `PANE_IDS` are the rules every untrusted payload is measured against, they
  are exported from modules a plug-in can import, and until ADR-0001 Amendment K
  every one of them was runtime-mutable — `REGISTRY_LIMITS` was `as const`, which
  binds nobody who is not being compiled. All six are frozen. No own property can
  be added, replaced or deleted, so `REGISTRY_LIMITS` is genuinely immutable and
  the sets' and pattern's `has`/`test` cannot be **shadowed** by an own property,
  which was the interesting attack: a plug-in owning `HOTKEY_KEYS.has` owned the
  hotkey allowlist for the whole page.

  **The obvious wider reading is false and is asserted against.** A frozen `Set`
  is not an immutable one — `Set` state lives in internal slots rather than
  properties, so `add`, `delete` and `clear` still work. The claim is "cannot be
  replaced", never "cannot be changed".
  *Tests:* `src/core/__tests__/hostConstants.test.ts` — "freezes the host constants
  against replacement", "refuses to let a caller raise a registry bound" and "does
  not claim more than a frozen Set delivers", the last of which demonstrates the
  remaining mutability on a throwaway `Set` rather than on a live allowlist.

### Entry-point validation — real at the door, bypassable elsewhere

- **Identifier hygiene.** Every plugin-supplied id — the extension id, navigation
  node ids, ribbon action ids, badge node ids, badge scopes — must match a strict
  allowlist and is refused if it is a prototype-pollution key. Rejection messages
  describe an untrusted value by its `typeof` and never stringify it, so a hostile
  `toJSON`, a `Symbol.toPrimitive` or a cycle cannot run code or throw a raw
  `TypeError` out of the host.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — identifier
  hardening"; `contextPatch.test.ts` — "patchContext validates the two identifier
  fields", "refuses a value that throws from every route to a string";
  `shellApi.test.ts` — "the badge scope and node id are validated at both doors",
  "setBadgeCount rejects an unstringifiable nodeId with a ShellUXError".
- **Bounds.** Text lengths, navigation node count, navigation depth and ribbon
  action count are all capped, and the cap applies to what is stored rather than
  to a number the payload can revise afterwards.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — text
  fields", "— navigation tree", "— commands";
  `registryNormalization.test.tsx` — "register — a lying `length` cannot grow the
  payload after it is measured"; `registrySecurity.test.tsx` — "validateBlueprint —
  collection lengths are read once".
- **Argument validation on `IShellAPI`.** Every member that takes an argument
  checks it and raises `ShellUXError` rather than letting an arbitrary value reach
  the context snapshot the host passes to *other* extensions — the six writers and
  readers the interface has grown to since ADR-0001 Amendment K, not just the two
  it had. `patchContext` — the unscoped store member the same values can reach
  through the public `useShellStore()` — is held to the identical standard field by
  field, and a collection field is read once into a host-owned copy that is what
  gets validated and stored.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "setSelectedItem validates its
  argument", the "setSelectedItems validates its argument" group, "setActiveNavNode
  validates its argument", "the badge scope and node id are validated at both
  doors"; `contextKeys.test.tsx` — "setContextKey validates its value";
  `contextPatch.test.ts` — "patchContext rejects what setSelectedItem rejects",
  "patchContext rejects what setSelectedItems rejects", "patchContext is
  all-or-nothing".

These are called entry-point validation rather than integrity controls for one
honest reason: they hold for the values that arrive through these functions, and
a caller who reaches the objects behind them another way is not bound by them.

### Collision-resistance, not confinement

- **Badge scoping.** Badge state is keyed by `${extensionId}:${nodeId}`, and an
  extension's own facade closes over the id the registry validated rather than
  taking it as a parameter. **The true claim is that two extensions which both
  name a node `inbox` cannot collide, and that the scope is not a caller-supplied
  argument.** It is *not* confinement: `useShellStore()` is public, so
  `store.getBadgeCount('other-ext', 'inbox')` reads another extension's badge and
  `store.setBadgeCount('other-ext', …)` writes one, host badges under `__host__`
  included. Nothing confidential belongs in the store.
  *Tests:* `src/core/__tests__/dataflow.test.tsx` — "keeps two extensions that both
  use the node id \"inbox\" apart", "does not let an extension name the scope it
  writes to"; `shellApi.test.ts` — "scopes a badge to its extension, so the same node
  id does not collide". The *absence* of confinement is pinned by "reaches the host
  ActivationController by reflection anyway, and steals a sibling handle" in
  `reflection.test.tsx`.

  **The read half is scoped the same way, since ADR-0001 Amendment K.**
  `IShellAPI.getBadgeCount(nodeId)` closes over the same validated id and takes no
  scope parameter, so a handle reads back exactly what it can write and nothing
  else. That keeps the read from being a wider capability than the write it
  mirrors; it does not make either one confinement, for the reason above. *Test:*
  `dataflow.test.tsx` — "reads back only its own scope, and offers no parameter to
  name another".

- **Context-key scoping.** Same shape, same limit, new surface.
  `IShellAPI.setContextKey(key, value)` writes into a namespace keyed by the
  closure-captured extension id, so two extensions that both publish a key called
  `loaded` keep their own, and an extension has no parameter with which to name
  another's namespace. **It is not confinement**: `RibbonContext.contextKeys`
  publishes the FOREGROUND extension's record into the one host-wide snapshot, and
  anything holding a context — a backgrounded extension's `getContext()` included
  — can read it. Every namespace is dropped on a foreground handover, which bounds
  how long a key is readable but does not make it private. **Nothing confidential
  belongs in a context key.** The value type is deliberately
  `string | number | boolean | null` and nothing else, which is what stops it
  becoming an object-injection channel into another extension's predicates.
  *Tests:* `src/core/__tests__/contextKeys.test.tsx` — "keeps two extensions'
  context keys apart, and publishes only the foreground's", "does not let an
  extension name the scope it writes a context key to", "clears every extension's
  context keys on a foreground handover", "setContextKey validates its value".

### Guardrails — honest mistakes only

- **`ExtensionHostBoundary` and the `useActivation` / `useExtensionActivation`
  split.** The host wraps a plugin subtree in a boundary; `useActivation()` throws
  below it, and plugin code gets three read-only facts instead. This is kept, and
  it is worth keeping: the activation controller carries `release(id)` for any id
  and an `activate(id)` that returns *another extension's* `IShellAPI`, and an
  earlier version of `DEVELOPER.md` actively **instructed** authors to call it. The
  guardrail turns that one instruction into a loud, deterministic throw. It does
  not enforce anything against a caller who walks the fiber tree, and it is not
  described as isolation anywhere in this repository.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "ExtensionHostBoundary severs the
  host activation controller"; `reflection.test.tsx` — "gives a plug-in no capability
  through the documented channel" for what it does deliver, and "reaches the host
  ActivationController by reflection anyway, and steals a sibling handle" for what it
  does not.
- **A throwing listener cannot take the shell down through the registry sweep.** The
  one store write a host has no statement to wrap is guarded inside the sweep effect,
  and the report itself is guarded too, because `console.error` is no more the host's
  object than a listener is. This is a guardrail, not a control: it protects the one
  unguardable call site, and every other write is still the caller's to guard.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "is contained inside the sweep
  effect, which has no guardable call site", "survives a console.error that throws,
  which is the report path escaping the guard".

### Stated as intent, with no test — do not read as a control

- **No HTML injection path for plugin content — now true of ONE render site, and
  still only an intent at the others.** This entry has been split rather than
  promoted wholesale, because promoting it wholesale is exactly the error the rule
  above exists to catch.

  **Delivered and tested at the four command surfaces.** The ribbon is deleted and
  the context bar, the command palette, the floating toolbar and the omnibox
  composer stand where it stood — and **none of them renders a plug-in string
  itself.** `src/components/command/commandListItem.tsx` is the one place
  `Command.label` reaches the DOM, as a JSX text node, and the one place
  `Command.icon` is resolved, through a host-owned `Map` of inline SVGs, so an
  untrusted icon key cannot reach a URL, markup, or an inherited
  `Object.prototype` value. *Tests:*
  `src/components/command/__tests__/commandSurfaces.test.tsx` — "the context bar
  renders a markup-shaped plug-in label as a text node, not as markup" and its
  three siblings, one per surface; "the shared command row module source contains
  no HTML-injection sink at all", which parses the module with the TypeScript
  compiler so the absence is asserted against the source rather than trusted to
  review, together with the same case named once per surface; "reports a planted
  sink, so the five scans above cannot pass vacuously"; and "the context bar does
  not resolve a prototype-shaped icon key to anything inherited", again once per
  surface. For these five modules, and only these five, the claim is backed the way
  "Integrity controls — unconditional" above requires.

  **Still intent, still untested, at every other site.**
  `src/components/layout/ShellLayout.tsx` renders `NavigationNode.label` and the
  extension `name` with ordinary JSX interpolation — the correct pattern — but
  `ShellLayout.test.tsx` contains no injection case and no source scan, so nothing
  pins it and it must not be cited as a control. The row virtualizer added by
  ISSUE-004 is the SECOND site that does carry the pair. *Tests:*
  `src/components/__tests__/VirtualizedList.test.tsx` — "the module source contains
  no HTML-injection sink at all", "the module source names no URL-bearing attribute
  a plug-in value could reach", "renders extension row content as text, with no
  HTML-injection path" and "reports a planted sink, so the scans above cannot pass
  vacuously". Anything an extension renders inside its own panes is still the
  extension's responsibility and the host neither inspects nor sanitizes it.

  Round 10 found this entry restated as delivered at two sites while no renderer
  existed, and corrected both. The correction is preserved as history: the risk was
  never that the code was wrong, but that the sentence was wider than the premise
  licensing it — which is why the command surfaces' arrival buys a sentence about
  the command surfaces and nothing more.

Accepted limits — decided, not overlooked:

- **`unregister` is not authorised.** Any caller holding the registry can remove
  any extension, including one it did not register. ISSUE-001 specifies no
  ownership or capability model, and this shell is local-first and
  single-origin: extensions are same-origin JavaScript in the same page, so one
  that wanted to remove another's UI could equally reach into the DOM. An
  unregister token would read as a guarantee the architecture cannot make. The
  decision is recorded in ADR-0001 and on the `unregister` declaration itself.
  If an ownership model is ever wanted, it needs its own issue and its own
  threat model first.
  *Test:* `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling".
- **`useRegistry` is not severed inside an extension subtree.** It is how an
  extension registers itself, so severing it would break the documented
  registration flow. It follows that `getExtension(otherId)` hands any component
  the sibling's host-owned record — including the sibling's *unfrozen* view
  components and callbacks.
  *Test:* `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling".
- **Plugin view components and callbacks are carried by reference and unfrozen.**
  Every container the host owns is frozen; the plugin functions inside them are
  not, because freezing them breaks `memo`/`forwardRef` internals and they are not
  the host's objects. So one extension can set `defaultProps` on another's view
  component and change what it renders. Freezing is not the fix and the host does
  not do it.
  *Test:* `src/core/__tests__/capability.test.tsx` — "pins the accepted limit: the view
  components and callbacks take new properties".
- **A store listener is untrusted code running inside somebody else's write.** It
  observes, it can re-enter, and it can throw into the writer's frame. Covered in
  full under "Integrity controls" above.
  *Test:* `src/core/__tests__/subscribe.test.tsx`.

Specified but **not yet enforced** — do not read these as current guarantees:

- **Namespaced persistence.** This one has landed as code, which makes the wording
  matter more than it did. `src/core/services/HydrationEngine.ts` namespaces
  per-extension persisted state by extension id, and that namespace is
  **collision-resistance and not confinement**: two extensions that both persist a
  key named `selection` keep their own copies, and that is the whole of what it
  buys. It confines nothing, for two independent reasons. The scope is an
  **argument, not a closure** — `setExtensionState(id, state)` takes the id from
  its caller, so any holder of the engine can name any scope; there is no
  per-extension facade over persistence the way `createRevocableShellAPI` is one
  over badges, and `IShellAPI` still has no persistence member. And the store is
  one `localStorage` entry under one origin, which any script on the page reads and
  rewrites without going through the engine at all — the same shape as
  `useShellStore()` being public. **Nothing confidential belongs in persisted UI
  state.** Weaker than badge scoping, not equal to it. It stays in this list, and
  did not graduate out of it when the code arrived, because what landed is a store
  and not a boundary. ISSUE-003.

  **Wiring the shell to the engine did not change any of that, and the reason is
  which half was wired.** `ShellLayout` consumes the three HOST slots — pane
  sizes, the pane-1 collapsed flag, the foreground extension id — through
  `useLocalStorageState` and `setSlot`. The per-extension scopes this entry is
  about are still reached by nothing, `IShellAPI` still has no persistence member,
  and no extension can put a value into that namespace through the documented
  contract at all. So the namespace remains untested-in-anger collision
  resistance for a case the shell does not yet create.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "keeps two
  extensions that both use the key \"selection\" apart" for what the namespace does
  buy; "lets any caller name any scope, so the namespace confines nothing" and
  "reads and rewrites another extension's scope straight through the storage entry"
  for what it does not, each reproduced as behaviour rather than asserted in prose.
- **A sandbox.** There is none, and nothing in this repository substitutes for
  one. `useShellStore()` is public and a plugin view renders inside the provider,
  so a plugin can reach the unscoped host store and bypass its own facade; every
  member of that store validates its arguments, so what it cannot do is put a
  value of the wrong shape into the context other extensions read — but it can
  read and write anything the store holds, host badges under `__host__` included,
  and through `subscribe` it can also watch, overwrite and throw into another
  extension's writes.
  The activation controller, and with it `release` for any id and an `activate`
  that returns another extension's handle, is reachable by walking React's fiber
  tree from any DOM node on the page. Badge scoping and revocation protect against
  *mistakes and collisions* between mutually untrusting extensions; against a
  mutually *hostile* one they protect nothing — see ADR-0001 Amendments C, D, **E**
  and **G**.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "the store handed out by
  useShellStore is frozen" for the validation that does hold;
  `reflection.test.tsx` — "reaches the host ActivationController by reflection
  anyway, and steals a sibling handle" for the controller; `subscribe.test.tsx` for
  the listener channel.
**Newly enforced by ISSUE-004 — moved out of this list:**

- **Fault containment.** No longer "intended". This entry used to read that there
  was **no error boundary in `src/`** and that a plug-in view throwing during
  render unmounted the whole shell — a live exposure, correctly labelled as one,
  and it stopped being true in `cd52bbf`. `src/components/error/FaultBoundary.tsx`
  is a real error boundary, and `ShellLayout` composes one around every set of
  children it hands a `PaneWrapper` — both plug-in panes, the context bar, and pane 1's
  navigation, which renders plug-in labels and badge counts and so was never
  incapable of failing. The boundary sits OUTSIDE `ExtensionHostBoundary`, which
  is still not an error boundary and still catches nothing: the inner one throws
  for a non-string `extensionId`, and a boundary nested beneath it could not catch
  its own parent. *Tests:* `src/components/__tests__/ShellLayout.test.tsx` —
  "contains a throwing pane-2 view to pane 2, leaving the context bar and pane 3 interactive", "contains a throwing context bar without taking the panes down" and
  "clears a pane error surface when the active extension changes".

  **Scope, so this is not over-read:** a boundary contains a throw during RENDER.
  It is not a sandbox, it does not contain a plug-in that wedges the UI thread
  without throwing, and ADR-0001 "No sandbox" and Amendment E are untouched by it.

**Newly enforced by ISSUE-002 — moved out of this list:**

- **Command predicate and handler containment.** No longer "intended". The command
  registry calls `isVisible` inside a guard and treats a throw as "not visible",
  reporting it and continuing to offer the remaining commands; it calls `onExecute`
  inside the same kind of guard, so a throwing handler does not reach React. Since
  the ribbon's deletion the same two functions serve four surfaces and the chord
  dispatcher, which is six routes through one implementation. The report path is
  itself guarded, so a tampered `console.error` cannot turn the containment into an
  escape. A non-boolean return is treated as not visible, since the comparison is
  `=== true`. *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "the context bar hides a command whose isVisible predicate throws and still renders the rest", "the context bar survives a console.error that itself throws while reporting a bad predicate", "the context bar survives an onExecute that throws, leaving the surface interactive", "treats a non-boolean
  isVisible result as not visible".

  **Scope, so this is not over-read:** it contains what arrives through
  `Command` — a buggy or hostile predicate or handler. It is not a sandbox, and
  ADR-0001 "No sandbox" and Amendment E are untouched by it.

Extension authors: see the security section of
[`DEVELOPER.md`](DEVELOPER.md) for the rules your code must follow.

---

## Documentation

| Document | Purpose |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The rules for anything written into this repository, including the no-local-environment-dependencies mandate and what to do when its checker fails. |
| [`DEVELOPER.md`](DEVELOPER.md) | Onboarding guide for third-party extension authors. |
| [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) | The five-issue work breakdown, with specs, edge cases and definitions of done. |
| [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md) | Why a registry-based IoC contract, and what was rejected. Read **Amendment E** for why there is no boundary between extensions, **Amendment F** for the store freeze, and **Amendment G** for the rule that no security claim may be written without naming its test. |
| [`docs/adr/0002-no-local-environment-dependencies.md`](docs/adr/0002-no-local-environment-dependencies.md) | Why no tracked file may depend on one developer's machine, why the rule is enforced by a script rather than by review, and what the script cannot decide. |

---

## Contributing

The full rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version:

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
   [`docs/adr/0002-no-local-environment-dependencies.md`](docs/adr/0002-no-local-environment-dependencies.md).
