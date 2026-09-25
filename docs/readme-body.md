# README body — status, diagram, and getting-started detail

Moved out of `README.md` on 2026-09-25 (`docs/plans/v1-production.md` line 133),
to match the `leapware-sessionkeeper` top-matter pattern: README keeps a
one-paragraph what-it-is, the license line, an Installing link, a short
Developing block, and the Contributing/Security links; everything below moved
here verbatim.

## Status

**Pre-release. Nothing has been released and there is no installer to download.**
Version `0.1.0`, no tag.

| Area | State |
|---|---|
| Native host | **Built.** Electron 43, one window, two processes: host chrome, and one extension surface holding panes 2 and 3 |
| Three-pane shell, command palette, context bar, docked composer | **Built**, with browser-lane specs for the geometry |
| Token system and themes | **Built.** Every colour is generated (`design/`), contrast-gated, three themes |
| Visualization in all three panes | **Built** |
| Redesign to [`DESIGN.md`](../DESIGN.md) | **In progress.** Wave 1 is merged; waves 2 to 4 wait for the gate-4 screens to be approved |
| Plugins installed at runtime | **Not built.** Today plugins are compiled into the shell. Runtime install is plan step 6b |
| Keyboard gate (the 1.0 accessibility bar) | **Partly built.** Screen-reader support is **not done** and is a 1.1 item (D-37) |
| Signing | **Not signed.** 1.0 ships unsigned for LEAPWare operators (D-33) |
| Release | **Waits for LEAPWare BuildCraft**, which leads this project's SDLC (D-39, [`docs/sdlc.md`](sdlc.md)) |

What is in flight right now is in [HANDOFF.md](../HANDOFF.md); the full plan to 1.0 is
[`docs/plans/v1-production.md`](plans/v1-production.md).

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
influences are in [`docs/overview.md`](overview.md).

## Getting started

### Prerequisites

| Tool | Requirement |
|---|---|
| **Node.js** | `^22.13.0 \|\| >=24`, declared as `engines` and enforced by the tracked `.npmrc` (`engine-strict=true`). `.nvmrc` carries the major version CI uses |
| **npm** | 11.16.0, pinned as `packageManager`. Use that version: npm 10.9.8 has crashed on an earlier state of this lockfile (`docs/traps.md`) |
| **git** | any recent version |

Why the Node floor is exactly that range, arm by arm, is in
[`docs/getting-started.md`](getting-started.md).

### Install and run

```bash
git clone <repository-url>
cd leapware-shellux
npm ci
npm run dev            # the shell in a browser, on Vite's default port 5173
npm run dev:desktop    # the shell as the native Electron window
```

`npm run dev` serves the shell with the two verification plugins in
`plugins/mail/` and `plugins/database/` registered, from their source
(ADR-0006 step 7). `/index.html` on the same server is the production
composition root, which registers nothing.

### The acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That is the definition of done for every change, and `npm run check:portability`
enforces it. The mandate is in [`CONTRIBUTING.md`](../CONTRIBUTING.md); the reasoning is
[ADR-0002](adr/0002-no-local-environment-dependencies.md).

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
cannot see is in [`docs/testing.md`](testing.md), and the rules every change
follows are in [`CLAUDE.md`](../CLAUDE.md) and
[ADR-0003](adr/0003-quality-over-velocity.md).
