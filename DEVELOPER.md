# Extension Author Guide — LEAPWare-ShellUX

This is the onboarding guide for third parties building extensions against the
LEAPWare-ShellUX host.

---

## Read this before you read anything else

**The host is pre-alpha and the core contract is being written right now.**
ISSUE-001 — the file set that defines `LEAPExtensionBlueprint` and `IShellAPI` —
is in progress and has not landed. See [`README.md`](README.md#project-status).

That has a direct consequence for this document, and it is important that you
understand it rather than working around it:

> **Where an exact TypeScript signature has not yet been settled by ISSUE-001,
> this guide says so and does not print one.** You will find "not yet settled"
> markers below where a concrete type would normally be. That is deliberate. A
> confidently wrong signature in an onboarding guide is worse than an
> acknowledged gap — it produces code that compiles against a fiction and has to
> be thrown away.
>
> **The generated types in `src/core/types.ts` are the single source of truth.**
> When it lands, read it. Where this guide and that file disagree, that file
> wins and this guide is a bug.

What *is* settled, and what you can safely design around today, is the **shape
of the contract**: which concepts exist, what each one is responsible for, and
what the host guarantees. That is what this guide covers.

---

## The mental model

You do not import the host. The host does not import you.

You export a **blueprint** — a plain description of what your extension
contributes. The host receives it, validates it, registers it, and calls you
back with a **shell API** object when it activates you. Everything you are
allowed to do to the host goes through that object. There is no other channel,
and reaching for one (a global, a window property, a direct import of a host
module) is a contract violation that will break without warning.

```
   your extension                   the host
   ─────────────                    ────────
   exports  ──►  LEAPExtensionBlueprint  ──►  registry validates + indexes
                                                        │
   receives ◄──  IShellAPI (deep-frozen)  ◄─────────────┘
                                                        │
   host renders your Pane 1 entry, Pane 2 view,  ◄──────┘
   Pane 3 view, and your ribbon actions
```

The host contains zero business logic. It does not know what your data means. It
will not special-case you, and you should not need it to — if you cannot express
something through the public contract, that is a gap in the contract worth
reporting, not a reason to reach inside.

---

## The `LEAPExtensionBlueprint` contract

Your extension's entry point exports one blueprint object. It is data, not
behaviour: the host reads it during registration, before anything of yours
renders.

| Concept | Responsibility | Signature status |
|---|---|---|
| **Extension id** | Stable, unique identifier. Used to index the registry and to namespace your persisted state. Never change it after release — changing it orphans every user's saved state for your extension. | Settled as a string. Exact branding/validation rules **not yet settled** by ISSUE-001. |
| **Display label** | Human-readable name shown in the navigation sidebar. | Settled as a string. |
| **Icon** | Optional icon reference for the sidebar, and the only thing visible when Pane 1 collapses to its 48px icon track. | Concept settled. **Exact type not yet settled** — whether this is a component, a name from a set, or a node is an open ISSUE-001 decision. Do not assume. |
| **Navigation entry** | Your Pane 1 contribution: the tree or list a user navigates. Supports runtime-mutable badge counts (unread, pending, stock level). | Concept settled. **Exact shape not yet settled**, including how badge counts are updated. |
| **Pane 2 view** | Your master/list view component. Rendered inside the host's virtualized list container. | Settled as a React component. **Exact props not yet settled.** |
| **Pane 3 view** | Your detail view component. Gets a header region, a scroll container, and a utility drawer slot. | Settled as a React component. **Exact props not yet settled.** |
| **Ribbon actions** | Your contextual actions, rendered on the right side of the ribbon. See below. | Concept settled. Field names settled (id, label, invoke handler, visibility predicate). **Exact types not yet settled.** |

**Do not hand-write a type declaration matching this table.** Import the real
type from the host's `src/core/types.ts` once ISSUE-001 lands and let the
compiler tell you what you got wrong. That is the whole point of a type-safe
registry.

---

## The `IShellAPI` contract

`IShellAPI` is what the host hands *you*. It is the entire surface you are
permitted to touch.

Two properties of it are settled and load-bearing for how you write your code:

**1. It is deeply frozen.** Recursively — not just the root object. You cannot
add to it, replace anything on it, or patch a nested service. Attempts are a
no-op in sloppy mode and a `TypeError` under strict mode, which is how your
modules will run. This is not incidental hardening; it is the mechanism that
stops one extension from tampering with the shell services other extensions
depend on. Design your extension as a consumer of this object, never as a
modifier of it.

**2. It is scoped to you.** Your persisted state is namespaced by your extension
id. You cannot read or overwrite another extension's state, and another
extension cannot read or overwrite yours.

> **The member list of `IShellAPI` is not yet settled.** ISSUE-001 owns it.
> This guide will not print a method list, because printing a plausible-looking
> one that turns out to be wrong would send you writing calls that do not exist.
> When `src/core/ShellAPI.ts` and `src/core/types.ts` land, the type is the
> reference. Broadly, the services being scoped for it cover shell-level
> concerns — selection and navigation state, scoped persistence, and
> notification of shell events — but **treat that as a description of intent,
> not as an API listing.**

Practical advice that holds regardless of the final member list: **keep your
calls into `IShellAPI` behind a thin adapter in your own code.** One small module
that wraps every host call gives you a single place to fix when the contract
settles, instead of a fix scattered through every view you wrote.

---

## Directory convention

Extensions live one directory per extension:

```
src/extensions/<name>/
├── index.ts               ← exports your LEAPExtensionBlueprint. Entry point.
├── views/
│   ├── Pane2View.tsx      ← master / list view
│   └── Pane3View.tsx      ← detail view
└── (anything else you need — state, adapters, tests, styles)
```

The three named files are the convention the host and its tooling expect:

- **`index.ts`** exports the blueprint and nothing else of consequence. Keep it
  declarative. It is read at registration time, so avoid side effects, network
  calls or heavy imports at module scope — they run before your extension is
  ever activated and they slow the shell's boot for every user, including the
  ones who never open your extension.
- **`views/Pane2View.tsx`** is your list. It renders inside the host's
  virtualized container, so it renders *rows*, and it must not assume every item
  is mounted. See the virtualization notes below.
- **`views/Pane3View.tsx`** is your detail view. You own a header, a scroll
  container and a utility drawer slot. Put your own scrolling inside the
  provided scroll container — do not create a second, competing scroll context.

Everything else under your directory is yours. The host does not read it.

---

## Compact styling rules

The shell is a **high-density desktop tool**. Your views must match its density
or they will look broken next to the host chrome. This is not a suggestion —
it is the visual contract.

| Rule | Value |
|---|---|
| Padding | `p-1` to `p-3`. Nothing looser. |
| Base type | 11px – 13px. |
| Borders | 1px, `border-neutral-200` (light) / `border-neutral-800` (dark). |
| Row height | Compact. Assume many rows visible at once. |
| Spacing | Tight. Explicitly **not** airy mobile-web spacing. |

Concretely, for extension authors:

- **Do not** use large padding utilities (`p-4` and up) for structural spacing in
  panes. If your view needs more air to be legible, the problem is usually
  information hierarchy, not spacing.
- **Do not** introduce your own font sizes above the 11px–13px band for body
  content. A heading may be slightly larger; a data row may not.
- **Do** use the same neutral border tokens as the host. A different border
  colour reads as a rendering bug to users, not as branding.
- **Do** support both light and dark. Both tokens above are part of the contract;
  an extension that only works in one theme is incomplete.
- **Do** keep row heights consistent within a list. The virtualizer handles
  variable heights, but consistent heights scroll better and look correct at
  density.

The density exists because a user of this shell is looking at a lot of rows on a
large screen and values seeing more of them over seeing them spaciously. An
extension that ignores this makes the whole application feel inconsistent.

---

## How `ribbonActions` visibility predicates work

The ribbon is split: **global host actions on the left, your contextual actions
on the right.** Contextual means the set changes with context — and *you* define
what context means, because the host cannot.

Each ribbon action carries four things: an **id**, a **label**, an **invoke
handler**, and a **visibility predicate**.

The predicate is the interesting one. On each relevant render, the host
evaluates your predicate against current shell state and shows the action only
if it returns true. This is the entire mechanism by which "Reply" appears when a
message is selected and disappears when nothing is, without the host knowing
what a message or a reply is.

```
  host renders ribbon
        │
        ├─ for each of your ribbonActions:
        │     evaluate action's visibility predicate against shell state
        │        ├─ true  → render the action (label as a text node)
        │        ├─ false → omit it
        │        └─ threw → omit it, report it, keep rendering the rest
        │
        └─ ribbon renders
```

### Rules for writing predicates

- **Predicates must be pure and cheap.** They are evaluated on render, possibly
  often. No network calls, no writes, no state mutation, no `localStorage`
  access. Read the state you were given and return a boolean.
- **A throwing predicate is treated as "not visible."** The host will hide the
  action, report the failure, and continue rendering the ribbon. Your action
  silently vanishing is the symptom of a predicate that threw — check that first
  when an action does not appear.
- **Predicates must be defensive about their input.** Selection may be empty,
  may be multiple, may reference an item that has since been removed. Write
  predicates that return false in states you do not understand rather than
  assuming a shape.
- **Do not use a predicate as a side-channel.** Using render-time predicate
  evaluation to trigger work is an abuse that will break when the host changes
  when it evaluates them.
- **Keep action ids stable and namespaced.** Collisions with another extension's
  action ids are a registration-time failure. Prefixing with your extension id
  is the simple way to avoid it.
- **Labels are rendered as text nodes.** See below — this matters for security,
  and it also means markup in a label will be shown literally, not rendered.

> **The exact predicate signature — what state object it receives and its precise
> parameter list — is not yet settled by ISSUE-001.** What is settled is the
> behaviour above: a pure function evaluated against current shell state,
> returning a boolean, with throws treated as false. Write your predicates as
> small, self-contained functions so that adapting them to the final signature is
> a one-line change at the call boundary rather than a rewrite.

---

## Working with the virtualized list

Pane 2 is virtualized: only rows intersecting the viewport, plus a small
overscan, are mounted. Consequences for your Pane 2 view:

- **Never assume all your rows are in the DOM.** Do not query the document for
  rows, measure the full list by walking DOM nodes, or use `Ctrl+F`-style
  find-in-page as a supported flow. Only the visible window exists.
- **Row renderers must be side-effect-free and fast.** They run during scroll.
- **A row renderer that throws is contained** to that row where possible — but
  do not rely on that as error handling. Validate your data.
- **Keep row keys stable.** Index-based keys break under insertion and removal.
- **Consistent row heights scroll better.** Variable heights are supported;
  heights that change *after* mount cause visible reflow.

---

## Fault containment — and its real limits

The host wraps each pane and each extension subtree in a fault boundary. If your
extension throws during render, it degrades to a contained error surface inside
its own pane, naming your extension, while the rest of the shell stays
interactive.

**Be clear about what this does not cover.** React error boundaries catch errors
in render, in lifecycle methods and in constructors. They do **not** catch:

- errors thrown in **event handlers** (your click handler, your ribbon action's
  invoke handler),
- errors thrown in **`setTimeout` / `setInterval`** callbacks,
- **unhandled promise rejections** from your async work,
- errors thrown during **server-side rendering**.

Those are yours to handle. Wrap your own async work and your own handlers. An
unhandled rejection in your extension will surface as a global error, not as a
tidy contained pane.

---

## Security: plugin-supplied strings are untrusted

**Read this section even if you skip the rest.**

The host treats every string that comes from an extension — labels, display
names, navigation entry text, badge values, list item content, detail field
values — as **untrusted input**. You must do the same with every string that
comes from *your* data source into your views.

The rule is simple and absolute:

> **Render plugin-supplied and data-supplied strings as text nodes. Never via
> `dangerouslySetInnerHTML`.**

### Why this is not paranoia

Extensions run as same-origin JavaScript in the same page as the shell and every
other extension. There is no iframe sandbox between you and them. An injected
script in your pane is an injected script in the whole application — with access
to the shell, to other extensions' rendered content, and to the user's session.
Your extension is very likely rendering content that originated somewhere else:
an email body, a record field, a filename, a user-entered label. Any of it can
contain markup, and some of it will.

### Do this

```jsx
// Correct. React escapes this. Markup in the value is shown literally.
<span className="truncate">{item.subject}</span>
<div className="p-2 text-xs">{record.notes}</div>
```

React escapes interpolated values by default. Using `{value}` in JSX is safe and
is the expected pattern throughout the shell.

### Never do this

```jsx
// PROHIBITED. This is a cross-site scripting vulnerability in a shared page.
<div dangerouslySetInnerHTML={{ __html: item.body }} />
<span dangerouslySetInnerHTML={{ __html: extension.label }} />
```

There is no "but my data source is trusted" exemption. Data sources change,
get proxied, get mirrored, and get compromised. The boundary is enforced at
render because that is the only place it can be enforced reliably.

### The rest of the rules

- **No `dangerouslySetInnerHTML` in extension code.** If you believe you have a
  case that genuinely requires rendering HTML — a rich email body is the honest
  example — do not solve it with `dangerouslySetInnerHTML` and a hand-rolled
  filter. Raise it as a contract question. Sanitizing HTML correctly is a
  specialist problem and hand-rolled sanitizers fail.
- **Do not build DOM by string concatenation**, and do not reach for `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, or `document.write` to get around the JSX
  rule.
- **Never pass extension or data strings to `eval`, `new Function`, or to
  `setTimeout`/`setInterval` as a string body.**
- **Validate URLs before putting them in `href` or `src`.** A `javascript:` URL
  in an anchor is script execution. Allow only the schemes you actually need —
  in practice `https:`, and `mailto:` if you are a mail extension.
- **Treat persisted state as untrusted on read.** Your persisted state lives in
  local storage, which the user (or anything running in the page) can edit.
  Validate it when you read it; never spread an unvalidated persisted object into
  live state.
- **Do not attempt to read or write another extension's namespace.** It is a
  contract violation, and the namespacing exists specifically to prevent it.
- **Do not stash capabilities on globals.** Putting a reference to your services
  on `window` hands them to every other extension in the page.

---

## Testing your extension with a mocked `IShellAPI`

Your extension should be testable without booting the host. Because everything
you are allowed to do goes through `IShellAPI`, substituting a test double for
that one object gives you a fully isolated extension under test.

Tests run under Vitest. The recommended approach:

**1. Build a stub that satisfies the real `IShellAPI` type — do not hand-write
an interface.** Type your stub as `IShellAPI` (imported from the host's
`src/core/types.ts`) and let the compiler enforce completeness. If the contract
grows a member, your test stub fails to compile, which is exactly the signal you
want. A hand-written interface that merely resembles `IShellAPI` will silently
drift and give you passing tests against an API that no longer exists.

> Because the member list of `IShellAPI` is **not yet settled** (ISSUE-001 is in
> progress), this guide does not print a filled-in stub object. Doing so would
> mean inventing the very method names the compiler is supposed to be checking
> for you. Build your stub from the real type when it lands; the structure below
> is the pattern, not the payload.

**2. Freeze your stub the way the host does.** The host hands out a deeply
frozen object. If your test double is mutable, your tests will pass on code that
mutates the API — and that code will fail in production. Deep-freeze your stub so
your tests reproduce the real constraint.

**3. Assert on the calls, not on host internals.** Use `vi.fn()` for each member
so you can assert your extension called the host correctly. That is the actual
contract you are testing: given this user interaction, my extension makes this
request of the shell.

**4. Test your views in isolation.** Render `Pane2View` and `Pane3View` with
your stub API and representative data. Cover the states the host will actually
put you in:

- Empty data set, and a single item.
- No selection, single selection, and — if you support it — multi-selection.
- A selection referencing an item that has since been removed.
- Long strings that must truncate rather than break the pane.
- **Strings containing markup**, asserting they render as literal text. This is
  a security regression test and it is worth having.
- Both light and dark theme.

**5. Test your visibility predicates directly.** They are pure functions.
Call them with the state shapes you expect, plus the states you do not — empty
selection, stale selection, missing fields — and assert they return false rather
than throwing. Remember a throwing predicate silently hides your action.

**6. Test your cleanup.** Mount and unmount your views repeatedly and assert
that listeners, timers, subscriptions and observers are released. Extension
switching in this shell causes real mount/unmount churn, and a leak in your
extension degrades the whole application.

**7. Do not test against the host's internals.** If a test needs to import
something from the host that is not part of the public contract, that test is
testing the wrong thing — or the contract has a genuine gap worth reporting.

---

## Checklist before you ship an extension

- [ ] `index.ts` exports a blueprint with a stable, namespaced extension id.
- [ ] No side effects, network calls or heavy imports at module scope in
      `index.ts`.
- [ ] Ribbon action ids are namespaced; no collisions.
- [ ] Every visibility predicate is pure, cheap, and returns false on states it
      does not understand.
- [ ] All extension- and data-supplied strings render as text nodes. Zero uses of
      `dangerouslySetInnerHTML`.
- [ ] URLs are scheme-validated before reaching `href` or `src`.
- [ ] Persisted state is validated on read, not trusted.
- [ ] Padding within `p-1`–`p-3`, type within 11px–13px, host neutral border
      tokens used.
- [ ] Light and dark theme both correct.
- [ ] Pane 3 scrolling uses the provided scroll container.
- [ ] Row keys are stable; the Pane 2 view does not assume all rows are mounted.
- [ ] Async work and event handlers have their own error handling — the fault
      boundary does not cover them.
- [ ] Listeners, timers and subscriptions are cleaned up on unmount, verified by
      test.
- [ ] Views tested against a deep-frozen stub typed as the real `IShellAPI`.
- [ ] The extension imports nothing from the host outside the public contract.

---

## Where to go next

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | Project status, design system, accessibility target, performance targets. |
| [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md) | Why the registry works this way, and what was rejected. |
| [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) | What is being built, in what order, and what "done" means. |
| `src/core/types.ts` | **The source of truth for every contract in this guide.** Not yet landed — ISSUE-001. |
