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

**One limit applies to every integrity control in this file, and it is stated
once, here, rather than on whichever bullet happens to mention it.** All of them —
the closure-backed store, the deep-frozen `IShellAPI`, the host-owned normalised
copies, the `Map`-backed registry and badge stores, the frozen host constants and
the error-code trust decision alike — defend against plug-in code that runs
*after* the host module graph has evaluated. Code that runs *before* it can
replace `Object.freeze`, `Map`, `Set` or `Object.defineProperty` themselves, and
no module can defend against that from inside, because it is holding the very
builtins its defence is written in. Stating the limit on one control would imply
by omission that the others are exempt, and none of them is.

This does not weaken any control below, and it is why the heading over them still
reads *unconditional*. **Unconditional** in the table that follows means *against
any caller, however hostile, once the host is running* — the register the whole
file is written in. It has never meant *before there is a host to call*. In this
trust model, code evaluating ahead of the host is code the deployer chose,
compiled and shipped; the day that stops being true, the paragraph below has
already voided the whole model rather than this one caveat.

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
  own enum — never an error object handed back out of plug-in code.

  **The mechanism is named here because the obvious one is not enough, and this
  claim was over-stated until it changed.** A `ShellUXError` coming back out of
  plug-in code may carry any `code` at all, and the host has to decide whether to
  copy that string into the error it hands its own callers. That decision used to
  interrogate the exported `SHELL_UX_ERROR_CODES` set, which a plug-in can import
  — and freezing that set closed only own-property shadowing of its lookup method,
  leaving `add` working, because a `Set` keeps its membership in internal slots
  rather than in properties. So a plug-in could widen the collection the host was
  consulting and choose the code `register` reported, including `REVOKED`. For as
  long as that was true this bullet claimed more than the code delivered.

  The decision is now `isShellUXErrorCode` in `src/core/types.ts`. It reads a
  **module-private, frozen, null-prototype** table that no importer can name, and
  compares the result with `=== true`. Widening any exported collection leaves it
  where it was; it calls no method, so replacing `Set.prototype`'s lookup forges
  nothing; and its table inherits nothing, so `Object.prototype` pollution answers
  for no key. The pre-evaluation limit that bounds this — and bounds every other
  control in this section identically — is stated once in the trust model above.
  The named tests for all of it are in the Security posture section of
  [`README.md`](README.md), under the host-constants bullet, per the policy above.

  **This is `register`'s contract and not the exported `validateBlueprint`'s**,
  which throws rather than returning a result and out of which a throwing property
  getter on the payload still propagates untyped. Prefer `register` for input you
  did not author.
- **Revocation is immediate and cannot be resurrected.** A handle's liveness is
  re-asked on every call and is keyed on the host-owned record it was minted
  against, not on the id still being registered. `unregister` kills the handle
  from the very next statement, and unregistering then re-registering the same id
  in one commit does not hand the previous vendor a live handle into the new
  one's scope.
- **The host constants cannot be replaced.** `EXTENSION_ID_PATTERN`,
  `RESERVED_IDS`, `REGISTRY_LIMITS`, `HOTKEY_KEYS` and
  `HOTKEY_MODIFIER_REQUIRED_KEYS` — the rules every untrusted payload is measured
  against — are exported from modules a plug-in can import, and every one of them
  used to be runtime-mutable: `REGISTRY_LIMITS` was `as const`, which binds nobody
  who is not being compiled, and assigning `EXTENSION_ID_PATTERN.test` shadowed
  the method every id check calls. **Thirteen exports are now covered, not those
  five and not the six this bullet used to list.** Five of the others are
  `PANE_IDS` and `SHELL_UX_ERROR_CODES` in `src/core/types.ts`, and
  `HYDRATION_LIMITS`, `DEFAULT_SHELL_STATE` and `EMPTY_SCOPED_STATE` in
  `src/core/services/HydrationEngine.ts`; `HYDRATION_LIMITS` is a second set of
  bounds on untrusted input and shipped `as const` — issue #10's exact defect,
  reintroduced. The last three are `SHELL_ICONS`, `FALLBACK_ICON` and
  `OVERFLOW_ICON` in `src/components/ui/shellIcons.tsx`, covered from 2026-08-16.
  All thirteen are frozen, so no own property can be added, replaced or deleted on
  any of them.

  **The enumeration is no longer maintained by hand, because a hand-maintained
  list is how the tenth one got in.** The gate walks the export namespace of each
  covered module and requires every object-valued export to be frozen, so a
  constant added to a module already covered is gated by default rather than by
  someone remembering to add a line. Exemptions must be written down with a reason
  a reviewer can refuse; there are currently none. **What is still hand-maintained
  is the list of MODULES** — four of them today — so a *new* module exporting
  bounds or allowlists is outside the gate until someone adds it. That was a real
  residual hole and not a theoretical one, and it had a live instance until
  2026-08-16: `SHELL_ICONS` in `src/components/ui/shellIcons.tsx` is the host's
  icon vocabulary, keyed by an **untrusted** plug-in string and read into the
  shell's own navigation rail and ribbon — outside any extension boundary — and it
  shipped unfrozen behind a `ReadonlyMap` type that binds nobody at runtime. An own
  `get` assigned onto it shadowed the prototype method every one of those call
  sites invokes and put attacker-chosen geometry into host chrome. It is frozen,
  its module is in the gate, and the shadow is refused at both render sites; the
  finding is kept with its closure note in
  [`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md). **The structural
  residual remains: the module list is still hand-maintained.**

  **The obvious wider reading is false, and the repository asserts against
  it rather than leaving it to be discovered.** `Object.freeze` on a `Set` does
  not stop `.add()` — a `Set` keeps its state in internal slots rather than in
  properties, so `HOTKEY_KEYS.add('tab')` still widens the allowlist. A `Map` is
  the same: freezing `SHELL_ICONS` does not stop `.set()`, `.delete()` or
  `.clear()`. What freezing closes is own-property shadowing of `has`, `test` and
  `get`, which was the interesting attack. The claim is that these cannot be
  **replaced**, never that they cannot be **changed**, and tests demonstrate the
  mutability that remains — on a throwaway `Set` and a throwaway `Map`, so no live
  allowlist is left widened behind them. The freeze is also one level deep:
  `DEFAULT_SHELL_STATE` nests a `paneSizes` object that is frozen at its own
  declaration rather than by the gate.
  *Tests:* `src/core/__tests__/hostConstants.test.ts` — "freezes the host constants
  against replacement", "walks the gated modules and finds the constants it is
  meant to guard", "does not claim more than a frozen Set delivers" and "does not
  claim more than a frozen Map delivers";
  `src/components/__tests__/ShellLayoutIcons.test.tsx` — "refuses an own get on the
  icon table, so the collapsed track still draws host geometry";
  `src/components/__tests__/RibbonToolbar.test.tsx` — "refuses an own get on the
  icon table, so the ribbon still draws host geometry".

  **`SHELL_UX_ERROR_CODES` is the case where freezing was necessary and was not
  sufficient**, which is why the error-code decision moved out of it entirely —
  see the `register` bullet above. It is not the trust decision, and no
  production module under `src/` may even name it, let alone interrogate it,
  which a source scan enforces rather than asks for.

### Entry-point validation — real at the door, bypassable elsewhere

- **Identifier hygiene.** Every plug-in-supplied id — extension id, navigation
  node ids, ribbon action ids, badge node ids, badge scopes — must match a strict
  allowlist and is refused if it is a prototype-pollution key. **A context key is
  held to that same rule.** `setContextKey(key, value)` takes a plug-in-supplied
  `key`, and it is checked against the same allowlist and the same reserved words,
  because it is a host lookup key in exactly the way a badge node id is; the
  record it lands in is built on `Object.create(null)` as well, so there is nothing
  to pollute even if that filter were wrong. Rejection messages describe an
  untrusted value by its `typeof` and never stringify it, so a hostile `toJSON`, a
  `Symbol.toPrimitive` or a reference cycle cannot run code or throw a raw
  `TypeError` out of the host.
- **Bounds on oversized payloads.** Text lengths, navigation node count,
  navigation depth and ribbon action count are all capped, and the cap applies to
  what is stored rather than to a number the payload can revise afterwards. Three
  of the bounds are on a runtime call rather than on a registered blueprint, and
  they sit in the same table so that there is one place to look for the limit on
  anything: a selection carries at most `MAX_SELECTED_ITEMS` (4096) item ids, an
  extension holds at most `MAX_CONTEXT_KEYS` (64) distinct context keys, and a
  `string` context-key value is at most `MAX_CONTEXT_VALUE_LENGTH` (256)
  characters. There is deliberately no way to delete a context key — unsetting one
  means writing `null`, which still occupies a slot — so that key bound is what
  stops the record growing without limit.
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
  read and written directly, host badges included. **The read half is scoped the
  same way, and that does not make it a boundary either.**
  `IShellAPI.getBadgeCount` closes over the same validated id and takes no scope
  parameter, so a handle reads back exactly what it can write and nothing more —
  which stops the read being a wider capability than the write it mirrors, and is
  the only thing it does. The unscoped `getBadgeCount` behind the facade still
  takes a scope and still reads anyone's.
- **Context-key scoping is collision-resistance, not confinement, in the same
  register.** `setContextKey` writes into a namespace keyed by the extension id
  the facade closed over, so two extensions that both publish a key called
  `loaded` keep their own and neither has a parameter with which to name the
  other's. Reading is the half that is not scoped at all:
  `RibbonContext.contextKeys` publishes the FOREGROUND extension's whole record
  into the one host-wide snapshot, so anything holding a context — a backgrounded
  extension calling `getContext()` included — reads it, and the unscoped store
  behind the facade is public exactly as it is for badges. Every namespace is
  dropped on a foreground handover, which bounds how long a key stays readable and
  does not make it private. **Nothing confidential belongs in a context key.**
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
