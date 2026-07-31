# LEAPWare-ShellUX

A local-first, pluggable application shell for web and desktop, built on the
Microsoft Outlook three-pane-plus-ribbon paradigm.

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
> registry and type primitives) has landed.** Everything else described in this
> README is specified but unbuilt — there is no layout, no ribbon, no
> virtualizer, no persistence, and the host renders a placeholder.
>
> There is no published package, no demo, and no release tag. The contract in
> `src/core/types.ts` is now real and is the reference for anything written
> against it; everything downstream of it may still move.

What that means for a reader:

| Area | State |
|---|---|
| IoC extension registry (ISSUE-001) | **Landed.** `src/core/types.ts`, `src/core/RegistryContext.tsx`, `src/core/ShellAPI.ts`, `src/core/ActivationContext.tsx`, `src/core/hotkeys.ts`, under a 100% coverage gate |
| Three-pane resizable layout (ISSUE-002) | Specified, not started |
| State hydration and persistence (ISSUE-003) | Specified, not started |
| Row virtualizer and fault boundaries (ISSUE-004) | Specified, not started |
| Verification remotes and integration suite (ISSUE-005) | Specified, not started |

Consequences worth stating plainly, because they are easy to assume away:
ribbon action `isVisible` predicates are **validated but never evaluated**,
`onExecute` handlers are **never invoked by the host**, and a ribbon action's
optional `hotkey` is **validated but never dispatched** — the ribbon renderer is
ISSUE-002; and the pane fault boundaries described below are ISSUE-004.

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
"Security posture" section below. What is still missing is the surface that would
*use* any of it: there is no three-pane layout, so nothing renders an extension's
views or calls its ribbon actions.

The authoritative work breakdown is [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md).

This README deliberately carries no status badges. A badge asserting build
health, coverage or release state would be asserting something nobody has
measured on a codebase this young.

---

## Getting Started

### Prerequisites

| Tool | Requirement | Why this floor |
|---|---|---|
| **Node.js** | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | Declared as `engines` in `package.json`. This is not a preference — it is the intersection of the `engines` constraints the dependency tree already carries. `package-lock.json` contains `^20.19.0 \|\| ^22.13.0 \|\| >=24` (via `@typescript-eslint`), `20 \|\| >=22` (via `test-exclude`, which rules out 21.x), and `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` (ESLint). Nothing in the tree needs more. |
| **npm** | 10 or newer; 11.16.0 is what the lockfile was written with | Pinned as `packageManager` so a laptop reaching for yarn or pnpm errors instead of silently resolving a different tree from the version ranges in `package.json`. |
| **git** | any recent version | The portability check below enumerates tracked files with `git ls-files`. |

`.nvmrc` tracks the major version CI uses, so `nvm use` (or `fnm use`) picks the
right one without being told. CI reads the same file rather than duplicating the
number.

**The floor is enforced, not suggested.** The tracked `.npmrc` sets
`engine-strict=true`, so a Node below the floor fails `npm ci` immediately with a
readable message. Without it npm's default is to print `EBADENGINE`, carry on, and
hand you a tree that breaks later somewhere unrelated.

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
URL. What renders today is a placeholder — see Project Status above.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot module replacement, on port 5173. |
| `npm run build` | Typechecks, then produces a production bundle in `dist/`. |
| `npm test` | Runs the Vitest suite once. |
| `npm run test:coverage` | Runs the suite and enforces the coverage gate in `vitest.config.ts` — 100% statements, branches, functions and lines over `src/core/**`. Exits non-zero if a threshold is unmet. |
| `npm run typecheck` | `tsc --noEmit`. Emits nothing; only checks. |
| `npm run lint` | ESLint at `--max-warnings 0`. There is no warning tier; a warning fails. |
| `npm run check:portability` | Enforces ADR-0002 — see below. |
| `npm run audit:prod` | `npm audit` over production dependencies at `--audit-level=high`. Needs network access. |
| `npm run verify` | **The gate.** Runs all of the above in order: portability, lint, typecheck, coverage, build, audit. This is exactly what CI applies. |

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

The production-dependency audit is a separate workflow on purpose. An advisory
database that updates daily and a lockfile that does not means the audit result can
change with no commit at all, so a per-push blocking audit would turn `main` red
for a defect nobody introduced. Instead it blocks when `package.json` or
`package-lock.json` changes — the only kind of commit that can introduce a
vulnerable dependency — and blocks weekly on a timer, which is what notices a newly
published advisory without blaming an unrelated commit. See
[`.github/workflows/audit-dependencies.yml`](.github/workflows/audit-dependencies.yml)
and [`.github/workflows/audit-schedule.yml`](.github/workflows/audit-schedule.yml).

---

## What this is

LEAPWare-ShellUX is the container. You bring the product.

```
┌─────────────────────────────────────────────────────────────────────┐
│  RIBBON   global actions ······················ contextual actions  │
├───────────────┬───────────────────┬─────────────────────────────────┤
│  PANE 1       │  PANE 2           │  PANE 3                         │
│  navigation   │  master / list    │  detail                         │
│  240px        │  360px            │  flex                           │
│  ↕ collapses  │  virtualized      │  header + scroll + drawer slot  │
│    to 48px    │                   │                                 │
└───────────────┴───────────────────┴─────────────────────────────────┘
        ⇕                   ⇕                       ⇕
              all dividers user-resizable
```

An extension supplies a navigation entry, a Pane 2 list view, a Pane 3 detail
view, and a set of ribbon actions. The host renders them. The host never knows
whether it is showing email, inventory records, or something else entirely.

### Keyboard shortcuts on ribbon actions

A ribbon action may carry an optional `hotkey`: a **structured chord**, `key`
plus the optional `ctrl`, `alt`, `shift` and `meta` booleans, rather than a string
like `"Ctrl+Shift+K"` that would need a parser at the trust boundary.

> **⚠ Declared and validated today. Nothing dispatches it.**
>
> There is no `keydown` listener, no dispatcher and no evaluation site anywhere
> in `src/`. Declaring a chord has no observable effect beyond the registration
> succeeding or failing. A dispatcher needs the foreground extension and a live
> `RibbonContext`, and both arrive with the ribbon — ISSUE-002.
> *Test:* `src/__tests__/noEventListener.test.ts` — "finds no listener
> registration and no key-event name in any module under src/", which parses
> every non-test module under `src/` with the TypeScript compiler, so this
> paragraph turns the suite red rather than turning quietly false the day a
> listener lands.

What the host does enforce, at registration:

- **`key` must name one of 61 keys on the `HOTKEY_KEYS` allowlist** — the 26
  letters, the 10 digits, `f1`–`f12`, the four arrows and nine named navigation
  and editing keys. `tab` (it owns focus order), `space` (it activates the focused
  control) and every modifier named as a key are deliberately absent.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — ribbon
  action hotkeys > accepts every key in the host allowlist", which also pins the
  size at 61, and "rejects %s as a hotkey key" beside it.
- **A single-character key must carry `ctrl`, `alt` or `meta`**, or the
  registration is refused. See Accessibility below.
- **The same chord twice inside one extension is refused**, with the
  `ShellUXError` code `DUPLICATE_HOTKEY`. Scoped to one extension on purpose:
  chords are live only for the foreground extension, so two *different*
  extensions both claiming `Ctrl+K` is not a conflict and is not rejected.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  duplicate hotkeys within one extension > rejects the same chord twice, with
  DUPLICATE_HOTKEY on the second action" and "lets two DIFFERENT extensions
  declare the same chord".

`src/core/hotkeys.ts` exports three pure functions over a chord and nothing else:
`hotkeyToken` (the canonical token that deduplicates today and will look up a
dispatch target later), `describeHotkey` (`"Ctrl+Shift+K"`, for a tooltip or an
`aria-keyshortcuts` attribute nothing emits yet) and `matchesHotkey` (an exact
match against the five keyboard-event fields it declares).
*Test:* `src/core/__tests__/hotkeys.test.ts` — "hotkeys module — does not attach
anything > exports exactly the three pure helpers and no dispatcher".

The author-facing contract in full is in [`DEVELOPER.md`](DEVELOPER.md) under
"`Hotkey` — a keyboard chord on a ribbon action"; the decisions and what was
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
| Borders | 1px. `border-neutral-200` light, `border-neutral-800` dark. |
| Pane 1 | 240px default, collapses to a 48px icon track. |
| Pane 2 | 360px default, virtualized. |
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

**This project targets WCAG 2.2 Level AA.** That is the standard the work is
being held to, and it is not yet met — the shell is pre-alpha and has not been
audited. AA is the commitment; conformance will be claimed only after an audit,
not before.

Level AA work in scope:

- 4.5:1 contrast for body text, 3:1 for large text and for UI component
  boundaries.
- Full keyboard operability, including pane dividers, ribbon actions, and list
  navigation.
- Visible focus indication that survives the high-density styling.
- Accessible names preserved when Pane 1 collapses to its 48px icon track.
- Correct landmark and region structure across ribbon and three panes.

**One criterion is already enforced by the host rather than being scoped work.**
A plugin-declared `hotkey` whose `key` is a single character and which carries no
`ctrl`, `alt` or `meta` modifier is **refused at registration**, with a message
naming WCAG 2.2 Success Criterion **2.1.4 Character Key Shortcuts (Level A)**.
`shift` does not satisfy the rule, because Shift produces a character too.
2.1.4's three conformance routes — turn the shortcut off, remap it, or make it
active only on focus — need a settings surface, a remapping UI or a
component-scoped dispatcher, and Phase 1 has none of the three, so the criterion
is met the fourth way: the declaration does not happen. Function keys and the
named navigation keys are exempt, because no dictation and no typing produces
them.
*Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the WCAG
2.1.4 modifier rule for character keys > rejects a bare single-character key and
names the criterion", with "rejects shift alone, because Shift produces a
character" and "exempts every non-character key in the allowlist, which may be
bare" beside it.
This is one rule at one door, not an audit: it is **entry-point validation** in
the vocabulary of "Security posture" below, and nothing dispatches a chord yet in
any case — see "Keyboard shortcuts on ribbon actions" above.

**This commitment constrains the architecture, and the constraint is recorded
rather than discovered later.** ARIA IDREF attributes — `aria-labelledby`,
`aria-describedby`, `aria-controls`, `aria-activedescendant`, `aria-owns` — resolve
**within a single document**. A ribbon control cannot point at a listbox in another
document, and focus order and roving-tabindex composite widgets stop at a document
boundary. So full keyboard operability across ribbon and panes **cannot be
delivered if extensions render into separate documents**, which is what real
per-extension isolation via iframes would require. That trade-off is the reason
isolation was not chosen now, and it is written down in ADR-0001 Amendment E
together with the condition that overrides it.

### AAA as a stretch goal — and its known conflicts

Level AAA is recorded here as an aspiration only. It is **not** targeted,
and it is currently contradicted by the design system in specific, concrete
ways:

- **Contrast, 1.4.6 Contrast (Enhanced).** AAA requires a 7:1 contrast ratio for
  text. The specified border token `border-neutral-200` on a white background is
  roughly **1.2:1**. That is not a near miss; it is an order of magnitude away
  from AAA and it also sits below the 3:1 AA threshold for non-text UI
  boundaries. Borders in this system are decorative separators, and any boundary
  that must be *perceived* to be operated — a pane divider, a focus ring, a
  control edge — needs a stronger token than `neutral-200`. Resolving that is AA
  work, and it is open.
- **Visual presentation, 1.4.8.** AAA calls for user-adjustable line spacing of
  at least 1.5× and block spacing of 2.25×, plus text blocks no wider than 80
  characters. A high-density shell built on `p-1`–`p-3` padding and 11px–13px
  type is in direct tension with this. Meeting it would mean abandoning the
  density that is the product's reason for existing.
- **Target size, 2.5.5.** AAA asks for 44×44 CSS pixel targets. A 48px collapsed
  icon track can accommodate this; 11px-type ribbon actions at `p-1` cannot,
  without redesigning the ribbon.

Anyone who tells you a `border-neutral-200`-on-white interface is WCAG 2.2 AAA
compliant is mistaken. This project does not make that claim.

---

## Testing and coverage

Tests run under Vitest.

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
  `useShellStore()`. A listener runs **synchronously inside another holder's write**,
  so it can *observe* every value written, *re-enter* the store and leave its own
  value standing instead, and *throw into the writing frame* — including a
  non-`ShellUXError`, and including a throw that starves every listener ordered after
  it, a subscribed pane included. Freezing the store does not touch any of this,
  because nothing is replaced. It is not closable either: a store that notifies
  nobody is a store no pane can render off.
  *Tests:* `src/core/__tests__/subscribe.test.tsx` — the whole file, in particular
  "sees the new value synchronously, before the writer returns", "leaves the
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
  fields", "— navigation tree", "— ribbon actions";
  `registryNormalization.test.tsx` — "register — a lying `length` cannot grow the
  payload after it is measured"; `registrySecurity.test.tsx` — "validateBlueprint —
  collection lengths are read once".
- **Argument validation on `IShellAPI`.** `setBadgeCount` and `setSelectedItem`
  both check their arguments and raise `ShellUXError` rather than letting an
  arbitrary value reach the context snapshot the host passes to *other*
  extensions. `patchContext` — the unscoped store member the same values can reach
  through the public `useShellStore()` — is held to the identical standard field by
  field.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "setSelectedItem validates its
  argument", "the badge scope and node id are validated at both doors";
  `contextPatch.test.ts` — "patchContext rejects what setSelectedItem rejects",
  "patchContext validates focusedPane against the real PaneId union", "patchContext is
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

- **No HTML injection path for plugin content.** The registry stores plugin strings
  and never renders them; the render-boundary rule — text nodes only, no
  `dangerouslySetInnerHTML` — is documented at the type declarations, in
  `DEVELOPER.md`, and as a cross-cutting gate in `.github/ISSUES_MANIFEST.md`.
  **No test exercises it, because there is no shell component today
  that renders plugin content at all.** It is therefore an obligation on the future
  renderer (ISSUE-002, ISSUE-004), not a property this codebase has. Under the rule
  above it stays here only because it is labelled as untested; it must not be restated
  anywhere as a delivered protection until there is a render site and a test at it.

  Round 10 found it restated as delivered at two sites and corrected both: the
  `.github/ISSUES_MANIFEST.md` cross-cutting gate, which asserted in the present tense
  that such surfaces "render them as text nodes" while none exists, and the `icon` row
  of `DEVELOPER.md`'s `RibbonAction` table, which said the key "is never interpolated
  into a URL or into markup". Both are now future-tense requirements carrying the
  untested label. The two spec sections in the manifest that describe the ribbon
  (ISSUE-002) and the virtualizer (ISSUE-004) were moved to `must` in the same pass.

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

- **Namespaced persistence.** Intended: per-extension state namespaced by
  extension id. Badge state is namespaced today, and the scope is not a parameter
  of the facade an extension holds — but see "Collision-resistance, not
  confinement" above: that is not a confinement claim, and persisted state will
  need its own answer rather than inheriting one. There is still no persistence
  member on `IShellAPI` and no storage layer. ISSUE-003.
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
- **Fault containment.** Intended: an extension that throws during render is
  contained to its own pane. There is no error boundary in `src/`. ISSUE-004.
- **Ribbon predicate containment.** Intended: a throwing `isVisible` hides the
  action and is reported. Nothing calls `isVisible` yet; the registry only
  validates that it is a function. ISSUE-002.

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
