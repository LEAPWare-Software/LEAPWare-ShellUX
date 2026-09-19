# LEAPWare ShellUX

**New session? Read [HANDOFF.md](HANDOFF.md) first.**

ShellUX is a desktop shell for LEAPWare's operators, and its mission is to be **the
best-in-class interface for hosting application plugins**. An operator keeps one
window open for a shift. Plugins supply the work (inventory, mail, shipments,
anything else); the shell owns every pixel around it: three resizable panes, a
command palette that drives everything from the keyboard, and one consistent way of
showing state. The host owns zero business logic.

"Best in class" is a bar, not an adjective. It is measured against VS Code, Linear,
Raycast and Outlook/Teams, and the measurements are listed in
[`docs/plans/v1-production.md`](docs/plans/v1-production.md). Until they are met and
measured, this README does not claim them.

License: [Apache-2.0](LICENSE), with a [`NOTICE`](NOTICE) (decision D-42).

## Status

**Pre-release. Nothing has been released and there is no installer to download.**
Version `0.1.0`, no tag.

| Area | State |
|---|---|
| Native host | **Built.** Electron 43, one window, two processes: host chrome, and one extension surface holding panes 2 and 3 |
| Three-pane shell, command palette, context bar, docked composer | **Built**, with browser-lane specs for the geometry |
| Token system and themes | **Built.** Every colour is generated (`design/`), contrast-gated, three themes |
| Visualization in all three panes | **Built** |
| Redesign to [`DESIGN.md`](DESIGN.md) | **In progress.** Wave 1 is merged; waves 2 to 4 wait for the gate-4 screens to be approved |
| Plugins installed at runtime | **Not built.** Today plugins are compiled into the shell. Runtime install is plan step 6b |
| Keyboard gate (the 1.0 accessibility bar) | **Partly built.** Screen-reader support is **not done** and is a 1.1 item (D-37) |
| Signing | **Not signed.** 1.0 ships unsigned for LEAPWare operators (D-33) |
| Release | **Waits for LEAPWare BuildCraft**, which leads this project's SDLC (D-39, [`docs/sdlc.md`](docs/sdlc.md)) |

What is in flight right now is in [HANDOFF.md](HANDOFF.md); the full plan to 1.0 is
[`docs/plans/v1-production.md`](docs/plans/v1-production.md).

## What it is

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
                   Ctrl-K opens the command palette, over everything
```

A plugin supplies a navigation entry, a list view, a detail view and a set of
commands. The shell renders them, in the operator's words rather than the plugin's
identifiers. It never knows whether it is showing stock levels, email or anything
else. The full description, the keyboard-shortcut contract and the architectural
influences are in [`docs/overview.md`](docs/overview.md).

## Getting started

### Prerequisites

| Tool | Requirement |
|---|---|
| **Node.js** | `^22.13.0 \|\| >=24`, declared as `engines` and enforced by the tracked `.npmrc` (`engine-strict=true`). `.nvmrc` carries the major version CI uses |
| **npm** | 11.16.0, pinned as `packageManager`. Use that version: npm 10.9.8 has crashed on an earlier state of this lockfile (`docs/traps.md`) |
| **git** | any recent version |

Why the Node floor is exactly that range, arm by arm, is in
[`docs/getting-started.md`](docs/getting-started.md).

### Install and run

```bash
git clone <repository-url>
cd leapware-shellux
npm ci
npm run dev            # the shell in a browser, on Vite's default port 5173
npm run dev:desktop    # the shell as the native Electron window
```

`npm run dev` serves the shell with the two verification plugins in `src/mocks/`
registered. `/index.html` on the same server is the production composition root,
which registers nothing.

### The acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That is the definition of done for every change, and `npm run check:portability`
enforces it. The mandate is in [`CONTRIBUTING.md`](CONTRIBUTING.md); the reasoning is
[ADR-0002](docs/adr/0002-no-local-environment-dependencies.md).

## Developing

| Command | What it does |
|---|---|
| `npm run verify` | **The gate.** Ten stages: portability, citations, tokens, lint, typecheck, coverage (100% on four metrics over the gated tree), the shuffled integration run, script tests, build, production audit. CI runs every stage. It needs network access |
| `npm run test:browser` | The Playwright lane in a real Chromium: everything geometric, visual, focus-ordered or pointer-driven. Not part of `verify`; its own CI leg. Run `npm run test:browser:install` once first |
| `npm run audit:all` | `npm audit` over the whole tree, dev dependencies included. Its own CI job |
| `npm run verify:desktop` | Builds and packages the Windows installer into `release/` |

The test suite runs in jsdom, which paints nothing: no layout, no hit testing, no
pointer events, no colour. **A green unit suite is not evidence about anything
geometric or visual**, which is why the browser lane exists. What each lane can and
cannot see is in [`docs/testing.md`](docs/testing.md), and the rules every change
follows are in [`CLAUDE.md`](CLAUDE.md) and
[ADR-0003](docs/adr/0003-quality-over-velocity.md).

## Documentation

| Question | Read |
|---|---|
| What is decided, and what is still open | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| The plan to 1.0, and the bar "best in class" is measured against | [`docs/plans/v1-production.md`](docs/plans/v1-production.md) |
| How work moves from design to release, under BuildCraft | [`docs/sdlc.md`](docs/sdlc.md) |
| Who this is for and what it must not look like | [`PRODUCT.md`](PRODUCT.md) |
| The visual system: type, colour, planes, components | [`DESIGN.md`](DESIGN.md) |
| Writing a plugin | [`DEVELOPER.md`](DEVELOPER.md), then `src/examples/HelloExtension.tsx` |
| What the shell does, in detail | [`docs/overview.md`](docs/overview.md) |
| What is and is not a security control here | [`docs/security-posture.md`](docs/security-posture.md) and [`SECURITY.md`](SECURITY.md) |
| Accessibility, and what is not done | [`docs/accessibility.md`](docs/accessibility.md) |
| Testing, coverage and the browser lane | [`docs/testing.md`](docs/testing.md) |
| Performance targets (unmeasured) | [`docs/performance.md`](docs/performance.md) |
| Cutting a release | [`docs/RELEASE.md`](docs/RELEASE.md) |
| Installing the packaged app as an operator (per-user, SmartScreen, logs, updates) | [`docs/INSTALL.md`](docs/INSTALL.md) |
| Why it is built this way | [`docs/adr/`](docs/adr/) |
| What changed, and what made each defect possible | [`CHANGELOG.md`](CHANGELOG.md) |
| This README before 2026-09-18 | [`docs/history/readme-status-2026-08.md`](docs/history/readme-status-2026-08.md) |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Every change states what it did not do,
lands its documentation in the same commit, and is reviewed adversarially before it
merges.

## Security

Report a vulnerability as [`SECURITY.md`](SECURITY.md) describes. Do not open a
public issue for one.
