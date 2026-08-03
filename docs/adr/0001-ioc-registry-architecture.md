# ADR 0001 — Registry-Based IoC Architecture with Deep-Frozen API Contexts

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Implemented by:** ISSUE-001 — Type-Safe IoC Extension Registry & Primitives
  (`src/core/types.ts`, `src/core/RegistryContext.tsx`, `src/core/ShellAPI.ts`)

> **Implementation status.** ISSUE-001 has landed: `src/core/types.ts`,
> `src/core/RegistryContext.tsx` and `src/core/ShellAPI.ts` exist and are held
> to a 100% coverage gate over `src/core/**`. Sections 1–3 of the decision
> below are implemented. Sections 4 (predicate evaluation), 5 (lazy loading)
> and 6 (pane fault boundaries) describe ISSUE-002 and ISSUE-004 behaviour and
> are **still decision only** — nothing in `src/` evaluates a predicate or
> catches a render error yet.
>
> Eight amendments have been made and are recorded at the end of this document —
> the header previously named only the first two, and then only the first six,
> each time going out of date as the next one landed:
>
> - **A** — normalisation at the trust boundary.
> - **B** — `unregister` carries no authorisation.
> - **C** — activation, revocation, badge scoping, and giving `onExecute` a
>   capability.
> - **D** — the capability/information split.
> - **E** — **the between-extension boundary is not enforceable in-page.** Read
>   this one before reading any claim in A–D as isolation. It reclassifies
>   `ExtensionHostBoundary` as a guardrail, states what *is* unconditionally true,
>   and records the firm condition that voids the decision.
> - **F** — **the store object was never frozen, and teardown revocation is
>   removed.** Read this one before reading E's own statement of what is
>   unconditionally true: E's flagship claim about the shell store was resting on a
>   freeze that did not exist, and E's claim to have left no false security claim
>   standing was itself false. F also removes provider-teardown revocation after two
>   failed implementations, and reclassifies `isVisible` purity as a guardrail.
> - **G** — **no security claim without a named test.** The review-time rule that
>   governs how every sentence in A–F may be written, and the seven rounds of
>   evidence for why it was needed.
> - **H** — **plug-in-registered keyboard shortcuts.** `RibbonAction.hotkey`:
>   where the field lives and why, the `event.key` binding, the WCAG 2.1.4
>   modifier rule, and why cross-extension conflict rejection was refused.

---

## Context

LEAPWare-ShellUX is a shell host, not an application. It owns the ribbon, the
three-pane layout, pane sizing and persistence, extension lifecycle, and
navigation. It is required to own **zero business logic**. Every user-facing
capability — mail, inventory records, whatever a deployment needs — arrives from
an extension.

That requirement is only meaningful if it is structurally enforced. A host that
merely *intends* to stay free of business logic accumulates it: a special case
for one extension's needs, then a second, and within a few releases the host is
an application with a plugin system bolted on. The architecture has to make the
wrong thing hard rather than merely discouraged.

The forces acting on the decision:

1. **The host must not know what extensions mean.** It renders a Pane 2 view
   without knowing whether it lists messages or parts. It shows a ribbon action
   without knowing what invoking it does.
2. **Extensions come from third parties.** They are written outside this
   repository, on their own schedule, and shipped without the host team
   reviewing them.
3. **Extensions are mutually untrusted.** Two extensions from different vendors
   run in the same page. Neither may tamper with the other, and neither may
   tamper with the shell services the other depends on.
4. **Type safety is a primary requirement, not a nicety.** The contract is the
   product. An extension author must find out at compile time that they got the
   contract wrong, not at runtime in front of a user.
5. **Local-first.** The shell must function with no network. Extension loading
   is local and lazy — no registry server, no remote manifest fetch, no runtime
   dependency on anything off the machine.
6. **A misbehaving extension must not take down the shell.** One vendor's bug
   must degrade to one broken pane, not a blank application.
7. **Extensions must be discoverable and enumerable at runtime.** The host needs
   to render a navigation entry per extension and collect ribbon contributions
   without a compile-time list of who exists.

Three systems were studied directly as prior art:

- **Eclipse RCP / OSGi** — the extension-registry model, where components declare
  contributions to named extension points and the platform resolves them, rather
  than components referencing each other.
- **VS Code** — the *shape* of a restricted API context object: an extension is
  handed one object describing everything it may ask for. **Studied as API design,
  not as an isolation model**, and an earlier version of this bullet described it
  as "host/plugin isolation … no reference to host internals", which is not what
  VS Code provides. Microsoft's own runtime-security documentation states that the
  extension host runs with the same permissions as VS Code and that an extension
  can read and write files, make network requests and run external processes.
  Their protection model is vetting, publisher verification and a trust prompt —
  reputation, not enforcement. That matters to this decision: the closest prior art
  for "restricted API object" does not treat it as a security boundary either, and
  Amendment E records why it cannot be one here.
- **Vite** — local-first, lazy module loading, where modules are resolved on
  demand from the local filesystem with no build-time coupling.

---

## Decision

**We will use a registry-based inversion-of-control contract, in which
extensions are registered as declarative blueprints and receive a deep-frozen
shell API object.**

Concretely:

### 1. Extensions are declarative blueprints, supplied to the host

An extension exports a `LEAPExtensionBlueprint`: a plain data description of
what it contributes — a stable id, a display label, a Pane 1 navigation entry, a
Pane 2 view, a Pane 3 view, and a set of ribbon actions.

There is **no `icon` field on the blueprint.** Earlier drafts of this ADR listed
one in that sentence; it does not exist in `src/core/types.ts` and never
shipped. Icons are carried per `RibbonAction` only. `DEVELOPER.md` records the
same correction.

The host never imports an extension. Extensions are supplied *to* the host, and
the direction of that dependency is the whole architecture. `src/core/**`
contains no import edge to any extension, and adding one is a review failure.

### 2. Registration through a single registry, with no side channel

`RegistryContext` accepts blueprints, validates them, indexes them by id, and
exposes read access to shell consumers. Registration is the **only** path by
which an extension becomes reachable. There is no global, no window property,
no ambient module registry, no back door.

Validation is at registration time, not first render, so a malformed extension
fails early and names itself. Duplicate ids fail deterministically rather than
last-write-wins, because silent overwrite between two vendors' extensions is
an indefensible failure mode.

### 3. The API context handed to extensions is deeply frozen

Each extension receives an `IShellAPI` object constructed by `ShellAPI.ts` and
**recursively frozen** before it crosses the boundary. Shallow `Object.freeze`
on the root is explicitly insufficient: it leaves every nested service object
mutable, which defeats the entire purpose.

This is an **integrity control** in the vocabulary Amendment E fixes: real and
unconditional. Extensions in a shared page cannot be prevented from touching the
DOM, but an instance of `IShellAPI` cannot have a method swapped out from under
another holder. Freezing turns "please do not patch this object" from a request into a
property of the runtime. *Tests:* `src/core/__tests__/shellApi.test.ts` — "is
deep-frozen: strict-mode reassignment throws", "is deep-frozen: sloppy-mode reassignment
is a silent no-op", "cannot have its prototype swapped".

> **Narrowed by Amendment G.** This paragraph also ended "so one holder cannot intercept
> or suppress the calls another holder makes through it" — the same false clause
> Amendment G deletes at six other sites, and a seventh instance found while sweeping for
> it. It does not follow from *methods cannot be swapped*: every call through the facade
> reaches the store, the store notifies synchronously, and `subscribe` is public. A
> listener sees the write, may overwrite it, and may throw back into the calling frame.
> `src/core/__tests__/subscribe.test.tsx`.

> **Narrowed by Amendment E.** This paragraph opened "This is the isolation
> mechanism", which is more than freezing can carry. It is a property of *this
> object*, not a boundary around the extension holding it: it does not stop a
> plug-in obtaining the unscoped store, another extension's handle, or another
> extension's unfrozen view components. Amendment E states what is and is not
> delivered, in three terms used consistently across the repository.

**Landed as code, not reached by the shell:** per-extension persisted state *is*
namespaced by extension id, in `src/core/services/HydrationEngine.ts` and the
`src/hooks/useLocalStorageState.ts` bindings over it. **That namespace is
collision-resistance, not confinement** — Amendment E's vocabulary, and Amendment
E is what forbids the stronger sentence being written here. Two extensions that
both persist a key named `selection` keep their own copies, and that is the whole
of what it buys. It confines nothing, for two independent reasons. The scope is an
**argument, not a closure**, so any holder of the engine can name any scope: there
is no per-extension facade over persistence the way `createRevocableShellAPI` is
one over badges, and `IShellAPI` still has **no persistence member**. And the store
is one `localStorage` entry under one origin, which any script on the page reads
and rewrites without going through the engine at all. Nothing confidential belongs
in persisted UI state. *Tests:*
`src/core/services/__tests__/hydrationEngine.test.ts` — "keeps two extensions that
both use the key \"selection\" apart" for what the namespace does buy; "lets any
caller name any scope, so the namespace confines nothing" and "reads and rewrites
another extension's scope straight through the storage entry" for what it does
not, each reproduced as behaviour rather than asserted in prose.

Nothing in the shell is wired to any of it yet. Neither
`src/components/layout/ShellLayout.tsx` nor `src/App.tsx` reads or writes persisted
state, so no pane divider and no collapse toggle survives a reload today: the
engine and the hook exist and are tested, and the shell does not use them.

> **Superseded 2026-07-31, when ISSUE-003 landed the engine.** This paragraph
> previously declared the whole subject absent — nothing written anywhere, no
> module under `src/` owning a storage entry — and sent the reader to ISSUE-003 and
> to the README's "Specified but not yet enforced" list. That was accurate when it
> was written and is not now. What survives of it is the `IShellAPI` half, which is
> unchanged, and its warning, which the paragraph above keeps: what has landed is a
> store, not a boundary.

### 4. Contextual behaviour through visibility predicates

Ribbon actions each carry a visibility predicate that the host evaluates against
current shell state. This is how contextual UI works without the host
understanding context. The host asks "should this be shown?" and the extension
answers; the host never learns why.

A predicate that throws is treated as "not visible" and reported. A third
party's bug hides one button; it does not break the ribbon.

### 5. Local, lazy loading

Extension modules load on demand from local modules. No network fetch is
required for the shell to boot or for an extension to activate.

### 6. Fault containment at the pane boundary

Each pane and each extension subtree is wrapped in a fault boundary, so a render
error in one extension degrades to a contained surface in its own pane.

The limits of this are recorded honestly: React error boundaries catch render,
lifecycle and constructor errors. They do not catch errors in event handlers,
in timer callbacks, or unhandled promise rejections. Those require separate
handling and are documented as extension-author responsibility in
[`DEVELOPER.md`](../../DEVELOPER.md).

---

## Consequences

### Positive

- **The zero-business-logic rule becomes structurally enforceable.** With no
  import edge from host to extension, host code physically cannot reference a
  domain concept. The rule is checkable in review and by lint rule, not merely
  aspirational.
- **Third parties can ship independently.** An extension is written, versioned
  and released without touching this repository or coordinating with the host
  team.
- **Compile-time contract errors.** A blueprint that does not satisfy the type
  fails to compile in the author's editor, which is the cheapest possible place
  to find out.
- **The host's own integrity is real, and collisions between vendors are
  designed out.** Deep freezing means an `IShellAPI` instance cannot be patched;
  the closure-held state store means `RibbonContext`'s declared types hold for
  every caller; validated ids and scoped badge keys mean two vendors cannot
  silently overwrite each other. Deep freezing has landed, and so has the
  persistence half: the hydration engine namespaces persisted state by extension id
  and two vendors picking the same state key do not collide. Like the badge scoping
  beside it, that is collision-resistance and not confinement, and nothing in the
  shell reads or writes it yet — see §3.

  > **Corrected by Amendment E.** This entry was headed "**Vendor isolation is
  > real, within the limits of a shared page**" and concluded that "one extension
  > cannot silently degrade another". **There is no vendor isolation here**, and the
  > qualifier "within the limits of a shared page" was doing far more work than it
  > looked like: in a shared page there is no boundary between vendors at all. One
  > extension *can* degrade another — through `unregister`, through the sibling's
  > unfrozen view components, through the store, or through the controller reached
  > by reflection. What is real is listed above, and it is about the host and about
  > accidents, not about vendors defending themselves from each other.
- **Bounded blast radius.** A bad extension costs one pane.
- **Testable in isolation.** Because everything an extension may do goes through
  one object, substituting a test double for that object gives a fully isolated
  extension under test — and equally, the host is testable against mock
  extensions that use only the public contract.
- **Runtime enumeration.** The host can list, render and route to extensions
  without a compile-time manifest of who exists.

### Negative

- **The contract is a hard commitment.** Once third parties ship against
  `LEAPExtensionBlueprint` and `IShellAPI`, changing them breaks other people's
  software. This buys correctness at the cost of future flexibility, and it puts
  real weight on getting ISSUE-001 right the first time.
- **Indirection has a comprehension cost.** A reader tracing "what happens when I
  click this ribbon button" goes through the registry rather than to a call site.
  Registry-based systems are harder to navigate than direct calls, and no amount
  of documentation fully removes that.
- **The frozen surface constrains extension authors.** Anything not exposed on
  `IShellAPI` is unreachable *through `IShellAPI`* — which is what constrains an
  author writing in good faith, and is the cost being recorded here. It is not a
  claim that nothing else is reachable at all; see Amendment E. Legitimate needs
  will be discovered late, and each one is a contract change rather than a local
  fix.
- **Deep freezing has a cost and a sharp edge.** The recursive walk must handle
  circular references without looping, and frozen objects produce failures at
  the point of mutation rather than at the point of the mistake, which can be
  confusing to debug.
- **No sandbox, and no boundary between extensions of any kind.** Same-origin
  JavaScript extensions share the DOM, the page and the JavaScript realm. Deep
  freezing protects the shell service objects themselves; it does not stop an
  extension touching the document, reaching the unscoped store, editing a sibling's
  view component, or walking React's fiber tree to the host's activation
  controller. This architecture defends against **accident and collision between
  mutually untrusting extensions**, and **not at all** against a determined
  malicious one. That limit is stated plainly in `README.md` and `DEVELOPER.md`
  rather than papered over, and **Amendment E** makes it a binding condition rather
  than a caveat: the day third-party code the deployer did not compile can reach
  the page, this decision is void and real isolation becomes mandatory.
- **Registration-time validation cannot catch everything.** A blueprint can be
  structurally valid and still contain a component that throws on render. Static
  validation and fault containment are complementary, and both are required.

### Neutral

- Extension authors must follow a directory convention
  (`src/extensions/<name>/` with `index.ts`, `views/Pane2View.tsx`,
  `views/Pane3View.tsx`). Conventional rather than enforced by the runtime.
- The host carries registry, freezing and validation machinery that a
  direct-import application would not need. This is the price of the property
  being bought, and it is small relative to the shell as a whole.

---

## Alternatives Considered

### 1. Direct imports — the host imports extension modules

The host imports each extension module and composes it in application code.

**Why it is attractive:** By far the simplest option. Fully type-safe with zero
custom machinery. Trivial to navigate — every reference goes to a definition,
and the compiler and bundler do all the work. No registry, no freezing, no
validation layer to write or maintain.

**Why it was not chosen:** It inverts the dependency the wrong way. The host
would import extensions, meaning the host has a compile-time list of every
extension that exists — so a third party cannot add one without modifying and
rebuilding the host. That alone disqualifies it against requirement 2.

It also destroys the zero-business-logic rule in practice. Once the host imports
a mail module, host code can reference mail concepts, and the pressure to add
"just one small special case" becomes constant with nothing structural to resist
it. And it provides no isolation whatsoever: directly imported modules share
module scope and can reach into each other and into host internals at will.

Direct imports are the right answer for a first-party application with a fixed
feature set. They are the wrong answer for a shell whose entire purpose is to
host code it has never seen.

### 2. A global event bus

Extensions and host communicate by publishing and subscribing to events on a
shared bus, with no direct references in either direction.

**Why it is attractive:** Maximum decoupling — neither side holds a reference to
the other. Easy to extend, since a new participant just starts listening.
Naturally supports many-to-many communication, and it is a well-understood
pattern.

**Why it was not chosen:** It fails the type-safety requirement, which is
primary here and not negotiable. Event buses are string-keyed and their payloads
are structurally unverifiable at the boundary. Typed wrappers can be layered on,
but the runtime remains "publish a string and hope someone is listening for it."
An extension author who typos an event name, or sends a payload of the wrong
shape, learns about it at runtime in front of a user — exactly the failure mode
this project is trying to design out.

It is also actively worse for isolation than the registry. A global bus is a
global: any extension can subscribe to any event, including events intended for
another extension, and can publish events impersonating another extension. That
is a *weaker* boundary than the one being replaced, not a stronger one.

Operationally, buses are notoriously hard to reason about. There is no call
graph, control flow is invisible, ordering is implicit, and debugging "why did
this not happen" means searching for string literals across code you do not own.
For a system whose contributions are inherently structural — here is my Pane 2
view, here are my ribbon actions — a declarative registry expresses the
relationship directly, where a bus would encode structure as a conversation.

An event stream may still be appropriate *within* the contract for genuinely
event-shaped concerns such as cross-pane notification. That is a narrow,
typed, host-mediated channel, not a global bus, and it does not change this
decision.

### 3. True Module Federation

Webpack-style Module Federation, with extensions built and deployed as
independent remotes, loaded at runtime from separate origins or bundles.

**Why it is attractive:** The strongest possible independence story. Extensions
are separately built, separately versioned and separately deployed — a vendor
ships an update without the host rebuilding or redeploying anything. It solves
runtime discovery natively, and shared dependencies can be negotiated between
host and remotes.

**Why it was not chosen:** It contradicts the local-first requirement at its
core. Module Federation's value proposition is loading remotes over the network
at runtime. This shell must boot and run with no network at all. A federated
setup that only ever loads local bundles pays the entire complexity cost of
federation for none of its benefit.

The build complexity is substantial and permanent: federation configuration,
shared-dependency version negotiation, and a class of runtime failure — remote
unreachable, version skew between host and remote, singleton React duplicated
across boundaries — that simply does not exist when modules are local. Debugging
these is genuinely difficult and the failures appear in production, in
configurations the host team cannot reproduce.

Type safety across a federated boundary is also weak. Remotes are resolved at
runtime, so the compile-time guarantee that is central to this design has to be
reconstructed with generated type packages and disciplined versioning — a
process that is fragile and easy to get quietly wrong.

Finally, it does not remove the need for this ADR's decision. Federation is a
*module delivery* mechanism; it says nothing about what an extension contributes
or how it talks to the host. A federated architecture would still need a
registry and an API contract, layered on top of the federation complexity. It
is not an alternative to the registry so much as an additional distribution
layer that this project does not currently need.

The project remains free to adopt federated delivery later without invalidating
this decision, precisely because the registry contract is independent of how the
module arrived.

---

## Amendment A — Normalisation at the trust boundary

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Decision §2

### What changed

The registry validates a blueprint and then stores a **normalised, host-owned
record built from it**, not the object the caller passed in. `getExtension` and
`listExtensions` return that record.

### Why the original shape was not sufficient

Section 2 said the registry "accepts blueprints, validates them, indexes them by
id". The first implementation read that literally: validate the payload, then
put the caller's object in the `Map`. Two rounds of point-fixes against that
shape each passed their own tests and each fell to a new instance of the same
defect, which is the signal that the shape itself was wrong.

The reason is that validation and storage were separated by a gap the plugin
still had access to:

- **A checked value stays re-readable.** Every field except a captured
  primitive is read through a getter the plugin wrote. The getter is free to
  return a benign value while it is inspected and a hostile one afterwards.
- **A checked value stays mutable.** Even with no getters at all, the plugin
  still holds a reference to the object the host approved, and can simply
  assign to it: `blueprint.views = null` after a successful registration.
- **Therefore a bounds check bounds nothing.** `Array.isArray` is true of a
  Proxy wrapping an array, and `length` on an array is writable, so a payload
  can report an honest count while it is measured and a larger one afterwards.
  Comparing that number against `MAX_RIBBON_ACTIONS` constrains only the number,
  not the collection.

Reading each value exactly once — the previous fix — closes the first of these
and neither of the other two. The property actually wanted is that **what was
validated is what is stored**, and that is only achievable if the host owns the
stored thing.

### The decision

Validation and normalisation are one pass. Each untrusted field is read once,
checked as the resulting local, and that local is written into a fresh
host-owned object; collections are rebuilt as fresh arrays of exactly the length
that was bounds-checked; the record is frozen at every host-owned level before
it is stored.

Two carve-outs, both deliberate:

- **Functions and React components are carried by reference, not copied, and
  not frozen.** A function cannot be cloned without breaking its closure, a
  component reference must keep its identity or React remounts the pane on every
  render, and freezing another vendor's component object reaches into internals
  this host has no business touching. They are type-checked and passed through.
- **The plugin's original object is retained privately**, as
  `RegistryEntry.source`, solely so that the StrictMode idempotency rule can
  keep comparing by reference identity. It is never read from and never exposed.

### Consequences

- **`getExtension(id)` no longer returns the caller's object.** This is a
  breaking change to the registry's read contract; it was made deliberately,
  and four existing tests that asserted identity were rewritten to assert the
  new contract rather than deleted. `DEVELOPER.md` documents it for extension
  authors, whose correct comparison is on `id`.
- **Mutating a blueprint after registration is now a silent no-op** rather than
  a live edit of host state. Authors who want a change must unregister and
  register again. That is the point.
- **A small allocation cost per registration.** Registration is a rare,
  boot-time operation on a bounded payload (≤512 nodes, ≤128 actions), so this
  is not measurable against anything the shell does per frame.
- **The claim in `README.md` — "what was validated is what is stored" — becomes
  true.** It was false before this amendment.

  > **Re-worded by Amendment F.** This sentence ended "and is now structural",
  > which is true on the merits and was left mislabelled when Amendment E fixed the
  > vocabulary. Under that vocabulary it is an **integrity control**: normalisation
  > plus deep-freeze of the stored record holds against any caller, however hostile.
  > The word *structural* is reserved for the `Map`-backed stores. *Tests:*
  > `src/core/__tests__/registryNormalization.test.tsx` — "register — the stored record
  > is host-owned", "is unaffected by the plugin mutating its own blueprint afterwards".
  >
  > **Amendment G removed the last site that still used the reserved word for this** —
  > the normalisation banner in `RegistryContext.tsx`, which said what was validated is
  > "structurally" what is stored. Comment-only.

---

## Amendment B — `unregister` carries no authorisation

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** nothing; records a
scope decision

Any holder of the registry can `unregister` any id, including one it did not
register. **This is accepted, not overlooked.**

- ISSUE-001 specifies no ownership, capability or token model, and inventing one
  while closing a defect would be undocumented scope.
- The shell is local-first and single-origin, and this ADR already records "No
  sandbox" as a limit: extensions are same-origin JavaScript sharing the DOM.
  An extension motivated to remove a competitor's UI does not need
  `unregister` to do it. A token would move the lock while leaving the door
  open, and would advertise a guarantee the architecture cannot make.
- The registry is only reachable inside `ExtensionRegistryProvider`, and nothing
  handed *down* to a plugin carries it — `IShellAPI` has no registry member. An
  extension reaches it by calling `useRegistry()` from its own component, which
  is the documented registration path.

Recorded on the `unregister` declaration in `src/core/RegistryContext.tsx`, in
`README.md` under accepted limits, and in `DEVELOPER.md` as a contract rule for
extension authors. If an ownership model is ever wanted it needs its own issue
and its own threat model first — starting with the question this decision turns
on, which is whether extensions are ever expected to be mutually hostile rather
than merely mutually untrusting.

---

## Amendment C — Activation, revocation, badge scoping, and giving `onExecute` a capability

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Decision 3 (the
deep-frozen API context) and Decision 4 (contextual behaviour through visibility
predicates)

### What changed

Four defects in the data-flow contract, closed together because each one is only
observable through the others.

1. **The state store had no subscribers.** `createShellStateStore` kept its state
   in a closure and told nobody when it changed, so a write through one pane's
   `IShellAPI` could not re-render another pane. The store now has
   `subscribe(listener)`, and `useShellContext()` is built on
   `useSyncExternalStore`.
2. **`patchContext` allocated unconditionally.** A write that set a field to the
   value it already held still produced a new frozen object, so the snapshot's
   identity changed when nothing had, invalidating every downstream `useMemo`
   keyed on it. It now compares per field with `Object.is` and skips both the
   allocation and the notification when nothing moved.
3. **`onExecute` had no capability.** Its signature was
   `onExecute(ctx: RibbonContext)` — four nullable strings and no shell — so a
   ribbon action provably could not change anything. It is now
   `onExecute(ctx: RibbonContext, shell: IShellAPI)`.
4. **Badges were globally keyed.** `badgeCounts` was one flat `Map` keyed by the
   bare `nodeId`, so two extensions that both named a node `inbox` silently
   overwrote each other. Badge state is now keyed by `${extensionId}:${nodeId}`.

And one thing that did not exist at all: activation. `src/core/ActivationContext.tsx`
introduces `ShellHostProvider`, `useActivation` and the `ActivationController`.

### The decision

**Activation is two orthogonal states, not one boolean.**

| | Foreground | Liveness |
|---|---|---|
| Question it answers | Which extension owns panes 2 and 3? | Does a usable `IShellAPI` exist for this extension? |
| Where it lives | `RibbonContext.activeExtensionId` | An entry in the provider's live map |
| How many at once | One, or none | Any number |
| Gained by | `activate(id)` | First `activate(id)` |
| Lost by | `blur()`, or losing liveness | `release(id)`, or being unregistered — exactly two (see Amendment F) |
| Effect of losing it | **Revokes nothing** | Handle is revoked permanently |

Collapsing these two into one flag is the tempting simplification and it is
wrong: a mail module that is not in the foreground must still be able to push an
unread badge into pane 1, which is the whole reason a shell hosts more than one
extension. So foreground implies liveness, liveness outlives foreground, and the
implication never runs the other way.

**Revocation fails loudly.** After `release` — or after the extension is
unregistered — every member of the revoked `IShellAPI` throws `ShellUXError` with
the new code `REVOKED` and changes nothing. A silent no-op was rejected: a plugin
that kept a reference is holding a bug, and a state write that quietly evaporates
is far harder to find than an exception at the call site. `REVOKED` is the eighth
member of `ShellUXErrorCode` and is pinned in the exhaustiveness record in
`types.ts`, so the runtime code set cannot drift from the union.

**`revoke` is not on `api`, and is not reachable from it.**
`createRevocableShellAPI(store, extensionId)` returns `{ api, revoke }` as two
separate objects. `revoke` closes over a variable only that factory's scope can
reach and is a property of the wrapper the host keeps — never of `api`.
`Object.keys(api)` is exactly the `IShellAPI` members and nothing else — three of
them when this amendment was written, seven since Amendment K. `createShellAPI(store)`
is unchanged for existing callers: it is the unscoped host-side facade and simply
discards the `revoke` handle. *Tests:* `src/core/__tests__/dataflow.test.tsx` — "does not
expose revoke to the plugin"; and for what that does *not* buy,
`reflection.test.tsx` — "reaches the provider live map, which holds revoke for every
extension".

> **Corrected by Amendment D, then again by Amendment E.** This paragraph
> originally concluded "so a plugin cannot revoke itself and cannot revoke anyone
> else", and was headed "`revoke` is structural, not conventional." Everything
> about `api` is true and unconditional. The conclusion was not, and Amendment D's
> replacement for it — that the split made the capability unreachable — was not
> either.
>
> Amendment C published the whole `ActivationController` to the provider subtree,
> which is where plugin views render, so the capability was one `useActivation()`
> call away. Amendment D severed that context, which closed the documented route.
> But `ShellHostProvider` keeps every `{ api, revoke }` wrapper in a `useRef`, and
> a `useRef` is hook state on a fiber that React hangs off the DOM — so the
> wrappers, and therefore `revoke` for every extension, are reachable by
> reflection from any script on the page. **Amendment E** records that, the
> evidence, and the mitigations that were tried and rejected. The word *structural*
> has been removed from this heading because it was not earned.

**An extension cannot name the badge scope it writes to.** The scope is not a
parameter of `setBadgeCount`; the per-extension facade closes over the id the
registry validated, and passing an extra argument reaches nothing. The host-side
store API therefore became `setBadgeCount(extensionId, nodeId, count)` and
`getBadgeCount(extensionId, nodeId)`, with the scope supplied by the host at mint
time. `createShellAPI`'s unscoped facade writes to `__host__`, a scope
`EXTENSION_ID_PATTERN` cannot produce, so host badges cannot be *collided with* by
an extension writing through its own `setBadgeCount`.

> **Corrected by Amendment D, and named properly by Amendment E.** This sentence
> originally read "so host badges can neither collide with nor **be read by** an
> extension." The first half holds; the second was false. `__host__` is unreachable
> through the *scoped facade*, which is all the facade argument establishes — but
> `useShellStore()` is public, and `store.getBadgeCount('__host__', nodeId)` reads a
> host badge while `store.setBadgeCount('__host__', ...)` writes one. Both were
> reproduced from a plugin view, and the same is true of any extension's scope, not
> only the host's.
>
> **The property is collision-resistance, not confinement.** What is true: two
> extensions that both name a node `inbox` cannot overwrite each other, and the
> scope is not a caller-supplied parameter. What is not true, and must not be
> written anywhere: that a scope confines anything, or that badge state is private
> to its owner. Nothing confidential belongs in the store. Everything in this
> repository that described badge scoping as separation, isolation or "neither can
> read the other's" has been corrected to this wording — `types.ts`,
> `DEVELOPER.md` (including its pre-ship checklist), `README.md` and this document.

**`isVisible` deliberately did NOT get the shell handle.** It is evaluated during
render. Handing a render-time predicate the ability to mutate shell state would
let it notify the store mid-render and re-enter the component that is rendering —
a loop or a tear, depending on timing. An action that needs to change something has
`onExecute`.

> **Corrected by Amendment F.** This paragraph continued "and would quietly make
> 'predicates must be pure' unenforceable. Keeping its argument list read-only makes
> that rule structural." It does not. A signature constrains ARGUMENTS and says
> nothing about closures: a predicate defined inside a view that called the public
> `useShellStore()` captures a store and writes on invocation, which was reproduced
> — the context afterwards held `selectedItemId: "written-from-isVisible"`.
> "Predicates must be pure" is a **guardrail**: the direct route is closed and the
> honest mistake is hard to make by accident. `DEVELOPER.md` already contradicted
> its own version of the stronger claim four lines below it, and now states only the
> weaker one.

**Unregistering revokes, and the registry was not changed to do it.** The
registry has no listener mechanism and Amendment B recorded that it has no
authorisation model either. `ShellHostProvider` therefore watches
`useRegistryRevision()` and sweeps its live map after every registry change,
revoking any entry whose id is no longer registered. The registry keeps knowing
nothing about activation, and the dependency still runs one way.

> **Amended by Amendment D.** An effect runs *after* the commit, so this sweep was
> one commit late and the guarantee it was carrying had a hole in it: between
> `unregister()` and the sweep — the remainder of the calling event handler, and
> anything awaited from it — a retained handle still wrote successfully. Amendment D
> keeps this sweep for bookkeeping and moves the guarantee to a call-time liveness
> predicate inside the facade. The registry still knows nothing about activation.

### Consequences

- **Positive.** A write in one pane is observed in another. A ribbon action can
  act. Two extensions can use the same node id. A released extension cannot
  write, and finds out that it cannot. Re-activation returns the same handle, so
  references an extension is holding stay valid across foreground changes.
- **Positive.** The equality check in `patchContext` makes "did anything change?"
  answerable, which is what lets `useSyncExternalStore` bail out and what stops a
  no-op write from invalidating memoised work downstream.
- **Negative — accepted.** `useShellStore()` is public, and a plugin view renders
  inside the provider, so a plugin can call it and obtain the raw, unscoped,
  unrevocable store — bypassing its own facade. This is the same accepted limit
  as Amendment B and the "No sandbox" clause: extensions are same-origin
  JavaScript in the same page, and one motivated to bypass its facade does not
  need this hook to do it. The scoping and revocation guarantees are integrity
  boundaries against *mistakes and collisions between mutually untrusting
  extensions*, not a sandbox against a hostile one. If extensions ever have to be
  treated as mutually hostile, that needs its own issue and its own threat model,
  starting with moving plugin code out of the host's realm entirely.
- **Negative.** `onExecute` grew a parameter. This is source-compatible for every
  implementer — a handler that ignores the second argument still satisfies the
  type — but it is a contract change and is recorded as one in `DEVELOPER.md`.
- **Neutral.** The store notifies on a badge write even though badges are not part
  of the context snapshot. `useShellContext` bails out on its own unchanged
  snapshot, so this costs a subscriber comparison and is what a future
  badge-aware selector will subscribe to.
- **Neutral.** `ShellHostProvider` must be rendered inside
  `ExtensionRegistryProvider`. Outside it, `useRegistry` throws, which is the
  intended loud failure.

---

## Amendment D — The capability/information split, and closing the gaps Amendment C left

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Amendment C
(activation, revocation and badge scoping)

### What changed

An independent adversarial review reproduced, with working code, four claims this
ADR and `DEVELOPER.md` were making that the code did not deliver, plus four
smaller defects behind them. None was theoretical. The governing rule of this
project is that the documentation must not claim more than the code delivers, so
each one was closed by fixing the code where the claim was worth keeping and by
fixing the sentence where it was not. Both kinds of correction are recorded here.

**1. A plug-in could revoke a sibling and steal its handle.** Amendment C
published the whole `ActivationController` to the provider subtree, and plug-in
views render in that subtree. From a component inside `ShellHostProvider` the
reviewer called `release('crm-ext')` and revoked another extension;
`activate('crm-ext')` then returned *crm-ext's* scoped `IShellAPI`, which the
reviewer wrote through; and `getActive()` exposed the foreground extension's
`shell`. `DEVELOPER.md` compounded it by *instructing* extension authors to call
`useActivation().activate('your-ext')`.

**2. Revocation on unregister was one commit late.** The sweep effect runs after
the commit, so `activate()` → `unregister()` → two writes landed both writes —
and still landed after `await Promise.resolve()`, so it was not merely a
synchronous window.

**3. `patchContext` accepted what `setSelectedItem` refused.** It was documented
as "not reachable from plugin code, and not validated beyond what the compiler
enforces". Neither half held: `useShellStore()` is public by design — this ADR
concedes exactly that, four paragraphs above — and the compiler enforces nothing
across a plain-JavaScript plug-in boundary. The reviewer put an object with a
getter into `selectedItemId`, `'pane9'` into `focusedPane`, and an unregistered id
into `activeExtensionId`, all through `patchContext`, all applied. `types.ts`
argues at length that an object in `selectedItemId` "would turn the context into a
cross-plugin object-injection channel". This was that channel.

Three defects sat inside it. `Object.is(null, undefined)` is `false`, so a
`null → undefined` patch wrote `undefined` into a field declared `string | null`,
making the declared type a runtime lie. The guard used `key in patch`, which walks
the prototype chain, so `patchContext(Object.create({ selectedItemId: 'x' }))`
applied. And `patchContext(null)` produced a raw `TypeError` out of a function
contracted to throw `ShellUXError`.

**4. Unmounting `ShellHostProvider` revoked nothing.** There was no cleanup effect.
A retained handle went on writing to the orphaned store after unmount, which is
precisely the silent evaporation revocation exists to rule out. This ADR said
liveness ends by "exactly two events"; teardown was a third, and it ended nothing.

> **Withdrawn by Amendment F.** This was not a defect, and the two attempts to fix
> it both were. "Exactly two events" was the correct specification all along;
> teardown was never a third. See Amendment F for the argument and for what replaced
> both attempts, which is nothing.

Two things were documentation defects with no code fix available, and are now
documented accurately instead: **plug-in view components are mutable through an
`ActiveExtension`** (below), and **host badges in `__host__` are readable** (the
correction is inline above, at the badge-scoping paragraph).

One further inaccuracy the reviewer did not raise but which follows from the same
audit: `ActivationController.activate` was documented as "**never throws** … total
by construction". It is not total. Publishing the foreground writes through the
store, and the store notifies its subscribers synchronously; `subscribe` is public,
so a listener registered by plug-in code runs inside that write and can throw
straight back out through `activate`. The docblock now says what is actually true —
that the method invents no failure of its own — and names the exposure.

### The decision

**The activation surface is split by kind: capability to the host, information to
the plug-in.**

`ActivationController` is a capability, not a fact. `release(id)` revokes; and
`activate(id)` *returns another extension's `IShellAPI`*, which is the part that
makes publishing it fatal — it is not a read of shell state, it is a handle to
someone else's write access. So:

| | Host | Plug-in subtree |
|---|---|---|
| Hook | `useActivation()` | `useExtensionActivation()` |
| Gets | `activate` / `blur` / `release` / `getActive` | `extensionId`, `foregroundExtensionId`, `isForeground` |
| Below an `ExtensionHostBoundary` | **throws** | the only thing available |

`ExtensionHostBoundary` is what the host wraps a plug-in subtree in. It severs the
controller context and publishes the extension's own id. Neither context object is
exported, so a plug-in cannot re-provide one through the public API to restore what
the boundary took away, and the scope marker is set for the whole subtree — nesting
a second `ShellHostProvider` inside a boundary does not hand the capability back
through `useActivation()`.

> **Corrected by Amendment E.** This paragraph originally said "The split is
> structural, not advisory", and the sentence is withdrawn. The split is a
> **guardrail**: it closes the documented route and makes the mistake this project
> used to teach a loud deterministic throw, and it enforces nothing against
> deliberate action. The capability is not held in context — it is held in
> `useMemo`/`useCallback`/`useRef` hook state on the provider fiber, which any
> script on the page reaches by walking React's fiber tree from a DOM node. So
> severing a context was never going to be enough, and no in-page arrangement of
> contexts will be. The word *structural* survives in this document in exactly one
> place where it is earned — the `Map`-backed stores, which have no prototype chain
> — and nowhere else.
>
> The stickiness claim is also weaker than it read. It was additionally defeatable
> by passing a non-string `extensionId`, which CLEARED the scope marker rather than
> setting it and let a nested provider answer; that is now a type-guarded throw.
> But the reflective route defeats stickiness regardless, so the sentence would
> have had to go either way.

The read-only view was held to a deliberate test: **every member must be something
the plug-in could already learn.** `foregroundExtensionId` is
`getContext().activeExtensionId`; `extensionId` is its own id, which it wrote. A
member that fails that test does not belong on the interface.

**Three limits, and the fact that they can be enumerated is itself the finding.**

A guarantee that has to be defended by listing the channels it does not cover is
not structural. This list was two items long and was presented as exhaustive; it
was not, and the missing item is the one that decides the question. **Amendment E**
is the consequence.

*Reflection over the fiber tree reaches the controller anyway.* No DOM ref, no
export, no import. This is the limit that makes the other two secondary, it is
reproduced by `src/core/__tests__/reflection.test.tsx`, and it is not closable
in-page. See Amendment E for the evidence and the rejected mitigations.

*It holds for a subtree the host rendered inside `ExtensionHostBoundary`.* Host code
that renders plug-in components as its own siblings is handing them host capability,
and no structure here can prevent that. Pane rendering — the code that will do the
wrapping in production — is ISSUE-002 and does not exist yet. This is a real
conditional, and `DEVELOPER.md` states it in the same terms rather than selling the
boundary as unconditional.

*The boundary does not sever `useRegistry`, so `unregister` remains a route to
ending a sibling's liveness* — and, now that revocation is immediate, an instant
one. It is also a route to a sibling's host-owned record, and therefore to the
sibling's *unfrozen* view components and callbacks. This is deliberate and follows
Amendment B, which decided against an authorisation model and said an ownership
model needs its own issue: `useRegistry` is also how an extension registers itself,
so severing it would break the documented registration flow to close a hole that
Amendment B already accepted with its reasons written down. The distinction
Amendment D drew here — that *ending* a sibling's liveness is vandalism while
`activate` handing over the sibling's `IShellAPI` is privilege escalation — is a
real distinction about the *documented* API, and it is not a claim that the
escalation is prevented. It is not. Tests pin both residuals so that no future
reader mistakes the boundary for a stronger guarantee than it is.

**Liveness is re-checked at call time, not only when `revoke` is called.**
`createRevocableShellAPI` took a third parameter: `isLive()`, the host's answer to
"is this handle still good?", consulted on entry to every member. It resolves
synchronously off a `Map`.

> **Amended by Amendment E.** `ShellHostProvider` originally passed
> `() => registry.getExtension(id) !== undefined`, and *id presence is the wrong
> question*. `unregister(id)` followed by `register(<a new blueprint under the same
> id>)` is the upgrade path `DEVELOPER.md` documents, and React 18 batches two
> adjacent statements into one commit — so the predicate answered *yes* across the
> whole operation, the sweep effect below saw the id present and skipped the entry,
> and the previous vendor's handle stayed live and went on writing under a scope the
> new registration owns. The predicate is now
> `() => mounted && registry.getExtension(id) === <the record this handle was minted
> against>`. The registry builds a fresh host-owned record per registration, so
> record identity is a mint-time token: same id plus a different record is a
> different extension.

Two routes were available for this and the other was a listener on the registry.
The predicate was chosen for three reasons. It closes the window *outright* rather
than shortening it — there is no commit to wait for, so the statement after
`unregister` already throws, and so does anything after an `await`. It leaves
`RegistryContext.tsx` untouched, so the `Map` store, `RESERVED_IDS`,
`EXTENSION_ID_PATTERN`, the single-read discipline, normalisation and deep-freezing
are not merely still tested but not even edited. And it preserves the one-way
dependency Amendment C was careful about: the registry still knows nothing about
activation. A listener would have inverted that, and would still have delivered
its news a commit late unless it fired synchronously from `unregister` — at which
point the registry would be calling into activation during a React render, which is
worse than the problem.

The observation **latches**: the first call that finds `isLive()` false marks the
handle dead permanently. `getActive()` asks the same predicate, so it cannot report
an extension whose handle already throws. The sweep effect is kept, for bookkeeping
— dropping map entries and re-deriving the published foreground — and is no longer
what stands between a forgotten extension and the store.

> **Corrected by Amendment E.** This paragraph continued "…so unregistering and
> re-registering an id cannot resurrect a handle the host has already stopped
> accounting for", which attributed the guarantee to the latch. **The latch cannot
> carry it.** A handle nobody happened to call during the gap has nothing to latch
> on, so everything rests on what the predicate asks — and it was asking the wrong
> question (see above). The latch is a convenience: it means a dead handle stops
> consulting the registry. The guarantee is the record-keyed predicate.
>
> The same defect had a third consequence, in `activate` rather than in the facade:
> the live-map entry was keyed on the id alone, so a re-activation after a
> re-registration returned the STALE entry and the host would have rendered the old
> version's view components after a successful upgrade. `activate` now drops an
> entry whose record no longer matches the registry's, before deciding whether to
> mint.

**Every member of the store validates its arguments, because the store is a trust
boundary.** `patchContext` is now checked field by field against a table pinned to
`keyof RibbonContext`, so a field added to `RibbonContext` cannot become patchable
without someone deciding what a legal value for it is:

| Field | Rule |
|---|---|
| `selectedItemId` | `string` or `null`. Type only — it is the extension's own item key, not a host lookup key. |
| `activeExtensionId`, `activeNavNodeId` | `EXTENSION_ID_PATTERN`, not reserved, or `null` — the registry's own rule, imported rather than restated. |
| `focusedPane` | a member of `PANE_IDS`, or `null`. **Superseded by Amendment K Decision 6: the field is removed, and so is this row and its validator.** |

`PANE_IDS` is new in `types.ts`: `PaneId` is a type union and vanishes at runtime,
so it is pinned to a `Record<PaneId, true>` exhaustiveness record in the same idiom
as `SHELL_UX_ERROR_CODES`. (`PANE_IDS` outlived the field it was built for: since
Amendment K it is what `HydrationEngine`'s pane-size record is checked against, and
the reason it was kept rather than deleted with `assertValidPaneId` is written on it
in `types.ts`.) The validators reuse `describeUntrusted` and never read
an untrusted value — `typeof` only, with interpolation reserved for a value already
proven to be a primitive string. Rejection is **all-or-nothing**: the draft is a
local and the context is replaced only after the loop, so a patch whose second
field is bad applies none of its first. The seed passed to `createShellStateStore`
goes through the same door and is validated identically.

`undefined` is **normalised to `null`** rather than rejected. Both were open; the
normalisation was chosen because every context field is declared `... | null`, so
`undefined` and `null` mean the same thing to a caller and only one of them is
representable. It also preserves the observable behaviour of the buggy code — an
`undefined` field read as "cleared" — while removing the type lie and the spurious
notification, where rejecting would have changed behaviour for a patch shape TypeScript
accepts. The own-property check is `Object.hasOwn`, never `in`.

**A store listener is a signal to re-read, never a place to write.** `notify` no
longer iterates the live `Set`: it runs over a snapshot and re-checks membership
before each call, so a listener added during a pass is not called by the pass it
predates and one that unsubscribed earlier in the same pass is not called after its
unsubscribe returned. And the cascade is depth-capped at 16, converting an
unbounded recursion whose natural end was a `RangeError` from a blown stack into a
`ShellUXError` with the new code `REENTRANT_NOTIFY`, raised at the offending write.
`REENTRANT_NOTIFY` is the ninth member of `ShellUXErrorCode` and is pinned in the
exhaustiveness record in `types.ts`. The depth counter is restored in a `finally`,
so one bad listener cannot leave the store permanently convinced it is mid-cascade.

**Teardown ends liveness.** The store a handle writes to dies with the provider, so
a handle that outlives it reaches an orphan: a write succeeds, changes state nobody
is subscribed to, and is observed by nothing.

> **REVERSED by Amendment F. Teardown does not end liveness, and the sentence above
> is withdrawn.** Both implementations of it were development-only defects, for one
> shared reason: a cleanup cannot distinguish a real unmount from StrictMode's
> simulated remount, so anything acting there is wrong in development exactly when it
> is right in production. And it was being paid for nothing — revoking on teardown
> buys **no security**, because the store dies with the provider and a write through a
> stale handle afterwards reaches an object nothing is subscribed to and nothing can
> obtain. It cannot touch a new provider's store; that provider creates its own. The
> value on offer was diagnostic, and it was not worth a development-only outage.
>
> **Liveness ends by exactly two events: `release(id)`, and being unregistered.** The
> `mounted` flag, the teardown effect and its docblock are deleted; `isLive` consults
> the registry and nothing else. The history of both attempts is below, kept because
> the second one looked like a fix and was not.

> **Amended by Amendment E.** Amendment D implemented this as a cleanup effect that
> walked the live map and called every `revoke`, on the stated premise that under
> StrictMode it ran "once on the simulated remount, where the map is still empty
> because nothing has been activated yet". **The map is not empty.** React flushes
> passive effects child-first, so a descendant that registers and activates from its
> own mount effect — the pattern `DEVELOPER.md` documents — has already put an entry
> in the map before the provider's cleanup runs. Reproduced as
> `["child effect", "child cleanup", "child effect"]` with the first handle REVOKED
> and only the last usable: **broken in development, correct in production**, which
> is the worst shape a bug has.
>
> A cleanup cannot distinguish a real unmount from the simulated one, so teardown
> now flips a `mounted` flag that the same call-time predicate consults, and the
> effect body sets it back on the re-run. Nothing observes a handle between the
> cleanup and the re-run — both are inside one synchronous flush — so nothing
> latches and no live handle dies. The live map is deliberately no longer cleared:
> clearing it would drop the host's record of a handle it has already handed out,
> and the next `activate` would mint a second live handle for the same extension,
> breaking the promise that re-activation returns the one you already have.
>
> > **The premise in that second paragraph is false, and Amendment F deletes the
> > mechanism it justified.** Something *does* observe the handle between the cleanup
> > and the re-run. Passive effects flush child-first in BOTH directions, so the
> > simulated remount runs every destroy (child, then the provider → flag false) and
> > only then every create (child **first**, the provider **last**). A descendant that
> > USES its handle inside its own mount effect — as `DEVELOPER.md` shows — read the
> > flag as false, and `assertLive` latched the handle revoked for the rest of the
> > session. Reproduced as `["ok", "REVOKED"]`. The window did not close in
> > Amendment E; the trigger merely narrowed from "took a handle" to "used one".
> >
> > The live-map paragraph survives on its own merits and is why the map is still
> > left alone.

### Consequences

- **Positive.** An extension cannot write through its own handle after the host has
  forgotten it — not one commit later, immediately. Unconditional; it is a property
  of the handle, not of who is holding it.

  > **Corrected by Amendment E.** This entry also claimed "An extension cannot
  > revoke a sibling, cannot obtain a sibling's `shell`." **Both clauses are false.**
  > `release` and `activate` are both on the controller, and the controller is
  > reachable by walking React's fiber tree from any DOM node on the page — no ref,
  > no export. `src/core/__tests__/reflection.test.tsx` obtains the controller from
  > inside a severed plug-in subtree, calls `activate('crm-ext')`, writes through the
  > handle it gets back, and then revokes the sibling. What Amendment D actually
  > delivered is that the documented route is closed and that a mistake is loud.
- **Positive.** `RibbonContext`'s declared types are true at runtime on every path
  that writes it, not only on the two that happened to be checked — and, per
  Amendment E, for **every caller however hostile**, because the store's state is
  held in closure variables that no reflective API reaches while every method
  validates. The object-injection argument written down in `types.ts` is enforced by
  the code it describes. This is the strongest true claim in the codebase and it was
  undersold.

  > **Narrowed by Amendment F, and the premise was incomplete when it was written.**
  > The argument ran from "the state is unreachable" to a conclusion about the
  > methods, and the methods were not covered by that premise: the store was returned
  > as a plain mutable object literal. `useShellStore()` is public, so a plug-in view
  > assigned over `setSelectedItem` and swallowed another extension's writes
  > (`swallowed = ["crm-selection"]`, real context `selectedItemId: null`), over
  > `getContext` and forged what a victim pane read
  > (`{ selectedItemId: {"injected":true}, focusedPane: "pane9" }`), and over
  > `patchContext` and made the host's own foreground publication evaporate. No
  > reflection was involved in any of it.
  >
  > The store object is frozen now, so the second half of the premise is true and
  > the claim holds — **at its real width, which is narrower than "every caller".**
  > What is unconditional is that **this store** cannot be subverted: its state is
  > unreachable, its six methods cannot be replaced, deleted or added to, and every
  > one of them validates. So every value that enters the context THROUGH this store
  > is well-typed, for any caller however hostile. Whether a given consumer is
  > reading this store is a separate question this does not answer: the store is
  > published through React context, and a caller who reaches hook state on a fiber
  > reaches a published context value by the same route. "The strongest true claim in
  > the codebase" is retired as a framing — it is what led to the overreach twice.
  >
  > **A third narrowing, per Amendment G.** The sentence above is what stands, and it
  > is pinned by `src/core/__tests__/contextPatch.test.ts` and "gets the store methods,
  > cannot replace one, and cannot put an illegal value through one" in
  > `reflection.test.tsx`. What does **not** follow — and was appended at six derived
  > sites — is that writes through the store are unobservable. `subscribe` is public and
  > runs inside another holder's write; see `src/core/__tests__/subscribe.test.tsx`.
- **Positive.** A runaway listener produces a named error at the write that caused
  it instead of a stack overflow. *Test:* "refuses a runaway write cascade with a typed
  error, not a RangeError" in `src/core/__tests__/contextPatch.test.ts`. It bounds a
  runaway and nothing narrower: one shallow re-entrant write is legal, which is what
  makes suppression reachable — Amendment G.
- **Negative — accepted.** `ExtensionHostBoundary` is a statement about a wrapper
  the host must actually render. It applies to everything below the boundary and to
  nothing above it, and the pane renderer that will apply it in production is not
  written yet. Per Amendment E it is a **guardrail** even below the boundary. The
  conditional is documented in both this ADR and `DEVELOPER.md`; it is not presented
  as unconditional, and it is not presented as isolation.
- **Negative — accepted.** Plug-in view components and ribbon callbacks reach the
  host by reference and **unfrozen**, and every container around them is frozen
  while they are not. The reviewer used this: one extension set `defaultProps` on
  another's view component and injected rendered content. **Freezing is not the fix**
  — it breaks `memo` and `forwardRef` internals and reaches into objects that are
  not the host's — so this is an accepted limit of the "No sandbox" clause rather
  than something the host prevents. It is documented as a limit in `DEVELOPER.md`
  and pinned by a test that asserts the mutability rather than wishing it away. The
  claim that the shallow freeze left "nothing sensitive" reachable has been removed
  from the code comment that made it.

  > **Corrected by Amendment E.** This entry claimed the reach "is bounded by who
  > can obtain an `ActiveExtension`, which now means the host-only controller, and
  > within that bound it is real." **It is not bounded by that.** `getExtension(id)`
  > returns the host-owned record carrying the *same* function objects, and
  > `useRegistry` is deliberately not severed at the boundary — so any component in
  > the tree reaches a sibling's view components without any `ActiveExtension` for
  > that sibling ever existing. Reproduced from a plug-in view inside a boundary and
  > pinned in `capability.test.tsx`. The identical claim has been corrected in
  > `ActivationContext.tsx` and `DEVELOPER.md`.
- **Negative — accepted.** Host badges under `__host__` cannot be *collided with*
  by an extension's own `setBadgeCount`, but they can be read and written through
  the public store, and so can any extension's. **Collision-resistance, not
  confinement** — Amendment E fixes the vocabulary and every site that used the
  weaker word. Nothing confidential belongs in the store, and the corrected
  paragraph above says so.
- **Negative.** Every `IShellAPI` call on a scoped facade now costs one `Map`
  lookup in the registry. This is the price of the window being closed at call time
  instead of at commit time, and it is not a measurable cost at this scale.
- **Neutral.** `ShellUXErrorCode` grew a ninth member and `types.ts` grew
  `PANE_IDS`. Both are pinned by exhaustiveness records, so neither runtime set can
  drift from its union.
- **Neutral.** `createRevocableShellAPI` grew an optional third parameter. Existing
  two-argument callers — `createShellAPI` among them — are unaffected: the default
  predicate is always true, which is correct for a facade whose liveness is its
  store's.

---

## Amendment E — The between-extension boundary is not enforceable in-page

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Amendment D (the
capability/information split), Amendment C (`revoke`, badge scoping, call-time
liveness), and the "VS Code" prior-art bullet in Context

### The finding

Two independent authorities reviewed this question and reached the same
conclusion. Three consecutive review rounds each found the same failure mode:
**sound code, documentation claiming security it cannot deliver.**

The hole is not a bug in `ExtensionHostBoundary`. It is that the capability the
boundary tries to withhold does not live in React context. It lives in
`useMemo`/`useCallback`/`useRef` hook state on the `ShellHostProvider` fiber, and
React attaches that fiber to the DOM node the provider rendered under an **own,
enumerable** property named `__reactFiber$<random>` (`__reactContainer$<random>` on
a root container). So:

```
document.body.firstElementChild        →  Object.keys() finds __reactContainer$…
  → walk .return to the root           →  above every boundary
    → walk .child / .sibling           →  every fiber in the application
      → read .memoizedState hook chain →  the ActivationController, the live Map
                                          (every extension's revoke), the store
```

**No DOM ref is needed. Nothing has to be exported. Severing a React context does
not remove a fiber from the tree.** Verified present in
`react-dom.production.min.js` and in this project's own `dist/` bundle, so it is
not a development-only artefact. `src/core/__tests__/reflection.test.tsx` performs
the escalation from inside a severed plug-in subtree — obtains the controller,
calls `activate('crm-ext')`, writes through the sibling's `IShellAPI`, then revokes
the sibling — and **asserts that it succeeds**. That test exists so that no future
reader mistakes the guardrail for a guarantee, and it is not a test to relax.

### Mitigations investigated and rejected, with the reason each fails

| Attempt | Why it fails |
|---|---|
| Freeze the fibers, or the context object | Breaks React. It mutates both during render and commit. |
| `delete node.__reactFiber$…` | Breaks all event dispatch. React's synthetic event system resolves the target fiber through exactly that property. |
| Wrap the controller in a `Proxy` and refuse plug-in callers | A `Proxy` trap cannot identify its caller. There is no reliable in-language caller identity to gate on. |
| Key the capability with a `Symbol` | `Reflect.ownKeys` enumerates symbol keys. A `Symbol` is not private. |
| Render plug-ins into a `ShadowRoot` | A ShadowRoot is not in the fiber tree, and the DOM parent walk escapes it anyway — `host.getRootNode().host` climbs straight out. |
| Lint rules or compile-time checks | They never see third-party JavaScript. The threat model is precisely code this repository did not compile. |

### The decision

**Option A. Keep `ExtensionHostBoundary` and `useExtensionActivation` as
guardrails. Delete every claim that the boundary is enforced. Fix the real code
defects.**

Three words are now used precisely across this repository, and every security
sentence must be placeable in one of them:

- **Integrity control** — real and unconditional; holds against any caller however
  hostile.
- **Entry-point validation** — real at the documented door; bypassable by a caller
  who reaches internals another way.
- **Guardrail** — prevents honest mistakes only; enforces nothing against
  deliberate action.

#### What is an integrity control, unconditionally

- **The shell state store cannot be subverted.** Two halves, both unconditional,
  and the second was missing when this bullet was first written. *Its state is
  unreachable:* `createShellStateStore` holds `context`, `badgeCounts`, `listeners`
  and `notifyDepth` as **closure variables**, and JavaScript has no reflective API
  for a scope — no `Object.keys` for a closure, no `Reflect` operation that
  enumerates one, nothing on a function object exposing what it captured. The fiber
  walk yields the store's six **methods** and never the state behind them. *Its
  methods are its own:* the store object is **frozen**, so no holder can replace,
  delete or add a member, and every one of the six validates its arguments.
  Therefore no caller, however hostile, can put a value of the wrong shape into
  this store's context — which is what the object-injection argument in `types.ts`
  needs. *Tests:* `src/core/__tests__/reflection.test.tsx` — "gets the store methods,
  cannot replace one, and cannot put an illegal value through one", "never reaches the
  badge map itself, because it is a closure variable"; `capability.test.tsx` — "the
  store handed out by useShellStore is frozen"; `contextPatch.test.ts` — the whole file.

  > **Corrected a third time and narrowed again by Amendment G.** The sentence above
  > used to continue "**, or intercept, suppress or forge the writes and reads another
  > holder makes through it**". That clause is **false** and is deleted. It is the same
  > defect as the two below, in its third iteration: the premise is *no member can be
  > replaced*, and `subscribe` requires no member to be replaced. `subscribe` is one of
  > the six frozen members, it is reachable through the public `useShellStore()`, and it
  > runs plug-in code synchronously inside another holder's write. Reproduced four ways
  > in `src/core/__tests__/subscribe.test.tsx`; see Amendment G for the finding and for
  > the rule installed in response.

  > **Corrected and narrowed by Amendment F.** This bullet read "**Therefore
  > `RibbonContext`'s declared types are true at runtime for every caller however
  > hostile** … the strongest true claim in the codebase and it was *undersold*",
  > and the store was a plain mutable object literal at the time. Two things were
  > wrong. The freeze did not exist, so the methods were replaceable through the
  > public `useShellStore()` — reproduced four ways, no reflection needed. And the
  > conclusion was about **consumers** while the evidence was about **the store**:
  > the store is published through React context, and a caller who reaches hook
  > state on a fiber reaches a published context value the same way, so what an
  > arbitrary component is handed is not something this bullet can promise. The
  > freeze is in place and the claim is restated at the width the evidence supports.
  > "Strongest true claim in the codebase" is retired as a framing; it is what
  > produced the overreach both times.
- **A listener is untrusted code inside another holder's write — the limit of the
  bullet above, stated as its own entry so it cannot be skipped.** `subscribe` is one
  of the six frozen members and is public. A listener observes every write, may
  re-enter the store and leave its own value standing, and may throw anything into the
  writer's frame — including a starving throw that stops every listener after it,
  a subscribed pane included. The freeze does not touch this, because nothing is
  replaced, and nothing in-page can: a store that notifies nobody is a store no pane
  can render off. *Tests:* `src/core/__tests__/subscribe.test.tsx`, the whole file.
- **Deep-freeze of `IShellAPI`.** An instance's methods cannot be swapped out from
  under another holder. It does **not** follow that calls through it are unobservable
  — see the listener entry above; that clause used to be written here too and is
  deleted. *Tests:* `src/core/__tests__/shellApi.test.ts` — "is deep-frozen: strict-mode
  reassignment throws", "is deep-frozen: sloppy-mode reassignment is a silent no-op",
  "cannot have its prototype swapped".
- **Normalisation plus deep-freeze of the stored record.** What was validated is
  what is stored; a plug-in editing its own blueprint afterwards changes nothing
  the host holds. *Tests:* `src/core/__tests__/registryNormalization.test.tsx` —
  "register — the stored record is host-owned", "register — a lying `length` cannot grow
  the payload after it is measured".
- **The `Map`-backed stores.** This is the **only** remaining use of the word
  *structural* worth keeping in this document: a `Map` has no prototype chain, so
  prototype pollution through a plug-in-supplied key is impossible by construction
  rather than by filtering. *Tests:* `src/core/__tests__/registrySecurity.test.tsx` —
  "register — a shifting id cannot smuggle a reserved key into the store".

  > **Made true by Amendment F.** When Amendment E wrote "the only remaining use",
  > two live positive uses survived elsewhere in this document: normalisation "is now
  > structural" in Amendment A's consequences, true on the merits but mislabelled
  > under this vocabulary, and `isVisible`'s argument list making purity "structural",
  > which is false outright. The first is re-worded to **integrity control**, the
  > second to **guardrail**, and the sentence above is accurate for the first time.
  > The same claim in Amendment E's discussion of the controller split is covered by
  > the same two corrections. `README.md` made this claim once and it was true there.
  >
  > **Read "only" as scoped to security claims, which is what this vocabulary
  > governs.** *Structurally* still appears in the Context, Decision and Alternatives
  > sections describing architecture rather than enforcement — the
  > zero-business-logic rule being "structurally enforceable", a blueprint being
  > "structurally valid", contributions being "inherently structural". Those are not
  > claims about what one extension can do to another and this vocabulary does not
  > reach them. Stating the scope rather than leaving "in this document … and nowhere
  > else" to be read literally is the same discipline the rest of Amendment F applies:
  > a claim should be no wider than its evidence.
- **Record-keyed revocation.** A handle's liveness is keyed on the host-owned
  blueprint record it was minted against, so `unregister` kills it from the next
  statement and a same-commit re-registration under the same id cannot resurrect
  it. *Tests:* `src/core/__tests__/capability.test.tsx` — "revocation on unregister is
  synchronous", "re-registering an id does not resurrect the previous handle". It says
  nothing about *who may revoke*: `reflection.test.tsx` reaches the controller and the
  live map.

#### What is entry-point validation

Identifier validation (`EXTENSION_ID_PATTERN`), `RESERVED_IDS`, and every bound —
text length, node count, nesting depth, action count, badge scope, badge node id,
`count`. Real at the doors they guard. A caller who reaches the objects behind
those doors another way is not bound by them, and that is why they are not called
integrity controls.

*Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — identifier
hardening", "— text fields", "— navigation tree", "— ribbon actions", "— views";
`registrySecurity.test.tsx` — "validateBlueprint — collection lengths are read once";
`shellApi.test.ts` — "the badge scope and node id are validated at both doors",
"setSelectedItem validates its argument"; `contextPatch.test.ts` — the whole file, which
is the same standard applied at `patchContext`.

#### What is collision-resistance, not confinement

Badge scoping. Two extensions that both name a node `inbox` cannot collide, and
the scope is not a caller-supplied parameter of the facade an extension holds.
That is all. It does not confine anything: `useShellStore()` is public and reads
and writes any scope.

*Tests:* `src/core/__tests__/dataflow.test.tsx` — "keeps two extensions that both use the
node id \"inbox\" apart", "does not let an extension name the scope it writes to";
`shellApi.test.ts` — "scopes a badge to its extension, so the same node id does not
collide". The absence of confinement: `reflection.test.tsx` — "reaches the host
ActivationController by reflection anyway, and steals a sibling handle".

#### What is a guardrail

`ExtensionHostBoundary`, `useActivation`'s refusal below it, and
`useExtensionActivation`. **The code stays.** It converts the one mistake
`DEVELOPER.md` used to actively *instruct* — "call
`useActivation().activate('your-ext')`" — into a loud, deterministic throw, and a
loud deterministic throw at the moment of the mistake is worth a great deal. It is
prose, not code, that had to change.

Amendment F adds two more: `isVisible` purity (a signature constrains arguments, not
closures) and the registry sweep's listener guard, which protects the one store write a
host has no statement to wrap. Amendment G adds the report-path guard inside it.

*Tests:* `src/core/__tests__/capability.test.tsx` — "ExtensionHostBoundary severs the host
activation controller", "is contained inside the sweep effect, which has no guardable
call site", "survives a console.error that throws, which is the report path escaping the
guard"; `reflection.test.tsx` — "gives a plug-in no capability through the documented
channel". **`isVisible` purity has no test**, and Amendment G requires that to be said
rather than left implicit: nothing calls `isVisible` yet (ISSUE-002), so there is no call
site at which purity could be observed.

### This is a bet, and it is recorded as one

Isolation is cheapest to build now and gets more expensive with every phase that
lands on the synchronous contract. Deciding not to build it today is a wager that
the trigger below does not fire before the phases that would make it costly are
already written. That is a real risk and it is being taken deliberately, not
overlooked.

### THE TRIGGER — a binding condition, not a note

> **This decision is VOID the day code the deployer did not read and compile from
> source they chose can reach the page.**

Concretely, any one of these fires it:

- an extension registry or a plug-in marketplace;
- a runtime remote loader of any kind;
- a hosted, multi-tenant deployment.

At that moment **real per-extension isolation becomes mandatory**, and it needs
its own issue, its own threat model written before any code, and a rewrite of the
view contract. It is not a hardening pass on this architecture. Nobody may close
that issue by adding checks to `ExtensionHostBoundary`.

Until then the honest description of this shell is: **a host that runs extensions
the deployer chose, compiled from source the deployer has, in one realm, with real
integrity controls on the host's own state and no boundary between extensions.**

### What Option B would have cost, and why it was not chosen now

Option B is real isolation: each extension in its own realm — an iframe or a
worker — with a message-passing contract.

- **The synchronous `ExtensionView` handoff cannot cross a realm.** `ExtensionView`
  is `ComponentType<ExtensionViewProps>`: the host renders the plug-in's own React
  component inside its own tree. A component reference is not serialisable, and
  render is synchronous. Crossing a realm means the plug-in no longer supplies a
  component at all — it supplies a description the host renders, or it renders into
  its own document and the host composites the result. Either is a different
  contract.
- **`RibbonAction.isVisible` cannot cross a realm.** It is evaluated *during
  render* and must return a boolean synchronously. Across a realm every answer is a
  promise, so the ribbon becomes eventually consistent: actions appear and
  disappear a frame or more after the context they describe.
- **WCAG 2.2 AA keyboard operability cannot be delivered across separate
  documents.** This is the decisive one and it is not a matter of effort. ARIA
  IDREF attributes — `aria-labelledby`, `aria-describedby`, `aria-controls`,
  `aria-activedescendant`, `aria-owns` — resolve **within a single document**. A
  ribbon control in the host document cannot point at a listbox inside an iframe;
  focus order, roving tabindex and the composite-widget patterns the three-pane
  layout needs all stop at the document boundary. `README.md` commits this project
  to WCAG 2.2 Level AA, including full keyboard operability across ribbon and
  panes. Option B, today, would mean breaking an accessibility commitment in order
  to make a security claim — and the accessibility commitment is the one users
  actually experience.

So Option B is the right answer *after* the trigger fires, and it will cost the
view contract when it comes. It is the wrong answer before, because it would trade
a delivered accessibility guarantee for a security guarantee nobody in the current
deployment model needs.

### Consequences

- **Positive.** No false security claim is left standing anywhere in the
  repository. Every sentence that asserted enforcement between extensions is
  either deleted or downgraded to the vocabulary above, with the correction and its
  reason recorded rather than quietly rewritten.

  > **This sentence was false when it was written, and Amendment F replaces it.**
  > Independent review found more overclaims immediately afterwards, in prose this
  > entry had just declared clean — including the store claim in this very
  > amendment, and this amendment's own "only remaining use of *structural*". A
  > blanket assertion of completeness is not a claim any review can support; it is
  > the same shape of error as the security claims it was summarising.
  >
  > **What is defensible instead:** every overclaim identified so far is corrected in
  > place, at the site that made it, with the wording that was wrong quoted and the
  > reason recorded — so a later reader can check the correction rather than take it
  > on trust. Each code-level claim in the vocabulary lists above is pinned by a
  > named test. Nothing here asserts that no overclaim remains, and the fact that
  > rounds 5 and 6 each found more is the evidence for stating it that way.
  >
  > **Round 7 found more again, in prose Amendment F had just rewritten** — the
  > `subscribe` clause at six sites. That vindicates the hedge above and is why
  > Amendment G stops correcting instances and installs a rule instead: every security
  > sentence must name the test that exercises it. Amendment G likewise asserts no
  > completeness. It asserts that every claim now names a test, is narrowed to one that
  > exists, or is labelled as having none — which is checkable sentence by sentence in a
  > way "no false claim remains" never was.
- **Positive.** The claims that *are* true are stated at their real strength for
  the first time, in particular the closure-held store.

  > **Amended by Amendment F.** "At their real strength" overshot for the store: the
  > object was not frozen, and the strength claimed was a claim about consumers
  > resting on evidence about the store. Both are corrected above.
- **Positive.** Four real code defects are fixed, each with a regression test that
  failed before it: record-keyed liveness (three separate consequences), the
  StrictMode teardown that revoked live handles, the two unvalidated badge doors,
  and `patchContext`'s unguarded reads. A fifth, the boundary's non-string
  `extensionId`, is type-guarded.

  > **Partly withdrawn by Amendment F.** "The StrictMode teardown that revoked live
  > handles" was not fixed. The `mounted` flag that replaced the revoke loop still
  > revoked a legitimately live handle — permanently — whenever a descendant used its
  > handle inside the same mount effect that took it. Teardown revocation is removed
  > outright in Amendment F rather than reimplemented a third time.
- **Negative — accepted.** The repository now documents, in the open, exactly how
  to escalate privilege inside it, and ships a test that does so. Given that the
  code is public and the technique is a property of React that anyone can rediscover
  in an afternoon, a written-down limit is worth more than an unwritten one.
- **Negative — accepted.** `ExtensionHostBoundary` is code that enforces nothing.
  It is kept because a loud throw at the point of an honest mistake has real value,
  and because deleting it would remove the only thing standing between an extension
  author and the instruction this project used to give them. The prose no longer
  oversells it.
- **Neutral.** `createRevocableShellAPI` now validates `extensionId` and can throw
  where it previously could not. Only a host bug reaches that path.
- **Neutral.** `getBadgeCount` now throws on a malformed argument where it
  previously returned `undefined`. It is a host-side read on a trust boundary and
  the asymmetry with `setBadgeCount` was the defect.

---

## Amendment F — The store object was never frozen, and teardown revocation is removed

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Amendment A
(consequences), Amendment C (the `isVisible` rationale, the liveness table),
Amendment D (defect 4, "teardown ends liveness", two consequences), Amendment E
(the store bullet, the "only remaining *structural*" claim, and the completeness
claim in its consequences)

### The findings

**1. The store object was a plain mutable literal, and the repository's flagship
claim rested on it not being one.** `createShellStateStore` returned an object
literal. Nothing froze it. `useShellStore()` is public by design and a plug-in view
renders inside the provider, so a plug-in obtained the one host-owned store and
assigned over a member. Reproduced four ways, none needing reflection:

| | What was done | What happened |
|---|---|---|
| a | `Object.isFrozen(store)` | `false` |
| b | replace `setSelectedItem`, then let another extension write through its **own** deep-frozen facade | the write was recorded by the interceptor and never reached the context — intercepted **and** suppressed |
| c | replace `getContext`, then let a victim pane read `useShellContext()` | victim read `{ selectedItemId: {"injected":true}, focusedPane: "pane9" }` |
| d | replace `patchContext` | `activeExtensionId` published as `null` while `getActive()` said `crm-ext` — the host's foreground publication evaporated |

The fix is one line: `return Object.freeze({ … })`. Nothing in `src/` ever assigned
to a store member, so it cost nothing. The prose was the larger part of the work —
six sites asserted the falsified property and are corrected in place.

**The corrected claim, and where it stops.** What is unconditional is that **this
store cannot be subverted**: its state is unreachable (closure variables, no
reflective API for a scope), its six methods cannot be replaced, deleted or added
to (frozen), and every one of them validates. So every value that enters the
context *through this store* is well-typed, for any caller however hostile. What is
**not** claimed, and what the old wording did claim: that an arbitrary consumer is
necessarily reading this store. It is published through React context, and a caller
who reaches hook state on a fiber reaches a published context value by the same
route Amendment E documents. The old sentence reasoned from evidence about the store
to a conclusion about consumers, and the phrases *unconditional* and *however
hostile* were attached to the conclusion rather than to the premise.

**Narrowed once more by Amendment G.** The restatement in this paragraph was correct.
The corrected sentences Amendment F wrote at the six *derived* sites were not: they each
appended a clause this restatement never made — "and no caller can intercept, suppress or
forge the writes and reads another holder makes through it." `subscribe` falsifies it,
and needs no member replaced to do so. See Amendment G, which also installs the rule
intended to stop the pattern rather than the instance.

**2. Teardown revocation is removed, not reimplemented.** Amendment E replaced
Amendment D's revoke loop with a `mounted` flag. The window did not close; the
trigger narrowed. Passive effects flush child-first in **both** directions, so
StrictMode's simulated remount runs every destroy (child, then the provider → flag
false) and only then every create (child **first**, the provider **last**). A
descendant that used its handle inside the mount effect that took it — the pattern
`DEVELOPER.md` documents — read the flag as false, and `assertLive` latched the
handle revoked for the rest of the session. Reproduced as `["ok", "REVOKED"]`, with
nothing released and nothing unregistered. `capability.test.tsx` missed it because
its test deferred the handle's *use* to after render.

The shared cause of both attempts is positional, not mechanical: **a cleanup cannot
distinguish a real unmount from StrictMode's simulated remount**, so anything acting
there is wrong in development exactly when it is right in production — the worst
shape a bug has. And the thing being bought is worth nothing. Revoking on teardown
delivers **no security**: the store dies with the provider, so a write through a
stale handle afterwards reaches an object nothing is subscribed to and nothing can
obtain, and it cannot touch a new provider's store because that provider creates its
own. The value was diagnostic, and a development-only outage is too high a price for
a diagnostic.

**So liveness ends by exactly two events — `release(id)`, and being unregistered.**
Both are things somebody did to the extension; both are observable; neither has a
StrictMode double. The `mounted` ref, the teardown effect and its docblock are
deleted, and `isLive` consults the registry and nothing else. The sweep effect now
calls `isLive` rather than restating it, since the reason the two differed was the
flag. The D7 test is rewritten rather than deleted: it pins that teardown revokes
nothing **and** that the stale handle cannot reach a live shell, which the
revoke-on-teardown version never asserted.

**3. The sweep effect was a fourth non-total path with no guardable call site.**
`activate`, `blur` and `release` all publish the foreground through the store, the
store notifies synchronously, and `subscribe` is public — so a plug-in listener that
throws comes back out. That is documented, and the advice "a host that treats
listeners as untrusted should guard the call" is actionable for all three, because
the host makes those calls. The registry sweep effect is the fourth path and the
advice is empty there: the caller is React's passive-effect flush and there is no
host statement to wrap. A plug-in that subscribed one throwing listener and then
caused any registry change that moved the foreground took the **whole root** down.

It is guarded inside the effect. Catching is safe because `applyPatch` notifies
last, so the context is already committed and the bookkeeping the effect exists for
is complete; the listener is reported through `console.error` rather than swallowed,
and deliberately not re-raised, because there is nowhere to raise it to that does
not cost the shell.

**4. "Structural" was wrong for `isVisible` purity, and right in only one place.** A
signature constrains arguments, not closures: a predicate defined inside a view that
called the public `useShellStore()` captures a store and writes on invocation, which
was reproduced. Purity is a **guardrail**. With that and Amendment A's normalisation
bullet re-labelled as an **integrity control**, Amendment E's claim that the
`Map`-backed stores are the only earned use of *structural* is true for the first
time — **as a claim about security properties**, which is the only thing this
vocabulary governs. The word still appears in the Context, Decision and Alternatives
sections describing architecture rather than enforcement, and E's "in this document …
and nowhere else" was wider than it needed to be; the scope is now stated at the
bullet itself.

### The decision

Freeze the store; delete teardown revocation; guard the sweep effect; re-label
`isVisible` purity as a guardrail. Correct every prose site that asserted the
falsified properties, quoting the wording that was wrong so the correction is
checkable. Replace Amendment E's "no false security claim is left standing anywhere
in the repository" with a claim that a review can actually support — that each
identified overclaim is corrected at the site that made it, and that nothing here
asserts none remains.

### Consequences

- **Positive.** One of the three vocabulary terms now has a code-level basis it
  lacked. The deep-frozen `IShellAPI` had been protected against method replacement
  since it was written; the store it sits on had not, while carrying the stronger
  claim.
- **Positive.** No development-only divergence remains in the liveness model. The
  two ending events are the two that were specified in the first place.
- **Positive.** A hostile listener can no longer take the root down through the one
  path a host had no way to guard.
- **Negative — accepted.** A write through a handle retained past its provider's
  unmount now succeeds instead of throwing `REVOKED`. It reaches an orphaned store
  that nothing subscribes to and nothing can obtain, so the loss is a diagnostic
  one. `DEVELOPER.md`'s advice not to park a handle past its life is unchanged and
  is now the only thing covering that case.
- **Negative — accepted.** The sweep effect reports a throwing listener to
  `console.error` and continues. That is a swallow with a log rather than a
  propagated failure, and it is the first `console` call in `src/core/`. The
  alternative was a shell that a single `subscribe` can unmount.
- **Neutral.** The `isVisible` signature is unchanged. Only its description is.

---

## Amendment G — No security claim without a named test

**Date:** 2026-07-29 · **Status:** Accepted · **Amends:** Amendment F (the corrected
store bullet and the six sites it corrected them at), Amendment E (the three-word
vocabulary, which now has a fourth rule governing its use), and Amendment F finding 3
(the sweep-effect guard, whose reporting call was itself unguarded)

### The finding that prompted it

**The interception clause was false at six sites.** Amendment F froze the store and
rewrote the flagship claim. Its own restatement — "every value that enters the context
*through this store* is well-typed, for any caller however hostile" — is correct and is
exactly as wide as the evidence. But the six *derived* sites each appended a clause the
restatement never made:

> *Its methods are its own.* The returned object is **frozen**, so no holder can
> replace, delete or add a member. Every one of the six validates its arguments.
> Therefore no caller can put a value of the wrong shape into this store's context,
> **and no caller can intercept, suppress or forge the writes and reads another holder
> makes through it.**

The first conclusion is true. The second is false, and the freeze is irrelevant to it.
`subscribe` is one of the six frozen members, it is reachable through the public
`useShellStore()`, and it runs plug-in code **synchronously inside another holder's
write**. Nothing is replaced, so nothing the freeze buys applies. Reproduced with
`Object.isFrozen(store) === true` throughout:

| | What was done | What happened |
|---|---|---|
| a | subscribe a listener; another holder writes through its **own deep-frozen facade** | the listener read the new value and ran **before the writer's statement returned** — interception |
| b | the listener re-enters `patchContext` from inside the notification | host wrote `host-value`; final state `attacker-wins` — the write suppressed, one shallow cascade, no `REENTRANT_NOTIFY` |
| c | a listener that throws, with a second listener subscribed after it | `victimCalls == []` while the context held `host-value` — the notification suppressed |
| d | a listener that throws a `TypeError` | a raw `TypeError` out of `patchContext` and out of `setBadgeCount`, neither contracted to deliver one |
| e | a hostile extension mounted before a victim pane | `victim render log: [null]`; the pane stays desynchronised for every later write |
| f | a listener re-publishes the foreground during `blur()` | `store says: a-lie` while `host getActive() says: null` — Amendment F row (d)'s observable, reached through `subscribe` instead of method replacement |

**The repository already contradicted itself**, which is the sharpest evidence that this
was a prose defect rather than a discovery: `ActivationContext.tsx` says in five separate
places that "`subscribe` is public — so plugin code runs inside this write", and
`capability.test.tsx` pins a throwing listener propagating out of `activate`, `blur` and
`release`. The six derived sites simply did not consult any of it.

All six are corrected. What is kept is the proven half — values entering this store's
context are well-typed for any caller — and the real limit is now stated at each site in
the vocabulary's own terms: **a listener is a synchronous call into untrusted code inside
another holder's write; it can observe, re-enter, and throw into the writer's frame.**
`ShellStateStore.subscribe`'s own docblock, which said none of this and is the root of the
finding, now says all of it. *Tests:* `src/core/__tests__/subscribe.test.tsx`.

**The reported six were:** `src/core/ShellAPI.ts` (the `createShellStateStore` banner),
`README.md` (the state-store integrity bullet), `DEVELOPER.md` (the integrity-control
vocabulary cell, and the store paragraph under "Where to go next"), this document's
Amendment E integrity bullet, and the comment above the freeze assertion in
`src/core/__tests__/reflection.test.tsx` — which claimed the property while the test
asserts only that assignment throws.

**Sweeping for the clause found two more, which is itself the argument for the rule
below.** The same "cannot intercept or suppress" conclusion, from the same
freeze-based premise, sat at §3 of the original Decision in this document ("The API
context handed to extensions is deeply frozen") and at `DEVELOPER.md`'s property 1 of
`IShellAPI` ("it is the mechanism that stops one extension from tampering with the shell
services other extensions depend on"). Neither was in the report. Both are corrected.
Eight sites, one premise, one unlicensed step.

### Seven rounds, one defect

This is the seventh consecutive round to find the same thing, and in **every** round the
mechanism was sound and the sentence was wider than its premise. The verifier's summary
of round 7 is the whole diagnosis:

> it is not the mechanism — it is that a conclusion keeps being written one step wider
> than the premise that licenses it.

| Round | Site | Premise that was true | Conclusion that was too wide |
|---|---|---|---|
| 1 | `README.md` "VS Code" prior-art bullet | VS Code's restricted-object *contract* is worth borrowing | extensions "cannot reach into the host or into each other" — false about this shell and about VS Code, whose own docs say the extension host runs with the editor's permissions |
| 2 | `DEVELOPER.md` activation guide | `useActivation()` is the documented route to the controller | the guide *instructed* authors to call it, then called the controller host-only "and structurally so" |
| 3 | Amendment C / `ShellAPI.ts` `revoke` | `revoke` is not reachable **from `api`** | "a plug-in cannot revoke itself, and cannot revoke another extension" — the controller is reachable by fiber walk (Amendment E) |
| 4 | Amendment D / `ActivationContext.tsx` `activate` | every container the host owns is frozen | the reach of unfrozen plug-in functions "is bounded by who can obtain an `ActiveExtension`" — `getExtension` hands them to anyone (Amendment E) |
| 5 | Amendment E store bullet, `README.md`, `DEVELOPER.md` | the store's *state* is unreachable (closure variables) | "`RibbonContext`'s declared types are true at runtime for every caller however hostile … the strongest true claim in the codebase" — the store object was a plain mutable literal, and the premise said nothing about the methods (Amendment F) |
| 6 | Amendment F's six derived sites — `ShellAPI.ts` store banner, `README.md` store bullet, `DEVELOPER.md` vocabulary cell and store paragraph, this document's Amendment E store bullet, `reflection.test.tsx` freeze comment — plus two the sweep added, this document's Decision §3 and `DEVELOPER.md`'s `IShellAPI` property 1 | the store object is frozen, so **no member can be replaced**; a facade's methods cannot be swapped | "therefore no caller can intercept, suppress or forge the writes and reads another holder makes through it" — `subscribe` needs no member replaced (this amendment) |
| 7 | Amendment F finding 3's guard, `ActivationContext.tsx` | catching the listener keeps the sweep effect from unmounting the root | the guard's own `console.error` is not the host's object either, and a throwing one escaped and unmounted the root anyway — `CONSOLE-THROWS: ESCAPED` |

Six code fixes across those rounds were all correct and all necessary. **None of them
addressed the pattern**, because the pattern is not in the code. Correcting the seventh
instance and stopping there would produce an eighth.

### The decision

> **No security claim may appear in prose — in any `.md` file or any docblock — unless
> it names the test that exercises it.**

Three ways to satisfy it. All three are correct outcomes:

1. **Name the test.** Append the file and the `it(...)` description that asserts the
   property.
2. **Narrow the claim** until an existing test does assert it.
3. **Delete the claim.** If nothing exercises it and no test can cheaply be written, the
   sentence goes. **That is the rule working, not a failure.**

The rule is deliberately about *naming a test*, not about *having* one. Naming forces the
author to open the test file and read what is actually asserted before writing the word
*cannot*. Every round above would have been caught by that single act: round 5's evidence
was a test that only ever passed bad **arguments**, and round 6's was a test that only
ever asserted that **assignment throws**. Both were cited for properties they did not
assert. Both comments now say what their test actually covers.

The rule is recorded in `README.md` beside the three-term vocabulary it governs, in
`DEVELOPER.md`, and as a Definition-of-Done bullet on ISSUE-001 in
`.github/ISSUES_MANIFEST.md`.

**It is a review-time convention and no script checks it.** That is stated plainly here
rather than left to be discovered. A linter cannot tell a security claim from any other
sentence, and a grep for *cannot* over four documents returns mostly prose about
architecture. What the rule buys is not enforcement; it is that a reviewer now has a
mechanical question to ask of every such sentence — *which test?* — and an unanswerable
one is a finding. Anyone who wants it enforced should open an issue for it and write the
threat model for what a checker would actually match, in the same spirit as the
`unregister` ownership model.

### The three lows fixed alongside it

1. **The sweep guard's report path was a second escape (round 7 above).** `console.error`
   is replaceable, and a throwing one left the `catch`, escaped React's passive-effect
   flush, reached no error boundary and unmounted the root. Guarded with one nested
   `try`; the handler attempts nothing, because there is no second reporting channel any
   more the host's than `console` is. The precondition is global tampering, which this
   ADR's threat model concedes rather than defends against — the guard is cheaper than
   the argument for omitting it. *Test:* "survives a console.error that throws, which is
   the report path escaping the guard".
2. **`badgeKey` said "all four call sites validate first".** There are **two**,
   `getBadgeCount` and `setBadgeCount`; the count was of arguments, not callers.
   Corrected, and the sentence now names the test that pins the validation.
3. **`RegistryContext.tsx` still said normalisation is "structurally" what is stored**,
   after Amendment F reserved *structural* for the `Map`-backed stores. That is
   comment-only drift and the last site of it. Normalisation is an **integrity control**
   — real and unconditional — but bought by code that runs, not by a property of the data
   structure. Corrected; the file is otherwise untouched, and the `Map` store,
   `RESERVED_IDS`, `EXTENSION_ID_PATTERN`, the single-read discipline, normalisation and
   the deep-freezing are unchanged and still tested.

A fourth, in the test layer, because the same failure mode there is no better:
Amendment F claimed the rewritten D7 test "pins both real ending events" and it pinned
only `unregister`. D7 now activates two extensions and pins `release` on one and
`unregister` on the other, so the description is true of the test.

### Consequences

- **Positive.** The store claim is now stated at a width three successive amendments
  failed to reach, and `subscribe` — the member that falsified it — carries the
  explanation at its own declaration rather than in an amendment a reader may not open.
- **Positive.** Every live security claim in **every `.md` file in the repository** —
  `README.md`, `DEVELOPER.md`, `.github/ISSUES_MANIFEST.md` and this ADR, which are all
  four of them — and in `src/core/**` now names a test, is narrowed to one that exists,
  or is explicitly labelled as having none. The sweep that produced that also caught two
  stale claims no round had reported: `README.md` and `DEVELOPER.md` both still listed
  **provider teardown** as a third event that revokes a handle, which Amendment F
  removed.

  **This scope was widened in round 10, and it is worth recording why.** As first
  written the sentence listed `README.md`, `DEVELOPER.md`, this ADR and `src/core/**` —
  and `.github/ISSUES_MANIFEST.md` was neither in it nor swept, despite being the file
  that carries the rule as an ISSUE-001 Definition-of-Done bullet and despite the rule
  itself saying *any `.md` file*. Citation counts at the time made the gap plain: 16 in
  `README.md`, 12 in `DEVELOPER.md`, 18 here, and **0** in the manifest.

  Given a rule and a completeness statement that disagreed, the choice was to widen the
  statement rather than narrow the rule, and the reasoning is not a preference. The
  rule's breadth is the correct breadth: a reader who learns the security posture from
  the work-breakdown document is misled by an unsupported claim there exactly as much as
  by one in the README, and exempting the file that *states* the rule would be the
  clearest possible signal that the rule is decorative. Narrowing the rule to the four
  swept locations would also have been unstable — it would need re-widening the moment a
  fifth `.md` file appeared. So the manifest was swept under Amendment G in round 10 and
  the statement now names the whole file set. The count of four is checkable and is
  stated so that a fifth `.md` file arriving without a sweep is a visible discrepancy
  rather than a silent one.
- **Positive.** Two claims are labelled *untested* rather than deleted, and saying so is
  the point: the render-boundary rule (no `dangerouslySetInnerHTML`) and `isVisible`
  purity. Neither has a call site in `src/` yet, so neither can be observed. They are
  obligations on ISSUE-002 and ISSUE-004, not properties of this codebase.
- **Negative — accepted.** Prose is now noticeably heavier: most security bullets carry a
  *Tests:* line, and some carry three. That is the cost of the rule and it was accepted
  over a seventh round of the same defect.
- **Negative — accepted.** The rule has no automated enforcement, so it degrades to the
  discipline of whoever is reviewing. Stated above rather than implied.
- **Neutral.** `subscribe.test.tsx` is a new file in the honest-pinning register of
  `reflection.test.tsx` — it asserts reachable hostile behaviour as expected reality. Like
  that file, it is not a file to relax: a change that makes any of its assertions fail is
  a genuinely new property needing its own analysis first.
- **Neutral.** No behaviour changed except the one nested `try` in the sweep effect.
  Findings 1 through 6 in the table above were all prose.

---

## Amendment H — Plug-in-registered keyboard shortcuts

**Date:** 2026-07-30 · **Status:** Accepted · **Amends:** Amendment A (the
normalisation rules now cover a nested optional object), Amendment C (the
`onExecute` capability, which a hotkey is a second route to), and the original
Decision §1 (the blueprint contract, which gains one optional field)

### What changed

`RibbonAction` gains one optional field:

```ts
export interface Hotkey {
  readonly key: string;      // a key name from the host allowlist, compared lowercased
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

export interface RibbonAction {
  // ...existing fields unchanged...
  readonly hotkey?: Hotkey;  // declared and validated now; dispatched in Phase 2
}
```

`ShellUXErrorCode` gains `DUPLICATE_HOTKEY`. `RegistryContext.tsx` gains the
`HOTKEY_KEYS` allowlist beside `REGISTRY_LIMITS`, and `normalizeHotkey`.
`src/core/hotkeys.ts` is new and holds three pure functions — `hotkeyToken`,
`describeHotkey`, `matchesHotkey`. (Amendment J adds a fourth, `ariaKeyShortcuts`.)
Nothing else changed: the `Map` store,
`RESERVED_IDS`, `EXTENSION_ID_PATTERN`, the single-read discipline, normalisation
and the deep-freezing are untouched.

**Nothing dispatches a hotkey.** No module under `src/` registers an event
listener of any kind, there is no `useHotkeyDispatcher`, and there is no
evaluation site. This amendment records a *declaration and validation* decision,
in the same present-tense-honest register Amendment G requires of `isVisible`.

> **SUPERSEDED BY AMENDMENT J.** The paragraph above was true when it was written
> and is not true now: ISSUE-006 built the dispatcher, `src/core/hotkeyDispatch.ts`
> holds the repository's one `addEventListener`, and both halves of the scan below
> are now allowlisted. It is preserved rather than rewritten because the rest of
> this amendment is a record of decisions taken while it was true. Everything else
> in Amendment H stands; see Amendment J for what the dispatcher does with it.

*Tests:* the repository-wide half of that sentence was pinned by a test that
forbade `addEventListener` in every module under `src/` with no exceptions at all.
Amendment J narrowed it to a one-entry allowlist and re-pointed this citation with
it: "finds no listener registration in any module outside the hotkey-dispatch
allowlist" in `src/__tests__/noEventListener.test.ts`. It parses every non-test
`.ts`/`.tsx` file under `src/` with the TypeScript compiler and fails if any code
position — identifier, property name, JSX attribute or string literal — spells
`addEventListener` or `removeEventListener` outside that allowlist.

**AMENDED BY ISSUE-004, and amended by narrowing rather than by weakening.** That
test used to forbid `keydown`, `keyup` and `keypress` in the same breath and with
the same repo-wide reach. ISSUE-004's list virtualizer needs `onKeyDown` for
arrow-key row navigation — it is the issue's own Definition of Done — so the two
halves were split. The listener half was left unchanged with NO allowlist
mechanism at all, because that half was what "no dispatcher, no evaluation site"
rested on; ISSUE-006 then had to narrow it too, and Amendment J records why. The
key-event half is scoped to a named allowlist, and both allowlists are checked in
both directions: a listed module that stops spelling what its entry claims fails
as a stale exemption, and one that grows a spelling its entry does not name fails
as an unreviewed widening. *Tests:* "finds no key-event name in any module
outside the key-event allowlist", "holds the key-event allowlist to the exact
spellings each listed module contains", "holds the hotkey-dispatch allowlist to
the exact spellings the dispatcher contains" and "registers no listener and names
no window or document target in the allowlisted module".

Amendment G's three routes are name a test, narrow the claim, or delete it.
Deleting the file or blanket-exempting `src/components/**` were both rejected:
the first destroys the evidence for a claim made in five places, and the second is
an allowlist that only ever gets longer. Narrowing is the route that keeps the
sentence and the evidence the same width, and every prose site stating the wider
claim was re-pointed in the same change.

Comments are trivia to the parser and are not scanned, which is the distinction
the claim needs: this paragraph and several docblocks discuss the absence, and
a raw text search would fail on the sentences describing it. Its limit is stated
in the test rather than glossed — a listener reached through a name that is not
text, or one installed by an imported third-party module, is outside what a
parse of `src/` can see. The narrower module-level fact, that
`src/core/hotkeys.ts` exports exactly the three helpers and that calling all
three registers no listener on `window` or `document`, is "hotkeys module — does
not attach anything" in `src/core/__tests__/hotkeys.test.ts`.

**Why a new test rather than a narrower sentence.** Amendment G's three routes
are name a test, narrow the claim, or delete it. This site originally cited the
module-level test for a repository-wide claim — the ninth instance of the
pattern, and the first where the missing evidence was cheap to produce rather
than absent in principle. Narrowing to "`src/core/hotkeys.ts` attaches nothing"
would have been honest and would have thrown away the property an extension
author actually needs to know. Route 1 keeps the claim and moves the evidence up
to meet it, which also makes the claim self-defending: a listener added to
`App.tsx` or `RegistryContext.tsx` tomorrow turns the suite red instead of
turning a sentence false in silence.

### Decision 1 — the field lives on `RibbonAction`, not on the blueprint

A blueprint-level `hotkeys` collection was the obvious alternative and was
rejected. Hanging the chord off the action means it **inherits four properties
that already exist and are already tested**, rather than needing four new ones:

1. **The bound.** `MAX_RIBBON_ACTIONS` is 128, and it is applied to the count the
   host actually walks rather than to a `length` a Proxy can revise afterwards.
   A hotkey cannot exist without an action, so the number of chords one extension
   can declare is bounded by that same check, with no second limit to keep in
   sync. *Tests:* "register — a lying `length` cannot grow the payload after it is
   measured" in `src/core/__tests__/registryNormalization.test.tsx`.
2. **The uniqueness walk.** `normalizeBlueprint` already threads a `seenIds` set
   through every action to reject a repeated action id. Chord uniqueness is
   decided in that same single pass by threading a second `Set<string>` keyed on
   the canonical token — no second traversal, and no possibility of the two walks
   disagreeing about how many actions there are. *Tests:* "validateBlueprint —
   duplicate hotkeys within one extension" in
   `src/core/__tests__/validation.test.ts`.
3. **The containment story.** A hotkey is a *second way to fire an `onExecute`
   the ribbon could already fire*, gated by the same `isVisible` and the same
   `isDisabled`. It therefore grants an extension no capability the ribbon did
   not already grant it, and Phase 2's dispatcher inherits whatever containment
   Phase 2 builds for the ribbon rather than needing its own. A blueprint-level
   collection would have needed its own handler field, and that handler would
   have been a new call site with a new argument list to design.
4. **The rendering story.** A ribbon button and its shortcut are the same
   affordance to a user. With the chord on the action, the Phase-2 renderer has
   what it needs for `aria-keyshortcuts` and for a tooltip **in the object it is
   already rendering**; `describeHotkey` exists for exactly that.

**The cost, stated rather than glossed:** a shortcut that is not also a ribbon
action cannot be declared. That is accepted for v1. It is additively fixable — a
blueprint-level collection can be added later without changing the meaning of
anything written against this contract — and the reverse is not: having shipped a
collection, moving chords onto actions would break every extension that used it.

### Decision 2 — structured fields, not a string

`"Ctrl+Shift+K"` would need a parser, and that parser would sit **at the trust
boundary**, deciding for untrusted input what `Cmd` means versus `Meta` versus
`Super`, whether `Esc` and `Escape` are one token, what `ctrl + shift + k` with
interior spaces means, what `Ctrl+Ctrl+K` means, and what a chord with no key at
all means. Every one of those is a decision that can be got wrong, and none of
them buys anything: the structured form validates with helpers that already
exist — a `Set` membership test for the key, and the same
boolean-when-present rule `isDisabled` already uses for each modifier. There is
no parser and therefore no parser bugs. *Tests:* "validateBlueprint — ribbon
action hotkeys" in `src/core/__tests__/validation.test.ts`.

### Decision 3 — this binds `event.key`, not `event.code`

**This is a real decision with a real consequence, and it is recorded before
Phase 2 builds a dispatcher on it.**

`event.key` is the character the layout produces; `event.code` is the physical
switch. Binding `key` means a chord declared `{ key: 'z', ctrl: true }` fires on
whichever physical key the user's layout puts `z` on. On a German QWERTZ layout
the key in the position a US keyboard calls Z produces `event.key` `"y"`, so that
chord fires on the physically-different key that says Z on its cap — which is the
*correct* behaviour for a mnemonic shortcut, and the wrong one for a positional
one.

The choice is deliberate because the shortcuts this contract offers are
mnemonics: an extension author writes `k` because the command is *Kill* or
*Compose*, not because of where that key sits. `event.code` would give a stable
physical position and a shortcut whose printed name is wrong for most of the
world. Positional binding is not offered at all rather than offered as a second
mode, because a contract with both needs the author to understand the difference,
and getting it wrong is invisible on the author's own keyboard.

`matchesHotkey` therefore compares `event.key.toLowerCase()` against the stored
lowercased key, and reads no other field of the event. *Tests:* "matchesHotkey"
in `src/core/__tests__/hotkeys.test.ts`.

### Decision 4 — the allowlist, and what is deliberately absent

`HOTKEY_KEYS` is 61 `event.key` names: the 26 Latin letters, the 10 digits, `f1`
through `f12`, the four arrows, and `home`, `end`, `pageup`, `pagedown`, `enter`,
`escape`, `delete`, `insert`, `backspace`. An allowlist rather than "any string",
for the same reason ids get one: the value arrives from an untrusted manifest and
the set of keys a shell can safely let a plugin claim is small and closed.

Three groups are absent on purpose, and the omissions are the part of the list
worth reviewing:

- **`tab`.** Tab is how a keyboard user moves between controls. An extension that
  owned it would break focus order for every user of the shell — WCAG 2.1
  Success Criteria **2.1.1 Keyboard** and **2.4.3 Focus Order**. No chord
  involving Tab is worth that, so it is not offered at all rather than offered
  with a warning nobody reads.
- **`space`.** Space activates the focused control: a button, a checkbox, a row.
  Claiming it globally means the focused control stops responding to the key that
  operates it.
- **Every modifier as a key** — `control`, `alt`, `shift`, `meta`, `capslock`,
  `altgraph`. A modifier is a *field* on `Hotkey`. Naming one as the `key` would
  describe a chord that fires on the modifier's own keydown, before the user has
  pressed the key they were reaching for.

*Tests:* the rejection table in "validateBlueprint — ribbon action hotkeys" walks
all three groups explicitly, and "accepts every key in the host allowlist" pins
the size at 61 so that a key joining or leaving the list is a failing test rather
than a silent widening.

> **Amended by Amendment I.** The list is **60** keys, not 61, and there are
> **four** absent groups, not three: `escape` was removed, on the same reasoning
> given here for `space`. `enter` stays on the list but may no longer be declared
> bare. The three exclusions above stand exactly as written; what was wrong was
> that the reasoning was not applied to two keys it plainly reached — GitHub issue
> #8. See Amendment I.

### Decision 5 — a single-character key must carry ctrl, alt or meta

**This is the WCAG 2.2 Success Criterion 2.1.4 Character Key Shortcuts, Level A
conformance route.** It is not a style preference and it is not negotiable
downward.

2.1.4 says that if a keyboard shortcut is implemented using only letter,
punctuation, number or symbol characters, then at least one of three things must
be true: the shortcut can be turned off, it can be remapped to include a
non-printable key, or it is active only when the relevant component has focus.
This shell offers none of those three in Phase 1 — there is no settings surface
to turn a chord off, no remapping UI, and the Phase-2 dispatcher is specified to
be extension-scoped rather than component-scoped. So the criterion is met the
fourth way: **the declaration is refused.** A chord whose key is one character
must carry `ctrl`, `alt` or `meta`.

**`shift` does not count**, and that is the part most likely to be argued with.
Shift+K is still a character key; it produces `K`. A speech-input user's dictation
emits characters, and a user typing into any surface the shortcut is live over
produces them too. Shift changes which character, not whether one is produced.

Function keys and the named navigation and editing keys are exempt, because they
are not characters: no dictation and no typing produces `F5` or `ArrowDown`.

The rejection message names the criterion, so an author who hits it learns why
rather than working around it. *Tests:* "validateBlueprint — the WCAG 2.1.4
modifier rule for character keys" in `src/core/__tests__/validation.test.ts`,
which asserts the message contains `2.1.4`, `Character Key Shortcuts` and
`Level A`, pins shift-alone as a rejection, and derives the exempt set from
`HOTKEY_KEYS` itself so a new named key is covered the moment it lands.

> **Amended by Amendment I.** This decision is unchanged and its message is
> unchanged. What changed is that it is no longer the *only* reason a chord may be
> refused for carrying no modifier: `enter` is now refused bare as well, on
> **activation** grounds, with its own message that names no criterion. The
> sentence above — "Function keys and the named navigation and editing keys are
> exempt" — remains true of 2.1.4 and is true of `enter` too; `enter` is refused by
> a different rule, and conflating the two would have made this citation
> inaccurate. The exempt set in the test now subtracts
> `HOTKEY_MODIFIER_REQUIRED_KEYS`, so it still derives rather than transcribes. See
> Amendment I.

### Decision 6 — cross-extension conflicts are impossible, and REJECTING them was refused

**Hotkeys are scoped to the foreground extension.** Only the foreground
extension's chords are live, exactly as only its `ribbonActions` appear on the
ribbon. Two extensions declaring `Ctrl+K` is therefore not a conflict, and both
registrations succeed. *Tests:* "lets two DIFFERENT extensions declare the same
chord" in `src/core/__tests__/validation.test.ts`.

Rejecting a chord at registration because another extension already claimed it
was considered and **refused, on three independent grounds**:

1. **It would make registration order semantically load-bearing.** In a lazily
   loaded local-first shell, registration order is whichever module's import
   graph resolves first. That is a function of bundler chunking, network timing
   and cache state — so the same two extensions could produce different winners
   across two boots of the same machine. This registry's headline property is
   that duplicates fail **deterministically**; a rule whose outcome depends on
   load order would be the only non-deterministic rejection in it.
2. **It would hand any extension a squatting attack.** Register first, declare
   128 chords — the `MAX_RIBBON_ACTIONS` ceiling — and every one of them is
   denied to everybody else for the life of the session. The shell has no
   ownership model and deliberately no authorisation on `unregister`
   (Amendment B), so there would be nothing to appeal to and no way to unstick
   it. Amendment E's threat model concedes that extensions are same-origin
   JavaScript in one page; adding a first-come land grab to that would be adding
   a new denial-of-service surface in exchange for a conflict that scoping
   already prevents.
3. **`normalizeBlueprint` has no view of the store, and giving it one would be
   the larger change.** It is a pure function of one candidate payload, which is
   what makes `validateBlueprint` exportable and testable without a provider.
   Threading the registry into it would couple validation to registry state and
   make the same blueprint validate or fail depending on what else happens to be
   registered — the time-of-check/time-of-use shape Amendment A exists to close.

What *is* rejected is a chord repeated **inside one blueprint**, because that is
an unambiguous author error with a deterministic answer: the second declaration
loses, with `DUPLICATE_HOTKEY` naming `ribbonActions[n].hotkey`. Uniqueness is
decided on the canonical token, so a chord spelled with its fields in a different
order, with an absent modifier where another wrote `false`, or with a different
key casing, is the same chord. *Tests:* "validateBlueprint — duplicate hotkeys
within one extension".

### Decision 7 — the stored chord is a fresh, frozen, fully-materialised object

The normalised `Hotkey` is a host-owned object with **all four modifiers present
as explicit booleans**, frozen before it is assigned into the action, which is
itself frozen — the same rule Amendment A set for every other validated field.
Two things follow, and the second is the reason the first is worth the lines:

- The plugin's own object is never stored, so editing it after registration
  changes nothing. *Tests:* "is unaffected by the plugin mutating its own hotkey
  afterwards" and "freezes the stored hotkey" in
  `src/core/__tests__/registryNormalization.test.tsx`.
- **`hotkeyToken` becomes a total function with no `undefined` branch.** The
  canonical token is what deduplicates today and what a dispatcher will look up
  by later; if it had to ask "absent or `false`?" on four fields, that is four
  `??` operators, and the 100% branch gate over `src/core/**` charges for every
  one of them. Materialising the four at the boundary means the token function is
  four unconditional reads.

### Decision 8 — ISSUE-005's J/K list navigation stays view-local

Recorded here so Phase 5 does not relitigate it. `.github/ISSUES_MANIFEST.md`
specifies that Arrow keys plus `J`/`K` move the Pane 2 selection. **Those are not
hotkeys in the sense of this amendment and must not be reimplemented as one.**

`J` and `K` are bare single-character keys. Declared as global shortcuts they
would fail WCAG 2.2 §2.1.4 at Level A for exactly the reason Decision 5 gives —
and `normalizeRibbonAction` would refuse the declaration, which is the rule doing
its job rather than an obstacle to route around. They are legitimate as **key
handling local to the Pane 2 list view**, active only while that list has focus,
which is 2.1.4's third conformance route ("active only on focus") and is also
what the manifest's own edge case requires when it says the bindings "must not
fire while focus is in a text input or any editable surface". That belongs in the
Pane 2 view with ISSUE-004's virtualizer, not in this contract.

### Consequences

- **Positive.** An extension can declare a shortcut today, in a shape a
  dispatcher can consume unchanged, and get the allowlist, the accessibility rule
  and the uniqueness check enforced at registration rather than discovering them
  when the ribbon lands.
- **Positive.** The accessibility rule is enforced by the *host*, at the one door
  every extension must pass through, rather than being a line in `DEVELOPER.md`
  asking authors to be careful. It is **entry-point validation** in this
  document's vocabulary — real at the documented door, and bypassable by a caller
  who reaches host internals another way, exactly like every other blueprint
  check.
- **Negative — accepted.** A shortcut with no ribbon action cannot be declared.
  See Decision 1.
- **Negative — accepted.** `event.key` binding means a chord's physical position
  moves with the user's layout. See Decision 3.
- **Negative — accepted.** Two extensions may claim the same chord, so what a
  chord does depends on which extension is in front. That is the same rule the
  ribbon already follows and it is the alternative to Decision 6's three
  failures, but it does mean a user's muscle memory is per-extension.
- **Neutral.** No existing behaviour changed. Every one of the 384 tests that
  existed before this amendment still passes untouched, because `hotkey` is
  optional and absent from every fixture that does not name it.
- **Neutral.** `src/core/hotkeys.ts` is a new file under the 100% coverage gate,
  and it is deliberately trivial: three pure functions, no DOM, no React, no
  state. The interesting code is the dispatcher, and the dispatcher is Phase 2.
  (It landed as `src/core/hotkeyDispatch.ts` — a separate module, so this one
  stayed trivial. See Amendment J.)

---

## Amendment I — `enter` and `escape`: the allowlist now applies its own rule to itself

**Date:** 2026-07-31 · **Status:** Accepted · **Amends:** Amendment H Decision 4
(the allowlist and its absences) and Amendment H Decision 5 (the modifier rule,
which is now one of two rules rather than the only one)

### The finding

GitHub issue #8. `HOTKEY_KEYS` admitted `enter` and `escape` as chords with **zero
modifiers**, because the guard in `normalizeHotkey` refused a bare chord only when
`key.length === 1`. Decision 4 excludes `space` in these words:

> **`space`.** Space activates the focused control: a button, a checkbox, a row.
> Claiming it globally means the focused control stops responding to the key that
> operates it.

That reason reaches `enter` exactly. Enter activates the focused control — the
default button, a focused link, a table row — and submits a form, in every browser
and every assistive technology. Two keys with one failure mode sat on opposite
sides of the list, and the list explained only one of them.

`escape` has a second, concrete collision. It is the shell's dismissal key: it
closes the ribbon's overflow menu, cancels a drag, leaves fullscreen, and dismisses
a `@radix-ui/react-dialog` dialog — and this project ships that dependency. Once a
dispatcher exists, an extension holding bare `escape` and an open dialog are in a
fight neither side declared.

**What was *not* wrong, and is not being fixed here.** WCAG 2.2 §2.1.4 Character
Key Shortcuts is about single printable **character** keys. It genuinely does not
reach `enter`, `escape`, `backspace`, `delete` or `insert`, so the rule as shipped
was conformant and no accessibility claim in this repository was false. This
amendment is about the allowlist applying its own stated rationale uniformly.

### Why now, and why the cost only rises

Nothing dispatched a chord when this was written — pinned at the time by a scan
that forbade `addEventListener` anywhere under `src/`, now narrowed by Amendment J
to "finds no listener registration in any module outside the hotkey-dispatch
allowlist" in `src/__tests__/noEventListener.test.ts`. **No extension exists**, and
ISSUE-005 has not landed. So at the time this change broke nothing at all — and
ISSUE-006's dispatcher, which landed after it, inherited the smaller allowlist
rather than having to shrink a live one.

That is the entire argument for doing it now rather than with the Phase 2
dispatcher. The moment chords actually fire, removing a key from the allowlist or
adding a modifier requirement to one is a **breaking change for every extension
that declared it** — it turns a working registration into a rejected one, and a
rejected registration takes the whole blueprint with it. The cost of this decision
therefore rises with every release after this one, and it never falls. It is
recorded here so that a later reader who finds the change disruptive can see that
the alternative was to make it more disruptive later.

### Decision 1 — `escape` is removed from the allowlist outright

`HOTKEY_KEYS` is **60** keys: 26 Latin letters, 10 digits, `f1`–`f12`, the four
arrows, and `home`, `end`, `pageup`, `pagedown`, `enter`, `delete`, `insert`,
`backspace`. Decision 4's list of absences gains a fourth group.

**A modifier-gated Escape was considered and refused as dead surface rather than
accepted as a compromise.** The obvious symmetric move — keep `escape`, require a
modifier, as with `enter` below — buys nothing, because the modified forms are all
claimed by something outside this shell: `Ctrl+Escape` opens the Start menu on
Windows, and `Alt+Escape` and `Meta+Escape` belong to the window manager on the
major desktops. Offering a family of chords the host cannot deliver would be worse
than offering none, because the failure is invisible at registration and shows up
only as a shortcut that silently never fires.

Escape belongs to the focused component, exactly as `tab` and `space` do. That is
the whole rule and it needs no exception. *Tests:* "rejects %s as a hotkey key" in
`src/core/__tests__/validation.test.ts` now carries `escape` alongside `tab` and
`space`, and "accepts every key in the host allowlist" pins `HOTKEY_KEYS.size` at
60 and asserts `HOTKEY_KEYS.has('escape')` is `false`.

### Decision 2 — `enter` stays on the allowlist and becomes modifier-required

`enter` is not removed, because `Ctrl+Enter` — "send", "commit", "run" — is the one
genuinely wanted chord in this family, and it collides with nothing. Removing the
key would have taken that with the rest.

A new export sits beside the allowlist:

```ts
/** Keys that may never be bound bare, whatever their length. */
export const HOTKEY_MODIFIER_REQUIRED_KEYS: ReadonlySet<string> = new Set(['enter']);
```

and Decision 5's guard widens by exactly one clause:

```ts
if ((key.length === 1 || HOTKEY_MODIFIER_REQUIRED_KEYS.has(key)) && !ctrl && !alt && !meta) {
```

`shift` satisfies neither half, for two different reasons that happen to agree:
Shift+K still produces a character, and Shift+Enter still activates the focused
control. *Tests:* "validateBlueprint — the activation rule for keys that must carry
a modifier" in `src/core/__tests__/validation.test.ts`, which pins the bare
rejection, shift-alone as a rejection, `Ctrl+Enter` as accepted, and derives its
coverage from `HOTKEY_MODIFIER_REQUIRED_KEYS` itself so a key added to that set is
covered the moment it lands.

### Decision 3 — one rule at one door, and no second suppression at dispatch time

Suppressing bare Enter a second time inside the Phase 2 dispatcher was considered
and **refused**. Two copies of one rule drift, and the drift is silent: whichever
copy is edited, the other keeps enforcing the old rule and the system as a whole
enforces neither predictably. The declaration door is where every chord already
passes, it is where `HOTKEY_KEYS`, the 2.1.4 rule and the uniqueness check already
live, and the check is a `Set` membership test that costs nothing.

This is the same reasoning Amendment A used for validating and storing in one pass,
and Amendment H Decision 6 used for refusing to give `normalizeBlueprint` a view of
the store: a rule evaluated twice is a rule that can disagree with itself.

### Decision 4 — the Enter refusal gets its own message and does NOT cite 2.1.4

**This is the load-bearing part of the amendment, and it is the reason the change
is not two lines.**

Extending the existing 2.1.4 message to cover Enter would have been the smallest
diff and would have been wrong. 2.1.4 is about *character* keys. Enter is not one.
A message telling an author that WCAG 2.2 Success Criterion 2.1.4 forbids their
bare Enter shortcut states something false about the criterion, and it teaches the
author a wrong rule they will carry into their next project.

That is precisely the failure mode Amendment G exists to stop — a citation written
one step wider than what licenses it — and the tenth instance of the pattern would
have been introduced by the fix for issue #8 itself. So the two rules meet at one
`if` and then part company:

| | Refused because | Message names |
|---|---|---|
| `k`, `7` — one character, no modifier | WCAG 2.2 §2.1.4 Character Key Shortcuts, Level A | the criterion, its title and its level |
| `enter` — on the modifier-required list | it **activates the focused control** | the activation, and ADR-0001 Amendment I. **No criterion, no level.** |

`bareChordMessage` in `RegistryContext.tsx` is the branch point, and the split is
asserted in both directions rather than merely written down. *Tests:* "does NOT
cite WCAG 2.1.4 for enter, which is not a character key" asserts the Enter message
contains neither `2.1.4`, nor `Character Key Shortcuts`, nor `Level A`; "leaves the
2.1.4 message alone for a genuine character key" asserts the character-key message
still names `2.1.4` and does *not* name this amendment. A future edit that merges
the two messages fails one of those two cases whichever direction it merges in.

### Consequences

- **Positive.** The allowlist's docblock no longer implies a rule it does not
  apply. `space` and `enter` are now on the same side of the same reasoning, and
  `escape` is absent for a reason stated at the list rather than discovered by a
  user whose dialog stopped closing.
- **Positive.** The change is free today and expensive later, and it was made
  today. No extension exists to break, and ISSUE-005 has not landed.
- **Positive.** `Ctrl+Enter` survives, which is the chord anybody actually wanted
  out of this family.
- **Negative — accepted.** `HOTKEY_MODIFIER_REQUIRED_KEYS` is a second list to keep
  in step with `HOTKEY_KEYS`. It is a `Set` with one member, it is exported so it
  can be asserted rather than trusted, and "holds exactly the keys that activate
  the focused control" pins both its contents and the fact that every member of it
  is a real allowlist key — a member that was not would guard a chord already
  rejected one check earlier and would mean nothing.
- **Negative — accepted.** An extension that wants a bare Escape or a bare Enter
  cannot have one, and there is no escape hatch. That is the same trade Decision 4
  already made for `tab` and `space`.
- **Neutral.** Nothing was dispatched before this amendment and nothing is
  dispatched after it. The Phase 2 dispatcher inherits a smaller and more
  defensible set of chords to route.
- **Housekeeping owed, stated rather than left to be found — and since paid.** The
  count `61` stood in `README.md`, `DEVELOPER.md` and `.github/ISSUES_MANIFEST.md`
  when this amendment was written, and `escape` was named in the allowlist prose of
  the latter two. Those three files were **not** edited here — they were outside
  the change's remit and in other hands at the time — so each carried a stale count
  and a stale key, and the debt was recorded instead of being left for a reader to
  discover. It has since been swept, in all three: no allowlist-context `61`
  survives anywhere, `escape` is gone from every enumeration and appears instead in
  each file's list of deliberately absent keys with the dismissal-key reason
  attached, and the two bare-chord rules are documented apart, with the Enter rule
  citing no criterion as Decision 4 requires. The entry is kept rather than deleted
  because what it records is not the count but the shape: an amendment that changes
  a number owes a sweep of every file repeating it, and the way to make that owed
  work visible is to name the files. The authority was never the prose in any case
  — it is the test: "accepts every key in the host allowlist" in
  `src/core/__tests__/validation.test.ts` pins `HOTKEY_KEYS.size` at 60.

---

## Amendment J — Hotkey dispatch, and narrowing the no-listener invariant to keep it

> **Path note, added with Amendment N.** `src/core/ribbonAction.ts` named below was
> RENAMED to `src/core/command.ts` when the ribbon was deleted; the three functions
> and their behaviour are unchanged. The path is left as written here because this
> amendment is a record of a decision as it was made, and Amendment N is where the
> rename is decided.

**Date:** 2026-07-31 · **Status:** Accepted · **Amends:** Amendment H (which
recorded declaration and validation and deferred the dispatcher), Amendment H
Decision 6 (foreground scoping, now the dispatcher's lookup rule) and Amendment G
(the no-listener claim, whose evidence is narrowed rather than deleted)

### What changed

`src/core/hotkeyDispatch.ts` is new and exports `useHotkeyDispatch(): void`,
called once by `ShellLayout`. `src/core/ribbonAction.ts` is new and holds
`isVisible`, `execute` and `report`, moved out of `RibbonToolbar.tsx` unchanged.
`src/core/hotkeys.ts` gains a fourth pure export, `ariaKeyShortcuts`.
`RibbonToolbar.tsx` emits `aria-keyshortcuts`. `src/__tests__/noEventListener.test.ts`
gains a second allowlist. Nothing about registration, validation, normalisation or
the `Hotkey` contract changed at all: the dispatcher consumes the shape
Amendment H specified, unaltered.

### Decision 1 — the guards were extracted BEFORE the dispatcher was written

`isVisible` and `execute` were module-private in `RibbonToolbar.tsx` while the
button was the only route to a plug-in action. There are now two routes, and
Amendment H Decision 1 licenses the second one in these words: a hotkey is "a
second way to fire *this* `onExecute`, gated by the same `isVisible` and the same
`isDisabled`".

**The whole containment argument turns on the word *same*.** A second copy of those
semantics would drift, and the drift would be silent: a chord that fired for an
action the button would have hidden would be a WIDER route to a plug-in handler
than the ribbon is, and the claim that a hotkey grants no capability the ribbon did
not already grant would simply be false. So the extraction is not tidying — it is
the precondition for the dispatcher being defensible, and it was done and verified
green as its own step. This is Amendment I Decision 3's reasoning ("a rule
evaluated twice is a rule that can disagree with itself") applied to a guard rather
than to a validation. *Tests:* the existing ribbon cases still exercise both
functions through the component — "the context bar hides a command whose isVisible predicate throws and still renders the rest", "treats a non-boolean isVisible result as not visible",
"the context bar survives an onExecute that throws, leaving the surface interactive" — and the
dispatcher exercises the same two through the chord: "does not fire a chord whose
isVisible predicate throws, and reports it once" and "survives an onExecute that
throws, leaving the dispatcher live" in `src/core/__tests__/hotkeyDispatch.test.tsx`.

### Decision 2 — `ShellLayout` owns the listener, not `ShellHostProvider`

`ShellLayout` is host territory above every `ExtensionHostBoundary`, it already
holds `useActivation()` and `useShellContext()`, and it renders the ribbon — so
the button path and the chord path resolve the same foreground extension and the
same action list. A listener in the provider would be live with **no shell
mounted**: a host that wrapped something other than `ShellLayout` in
`ShellHostProvider` would get global chords over a UI with no ribbon and therefore
no way for a user to discover what was bound.

### Decision 3 — bubble phase, and the cost that comes with it

Capture would make the host win over everything below it, including a Radix menu's
own key handling and the Pane 2 list's arrow keys. Bubble lets a component that
deliberately handles a key and calls `stopPropagation()` keep it, which is exactly
what Amendment H Decision 8's view-local `J`/`K` navigation needs.

**The accepted cost, recorded rather than discovered later:** a foreground
extension that calls `stopPropagation()` on `keydown` inside its own pane starves
its OWN chords. It starves nobody else's, because chords are foreground-scoped —
the only actions the dispatcher would have walked are that same extension's. A
plug-in denying itself its own shortcuts is a plug-in bug with a contained blast
radius; capture would have traded that for the host breaking widgets it does not
own, which is not contained.

On a match the dispatcher calls `preventDefault()` and nothing else.
`stopPropagation()` is deliberately absent: `window` is the last stop in the bubble
path, so there is nothing left to stop.

### Decision 4 — foreground-only, which is what makes the lookup total

Amendment H Decision 6 makes cross-extension chord collisions **legal by design**:
two live extensions may both declare `Ctrl+K` and both registrations succeed. A
shell-wide dispatch table is therefore ambiguous by construction — there is no
non-arbitrary answer to "whose `Ctrl+K`?" — and the ambiguity is not a bug to be
fixed at dispatch time, it is the price Decision 6 paid to avoid making
registration order semantically load-bearing and to avoid handing any extension a
squatting attack.

Scoping to `activation.getActive()` is what makes the lookup total again, and it
mirrors the ribbon exactly. `getActive()` re-checks liveness against the registry
rather than trusting the last commit, so a chord stops firing the statement after
`release` or `unregister` rather than at the next render. *Tests:* "does not fire a
background extension chord while another extension is in the foreground", "stops
firing after the extension is released" and "stops firing from the statement after
unregister, without waiting for a commit".

### Decision 5 — the suppression list is a guardrail, and is labelled as one

Before any `matchesHotkey` call, a keystroke is dropped when `defaultPrevented` is
set, when `repeat` is set, when `isComposing` is true or `keyCode` is 229, and when
the target is an editable surface — the three form elements, a `contenteditable`
subtree whose value is not `"false"`, or an ARIA `textbox`/`searchbox`/`combobox`.
The target is checked with `instanceof Element` first, so no property is read off a
non-element.

**This is a guardrail, not a boundary, in exactly the register of "No sandbox"
above.** A plug-in can render a custom editor from a bare `div` with no recognised
role, and a chord will fire into it while the user types. The host does not know
what a plug-in's DOM means and cannot be made to; the remedy available to the
plug-in is `stopPropagation()`, which Decision 3 deliberately leaves working. Two
implementation notes that are easy to get wrong and were: `closest()` walks plug-in
DOM but reads attributes only and invokes no plug-in code, and
`element.isContentEditable` is NOT used — it returns `undefined` in this repository's
jsdom, so a check built on it would pass every test while doing nothing in a
browser. *Test:* the `it.each` table "does not fire while focus is in %s", with
"still fires from an ordinary element, and from contenteditable=\"false\"" as its
other side.

### Decision 6 — `aria-keyshortcuts` is a fourth function, not `describeHotkey`

`aria-keyshortcuts` is defined over UI Events `KeyboardEvent.key` **values** —
`Control`, `Alt`, `Shift`, `Meta`. `describeHotkey` deliberately emits the
**display** spelling, where the control key is `Ctrl`, because that is what a user
reads on a keycap and in a tooltip. `Ctrl` is not a valid key value, so one
function cannot serve both without being wrong for one of them. `ariaKeyShortcuts`
is therefore a separate pure export sharing only the key half, where the two
spellings genuinely agree.

The attribute is emitted on a plug-in action that carries a `hotkey` and is **not
disabled**, on the bar and in the overflow menu alike, and never on a host action.
The omission on a disabled action is not an oversight: the dispatcher skips a
disabled action, so announcing a shortcut on it would be the same lie in the other
direction as the one the pre-ISSUE-006 ribbon avoided by announcing nothing at all.
*Tests:* "spells the control key Control, which describeHotkey deliberately does
not" in `src/core/__tests__/hotkeys.test.ts`; "advertises a chord-bearing command with aria-keyshortcuts, in key values rather than display spelling", "omits aria-keyshortcuts from a disabled command, because the chord will not fire",
"advertises a chord on an overflow menu item too" and "never advertises a chord on a host command" in `src/components/command/__tests__/ContextBar.test.tsx`.

### Decision 7 — narrowing the no-listener scan beat deleting it, and beat pretending

**This is the load-bearing part of the amendment.** ISSUE-004 split
`src/__tests__/noEventListener.test.ts` into two halves and kept the listener half
absolute *on purpose*, saying so in its own docblock: that half was what "no
dispatcher, no evaluation site" rested on, and adding an exception mechanism to it
"would be the change that quietly ends the invariant". ISSUE-006 is that change.
Three options were on the table, which are Amendment G's three routes:

1. **Delete the file.** Rejected. It is the evidence for a claim made in eight
   prose sites, and deleting it at the moment the first ambient key handler lands
   is deleting the evidence exactly when it is worth most.
2. **Leave the title and let it lie.** Rejected outright, and named here because it
   is the cheapest option and the one a hurried change actually takes: keeping
   "with no exceptions at all" on a test that has an exception is the Amendment G
   failure mode in its purest form.
3. **Narrow the claim to what is still true, and re-point every site.** Taken. The
   listener half now consults a one-entry allowlist naming `core/hotkeyDispatch.ts`
   and its exact spellings, checked in both directions like the key-event half. The
   property that survives is the one that matters going forward: there is exactly
   ONE listener in the repository, it is in a named file, and a second cannot appear
   without an edit to this test that a reviewer has to approve.

**And the scan is the weaker half of the new claim, so it is not the whole of it.**
A text scan can see that `addEventListener` appears once and `removeEventListener`
once. It cannot see that the two name the same event, and it cannot see that the
cleanup passes the SAME function reference — a cleanup that rebuilt the closure
would leak one listener per mount while satisfying every count the scan can take.
That pairing is therefore pinned at runtime, by spying on `window` across a mount
and an unmount and comparing handler identity, and again under StrictMode whose
simulated remount must net to a single registration. *Tests:* "finds no listener
registration in any module outside the hotkey-dispatch allowlist", "holds the
hotkey-dispatch allowlist to the exact spellings the dispatcher contains" and
"holds the dispatcher to exactly one addEventListener and one removeEventListener"
in `src/__tests__/noEventListener.test.ts`; "adds exactly one keydown listener and
removes the identical handler on unmount" and "registers once under StrictMode,
whose simulated remount is symmetric" in
`src/core/__tests__/hotkeyDispatch.test.tsx`.

Two test titles changed as a result — the listener scan's and the key-event scan's,
the latter because its allowlist is no longer only about keyboard navigation — and
every prose site citing either was re-pointed in the same change: `README.md`,
`DEVELOPER.md`, `.github/ISSUES_MANIFEST.md`, this file, `src/core/types.ts`,
`src/components/layout/ShellLayout.tsx`,
`src/components/ui/RibbonToolbar.tsx`, `src/core/services/HydrationEngine.ts` and
`src/components/__tests__/ShellLayout.test.tsx`.

### Consequences

- **Positive.** A declared chord now does something, through the same two gates the
  ribbon button passes and through literally the same two functions. Amendment H
  Decision 1's containment argument is now a property of code rather than a promise
  about future code.
- **Positive.** The repository still has exactly one event listener, and it is
  harder to add a second than it was before: the source scan has to be edited, and
  the runtime pairing test has to keep passing.
- **Positive.** `aria-keyshortcuts` finally appears, and appears only where it is
  true.
- **Negative — accepted.** A foreground extension that stops `keydown` propagation
  starves its own chords. See Decision 3; the alternative starves other people's
  widgets.
- **Negative — accepted.** The suppression list does not recognise a plug-in's
  home-made editor. See Decision 5. It is labelled a guardrail everywhere it is
  described, including in `DEVELOPER.md`, where the author who could actually fix
  it will read it.
- **Negative — accepted.** The no-listener invariant is now defended by an
  allowlist rather than by an absolute rule, and an allowlist is a thing that can
  be extended. The mitigations are that it is exact in both directions, that it has
  one entry, and that the runtime pairing test does not care what the allowlist
  says.
- **Neutral.** `hotkeyToken` is still the deduplication key at registration and is
  still not a dispatch lookup key: the dispatcher walks the foreground extension's
  actions and calls `matchesHotkey`, because Decision 6 of Amendment H means there
  is no unambiguous table to look a token up in. The token's second use, forecast in
  Amendment H Decision 7, did not arrive and is not needed.

---

## Amendment K — The contract-hardening wave: multi-selection, context keys, and one deliberate removal

**Date:** 2026-08-01 · **Status:** Accepted · **Amends:** Amendment C
(`Object.keys(api)` is "exactly the three `IShellAPI` members"), Amendment D (the
`patchContext` validation table, whose `focusedPane` row is removed) and
Amendment G (which is the rule this amendment is written to satisfy, not one it
changes)

### What changed

`IShellAPI` went from **three members to seven**: `setSelectedItems`,
`setActiveNavNode`, `getBadgeCount` and `setContextKey` join `setSelectedItem`,
`setBadgeCount` and `getContext`. `RibbonContext` gained `selectedItemIds` and
`contextKeys`, made `selectedItemId` a derived read, and **lost `focusedPane`**.
`NavigationNode` gained an optional `icon`. The ribbon's icon table moved to
`src/components/ui/shellIcons.tsx` as `SHELL_ICONS` and is now published in
`DEVELOPER.md`. Every host constant is frozen. Seven GitHub issues (#10, #12,
#13, #14, #15, #18, #19) land as one change, because five of them touch the shape
of `IShellAPI` and doing the "three members" documentation sweep once is
materially safer than doing it five times.

### Decision 1 — multi-selection is a first-class field, and the two alternatives are recorded so they are not re-proposed

`RibbonContext.selectedItemId: string | null` cannot express a multi-selection. A
list pane whose user has shift-clicked six rows had exactly one thing it could
tell the ribbon, and a plug-in had no way to make the ribbon re-evaluate from its
own state at all. Two designs were considered and **both were rejected**:

1. **An `invalidateRibbon()` signal**, letting a predicate read mutable plug-in
   module state and asking the host to re-render when that state moved.
   **Rejected: predicates run during render.** A predicate reading mutable
   external state reintroduces exactly the tearing `useSyncExternalStore` exists
   to prevent — two panes evaluating the same predicate at two points in one
   commit can read two different values, and the contract requires pure
   predicates for that reason. The signal would also have made "pure" mean
   "does not write", when the problem is reading something that is not the
   argument.
2. **A generic opaque `extensionState` blob on the context.** **Rejected on two
   grounds.** It becomes a dumping ground — there is no answer to "what may go in
   it?", so everything does. And an unvalidated opaque field is against the grain
   of a codebase that validates every untrusted value once, at the door, and
   stores a host-owned copy; a blob has no validation story, and an object in it
   carries getters that fire inside a render-phase predicate read and a prototype
   chain one extension can reach through into another's code.

What landed instead: `selectedItemIds: readonly string[]` as the **single source
of truth**, with `selectedItemId` becoming the LAST element or `null`. One
writer — `applyPatch` — recomputes the derived field inside the same draft, so no
notification can ever carry the two disagreeing. `selectedItemId` stays on the
interface and stays writable as a shorthand for a selection of one, because a
great deal of code and documentation reads it and single selection is the common
case; a patch naming both is resolved by precedence rather than refused, because
`patchContext(store.getContext())` names both and must be an exact round trip.

The array is untrusted input and is handled in this codebase's established idiom:
length captured once, each element read exactly once into a host-owned array, and
that array validated, frozen and stored — the discipline `normalizeNavigationNode`
already applies to a registered tree, so a `Proxy` reporting one length while it
is measured and another afterwards cannot grow what the host holds.
`REGISTRY_LIMITS.MAX_SELECTED_ITEMS` bounds it.

**Duplicates are REJECTED, not collapsed**, and the choice is recorded because
either would have been defensible. Deduplicating silently returns a selection of a
different length from the one the caller asked for, which is the same class of
failure `assertValidSelectedItemId` refuses to create by coercing a bad id to
`null`: a selection that mysteriously differs from the one you set is worse to
find than an exception at the call site.

`publishForeground` clears `selectedItemIds` in the SAME single patch that clears
`selectedItemId` and `activeNavNodeId`, so no subscriber observes a torn state.

*Tests:* the "setSelectedItems validates its argument" group in
`src/core/__tests__/shellApi.test.ts`; "patchContext rejects what setSelectedItems
rejects", "derives selectedItemId from the last element of selectedItemIds", "lets
selectedItemIds outrank selectedItemId in one patch" and "does not notify when a
selection is rewritten with the ids it already holds" in
`src/core/__tests__/contextPatch.test.ts`.

### Decision 2 — context keys are the general mechanism, and `selectedItemIds` is deliberately not an instance of it

Decision 1 answers selection. It does not answer the question underneath it:
**every time a plug-in needs the ribbon to react to something the host does not
model, does the host grow another `RibbonContext` field?** That does not scale,
and `selectedItemIds` would have been the first of many.

The prior art is named plainly because the shape is deliberately the same one:
**VS Code's `when` clauses over context keys**. An extension publishes named
values through the host; visibility expressions read them. That preserves the
purity guarantee which killed `invalidateRibbon()` — the predicate is still a pure
function of its argument, because the value went through the store and is part of
the same snapshot every other subscriber holds.

`IShellAPI.setContextKey(key, value)` writes one, and
`RibbonContext.contextKeys` publishes them. The design turns on four constraints:

- **The value type is `string | number | boolean | null` and nothing else.** This
  is what distinguishes a context key from the opaque `extensionState` blob
  rejected in Decision 1, and it is not a limitation waiting to be lifted. A
  primitive costs one `typeof` to validate, invokes nothing when it is read,
  carries no prototype another extension can reach through, and compares with
  `Object.is` — which is what makes the unchanged-write bail-out possible at all.
  A `number` must be finite: `NaN` and `Infinity` are values a predicate cannot
  branch on usefully.
- **The key is a host lookup key** and is held to `EXTENSION_ID_PATTERN` and
  `RESERVED_IDS`, exactly as a badge node id is. The published record is built on
  `Object.create(null)` regardless, so there is nothing to pollute even if that
  filter were wrong — the same belt-and-braces relationship Amendment F describes
  between the registry's `RESERVED_IDS` check and its `Map` stores.
- **The scope is closure-captured**, exactly as `setBadgeCount`'s is. An extension
  writes only into its own namespace and has no parameter with which to name
  another's. **That is collision-resistance, not confinement**, in the same
  register Amendment C uses for badges: the published record is the FOREGROUND
  extension's, and anything holding a context can read it. Stated in
  `DEVELOPER.md` in those words, because the honest version of this is the useful
  one.
- **Notification follows the store's existing discipline.** A key that moves
  notifies, so the ribbon re-evaluates; a key rewritten with the value it already
  holds does not, and neither does a background extension's write, because only
  the foreground's namespace is published and the context therefore did not move.

Keys are cleared on every real foreground handover, in the same single patch as
the selection and the nav node, and every namespace is dropped rather than only
the outgoing one. This is the bug class `publishForeground` was fixed for and it
would have been worst here: a predicate is a pure function of the context, so a
stale key from the previous vendor is indistinguishable to it from one this vendor
set. The clearing is split into a store-state half (`clearContextKeys`, which
deliberately neither patches nor notifies) and a published half (`contextKeys: {}`
inside the handover patch), because store state cannot be cleared from inside a
context patch and doing it afterwards would leave a window where the two
disagreed.

**`selectedItemIds` is NOT re-expressed as a context key, and that is the line
between the two.** Selection is a host concept: the shell renders it, hands it to
`onExecute`, clears it on handover and reasons about it. A context key is
plug-in-private state the host stores and republishes without understanding.
Collapsing the first into the second would make the host unable to say anything
about selection at all.

*Tests:* `src/core/__tests__/contextKeys.test.tsx` — "setContextKey validates its
value", "patchContext rejects what setContextKey rejects", "keeps two extensions'
context keys apart, and publishes only the foreground's", "clears every
extension's context keys on a foreground handover", "does not notify when a
context key is rewritten with the value it already holds", "does not notify for a
background extension's own context key" and "carries the cleared record in the
same single notification as the rest of the handover".

### Decision 3 — `setActiveNavNode`, and one path rather than two

`activeNavNodeId` was writable only by the host's pane-1 click handler, through a
raw `patchContext`. An extension could not navigate at all. The new member and
that handler now both go through **one** store member, `setActiveNavNode`, which
is Amendment J Decision 1's argument about `isVisible` applied to a field: two
routes to one thing must not be two copies of one rule.

`nodeId` **is** a host lookup key, unlike `setSelectedItem`'s `id`, so it is held
to the registry's allowlist and reserved words. It is deliberately **not** checked
against the calling extension's own tree: `activeNavNodeId` is one host-wide
field, the host clears it on every handover, and an extension naming a node it
does not own gets a value none of its own rendering will match — the same posture
`setSelectedItem` takes toward an invented item id. *Test:* "setActiveNavNode
validates its argument" in `src/core/__tests__/shellApi.test.ts`.

### Decision 4 — `getBadgeCount` is scoped by the closure, because a scoped write with an unscoped read is not a scope

`setBadgeCount` existed and `getBadgeCount` did not, so an extension that wanted
to increment its own count had to keep a shadow copy. The read half is scoped by
the same closure-captured `extensionId` the write half is, and takes no scope
parameter. A read half that took one would have handed every extension every other
extension's badges **through the documented API** — a strictly wider capability
than the write half it mirrors, and a widening nobody asked for. *Test:* "reads
back only its own scope, and offers no parameter to name another" in
`src/core/__tests__/dataflow.test.tsx`.

### Decision 5 — freezing the host constants, and exactly what a frozen `Set` is worth

`EXTENSION_ID_PATTERN`, `RESERVED_IDS`, `REGISTRY_LIMITS`, `HOTKEY_KEYS` and
`HOTKEY_MODIFIER_REQUIRED_KEYS` are the rules every untrusted payload is measured
against, and all five were runtime-mutable. `REGISTRY_LIMITS` was `as const`,
which is a **compile-time** assertion binding nobody who is not being compiled.
All five are now `Object.freeze`d.

**The claim is stated narrowly on purpose, because the obvious wider version is
false.** Freezing buys, unconditionally, that no own property can be added,
replaced or deleted: `REGISTRY_LIMITS` becomes genuinely immutable, and for the
`Set`s and the `RegExp` it means `has` and `test` cannot be **shadowed** by an own
property — which was the interesting attack, since a plug-in owning
`HOTKEY_KEYS.has` owned the hotkey allowlist for the whole page.

It does **not** make a `Set` immutable. `Set` state lives in internal slots rather
than in properties, so `Object.freeze(set)` leaves `add`, `delete` and `clear`
working, and `HOTKEY_KEYS.add('tab')` still widens the allowlist. Closing that
would mean shipping a `Set` whose mutators throw — a different object from the one
`ReadonlySet` describes — and it was not done. This is the same register as "No
sandbox": hardened against replacement, not against a determined caller. Both
halves are asserted rather than one, by "freezes the host constants against
replacement" and "does not claim more than a frozen Set delivers" in
`src/core/__tests__/hostConstants.test.ts`, the second of which demonstrates the
mutability on a throwaway `Set` so that no real allowlist is left widened behind
it.

### Decision 6 — `focusedPane` is deleted, not populated

`RibbonContext.focusedPane` was declared `PaneId | null`, was validated, and was
written by nothing: permanently `null` for the whole life of the field. ISSUE-002
recorded that as a known limit and `DEVELOPER.md` warned authors about it, which
is documentation of a defect rather than a fix for one.

**A field that is permanently null is worse than an absent one, because it looks
available.** It invites predicates that can never fire, and the author gets no
error — just an action that never shows. The alternative was to populate it, which
needs focus tracking the shell deliberately does not do (it would be a second
ambient listener, against the invariant Amendment J went to some trouble to keep
narrow). So it is removed: from `RibbonContext`, from the `CONTEXT_FIELDS`
validator table, from `assertValidPaneId`, and from every document that described
it.

**Two things survive it, and the second was nearly deleted by mistake.** `PaneId`
remains as a layout type — `PaneWrapper`, `ShellLayout`'s resize bookkeeping,
`HydrationEngine.PaneSizes`. And `PANE_IDS`, the runtime membership set, turned
out to have a second consumer unrelated to the field it was built for: "covers
exactly the pane ids the host declares" in
`src/core/services/__tests__/hydrationEngine.test.ts` checks the engine's
pane-size record against it. Deleting it would have forced that test to restate
the union in its own words, which is exactly the drift the pin exists to prevent,
so it stays and its docblock now says why.

The `focusedPane` cases in `contextPatch.test.ts` were **re-pointed rather than
deleted**. The properties they held — a patch value is validated before it reaches
the snapshot, and a rejection never stringifies what it is rejecting — are
unchanged; they now hold against `selectedItemIds`, which is a strictly harder
case, because a collection can refuse to report its length, refuse to yield an
element, and carry a hostile value at any index.

### Decision 7 — `NavigationNode.icon`, one icon table, and a published vocabulary

The collapsed 48px pane-1 track drew a monogram — the first letter of the label —
so `DatabasePlugin`'s Components / Assemblies / Consumables rendered as "C A C".
`NavigationNode.icon` is optional, validated in the nav-node normaliser beside
`badgeCount` and held to exactly what `RibbonAction.icon` is held to.

The icon table was module-private in `RibbonToolbar.tsx`. It moved to
`src/components/ui/shellIcons.tsx` as `SHELL_ICONS` **with its `Map` semantics
intact** — a `Map` specifically so a prototype-shaped key cannot resolve to
something inherited — because two surfaces resolve an icon key now and two copies
of a lookup table drift the way two copies of a validation rule do.

Three outcomes are kept distinct, deliberately: a known key draws its glyph, an
**unknown** key draws the host fallback, and **no key at all** keeps the monogram.
A mistyped key and an undeclared icon are different situations and must not render
identically.

The vocabulary is published in `DEVELOPER.md` (issue #18). The fallback stays —
guessing wrong should not break a ribbon — but a soft landing with no way to
discover the real keys is a vendor guessing forever. The list is machine-checked
against the map in both directions by "publishes every icon key in DEVELOPER.md,
and no key it does not have" in
`src/components/__tests__/ShellLayoutIcons.test.tsx`, so it cannot go stale by
omission and cannot document a key that does not exist.

### Consequences

- **Positive.** A plug-in can express a multi-selection, navigate, read its own
  badges, and drive ribbon visibility from its own state — the last through a
  mechanism rather than through a bespoke field per need.
- **Positive.** `selectedItemId` can no longer disagree with the selection,
  because it is not stored beside it.
- **Positive.** The host constants can no longer have their interrogation methods
  replaced, and the limit of that is written down rather than assumed away.
- **Negative — accepted.** `IShellAPI` is more than twice the size it was, and
  every member is a capability handed to untrusted code. The mitigation is that
  each of the four additions was argued for individually above, and that
  `dataflow.test.tsx` asserts the LITERAL member list rather than a count, so an
  eighth cannot arrive quietly.
- **Negative — accepted.** `contextKeys` published in a single host-wide snapshot
  means a backgrounded extension can READ the foreground extension's keys. It
  cannot write them. This is the badge posture and it is documented as
  collision-resistance rather than confinement.
- **Negative — accepted.** A frozen `Set` is still `add`-able. See Decision 5.
- **Neutral.** `PANE_IDS` outlived the field it was created for and is now
  justified by a different consumer. Its docblock says so, rather than leaving a
  reader to assume it is dead.

---

## Amendment L — The structured payload channel: Amendment K Decision 2's three objections, answered rather than reversed

**Date:** 2026-08-02 · **Status:** Accepted · **Amends:** nothing. It **extends**
Amendment K Decision 2, and is written to satisfy Amendment G.

### Context

`docs/plans/native-host-pivot.md` §4.2 requires pane 3 to carry structured data —
a chart spec, a table, a form, an agent block — from the extension that owns it to
the surfaces that render it. `ContextKeyValue` cannot carry any of those: it is
`string | number | boolean | null`, and its docblock says why in three clauses.

**The obvious move is to widen `ContextKeyValue`, and it is the wrong one.** An
amendment that silently contradicts an older one is the failure Amendment G was
written to stop, and Decision 2 states plainly that the primitives-only rule "is
not a limitation waiting to be lifted". So this amendment does not lift it. It
adds a **different channel**, and answers each of Decision 2's objections in
turn — because every one of those objections is a statement about *a live
caller's object reaching a render path*, and none of them is a statement about
structure.

### The three objections, quoted

`src/core/types.ts`, on `ContextKeyValue`:

> An object would carry getters that re-enter host code during a render-phase
> predicate, a prototype another extension could reach through, and an identity
> no `Object.is` bail-out could compare; a primitive carries none of those and
> costs one `typeof` to validate.

Amendment K Decision 2, on the same rule:

> **The value type is `string | number | boolean | null` and nothing else.** This
> is what distinguishes a context key from the opaque `extensionState` blob
> rejected in Decision 1, and it is not a limitation waiting to be lifted. A
> primitive costs one `typeof` to validate, invokes nothing when it is read,
> carries no prototype another extension can reach through, and compares with
> `Object.is` — which is what makes the unchanged-write bail-out possible at all.

### Decision 1 — answering "getters that re-enter host code during a render-phase predicate"

**The payload never enters `RibbonContext`.** It lives in
`createPayloadChannelStore()`, a second store with its own lifetime, created
beside `createShellStateStore()` in `ShellHostProvider` and reachable only through
the three new `IShellAPI` members.

That is a fact about the object graph rather than a convention, in three layers.
(The word *structural* is deliberately not used for it: Amendment F reserves that
for the `Map`-backed stores, and layer 2 below is a compile-time property rather
than a property of a data structure.)

1. `ShellStateStore.getContext()` returns one closure variable, `context`, and the
   payload store is not it.
2. `CONTEXT_FIELDS` in `ShellAPI.ts` is `Record<keyof RibbonContext, …>` — the
   compiler rejects both a missing field and an invented one — so a payload could
   not become a context field without somebody deciding, in that table, what a
   legal value for it is and what host-owned form it is stored in.
3. `isVisible(ctx)` is handed a `RibbonContext` and nothing else. There is no
   argument through which to reach a payload, and no member on the context that
   returns one.

The publisher's getters therefore run **exactly once**, inside `copyValue`, at an
imperative door that is never on a render path. *Tests:*
`src/core/__tests__/payloadChannel.test.tsx` — "a published payload never enters
the context, and publishing does not move the snapshot", which asserts that the
context snapshot keeps its identity across a publish and that its keys are exactly
the five `RibbonContext` fields; "an isVisible predicate has no argument through
which to reach a payload"; and "runs the publisher's getters exactly once, at the
imperative door".

### Decision 2 — answering "a prototype another extension could reach through"

**The host takes a deep copy and retains nothing of the caller's object graph.**
Every record is a fresh `Object.create(null)`, every array a fresh frozen array,
and every leaf a primitive that has been type-checked. There is no prototype on
what is stored, so there is no chain to walk back through, and a `__proto__` key
arriving in a payload is an ordinary own property of a prototypeless record that
pollutes nothing.

This is the discipline `normalizeNavigationNode` already applies to a manifest,
applied to an arbitrary graph: every read happens exactly once into a local, the
local is what is both checked and stored, and every read is guarded so that a
publisher's throwing trap becomes a `ShellUXError` naming the path rather than a
raw `TypeError` escaping a `@throws {ShellUXError}` function.

It is an **integrity control** in this repository's vocabulary — real and
unconditional for anything arriving through this door — and it is deliberately not
a claim about what a plug-in can reach by other means. ADR-0001 "No sandbox" and
Amendment E are unchanged. *Tests:* same file — "takes a null-prototype deep copy,
so a __proto__ key pollutes nothing", "retains nothing of the publisher: mutating
the source afterwards changes nothing", "refuses every leaf that is not a
PayloadLeaf, by type rather than by coercion", "turns a payload that refuses to be
read into a rejection, not a raw TypeError" and "captures an array length once,
and refuses a length that is not a count".

### Decision 3 — answering "an identity no `Object.is` bail-out could compare", and the cost of that answer

**Subscribers compare `StructuredPayload.revision`, a host-assigned strictly
increasing number, and never the object.** The host builds one frozen copy per
publish and hands that same object back until the channel is republished, which is
what makes `readPayload` safe as a `useSyncExternalStore` snapshot.

**The cost is stated rather than glossed, because Amendment G is the reason this
document exists: republishing byte-identical content DOES bump the revision and
DOES notify.** The host does not deep-compare payloads — a walk over 4096 nodes on
every publish would cost more than the re-render it saves — so the field-by-field
bail-out `applyPatch` performs has no analogue here, and a publisher that
republishes in a loop wakes its subscribers in a loop. That is a real difference
from a context key, and it is the honest price of the deep copy that answers
Decision 2: two host-built copies of one payload are never `Object.is`, so
identity was never going to be the comparison. *Test:* same file — "bumps the
revision and notifies even when the republished content is identical".

The revision is store-wide rather than per channel. Monotonic per channel follows
from monotonic overall, and the stronger property is worth having: a pane-3 block
reading a chart channel and a table channel can tell which arrived last without
the host inventing a clock. *Test:* "keeps the revision monotonic across channels,
so two blocks are comparable".

### Decision 4 — the bounds the primitive rule bought for free are now paid for explicitly

A primitive is bounded by `typeof`. A graph is not. `PAYLOAD_LIMITS` therefore
bounds depth (6), nodes (4096), host-accounted bytes (262144) and channels per
extension scope (32).

It is **its own record rather than four more keys on `REGISTRY_LIMITS`**, and the
split is a real one: `REGISTRY_LIMITS` bounds what arrives through the registry's
door, once, at registration, on a manifest; these bound what arrives through an
imperative door, repeatedly, at runtime, from an already-registered extension.
There is no value in one being raisable by an edit aimed at the other.

**A cycle is REJECTED, never truncated.** Truncating always succeeds, which is
exactly what makes it wrong: the subscriber receives a payload the publisher did
not write, cannot distinguish it from one that was, and the publisher is never
told. A repeated *sibling* is not a cycle — `{ a: shared, b: shared }` is a
directed acyclic graph with a finite copy — so cycle detection is over the current
path and not over everything the walk has seen. *Test:* "rejects a cycle rather
than truncating it, and copies a repeated sibling".

Size is accounted by the host during the copy walk rather than by serialising in
order to measure. `JSON.stringify` would run a `toJSON` the publisher wrote, throw
outright on a cycle before the cycle check could report it properly, and allocate
a second copy of the very thing being bounded. What a bound needs is to be
deterministic, monotonic in the payload and impossible for a publisher to game;
the accounting in `SIZE_OF` is all three, and it is not claimed to be a JSON
encoding.

### Decision 5 — no new `ShellUXErrorCode`

The existing ten cover every rejection this door decides on: `INVALID_ID` for a
channel name, `INVALID_FIELD` for a shape, an unknown kind, a non-`PayloadLeaf`
leaf, a cycle and a refused read, `PAYLOAD_TOO_LARGE` for every bound, and
`REVOKED` from the facade. `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts` is
compiler-pinned, so widening the union is a change every reader of it would have
to be told about — for no gain, since no caller could branch on a new code more
usefully than on those three plus the `field` path the rejection already carries.

### Decision 6 — the disposer is total, and liveness is checked when the subscription is taken

`subscribePayload` throws `REVOKED` like every other member. **The function it
returns throws nothing, ever, including after revocation.** That asymmetry is
deliberate: a pane-3 view unmounts *after* its extension is unregistered in the
ordinary teardown order, and React calls an effect cleanup with nowhere to raise
to — a throwing disposer would take the tree down during unmount, which is a worse
failure than the one it would be reporting. Liveness is checked when the
subscription is *taken*, which is a call the extension makes and can be reported
to. *Test:* "returns a disposer that is total, so unsubscribing after revocation
throws nothing".

### Decision 7 — both verification remotes are migrated onto it in the same change

`MailPlugin.tsx` and `DatabasePlugin.tsx` kept **module-scope stores** because the
host carried only an id between their panes, and a module-scope store is correct
in exactly one process. Under the process split `docs/plans/native-host-pivot.md`
§3.2 describes, the module loads twice: the static seeds still resolve, so pane 3
*looks* right on first paint, and every `commit` in pane 2 becomes invisible to
pane 3 with nothing to say why. A verification remote that would fail silently
under the architecture it exists to verify is not verifying it.

Migrating them is therefore part of this amendment rather than follow-up work, and
it is what makes the channel a *used* mechanism rather than a declared one.

### Consequences

- **Positive.** Pane 3 can carry structured data, and the rationale that refused
  it in `RibbonContext` is intact and is now cited by the thing that answers it.
- **Positive.** The two verification remotes stop depending on single-process
  module scope, so a future process split is a transport change rather than a
  rewrite of both mocks.
- **Negative — accepted.** `IShellAPI` grows from nine members to twelve, and
  every addition is a capability handed to untrusted code. The mitigation is
  unchanged from Amendment K: each was argued for above, and `dataflow.test.tsx`
  asserts the LITERAL member list, so a thirteenth cannot arrive quietly.
- **Negative — accepted.** An identical republish notifies. Decision 3 says so, and
  so do the interface docblock and the module banner.
- **Negative — accepted.** The host now holds a second copy of every published
  payload, bounded by `MAX_BYTES` × `MAX_CHANNELS` per extension scope. That is
  the price of retaining nothing of the publisher's graph, and the alternative —
  holding the publisher's object — is what Decision 2 refuses.
- **Neutral.** `PayloadLeaf` is an alias of `ContextKeyValue` rather than a second
  spelling of the union, so widening one widens both and forces the review.

---

## Amendment M — `normalizeTheme` and `ThemeBridge`: a theme is untrusted input reaching a stylesheet, and its contrast is not measured

**Date:** 2026-08-02 · **Status:** Accepted · **Amends:** nothing. It **extends**
Amendment K Decision 5 (the host constants are frozen; `SEMANTIC_TOKEN_NAMES` is
the newest of them) and is written to satisfy Amendment G.

**Separate from Amendment L on purpose.** L answers a rationale in `types.ts`
about what may travel between panes; this answers a different question — what may
reach a stylesheet — and folding the two together would make one amendment that
neither of the two rationales could be checked against.

### Context

`docs/plans/native-host-pivot.md` §3.6 puts a generative token pipeline behind the
shell's colours and says two things that turn into code here. First: a canvas
cannot read a CSS custom property, so anything painting on one has to be handed
resolved values, and resolving them per chart is one forced style recalculation
per chart per frame. Second: a third-party theme is untrusted input arriving at a
stylesheet, so it needs a trust boundary in the shape `normalizeNavigationNode`
already has.

### Decision 1 — the keys are the host's, and a candidate's key list is never obtained

`normalizeTheme` walks `SEMANTIC_TOKEN_NAME_LIST` — the host's own list, from the
generated contract — and asks the candidate for each name in turn. It never calls
`Object.keys` on the candidate and never iterates it.

The consequence is stronger than a filter, and it is why it is written this way:
a theme naming `--gray-7`, `--accent-9` or `__proto__` is not *rejected*, it is
**never read**. There is no code path on which a key outside the semantic tier is
looked at, so the primitive tier is out of a third-party theme's reach.

**That is an INTEGRITY CONTROL, and this paragraph deliberately does not call it
*structural*.** An earlier draft did, and cited Amendment F's `Map`-store
comparison while doing so — which is the exact drift Amendment F closed and
`RegistryContext.tsx` still carries a correction about. *Structural* is reserved
for a property of the data structure, holding whatever the code does; not
iterating the candidate's keys is bought by a loop that runs. Real and
unconditional for anything arriving through this door, and bought by code. The one
half of this function that IS structural is the container: the record is built on
`Object.create(null)` and frozen, so there is no prototype to pollute whatever the
loop does. *Test:*
`src/core/theme/__tests__/normalizeTheme.test.ts` — "reads only the host's own
token names, so a primitive-tier key is never looked at", which installs getters
on four out-of-contract names and asserts that none of them runs.

### Decision 2 — the values match an allowlist, they do not survive a denylist

A denylist over CSS is a losing game. `;`, `}`, `/*`, `url(`, `expression(`, a
`\3b` escape, a newline, a full-width `；` — the list is open-ended and the
attacker picks last.

`THEME_VALUE_PATTERN` is closed instead. A value is a hex colour of 3, 4, 6 or 8
digits, or an `oklch()` with numeric components and an optional alpha, or a
non-negative `px`/`rem` length — and nothing else is a value. There is no
alternative in the grammar containing a semicolon, a brace, a quote, a backslash,
a newline or a parenthesis outside `oklch(`, so "a value cannot carry a CSS
statement" is a property of the grammar rather than a claim about a filter.
*Test:* same file — "refuses a value carrying a CSS statement terminator, in every
spelling tried", which walks seventeen spellings.

**Absent fills, supplied-and-illegal rejects.** A name the theme omits takes the
base theme's value; a name it supplies with a value outside the grammar is
`INVALID_FIELD`. That is the asymmetry `normalizeNavigationNode` draws between an
absent optional field and a present bad one, and it is chosen for the reason
`assertValidSelectedItemId` refuses to coerce: silently substituting for a value
the author actually wrote produces a theme that ignores half of what was asked for
with nothing to look at. *Test:* "refuses a supplied value that is not a string at
all, rather than filling from the base".

The rejected value is deliberately **not** interpolated into the error message. It
has just failed the grammar, which is exactly the case in which putting it
somewhere a console or a log will render it is the wrong move.

### Decision 3 — one `getComputedStyle` per theme change, never one per reader

`ThemeBridge` resolves the whole semantic set with exactly one
`getComputedStyle(root)` call, freezes the record, and hands that same object to
every reader until the theme changes. `IShellAPI.getTheme()` and
`IShellAPI.onThemeChange()` are the extension-facing half, deep-frozen and
revocable like every other member.

The stable identity is load-bearing rather than tidy: a chart theme is memoised on
the record, and a `getTheme` that resolved on demand would both reintroduce the
per-reader recalculation and hand a different identity to every caller. *Test:*
`src/core/theme/__tests__/themeBridge.test.ts` — "resolves the whole semantic set
with exactly one getComputedStyle call", which asserts the CALL COUNT across
twenty reads and one refresh.

**The disposer `onThemeChange` returns is total**, for the reason Amendment L
Decision 6 gives about `subscribePayload`: a view unmounts after its extension is
unregistered, and React calls an effect cleanup with nowhere to raise to. Liveness
is checked when the subscription is taken. *Test:*
`src/core/__tests__/themeApi.test.ts` — "returns a total theme disposer, so
unsubscribing after revocation throws nothing".

### Decision 4 — two postures towards an illegal value, and the difference is the caller

`normalizeTheme` **rejects**; `ThemeBridge`'s document resolve **falls back**.

That is not an inconsistency. `normalizeTheme`'s caller is an extension at an
imperative door, where a rejection can be reported to the party that made the
mistake. The document resolve's caller is a theme change, where there is nobody to
report to and a throw would take the shell down over a stylesheet the host itself
shipped — the same asymmetry `ActivationContext`'s sweep effect draws when it
guards the one call site a host cannot guard for itself.

The fallback is not a hole. Everything a document can define arrived either from
the generated stylesheet, which `npm run tokens:check` measures, or through
`normalizeTheme`, which applies the same grammar with teeth. A value that fails at
the document is evidence one of those two doors was bypassed, and the safe answer
to that is to report nothing for that name rather than to take the shell down.
*Test:* `src/core/theme/__tests__/themeBridge.test.ts` — "falls back to the seed
rather than throwing, for a document property outside the grammar", which asserts
both halves against the same value.

### Decision 5 — a third-party theme's CONTRAST IS NOT MEASURED, and this amendment says so instead of implying otherwise

§3.6 says a theme is "**rejected if it fails the contrast manifest**". **That is
not implemented, and nothing in this change claims it is.**

What exists is `design/check-contrast.mjs`: it measures
`design/contrast-manifest.json` against the generated stylesheet, in Node, at
build time, over the three built-in themes. It is `npm run tokens:check`, it is a
stage of `npm run verify`, and it never sees a third-party theme. Wiring it into
`normalizeTheme` means the contrast maths crossing into the browser bundle, and
`design/` is not on the TypeScript project's include path — so it is a real piece
of work rather than an import.

The honest statement, which is the one written in `normalizeTheme.ts`'s banner and
in `IShellAPI.getTheme`'s docblock: **a third-party theme is held to the key
allowlist and the value grammar, and its contrast is measured by nothing.** A
theme whose surface and text both resolve to near-black is accepted and is
unreadable.

That gap is recorded here as **accepted and outstanding**, and it is pinned in the
direction that is TRUE rather than the direction that would be reassuring: *test*
— "accepts a legal theme whose contrast is terrible, because contrast is not
measured here", in `src/core/theme/__tests__/normalizeTheme.test.ts`. A test that
asserts the gap is what stops the gap being closed by prose.

### Decision 6 — `EMPTY_THEME` has complete keys and no values, because the host does not invent a colour

`getTheme()` is declared to return a value for every name in the contract. A
document that defines none of them — jsdom, or a pane whose stylesheet has not
been injected yet — would otherwise make that declaration a runtime lie.
`EMPTY_THEME` answers only that: the KEYS are complete and every VALUE is the
empty string.

**The first draft filled it with a placeholder colour, and the repository's own
rule caught it.** `src/__tests__/noRawColor.test.ts` reports a CSS colour literal
in any module outside its one-entry allowlist, and the module that has that entry
— `RootBoundary` — earns it twice over: it is the last thing between a throw and a
blank window, and its contrast is measured from those very literals. A placeholder
here would earn neither. It would be an untokenised colour in `src/`, invisible to
`design/contrast-manifest.json` and to `npm run tokens:check` — the second,
unreviewed design system that rule exists to stop, arriving in the module whose
whole subject is the token contract.

So the empty string is the honest answer and it means exactly one thing: the
document defines nothing for that name. It is deliberately **not** legal by the
value grammar, so it can never be something a third-party theme supplied — only
something the host reports when it has nothing to report, and a reader that paints
has to decide what to do about it rather than be handed a colour nobody chose.

"Missing keys fill from the built-in theme" is delivered through
`normalizeTheme(candidate, base)`'s **base parameter**, which `ThemeBridge` passes
the currently resolved theme — the built-in one, live from the stylesheet that
`npm run tokens:check` measures. This constant is only what a document defining
nothing at all yields. *Test:* same file — "covers every name in the contract and
invents a value for none of them".

### Consequences

- **Positive.** A canvas can be handed resolved token values without one forced
  style recalculation per chart, which is the prerequisite for §3.3's tier 1 and
  tier 2.
- **Positive.** A third-party theme cannot reach the primitive tier and cannot
  carry a CSS statement into a stylesheet. Both are integrity controls bought by
  the code in `normalizeTheme`; neither is claimed as *structural*, which
  Amendment F reserves for the `Map`-backed stores. See Decision 1.
- **Negative — accepted and OUTSTANDING.** A third-party theme's contrast is not
  measured by anything. Decision 5.
- **Negative — accepted.** `IShellAPI` grows from twelve members to fourteen.
  `dataflow.test.tsx` asserts the literal member list, so a fifteenth cannot
  arrive quietly.
- **Neutral.** `ThemeBridge.refresh` and `ThemeBridge.applyTheme` have no
  production caller yet: the shell has no theme picker, §3.6 describes one, and
  the mechanism landed before the control. That is stated in the members' own
  docblocks rather than left for a reader to infer from a call-graph search.

---

## Amendment N — The ribbon is deleted, and one command registry stands where it stood

**Date:** 2026-08-02 · **Status:** Accepted · **Amends:** Amendment H Decision 1,
Amendment J, and the render-boundary paragraph of `types.ts`

### Context

`docs/plans/native-host-pivot.md` §3.4 deletes the ribbon and replaces it with one
command registry projected onto four surfaces: a 32px context bar, a Cmd-K
palette, a selection-triggered floating toolbar inside pane 3, and a docked
omnibox composer. §11 item 1 refuses a ribbon in any costume — "not classic, not
simplified, not our own take" — and item 5 refuses "multiple competing,
non-unified command surfaces. One registry or inherit the mess."

That is a product decision with two contract consequences and one security
consequence, and this amendment records all three.

### Decision 1 — `RibbonAction` is GENERALISED, not replaced

`Command` is `RibbonAction` with four optional fields added — `when`, `category`,
`surfaces`, `priority` — and nothing removed. `isVisible`, `onExecute`, the
structured `Hotkey` and the 60-key `HOTKEY_KEYS` allowlist are unchanged, and
`export type RibbonAction = Command` stays as a deprecated alias so that mocks,
fixtures and tests migrate a file at a time rather than in one diff.

`LEAPExtensionBlueprint` gains `commands` beside `ribbonActions`, and **a manifest
declaring both is rejected with `INVALID_FIELD`** whether or not the two agree.
That is the same argument `src/core/command.ts` makes one level down: two sources
for one collection drift, the drift is silent, and "they must agree" is a rule
nothing enforces. The stored record carries both names referencing **one frozen
array**, so no reader has to know which name the manifest used.

`category` is validated against a closed set **with no fallback**, and the
asymmetry with `icon` is the decision. An unknown icon key resolves to a host
glyph because a wrong picture still leaves the command labelled and reachable. An
unknown category has no fallback that is not a lie about where the command lives:
every candidate — an invented "Other", the first bucket, no bucket — is a
statement the author never made and the user cannot correct.

### Decision 2 — Amendment H Decision 1's word *same*, applied to four routes

Amendment H licensed a keyboard chord as "a second way to fire this action's
`onExecute`, gated by the same `isVisible` and the same `isDisabled`". Amendment J
extracted those guards into one module so the button and the chord could not
drift. **There are now six routes, not two** — four surfaces, the chord
dispatcher, and the shared row all of them render — and the answer is the same
answer, once more: `isVisible` and `execute` in `src/core/command.ts` (renamed
from `ribbonAction.ts`, unchanged in behaviour) are the only route to a plug-in
predicate or handler, and `CommandRegistry` is the only caller of them.

`when` is **ANDed** with `isVisible`, never ORed, and that direction is
load-bearing: ANDing means adding a `when` to an existing command can only narrow
where it appears, so the migration cannot reveal a command a predicate was hiding.

### Decision 3 — Palette containment is structural, not a filter

The palette lists the FOREGROUND extension's commands, the host's own commands,
and a host-owned "switch extension" verb. Nothing else.

Listing a background extension's commands would be a **wider route to a plug-in
handler than the ribbon ever was**: its `onExecute` would receive a
`RibbonContext` whose `contextKeys` belong to a different extension and whose
`selectedItemIds` are rows in a list it does not own, at a moment the user
believes they are operating on what is on screen. `DUPLICATE_HOTKEY` is scoped per
blueprint for exactly this reason — Decision 6 of Amendment H — and a palette that
reached across extensions would make that scoping arbitrary rather than principled.

**It is enforced by the absence of a parameter, not by a filter.**
`createCommandRegistry` takes ONE extension; the module imports no registry and
performs no lookup. A filter is removed in one line; a missing parameter is not.
Recents are the one place a stale cross-extension id could survive, so they are
resolved against the CURRENT offered set on every read, and their keys are
namespaced so a key from elsewhere cannot resolve at all.

### Decision 4 — Host chrome is not plug-in-declarable

Cmd-K is in `HOST_CHORDS` in `src/core/hotkeyDispatch.ts`, consulted **before**
`activation.getActive()` is called. An extension declaring Ctrl+K is not rejected —
rejecting it would make load order semantically load-bearing, which Decision 6 of
Amendment H refuses — it simply never receives the keystroke while the host wants
it. `HostCommand` carries no `hotkey` field, so there is no single table in which a
host chord and a plug-in chord could be compared and one preferred: two tables, one
order, no priority column.

The palette's glyph is a module constant and is deliberately absent from
`SHELL_ICONS`, for the reason `OVERFLOW_ICON` always was: that map is the
vocabulary offered to extensions.

### Decision 5 — The editable-target suppression applies to one table, not both

`isSuppressed` used to fold five checks into one function. Four of them —
`defaultPrevented`, `repeat`, `isComposing`, `keyCode === 229` — are about the
EVENT and apply to both tables. The fifth, an editable target, exists because a
plug-in chord would fire on top of what the user is typing; a host chord carrying
Ctrl or Meta produces no character, and the omnibox composer is the surface a user
is most likely to want the palette from. So the editable check is consulted for the
extension walk only.

**This is not the second suppression Amendment I Decision 3 refuses.** That refusal
is about one rule evaluated twice, in two places, able to disagree with itself.
This is one rule, written once, applied to one of two tables, with the other
table's treatment stated rather than left to inference.

### Consequences

- **Positive.** One filter, four projections. A command hidden on one surface is
  hidden on every surface, and the property is a structure rather than four
  correct `filter` calls.
- **Positive.** The palette is browsable on an empty query, which is what makes the
  deletion defensible: the ribbon's real job was discovery, and a search-only
  replacement would have regressed on the one thing it was good at.
- **Positive.** One render boundary, not four. The four surfaces contain no render
  of a plug-in string at all; `commandListItem.tsx` is the only place `label` and
  `icon` meet the DOM, and the module-source scan is asserted five times over.
- **Negative — accepted.** The palette's rows are Tab-navigable buttons, not a
  `listbox` with arrow keys. Implementing the model means a key handler in `src/`
  and an entry in `KEY_EVENT_ALLOWLIST`, and Amendment G's lesson from the old
  `role="menu"` is that a role whose interaction model is not implemented is worse
  than no role. Recorded as a known deviation, not as an absence.
- **Negative — accepted.** Each of the palette's four projections runs the filter,
  so a throwing predicate is reported once per projection rather than once per
  render. Memoising would put a cache between a predicate and the context it is
  contracted to be a pure function of.
- **Negative — accepted.** `when` is optional in this phase. Requiring it now would
  empty the context bar for every extension written against the old contract,
  including both verification remotes. The succession is written into
  `Command.when` rather than left to be rediscovered.
- **Neutral.** `PersistedShellState` gains a fourth slot for recents, read
  tolerantly so a record written before it existed still restores.
  `SCHEMA_VERSION` does not move.

---

## Related

- [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) — ISSUE-001
  specification, adversarial edge cases and definition of done.
- [`DEVELOPER.md`](../../DEVELOPER.md) — the extension-author view of this
  contract.
- [`README.md`](../../README.md) — project status, security posture and its
  stated limits.
