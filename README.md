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
| IoC extension registry (ISSUE-001) | **Landed.** `src/core/types.ts`, `src/core/RegistryContext.tsx`, `src/core/ShellAPI.ts`, under a 100% coverage gate |
| Three-pane resizable layout (ISSUE-002) | Specified, not started |
| State hydration and persistence (ISSUE-003) | Specified, not started |
| Row virtualizer and fault boundaries (ISSUE-004) | Specified, not started |
| Verification remotes and integration suite (ISSUE-005) | Specified, not started |

Consequences worth stating plainly, because they are easy to assume away:
ribbon action `isVisible` predicates are **validated but never evaluated** — the
ribbon renderer is ISSUE-002; extensions are registered but **never activated**,
so no extension is handed an `IShellAPI` instance yet; and the pane fault
boundaries described below are ISSUE-004. Registration itself is complete: it
validates, it rejects duplicates deterministically, and it never throws.

The authoritative work breakdown is [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md).

This README deliberately carries no status badges. A badge asserting build
health, coverage or release state would be asserting something nobody has
measured on a codebase this young.

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

### Architectural influences

- **Eclipse RCP / OSGi** — the extension registry model. Capabilities are
  declared and discovered through a registry rather than wired by direct
  reference.
- **VS Code** — host/plugin isolation. Extensions receive a deep-frozen API
  context; they cannot reach into the host or into each other.
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

What the shell enforces **today**:

- **Deep-frozen API contexts.** `createShellAPI` returns a recursively frozen
  `IShellAPI`, so an extension cannot monkey-patch shell services out from under
  other extensions. (The factory and its freeze are built and tested; the
  activation step that hands an instance to an extension is ISSUE-002.)
- **Identifier hygiene at the trust boundary.** Every plugin-supplied id — the
  extension id, navigation node ids, ribbon action ids — must match a strict
  allowlist and is refused if it is a prototype-pollution key. The registry
  store is a `Map`, so a plugin key can never reach `Object.prototype`.
- **A registry that cannot be crashed or hijacked by its input.** `register`
  returns a typed failure instead of throwing, for every malformed payload
  including one that throws or resists inspection from its own property
  getters. Duplicate ids are a deterministic reported failure, never a silent
  overwrite. The failure it returns is always an error the host constructed
  itself, with a `code` from the host's own enum — never an error object handed
  back out of plugin code.
- **What was validated is what is stored.** Reading each untrusted value once
  is necessary but not sufficient, because a value the plugin can still reach
  is a value the plugin can still edit. So registration ends by building a
  **normalised, host-owned record**: every validated scalar copied into a fresh
  primitive, every collection rebuilt as a fresh array of exactly the length
  that was bounds-checked, the whole thing frozen at every host-owned level
  before it is stored. `getExtension` returns that record, not the plugin's
  object. A plugin editing its own blueprint after registration — or a Proxy
  reporting one `length` while it is measured and a larger one afterwards —
  cannot change what the host holds. Component and handler references
  (`views.pane2`, `views.pane3`, `isVisible`, `onExecute`) are deliberately
  carried across unchanged: they must stay callable and keep their identity, so
  they are type-checked rather than copied, and they remain the plugin's
  objects.
- **A shell API that validates what a plugin hands it.** `setBadgeCount` and
  `setSelectedItem` both check their arguments and raise `ShellUXError` rather
  than letting an arbitrary value reach the context snapshot the host passes to
  *other* extensions. Rejection messages describe an untrusted value by its
  `typeof` and never stringify it, so a hostile `toJSON`, a `Symbol.toPrimitive`
  or a cycle cannot run code or throw a raw `TypeError` out of the host.
- **No HTML injection path for plugin content.** The registry stores plugin
  strings and never renders them; the render-boundary rule — text nodes only,
  no `dangerouslySetInnerHTML` — is documented at the type declarations and in
  `DEVELOPER.md`, and there is no shell component today that renders plugin
  content at all.

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

Specified but **not yet enforced** — do not read these as current guarantees:

- **Namespaced persistence.** Intended: per-extension state namespaced by
  extension id. There is no persistence member on `IShellAPI` and no storage
  layer. ISSUE-003.
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
| [`DEVELOPER.md`](DEVELOPER.md) | Onboarding guide for third-party extension authors. |
| [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) | The five-issue work breakdown, with specs, edge cases and definitions of done. |
| [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md) | Why a registry-based IoC contract, and what was rejected. |

---

## Contributing

The project is pre-alpha and the core contract is still being written. The most
useful contribution right now is review of the specification in
`.github/ISSUES_MANIFEST.md` and of the architecture decision in
`docs/adr/0001-ioc-registry-architecture.md`.

Two standing rules for anything written into this repository, including
documentation:

1. **Do not assert unmeasured results.** If it has not been benchmarked,
   audited or measured, label it a target and say so.
2. **Label aspiration as aspiration.** A reader must always be able to tell what
   exists from what is planned.
