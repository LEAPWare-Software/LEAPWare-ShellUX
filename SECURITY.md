# Security Policy

## Supported versions

There has been no release. `package.json` declares version `0.1.0` and marks the
package `private`; nothing has been published and nothing has been tagged.

| What | Supported |
|---|---|
| The default branch | Yes. Fixes land there, and only there. |
| Any earlier commit | No. There are no backports and no patch branches. |
| Any tag or published artefact | None exist. |

There is no LTS line, and there will not be one before 1.0. If you are running
this shell you are running a **commit**, so name the commit when you report
anything.

---

## Read this first: the trust model

**LEAPWare-ShellUX is designed to host first-party modules — extensions the
deployer chose and compiled from source the deployer has.** Everything below is
written for that model and is not valid outside it.

Extensions run **in-page, in the host's React tree**: same origin, same document,
same JavaScript realm, same React reconciler. There is **no sandbox**. The host's
defences are about the host's own integrity and about **accidental collision
between mutually untrusting extensions**. They are not, and are nowhere described
as, a defence of one extension against another.

The condition that voids this, recorded in ADR-0001 Amendment E as a binding
trigger rather than a caveat:

> **This decision is VOID the day code the deployer did not read and compile from
> source they chose can reach the page.**

Concretely, any one of these fires it: an extension registry or plug-in
marketplace; a runtime remote loader of any kind; a hosted, multi-tenant
deployment. On that day the in-page model is void, **real per-extension isolation
becomes mandatory**, and it needs its own issue and its own threat model written
before any code. It is not a hardening pass on the current architecture, and
nobody may close it by adding checks to `ExtensionHostBoundary`.

---

## What the host defends against

Three words are used precisely across this repository, and they are load-bearing
here too:

| Term | What it means | What it survives |
|---|---|---|
| **Integrity control** | Real and unconditional. | Any caller, however hostile. |
| **Entry-point validation** | Real at the documented door. | An honest caller and a confused one; **not** a caller who reaches internals another way. |
| **Guardrail** | Prevents honest mistakes only. | A typo, a copied snippet, a misread guide. **Enforces nothing against deliberate action.** |

ADR-0001 Amendment G requires that no security claim stands in prose without
naming the test that exercises it, and `npm run check:citations` fails the build
on a citation that no longer resolves. **This file names no test titles**, on
purpose: every claim below is a summary of one stated at full width, with its
tests named, in the Security posture section of [`README.md`](README.md) and in
ADR-0001. Duplicating a title here would create a second copy to go stale, and a
stale citation reads as evidence when it is not. Read the summary here; read the
evidence there.

### Integrity controls — unconditional

- **The shell state store cannot be subverted.** Its state lives in closure
  variables, and JavaScript exposes no reflective API for a scope, so a caller who
  reaches the store obtains its methods and never the state behind them. The store
  object itself is frozen, so no holder can replace, delete or add a member, and
  every member validates its arguments. No caller, however hostile, can put a
  value of the wrong shape into this store's context.
- **Deep-frozen `IShellAPI`.** The handle an extension receives is recursively
  frozen, so one holder cannot swap a method out from under another. This is a
  property of the object, not a boundary around whoever holds it.
- **Host-owned normalised copies of everything untrusted.** Registration reads
  each untrusted field exactly once, checks the local, and writes it into a fresh
  host-owned record; collections are rebuilt as fresh arrays of exactly the length
  that was bounds-checked; the record is frozen at every host-owned level before
  it is stored. So a mutating getter that returns a benign value while it is
  inspected and a hostile one afterwards changes nothing; a `Proxy` reporting an
  honest `length` while it is measured and a larger one afterwards changes
  nothing; and a plug-in editing its own blueprint after a successful registration
  changes nothing. `getExtension` returns the host's record, not the caller's
  object.
- **Prototype pollution is impossible by construction, not by filtering.** The
  registry and badge stores are `Map`s. A `Map` has no prototype chain, so a key
  named `__proto__` or `constructor` stores a plain entry and can never reach
  `Object.prototype` — and that holds whatever the filter in front of it does.
- **A registry that its own input cannot crash or hijack.** `register` returns a
  typed failure rather than throwing, for every malformed payload including one
  that throws or resists inspection from its own property getters. Duplicate ids
  are a deterministic reported failure, never a silent overwrite. The failure it
  returns is always an error the host constructed, carrying a code from the host's
  own enum — never an error object handed back out of plug-in code. **This is
  `register`'s contract and not the exported `validateBlueprint`'s**, which throws
  rather than returning a result and out of which a throwing property getter on the
  payload still propagates untyped. Prefer `register` for input you did not author.
- **Revocation is immediate and cannot be resurrected.** A handle's liveness is
  re-asked on every call and is keyed on the host-owned record it was minted
  against, not on the id still being registered. `unregister` kills the handle
  from the very next statement, and unregistering then re-registering the same id
  in one commit does not hand the previous vendor a live handle into the new
  one's scope.

### Entry-point validation — real at the door, bypassable elsewhere

- **Identifier hygiene.** Every plug-in-supplied id — extension id, navigation
  node ids, ribbon action ids, badge node ids, badge scopes — must match a strict
  allowlist and is refused if it is a prototype-pollution key. Rejection messages
  describe an untrusted value by its `typeof` and never stringify it, so a hostile
  `toJSON`, a `Symbol.toPrimitive` or a reference cycle cannot run code or throw a
  raw `TypeError` out of the host.
- **Bounds on oversized payloads.** Text lengths, navigation node count,
  navigation depth and ribbon action count are all capped, and the cap applies to
  what is stored rather than to a number the payload can revise afterwards.
- **Argument validation on every door into shell state.** The members of
  `IShellAPI` and the members of the unscoped store are held to the same standard,
  field by field, and a rejected patch applies none of its fields.
- **Keyboard chords are validated at registration.** A chord is a structured
  field, not a string to parse at the trust boundary, and its key must be on a
  60-member host allowlist. A single character key must carry ctrl, alt or meta —
  the WCAG 2.2 section 2.1.4 conformance route — and `enter` is modifier-required.

These are entry-point validation rather than integrity controls for one honest
reason: they hold for the values that arrive through these functions, and a
caller who reaches the objects behind them another way is not bound by them.

### Fault containment

A plug-in view that throws during render degrades **one pane**, not the shell. The
ribbon, pane 1, pane 2 and pane 3 each carry their own fault boundary; the
boundary stores the thrown value and reads nothing off it inside React's error
path, because a second throw there is unrecoverable; the fallback renders no
plug-in component and no plug-in markup. A ribbon action's `isVisible` predicate
and its `onExecute` handler are each called inside a guard, a throwing predicate
is treated as not visible, and the report path is itself guarded so a tampered
`console.error` cannot turn containment into an escape.

**Its limits, which are the documented ones and not a surprise.** React error
boundaries catch render, lifecycle and constructor errors. They do **not** catch
errors in event handlers, in timer callbacks, or unhandled promise rejections.
Those remain the extension author's responsibility and are documented as such in
[`DEVELOPER.md`](DEVELOPER.md). Two further honesties: the pane-1 and ribbon
boundaries have no failure reachable through the public contract at all — they are
defence-in-depth, and pane 1's is untested — so the tested containment is the one
around the panes where plug-in views actually render. And a row's own boundary
offers no retry and no alert role, because it renders inside a list option.

---

## What the host explicitly does NOT defend against

Every item here is decided and recorded, not overlooked. Reporting one of them as
a vulnerability will get this section quoted back; reporting a place where the
repository *claims* otherwise is genuinely valuable — see below.

- **There is no sandbox.** Extensions are same-origin JavaScript in the same page.
  They reach the DOM, the document, and each other.
- **There is no enforceable boundary between two extensions, and there will not be
  one while extensions are scripts on this page.** Any code on the page can reach
  a DOM element, find React's `__reactFiber$…` expando as an own enumerable
  property, and walk the fiber tree to every hook value in the application —
  including the activation controller, the map holding every extension's `revoke`,
  and the state store. No DOM ref is needed, nothing has to be exported, and
  severing a React context does not remove a fiber from the tree. This is
  reproduced by a test that asserts the escalation **succeeds**, precisely so that
  nobody mistakes a guardrail for a guarantee. Six mitigations were investigated
  and rejected with reasons in ADR-0001 Amendment E.
- **Badge scoping is collision-resistance, not confinement** (ADR-0001 Amendment
  E). Two extensions that both name a node `inbox` cannot overwrite each other,
  and an extension cannot name the scope it writes to through its own facade. That
  is the whole of what it buys. The unscoped store is public, so any scope can be
  read and written directly, host badges included.
- **Persisted-state namespacing is collision-resistance, not confinement.**
  Weaker than badge scoping, for two independent reasons: the scope is an
  **argument, not a closure**, so any holder of the engine can name any scope; and
  the store is one browser storage entry under one origin, which any script on the
  page reads and rewrites without going through the engine at all. **Nothing
  confidential belongs in persisted UI state**, or in shell state generally.
- **`unregister` has no authorisation model.** Any holder of the registry can
  remove any extension, including one it did not register. This is an accepted
  scope decision (ADR-0001 Amendment B), not an oversight: an extension motivated
  to remove a competitor's UI does not need `unregister` to do it, and a token
  would advertise a guarantee the architecture cannot make.
- **A plug-in can reach a sibling's view component.** `useRegistry` is deliberately
  not severed inside an extension subtree — it is how an extension registers
  itself — so `getExtension(otherId)` hands any component the sibling's host-owned
  record, and that record carries the sibling's view components and callbacks.
- **The deep freeze does not extend to plug-in-supplied functions.** Every
  container the host owns is frozen; the functions and React components inside
  them are carried by reference, unfrozen. Freezing a function breaks its closure,
  freezing a component reference remounts the pane on every render or reaches into
  another vendor's internals. So one extension can set properties on another's view
  component and change what it renders. Freezing is not the fix and the host does
  not do it.
- **A store listener is untrusted code running inside somebody else's write.**
  `subscribe` is public. A listener runs synchronously inside another holder's
  write: it observes every value written, may re-enter the store and leave its own
  value standing instead, and may throw anything into the writing frame — including
  a throw that starves every listener ordered after it. Freezing the store does not
  touch any of this, because nothing is replaced, and it is not closable in-page: a
  store that notifies nobody is a store no pane can render off.
- **The host does not inspect or sanitize what an extension renders inside its own
  panes.** Anything an extension renders inside its own views is the extension's
  responsibility entirely. And the host's own render sites are not uniformly
  covered: rendering plug-in strings as text nodes is a delivered, tested property
  at the ribbon and at the row virtualizer, and elsewhere it is still the correct
  pattern written with nothing asserting it — an intent, which must not be cited as
  a control. README.md says which site is which.
- **Suppression of hotkey dispatch inside editable targets is a guardrail.** A
  plug-in can render a custom editor carrying no recognised role, and the
  suppression will not see it.

---

## Reporting a vulnerability

**Report privately, through GitHub Security Advisories.** On this repository:
Security tab, then "Report a vulnerability". That opens a private advisory
visible only to you and the maintainers.

**Do not open a public issue for a suspected vulnerability.** Not a bug report,
not a discussion, not a pull request that fixes it with an explanatory title. A
public issue publishes the finding before there is anything to update to, and on
a project with no release there is nothing to update to. If private reporting is
unavailable to you for any reason, say so through the private channel you *do*
have rather than working around it in public.

Please include, in as much of this form as you can manage:

- the **commit SHA** you observed it on;
- **`file:line`** for every claim — this repository argues from specific lines,
  and a report that does the same is triaged far faster;
- **how you reproduced it**, ideally as a failing test written against the public
  contract;
- **what the repository promises** that this contradicts — the sentence, and where
  it is;
- what you are **not** claiming, so the finding is not read wider than the
  evidence.

Expectations, stated honestly: this is a pre-1.0 project with a single
maintainer. There is no bounty, no service-level agreement, and no guaranteed
response window. What is promised is that a report will be read, that a finding
which reproduces will be recorded in the repository even if it is not fixed
immediately, and that the fix or the accepted limit will be written down where
readers will find it.

### What is not a vulnerability here

Anything in the "does NOT defend against" section above. Those are decided
positions with the reasoning recorded, and a report restating one is not a
finding. The trigger in ADR-0001 Amendment E is what changes that answer, and
until it fires the answer does not change.

### What IS a vulnerability here, and is easy to miss

**A sentence in this repository that claims more than the code delivers.** That is
the failure mode this project has actually had — seven consecutive review rounds
found sound code and a conclusion written one step wider than the premise
licensing it, which is why ADR-0001 Amendment G exists. A reader who trusts an
overclaimed sentence and ships against it is exposed by the sentence, so a
documentation overclaim is treated as a security defect and not as a typo. If the
overclaim is about a limit already public in this file, an ordinary public issue
is fine; if narrowing the sentence would itself disclose an unpublished weakness,
report it privately like any other.

---

## Where the evidence lives

| Document | What it carries |
|---|---|
| [`README.md`](README.md) | The Security posture section: every claim above at full width, labelled with one of the three words, each naming the tests that exercise it. |
| [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md) | The architecture and its amendments. Amendment E for why there is no boundary between extensions and for the trigger that voids the decision; Amendment B for `unregister`; Amendment G for the no-claim-without-a-test rule. |
| [`DEVELOPER.md`](DEVELOPER.md) | The rules an extension author's own code has to follow. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The standing rules for anything written into this repository, documentation included. |
