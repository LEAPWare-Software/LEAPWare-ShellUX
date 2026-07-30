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
> Six amendments have been made and are recorded at the end of this document —
> the header previously named only the first two, which was itself out of date:
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

**Intent, not current behaviour:** per-extension persisted state *is to be*
namespaced by extension id for the same reason. **No persistence exists.** There is no persistence member on
`IShellAPI` and no storage layer in `src/`. This is ISSUE-003, and until it
lands nothing here should be read as a guarantee. `README.md` lists it under
"Specified but not yet enforced"; this paragraph previously asserted it in the
present tense and was wrong to.

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
  silently overwrite each other. Deep freezing has landed; the persistence half is
  ISSUE-003 intent and is not in effect yet — see §3.

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
`Object.keys(api)` is exactly the three `IShellAPI` members. `createShellAPI(store)`
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
| `focusedPane` | a member of `PANE_IDS`, or `null`. |

`PANE_IDS` is new in `types.ts`: `PaneId` is a type union and vanishes at runtime,
so it is pinned to a `Record<PaneId, true>` exhaustiveness record in the same idiom
as `SHELL_UX_ERROR_CODES`. The validators reuse `describeUntrusted` and never read
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

## Related

- [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) — ISSUE-001
  specification, adversarial edge cases and definition of done.
- [`DEVELOPER.md`](../../DEVELOPER.md) — the extension-author view of this
  contract.
- [`README.md`](../../README.md) — project status, security posture and its
  stated limits.
