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
> This repository is at the very beginning of its life. **Only ISSUE-001 (the
> IoC registry and type primitives) is in progress.** Everything else described
> in this README is specified but unbuilt.
>
> There is no published package, no demo, no release tag, and no version of this
> software that anyone should depend on. Interfaces described here will change
> without notice until ISSUE-001 lands and the contract is frozen.

What that means for a reader:

| Area | State |
|---|---|
| IoC extension registry (ISSUE-001) | In progress |
| Three-pane resizable layout (ISSUE-002) | Specified, not started |
| State hydration and persistence (ISSUE-003) | Specified, not started |
| Row virtualizer and fault boundaries (ISSUE-004) | Specified, not started |
| Verification remotes and integration suite (ISSUE-005) | Specified, not started |

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

Coverage is enforced as a **build gate**, not reported as an achievement. The
threshold applies **per module, as each module lands** — a module cannot merge
below the gate, and modules that do not exist yet are not counted for or
against anything.

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

What the shell does enforce:

- **Deep-frozen API contexts.** The `IShellAPI` object handed to an extension is
  recursively frozen, so an extension cannot monkey-patch shell services out
  from under other extensions.
- **No HTML injection path for plugin content.** Extension-supplied strings —
  labels, names, list item content — are rendered as text nodes. Shell
  components do not offer a `dangerouslySetInnerHTML` route for plugin data.
- **Namespaced persistence.** Per-extension persisted state is namespaced by
  extension id so one extension cannot read or clobber another's.
- **Fault containment.** An extension that throws during render is contained to
  its own pane by a fault boundary rather than taking the shell down.

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
