# Security posture

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links were corrected for this file's location.

The shell treats every extension as untrusted code running in the same page.
This is honest about its limits: same-origin JavaScript extensions are not
sandboxed from the DOM, and the shell does not pretend otherwise.

## Three words, used precisely

Every claim below is labelled with one of these, and the labels are load-bearing.
If a sentence anywhere in this repository asserts a security property without
being placeable in one of these three categories, treat it as a documentation bug
and report it.

| Term | What it means | What it survives |
|---|---|---|
| **Integrity control** | Real and unconditional. | Any caller, however hostile. |
| **Entry-point validation** | Real at the documented door. | An honest caller and a confused one; **not** a caller who reaches internals another way. |
| **Guardrail** | Prevents honest mistakes only. | A typo, a copied snippet, a misread guide. **Enforces nothing against deliberate action.** |

## The rule that governs how those words may be used

> **No security claim may appear in prose — in any `.md` file or any docblock —
> unless it names the test that exercises it.**

Three ways to satisfy it, and all three are acceptable outcomes:

1. **Name the test.** Append the file and the `it(...)` description that asserts the
   property.
2. **Narrow the claim** until an existing test does assert it. A narrower true
   sentence is worth more than a wider one nobody checked.
3. **Delete the claim.** If nothing exercises it and a test cannot cheaply be
   written, the sentence goes. That is the rule working, not a failure.

**Why this rule exists.** Seven consecutive review rounds found the same defect, and
in every one of them the *code was sound*: a conclusion had been written one step
wider than the premise licensing it. Fixing the mechanism each time did not stop the
next sentence from doing it again, because the mechanism was never what was wrong.
Requiring a named test forces the author to go and look at what is actually asserted
before writing the word *cannot*. The seven-round history and each site is recorded in
ADR-0001 **Amendment G**.

**It is a review-time convention. No script checks it**, and the ADR says so
plainly — see Amendment G. A reader who finds a security sentence in this repository
with no test named beside it has found a documentation bug; please report it.

## The one limit to read before anything else

**There is no enforceable boundary between two extensions, and there will not be
one while extensions are scripts on this page.** Any code on the page reaches
`document.body.firstElementChild`, enumerates its own properties to find React's
`__reactFiber$…` expando, and walks the fiber tree to every hook value in the
application — the activation controller, the map holding every extension's
`revoke`, and the state store. No DOM ref is needed, nothing has to be exported,
and severing a React context does not remove a fiber from the tree.

This is reproduced, not hypothesised: `src/core/__tests__/reflection.test.tsx`
performs the escalation and asserts that it succeeds, precisely so that nobody
later mistakes a guardrail for a guarantee. Mitigations were investigated and
rejected with evidence — see ADR-0001 **Amendment E**, which also records the
firm condition under which this posture is void and real isolation becomes
mandatory.

What follows is therefore about **the host's own integrity** and about
**accidental collision between mutually untrusting extensions**. It is not about
defending one extension from another.

## Integrity controls — unconditional

- **The state store cannot be subverted.** Two halves. Its state is unreachable:
  `createShellStateStore` holds `context`, `badgeCounts`, `listeners` and
  `notifyDepth` as closure variables, and JavaScript has no reflective API for a
  scope — no `Object.keys` for a closure, no `Reflect` operation that enumerates
  one, nothing on a function object that exposes what it captured. A caller who
  walks the fiber tree obtains the store's six *methods* and never the state behind
  them. And its methods are its own: the store object is **frozen**, so no holder
  can replace, delete or add a member, and every one of the six validates its
  arguments. **Therefore no caller, however hostile, can put a value of the wrong
  shape into this store's context** — every value that enters it through this store
  is well-typed, which is what the cross-plugin object-injection argument at
  `src/core/types.ts` needs.
  *Tests:* `src/core/__tests__/reflection.test.tsx` — "gets the store methods, cannot
  replace one, and cannot put an illegal value through one", "never reaches the badge
  map itself, because it is a closure variable"; `capability.test.tsx` — "the store
  handed out by useShellStore is frozen"; `contextPatch.test.ts` — the whole file.

  > **Corrected three times, and the third correction is the reason for the rule
  > above.** (1) The bullet once read "`RibbonContext`'s declared types are true at
  > runtime for every caller, however hostile … the strongest true claim in the
  > codebase" while the store object was a plain mutable literal: a plug-in view
  > swapped `setSelectedItem` through the public `useShellStore()` and swallowed
  > another extension's writes. (2) The store was frozen and the claim narrowed to
  > **this object's** integrity — it is not a promise about what an arbitrary
  > component is handed, because the store is published through React context and a
  > caller who reaches fiber state reaches a published context value the same way
  > (Amendment E). (3) The sentence *still* carried a trailing clause — "or
  > intercept, suppress or forge the writes and reads another holder makes through
  > it" — which is **false and has been deleted.** Same shape as (1): the premise is
  > about *replacing a member*, and `subscribe` needs nothing replaced. See the
  > limit stated immediately below.
- **The limit of the bullet above: a listener is untrusted code inside your write.**
  `subscribe` is one of the six frozen members and is reachable through the public
  `useShellStore()`. A listener runs **synchronously inside another holder's write
  in the same renderer**, so it can *observe* every value written there, *re-enter*
  the store and leave its own value standing instead, and *throw into the writing
  frame* — including a non-`ShellUXError`, and including a throw that starves every
  listener ordered after it, a subscribed pane in that renderer included. Freezing
  the store does not touch any of this, because nothing is replaced. It is not
  closable either: a store that notifies nobody is a store no pane can render off.
  **The "in the same renderer" qualifier is a correction, not a hedge**: once panes
  are separate processes (`src/core/ipc/**`) a write is applied and notified locally
  and then posted, so a listener in another renderer runs a message later and has no
  frame of yours to throw into. The favourable half and the unfavourable half of that
  are both real — see `ShellStateStore.subscribe` in `src/core/ShellAPI.ts`.
  *Tests:* `src/core/__tests__/subscribe.test.tsx` — the whole file, in particular
  "sees the new value synchronously, before the writer returns, within one
  renderer", "leaves the
  attacker's value in place and not the host's", "desynchronises a victim pane that
  subscribed through useShellContext" and "delivers a raw TypeError out of
  patchContext".
- **Deep-frozen API contexts.** `createShellAPI` returns a recursively frozen
  `IShellAPI`, so an extension holding an instance cannot swap a method out from
  under another holder. It does **not** follow that calls through it are unobservable
  — see the listener limit above.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "is deep-frozen: strict-mode
  reassignment throws", "is deep-frozen: sloppy-mode reassignment is a silent no-op",
  "cannot have its prototype swapped", and "deepFreeze — hostile objects cannot make
  it throw".
- **A normalised, host-owned record is what gets stored.** Reading each untrusted
  value once is necessary but not sufficient, because a value the plugin can
  still reach is a value the plugin can still edit. So registration ends by
  building a fresh record: every validated scalar copied into a fresh primitive,
  every collection rebuilt as a fresh array of exactly the length that was
  bounds-checked, the whole thing frozen at every host-owned level before it is
  stored. `getExtension` returns that record, not the plugin's object. A plugin
  editing its blueprint after registration — or a Proxy reporting one `length`
  while it is measured and a larger one afterwards — cannot change what the host
  holds. Component and handler references are deliberately carried across
  unchanged and unfrozen; see the accepted limits below.
  *Tests:* `src/core/__tests__/registryNormalization.test.tsx` — "register — the
  stored record is host-owned", "register — a lying `length` cannot grow the payload
  after it is measured", "is unaffected by the plugin mutating its own blueprint
  afterwards"; `registrySecurity.test.tsx` — "register — a shifting id cannot hijack
  another extension".
- **A `Map`, not an object literal.** This is the one remaining use of the word
  *structural* worth keeping: registry and badge keys come from plugin manifests,
  and a `Map` has no prototype chain, so a key named `__proto__` or `constructor`
  stores a plain entry and can never reach `Object.prototype`. Prototype
  pollution is impossible by construction rather than by filtering.
  *Tests:* `src/core/__tests__/registrySecurity.test.tsx` — "register — a shifting id
  cannot smuggle a reserved key into the store", which asserts both that the id is
  refused and that no live key is ever `__proto__`.
- **A registry that cannot be crashed or hijacked by its input.** `register`
  returns a typed failure instead of throwing, for every malformed payload
  including one that throws or resists inspection from its own property getters.
  Duplicate ids are a deterministic reported failure, never a silent overwrite.
  The failure it returns is always an error the host constructed itself, with a
  `code` from the host's own enum — never an error object handed back out of
  plugin code. This is `register`'s contract, not the exported `validateBlueprint`'s.
  That one throws rather than returning a result, and every rejection it decides on is
  a `ShellUXError` — the raw `TypeError` it used to leak from five `Array.isArray` sites
  on a revoked `Proxy` was closed in Phase 1, *test:*
  `src/core/__tests__/validation.test.ts` — "validateBlueprint — a revoked Proxy". A
  throwing property getter on the payload still propagates out of it untyped, which is
  an open follow-up recorded in `.github/ISSUES_MANIFEST.md`, so prefer `register` for
  input you did not author.
  *Tests:* `src/core/__tests__/registry.test.tsx` — "register — hostile payloads never
  crash the host", "register — duplicate ids"; `registrySecurity.test.tsx` — "register
  — thrown values that resist inspection", "register — a getter that detonates late
  still cannot escape"; `registryNormalization.test.tsx` — "register — a weaponised
  ShellUXError cannot be relocated into the host".
- **Revocation is immediate and cannot be resurrected.** A handle's liveness is
  re-asked on every call and is keyed on the host-owned blueprint record it was
  minted against — not on the id still being registered. So `unregister` kills
  the handle from the very next statement, and `unregister` followed by a
  re-`register` under the same id in the same commit does not hand the previous
  vendor a live handle into the new one's scope.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "revocation on unregister is
  synchronous", "re-registering an id does not resurrect the previous handle";
  `dataflow.test.tsx` — "mints a live IShellAPI on activation and revokes it on
  release", "revokes when the extension is unregistered".

  Two things this does *not* cover, both deliberate: provider teardown revokes
  nothing (Amendment F), pinned by "does not revoke, and the write it lets through
  cannot reach a live shell" in `capability.test.tsx`; and revocation says nothing
  about *who may revoke* — the controller carrying `release` is reachable by
  reflection, pinned in `reflection.test.tsx`.

- **The host constants cannot be replaced.** `EXTENSION_ID_PATTERN`,
  `RESERVED_IDS`, `REGISTRY_LIMITS`, `HOTKEY_KEYS`, `HOTKEY_MODIFIER_REQUIRED_KEYS`
  and `PANE_IDS` are the rules every untrusted payload is measured against, they
  are exported from modules a plug-in can import, and until ADR-0001 Amendment K
  every one of them was runtime-mutable — `REGISTRY_LIMITS` was `as const`, which
  binds nobody who is not being compiled. All six are frozen. No own property can
  be added, replaced or deleted, so `REGISTRY_LIMITS` is genuinely immutable and
  the sets' and pattern's `has`/`test` cannot be **shadowed** by an own property,
  which was the interesting attack: a plug-in owning `HOTKEY_KEYS.has` owned the
  hotkey allowlist for the whole page.

  **The obvious wider reading is false and is asserted against.** A frozen `Set`
  is not an immutable one — `Set` state lives in internal slots rather than
  properties, so `add`, `delete` and `clear` still work. The claim is "cannot be
  replaced", never "cannot be changed".
  *Tests:* `src/core/__tests__/hostConstants.test.ts` — "freezes the host constants
  against replacement", "refuses to let a caller raise a registry bound" and "does
  not claim more than a frozen Set delivers", the last of which demonstrates the
  remaining mutability on a throwaway `Set` rather than on a live allowlist.

## Entry-point validation — real at the door, bypassable elsewhere

- **Identifier hygiene.** Every plugin-supplied id — the extension id, navigation
  node ids, ribbon action ids, badge node ids, badge scopes — must match a strict
  allowlist and is refused if it is a prototype-pollution key. Rejection messages
  describe an untrusted value by its `typeof` and never stringify it, so a hostile
  `toJSON`, a `Symbol.toPrimitive` or a cycle cannot run code or throw a raw
  `TypeError` out of the host.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — identifier
  hardening"; `contextPatch.test.ts` — "patchContext validates the two identifier
  fields", "refuses a value that throws from every route to a string";
  `shellApi.test.ts` — "the badge scope and node id are validated at both doors",
  "setBadgeCount rejects an unstringifiable nodeId with a ShellUXError".
- **Bounds.** Text lengths, navigation node count, navigation depth and ribbon
  action count are all capped, and the cap applies to what is stored rather than
  to a number the payload can revise afterwards.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — text
  fields", "— navigation tree", "— commands";
  `registryNormalization.test.tsx` — "register — a lying `length` cannot grow the
  payload after it is measured"; `registrySecurity.test.tsx` — "validateBlueprint —
  collection lengths are read once".
- **Argument validation on `IShellAPI`.** Every member that takes an argument
  checks it and raises `ShellUXError` rather than letting an arbitrary value reach
  the context snapshot the host passes to *other* extensions — the six writers and
  readers the interface has grown to since ADR-0001 Amendment K, not just the two
  it had. `patchContext` — the unscoped store member the same values can reach
  through the public `useShellStore()` — is held to the identical standard field by
  field, and a collection field is read once into a host-owned copy that is what
  gets validated and stored.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "setSelectedItem validates its
  argument", the "setSelectedItems validates its argument" group, "setActiveNavNode
  validates its argument", "the badge scope and node id are validated at both
  doors"; `contextKeys.test.tsx` — "setContextKey validates its value";
  `contextPatch.test.ts` — "patchContext rejects what setSelectedItem rejects",
  "patchContext rejects what setSelectedItems rejects", "patchContext is
  all-or-nothing".

These are called entry-point validation rather than integrity controls for one
honest reason: they hold for the values that arrive through these functions, and
a caller who reaches the objects behind them another way is not bound by them.

## Collision-resistance, not confinement

- **Badge scoping.** Badge state is keyed by `${extensionId}:${nodeId}`, and an
  extension's own facade closes over the id the registry validated rather than
  taking it as a parameter. **The true claim is that two extensions which both
  name a node `inbox` cannot collide, and that the scope is not a caller-supplied
  argument.** It is *not* confinement: `useShellStore()` is public, so
  `store.getBadgeCount('other-ext', 'inbox')` reads another extension's badge and
  `store.setBadgeCount('other-ext', …)` writes one, host badges under `__host__`
  included. Nothing confidential belongs in the store.
  *Tests:* `src/core/__tests__/dataflow.test.tsx` — "keeps two extensions that both
  use the node id \"inbox\" apart", "does not let an extension name the scope it
  writes to"; `shellApi.test.ts` — "scopes a badge to its extension, so the same node
  id does not collide". The *absence* of confinement is pinned by "reaches the host
  ActivationController by reflection anyway, and steals a sibling handle" in
  `reflection.test.tsx`.

  **The read half is scoped the same way, since ADR-0001 Amendment K.**
  `IShellAPI.getBadgeCount(nodeId)` closes over the same validated id and takes no
  scope parameter, so a handle reads back exactly what it can write and nothing
  else. That keeps the read from being a wider capability than the write it
  mirrors; it does not make either one confinement, for the reason above. *Test:*
  `dataflow.test.tsx` — "reads back only its own scope, and offers no parameter to
  name another".

- **Context-key scoping.** Same shape, same limit, new surface.
  `IShellAPI.setContextKey(key, value)` writes into a namespace keyed by the
  closure-captured extension id, so two extensions that both publish a key called
  `loaded` keep their own, and an extension has no parameter with which to name
  another's namespace. **It is not confinement**: `RibbonContext.contextKeys`
  publishes the FOREGROUND extension's record into the one host-wide snapshot, and
  anything holding a context — a backgrounded extension's `getContext()` included
  — can read it. Every namespace is dropped on a foreground handover, which bounds
  how long a key is readable but does not make it private. **Nothing confidential
  belongs in a context key.** The value type is deliberately
  `string | number | boolean | null` and nothing else, which is what stops it
  becoming an object-injection channel into another extension's predicates.
  *Tests:* `src/core/__tests__/contextKeys.test.tsx` — "keeps two extensions'
  context keys apart, and publishes only the foreground's", "does not let an
  extension name the scope it writes a context key to", "clears every extension's
  context keys on a foreground handover", "setContextKey validates its value".

## Guardrails — honest mistakes only

- **`ExtensionHostBoundary` and the `useActivation` / `useExtensionActivation`
  split.** The host wraps a plugin subtree in a boundary; `useActivation()` throws
  below it, and plugin code gets three read-only facts instead. This is kept, and
  it is worth keeping: the activation controller carries `release(id)` for any id
  and an `activate(id)` that returns *another extension's* `IShellAPI`, and an
  earlier version of `DEVELOPER.md` actively **instructed** authors to call it. The
  guardrail turns that one instruction into a loud, deterministic throw. It does
  not enforce anything against a caller who walks the fiber tree, and it is not
  described as isolation anywhere in this repository.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "ExtensionHostBoundary severs the
  host activation controller"; `reflection.test.tsx` — "gives a plug-in no capability
  through the documented channel" for what it does deliver, and "reaches the host
  ActivationController by reflection anyway, and steals a sibling handle" for what it
  does not.
- **A throwing listener cannot take the shell down through the registry sweep.** The
  one store write a host has no statement to wrap is guarded inside the sweep effect,
  and the report itself is guarded too, because `console.error` is no more the host's
  object than a listener is. This is a guardrail, not a control: it protects the one
  unguardable call site, and every other write is still the caller's to guard.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "is contained inside the sweep
  effect, which has no guardable call site", "survives a console.error that throws,
  which is the report path escaping the guard".

## Stated as intent, with no test — do not read as a control

- **No HTML injection path for plugin content — now true of ONE render site, and
  still only an intent at the others.** This entry has been split rather than
  promoted wholesale, because promoting it wholesale is exactly the error the rule
  above exists to catch.

  **Delivered and tested at the four command surfaces.** The ribbon is deleted and
  the context bar, the command palette, the floating toolbar and the omnibox
  composer stand where it stood — and **none of them renders a plug-in string
  itself.** `src/components/command/commandListItem.tsx` is the one place
  `Command.label` reaches the DOM, as a JSX text node, and the one place
  `Command.icon` is resolved, through a host-owned `Map` of inline SVGs, so an
  untrusted icon key cannot reach a URL, markup, or an inherited
  `Object.prototype` value. *Tests:*
  `src/components/command/__tests__/commandSurfaces.test.tsx` — "the context bar
  renders a markup-shaped plug-in label as a text node, not as markup" and its
  three siblings, one per surface; "the shared command row module source contains
  no HTML-injection sink at all", which parses the module with the TypeScript
  compiler so the absence is asserted against the source rather than trusted to
  review, together with the same case named once per surface; "reports a planted
  sink, so the five scans above cannot pass vacuously"; and "the context bar does
  not resolve a prototype-shaped icon key to anything inherited", again once per
  surface. For these five modules, and only these five, the claim is backed the way
  "Integrity controls — unconditional" above requires.

  **Still intent, still untested, at every other site.**
  `src/components/layout/ShellLayout.tsx` renders `NavigationNode.label` and the
  extension `name` with ordinary JSX interpolation — the correct pattern — but
  `ShellLayout.test.tsx` contains no injection case and no source scan, so nothing
  pins it and it must not be cited as a control. The row virtualizer added by
  ISSUE-004 is the SECOND site that does carry the pair. *Tests:*
  `src/components/__tests__/VirtualizedList.test.tsx` — "the module source contains
  no HTML-injection sink at all", "the module source names no URL-bearing attribute
  a plug-in value could reach", "renders extension row content as text, with no
  HTML-injection path" and "reports a planted sink, so the scans above cannot pass
  vacuously". Anything an extension renders inside its own panes is still the
  extension's responsibility and the host neither inspects nor sanitizes it.

  Round 10 found this entry restated as delivered at two sites while no renderer
  existed, and corrected both. The correction is preserved as history: the risk was
  never that the code was wrong, but that the sentence was wider than the premise
  licensing it — which is why the command surfaces' arrival buys a sentence about
  the command surfaces and nothing more.

Accepted limits — decided, not overlooked:

- **`unregister` is not authorised.** Any caller holding the registry can remove
  any extension, including one it did not register. ISSUE-001 specifies no
  ownership or capability model, and this shell is local-first and
  single-origin: extensions are same-origin JavaScript in the same page, so one
  that wanted to remove another's UI could equally reach into the DOM. An
  unregister token would read as a guarantee the architecture cannot make. The
  decision is recorded in ADR-0001 and on the `unregister` declaration itself.
  If an ownership model is ever wanted, it needs its own issue and its own
  threat model first.
  *Test:* `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling".
- **`useRegistry` is not severed inside an extension subtree.** It is how an
  extension registers itself, so severing it would break the documented
  registration flow. It follows that `getExtension(otherId)` hands any component
  the sibling's host-owned record — including the sibling's *unfrozen* view
  components and callbacks.
  *Test:* `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling".
- **Plugin view components and callbacks are carried by reference and unfrozen.**
  Every container the host owns is frozen; the plugin functions inside them are
  not, because freezing them breaks `memo`/`forwardRef` internals and they are not
  the host's objects. So one extension can set `defaultProps` on another's view
  component and change what it renders. Freezing is not the fix and the host does
  not do it.
  *Test:* `src/core/__tests__/capability.test.tsx` — "pins the accepted limit: the view
  components and callbacks take new properties".
- **A store listener is untrusted code running inside somebody else's write.** It
  observes, it can re-enter, and it can throw into the writer's frame. Covered in
  full under "Integrity controls" above.
  *Test:* `src/core/__tests__/subscribe.test.tsx`.

Specified but **not yet enforced** — do not read these as current guarantees:

- **Namespaced persistence.** This one has landed as code, which makes the wording
  matter more than it did. `src/core/services/HydrationEngine.ts` namespaces
  per-extension persisted state by extension id, and that namespace is
  **collision-resistance and not confinement**: two extensions that both persist a
  key named `selection` keep their own copies, and that is the whole of what it
  buys. It confines nothing, for two independent reasons. The scope is an
  **argument, not a closure** — `setExtensionState(id, state)` takes the id from
  its caller, so any holder of the engine can name any scope; there is no
  per-extension facade over persistence the way `createRevocableShellAPI` is one
  over badges, and `IShellAPI` still has no persistence member. And the store is
  one `localStorage` entry under one origin, which any script on the page reads and
  rewrites without going through the engine at all — the same shape as
  `useShellStore()` being public. **Nothing confidential belongs in persisted UI
  state.** Weaker than badge scoping, not equal to it. It stays in this list, and
  did not graduate out of it when the code arrived, because what landed is a store
  and not a boundary. ISSUE-003.

  **Wiring the shell to the engine did not change any of that, and the reason is
  which half was wired.** `ShellLayout` consumes the three HOST slots — pane
  sizes, the pane-1 collapsed flag, the foreground extension id — through
  `useLocalStorageState` and `setSlot`. The per-extension scopes this entry is
  about are still reached by nothing, `IShellAPI` still has no persistence member,
  and no extension can put a value into that namespace through the documented
  contract at all. So the namespace remains untested-in-anger collision
  resistance for a case the shell does not yet create.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "keeps two
  extensions that both use the key \"selection\" apart" for what the namespace does
  buy; "lets any caller name any scope, so the namespace confines nothing" and
  "reads and rewrites another extension's scope straight through the storage entry"
  for what it does not, each reproduced as behaviour rather than asserted in prose.
- **A sandbox.** There is none, and nothing in this repository substitutes for
  one. `useShellStore()` is public and a plugin view renders inside the provider,
  so a plugin can reach the unscoped host store and bypass its own facade; every
  member of that store validates its arguments, so what it cannot do is put a
  value of the wrong shape into the context other extensions read — but it can
  read and write anything the store holds, host badges under `__host__` included,
  and through `subscribe` it can also watch, overwrite and throw into another
  extension's writes.
  The activation controller, and with it `release` for any id and an `activate`
  that returns another extension's handle, is reachable by walking React's fiber
  tree from any DOM node on the page. Badge scoping and revocation protect against
  *mistakes and collisions* between mutually untrusting extensions; against a
  mutually *hostile* one they protect nothing — see ADR-0001 Amendments C, D, **E**
  and **G**.
  *Tests:* `src/core/__tests__/capability.test.tsx` — "the store handed out by
  useShellStore is frozen" for the validation that does hold;
  `reflection.test.tsx` — "reaches the host ActivationController by reflection
  anyway, and steals a sibling handle" for the controller; `subscribe.test.tsx` for
  the listener channel.
**Newly enforced by ISSUE-004 — moved out of this list:**

- **Fault containment.** No longer "intended". This entry used to read that there
  was **no error boundary in `src/`** and that a plug-in view throwing during
  render unmounted the whole shell — a live exposure, correctly labelled as one,
  and it stopped being true in `cd52bbf`. `src/components/error/FaultBoundary.tsx`
  is a real error boundary, and `ShellLayout` composes one around every set of
  children it hands a `PaneWrapper` — both plug-in panes, the context bar, and pane 1's
  navigation, which renders plug-in labels and badge counts and so was never
  incapable of failing. The boundary sits OUTSIDE `ExtensionHostBoundary`, which
  is still not an error boundary and still catches nothing: the inner one throws
  for a non-string `extensionId`, and a boundary nested beneath it could not catch
  its own parent. *Tests:* `src/components/__tests__/ShellLayout.test.tsx` —
  "contains a throwing pane-2 view to pane 2, leaving the context bar and pane 3 interactive", "contains a throwing context bar without taking the panes down" and
  "clears a pane error surface when the active extension changes".

  **Scope, so this is not over-read:** a boundary contains a throw during RENDER.
  It is not a sandbox, it does not contain a plug-in that wedges the UI thread
  without throwing, and ADR-0001 "No sandbox" and Amendment E are untouched by it.

**Newly enforced by ISSUE-002 — moved out of this list:**

- **Command predicate and handler containment.** No longer "intended". The command
  registry calls `isVisible` inside a guard and treats a throw as "not visible",
  reporting it and continuing to offer the remaining commands; it calls `onExecute`
  inside the same kind of guard, so a throwing handler does not reach React. Since
  the ribbon's deletion the same two functions serve four surfaces and the chord
  dispatcher, which is six routes through one implementation. The report path is
  itself guarded, so a tampered `console.error` cannot turn the containment into an
  escape. A non-boolean return is treated as not visible, since the comparison is
  `=== true`. *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "the context bar hides a command whose isVisible predicate throws and still renders the rest", "the context bar survives a console.error that itself throws while reporting a bad predicate", "the context bar survives an onExecute that throws, leaving the surface interactive", "treats a non-boolean
  isVisible result as not visible".

  **Scope, so this is not over-read:** it contains what arrives through
  `Command` — a buggy or hostile predicate or handler. It is not a sandbox, and
  ADR-0001 "No sandbox" and Amendment E are untouched by it.

Extension authors: see the security section of
[`DEVELOPER.md`](../DEVELOPER.md) for the rules your code must follow.
