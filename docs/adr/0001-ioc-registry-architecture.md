# ADR 0001 — Registry-Based IoC Architecture with Deep-Frozen API Contexts

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Implemented by:** ISSUE-001 — Type-Safe IoC Extension Registry & Primitives
  (`src/core/types.ts`, `src/core/RegistryContext.tsx`, `src/core/ShellAPI.ts`)

> **Implementation status.** This ADR records a decision, not a completed
> implementation. ISSUE-001 is in progress; the registry described here does not
> yet exist in verified, tested form. The decision is settled; the code is not.

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
- **VS Code** — host/plugin isolation, where an extension receives a restricted
  API context object and has no reference to host internals.
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
what it contributes — a stable id, a display label, an icon, a Pane 1
navigation entry, a Pane 2 view, a Pane 3 view, and a set of ribbon actions.

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

This is the isolation mechanism. Extensions in a shared page cannot be prevented
from touching the DOM, but they can be prevented from monkey-patching the shell
services that other extensions rely on. Freezing turns "please do not patch the
host" from a request into a property of the runtime.

Per-extension persisted state is namespaced by extension id for the same reason:
isolation should be structural, not conventional.

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
- **Vendor isolation is real, within the limits of a shared page.** Deep freezing
  plus namespaced persistence means one extension cannot silently degrade
  another.
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
  `IShellAPI` is unreachable. Legitimate needs will be discovered late, and each
  one is a contract change rather than a local fix.
- **Deep freezing has a cost and a sharp edge.** The recursive walk must handle
  circular references without looping, and frozen objects produce failures at
  the point of mutation rather than at the point of the mistake, which can be
  confusing to debug.
- **No sandbox.** Same-origin JavaScript extensions share the DOM and the page.
  Deep freezing protects shell service objects; it does not stop a hostile
  extension from touching the document. This architecture defends against
  accident and interference, **not** against a determined malicious extension.
  That limit is stated plainly in `README.md` and `DEVELOPER.md` rather than
  papered over.
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

## Related

- [`.github/ISSUES_MANIFEST.md`](../../.github/ISSUES_MANIFEST.md) — ISSUE-001
  specification, adversarial edge cases and definition of done.
- [`DEVELOPER.md`](../../DEVELOPER.md) — the extension-author view of this
  contract.
- [`README.md`](../../README.md) — project status, security posture and its
  stated limits.
