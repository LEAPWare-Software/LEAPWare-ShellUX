# Product

Strategic context for design work in this repository. Answers who, what and why.
It does not answer *how it looks* — that is `DESIGN.md`, which does not exist yet
and is gate 3 of the redesign, not this file.

Written 2026-08-03 from a two-round interview with the owner. Every answer below
is the owner's, not an inference, except where the sentence says otherwise.

---

## Mission

**A best-in-class UI/UX shell that hosts application plugins.** The owner set this
on 2026-09-18 (decision D-31), and it is the test every other section of this file
serves.

"Best in class" is only a claim once it is measured. The bar, in full, is in
[`docs/plans/v1-production.md`](docs/plans/v1-production.md): plugins installed and
removed at runtime, every command reachable from the keyboard, performance budgets
that CI enforces, a heuristic review against **VS Code, Linear, Raycast and
Outlook/Teams** (D-38), and operators using the packaged app with the owner watching.
One part stays unproven at 1.0 and is said so everywhere: **"best for plugin
authors"**. Nobody outside the design will have built a plugin before 1.0 (D-32).

---

## Register

product

---

## Users

**LEAPWare's own operators.** Internal staff on Windows 11 desktops, running the
shell as a native Electron window, one instance open for a shift rather than a
tab visited for a minute.

Third-party extension authors are **a means, not a customer**. The contract they
build against has to be legible, but they are not who the interface is designed
for. The commercial version of this question (GitHub #93) was decided on 2026-08-04 as
register row D-23: third parties are not customers in the next 12 months. The two
answers agree.

**The operator does all four jobs, and no one of them wins.** Asked which task
dominates the screen — monitoring, working a queue, investigating, or configuring
— the owner's answer was all of them. That is a design constraint, not a
non-answer:

- A monitoring-first shell leads with charts and thresholds.
- An investigation-first shell puts the query surface at the top.
- A queue-first shell maximises the list pane.
- A configuration-first shell is a form layout.

Serving all four means **the host layout stays mode-neutral and the extension's
published payload decides what leads.** Which is exactly why the editorial problem
below is the first-order design problem and not a polish item.

---

## Product Purpose

A desktop shell that hosts extensions. Extensions declare a navigation tree and
publish payload blocks — chart, table, form, text — into three panes. The host
renders all of it, owns every pixel of chrome, and owns zero business logic
(ADR-0001).

**Success is that an operator trusts what the shell shows them.** Not that the
shell is admired. The product register's own test applies: would someone fluent in
Linear, Raycast or Stripe sit down at this and trust it, or pause at every
subtly-off component. Today the honest answer is pause.

**The first-order design failure, stated plainly:** the host currently has no
editorial voice over publisher data. It renders an extension's internal
identifiers as human headings — an operator reads `stock-levels`, `stock-table`,
`stock-filter`, and a button labelled *Submit stock-filter* — and puts the payload
*type* (`chart`, `table`, `form`) on screen as a chip beside each heading. That is
a debugging affordance shipped in the product surface. Flat surfaces, no primary
action, a colliding chart title and a floating composer are all real, and all
cheaper to fix than this.

---

## Brand Personality

**Instrument. Quiet. Legible.**

Not an app that happens to show data — a panel that an operator reads. The voice
is the voice of a good instrument: it states, it does not sell, and it never
raises its own volume above the reading.

Four references were named, and each contributes one specific thing rather than a
whole aesthetic:

| Reference | The one thing taken |
|---|---|
| **Linear** | Restraint under density. One family, three weights, near-zero borders; hierarchy carried by weight and space, not by boxes. |
| **Raycast** | The command surface is a primary way to work, not a shortcut menu. Shortcut hints on rows, a footer that says what Enter does. |
| **A trading terminal** | Density taken seriously. Tabular numerals everywhere, chrome receding to almost nothing, the data being the interface. |
| **Stripe** | A small, rigorously consistent status vocabulary, applied identically everywhere, so a state a user has never seen is still readable. |

These do not conflict. Read together they describe one thing: **an operator's
instrument that is commanded by keyboard and reports state without decoration.**

Copy voice: name things the way an operator names them, never the way the
publisher's code names them. Button labels are verb plus object and say what will
happen.

---

## Anti-references

All four candidates were rejected outright, with the owner's condition attached:
*ok with all, as long as best in class standards.*

- **Enterprise Windows** — ribbon, chrome-heavy toolbars, grey gradient panels,
  2010 desktop grammar. The ribbon is already deleted (register row D-16).
- **SaaS dashboard** — card grids, hero-metric tiles, warm off-white body, rounded
  pastel everything. The saturated 2026 default.
- **Developer tool** — monospace everywhere, dark because tools are dark, an IDE's
  tab-and-sidebar-icon grammar. **This is the live risk, not a hypothetical one:
  the current build already reads as a debug inspector.**
- **Consumer polish** — large radii, illustration, motion flourishes, chatty
  microcopy. Eight hours in front of something means it should be quiet.

And a fifth, from this repository rather than from the market:

- **The current build.** Ten screenshots in `test-results/ui-screenshots/`. It is
  the most specific anti-reference available and it is the one to keep looking at.

---

## Design Principles

Five. Strategic, not visual. Each one decides arguments that will actually come up.

1. **The host has an editorial voice over publisher data.** A publisher's
   identifier is never presented as a human heading, and a payload's *type* is
   never a user-visible label. Where the contract gives the host nothing human to
   show, the host shows nothing rather than showing the machine string. The
   freeze that once blocked a human title (the blueprint has no title field) is
   lifted: decisions D-36 and D-40 add a block `title` and a plugin `icon` to the
   versioned plugin manifest.

2. **No mode owns the layout.** The operator monitors, transacts, investigates and
   configures in the same window. The shell must not be tuned so that one of those
   four reads as the intended use and the other three as afterthoughts.

3. **Colour is state, never decoration.** Accent is for focus, current selection
   and primary action. Status colour means a threshold was crossed. Nothing is
   coloured to look designed. This is the floor the product register calls
   Restrained, and this shell stays on it.

4. **A claim is painted or it is not made.** The repository already believes this
   about tests; design inherits it. The live example: the twelve-series chart
   palette was searched against a plot well the application never paints, so a
   validated palette runs against an unvalidated background. Gates must measure
   what reaches a pixel.

5. **Density is bought with hierarchy, not with shrinking.** More rows on screen
   comes from clear type steps, real spatial rhythm and restrained chrome. It does
   not come from smaller text or thinner padding, which is what the shell does
   today and why it reads as a wireframe.

---

## Accessibility & Inclusion

**For 1.0: a keyboard gate** (decision D-37, 2026-09-18). Every command is reachable
from the command palette, shortcuts are shown in the interface, the whole shell can be
operated from the keyboard, and focus is always visible. Each of those is pinned by a
browser-lane spec. **Screen-reader support is not done**: WCAG 2.2 AA and an NVDA
pass (GitHub #60) are 1.1 work, and no document may describe them otherwise.

What follows is the 2026-08-03 position, which D-37 extends rather than replaces.

**Best effort. No stated compliance target.** The owner's decision, 2026-08-03.

The consequence, stated rather than left to be discovered: **the WCAG 2.2 AA
claims currently in this repository's documentation must be narrowed or deleted.**
The repository's own rule is that a claim without a test is narrowed until a test
covers it, or removed. "AA" is now a claim nothing commits to. GitHub #55 already
records that the target is unattainable as written, because extensions render two
of the three panes and are given one accessibility obligation.

What survives as a real, tested floor — because it already exists mechanically and
costs nothing to keep:

- **Contrast pairs are gated.** `design/check-contrast.mjs` fails a semantic colour
  token with no manifest row, and fails a manifest row naming a token that does not
  exist. Kept, and extended to fail a pair whose background nothing paints.
- **Focus is visible.** `e2e/focus-visibility.spec.ts` measures it on painted
  pixels in a real browser.
- **Colour is never the only channel.** Status carries a mark or a word as well as
  a hue. Costs nothing and is the one colour-blindness accommodation that survives
  having no compliance target.

What is explicitly **not** committed to: screen-reader semantics, assistive
technology verification (GitHub #60 — none has ever been run against this
application), reduced-motion beyond what the two existing motion tokens imply, and
internationalisation or RTL (GitHub #66).
