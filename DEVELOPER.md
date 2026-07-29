# Extension Author Guide — LEAPWare-ShellUX

This is the onboarding guide for third parties building extensions against the
LEAPWare-ShellUX host.

---

## Read this before you read anything else

**The host is pre-alpha.** ISSUE-001 — the file set that defines
`LEAPExtensionBlueprint`, `IShellAPI` and the extension registry — **has
landed**: `src/core/types.ts`, `src/core/RegistryContext.tsx` and
`src/core/ShellAPI.ts` all exist and are covered by tests. The signatures in
this guide are now printed from those files rather than withheld. See
[`README.md`](README.md#project-status).

Everything *else* the host is specified to do — the three-pane layout, the
ribbon renderer, state hydration, the row virtualizer, the fault boundaries — is
ISSUE-002 and later, and **does not exist yet**. This guide marks those passages
explicitly as forthcoming behaviour.

> **The types in `src/core/types.ts` are the single source of truth.** Read it.
> Where this guide and that file disagree, that file wins and this guide is a
> bug.
>
> **Where behaviour has not been implemented, this guide says so in the same
> place it describes the behaviour**, rather than describing it in the present
> tense. A guide that describes an unbuilt feature as though it works is worse
> than an acknowledged gap: it produces extensions that rely on a host guarantee
> nobody has written.

What is settled and safe to build against today is the **registration
contract**: the blueprint shape, the validation rules, the `IShellAPI` surface,
and the registry's failure modes. That is what the next three sections cover.

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
                                                        │          ← BUILT
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄
                                                        │      ← ISSUE-002+
   receives ◄──  IShellAPI (deep-frozen)  ◄─────────────┘
                                                        │
   host renders your Pane 1 entry, Pane 2 view,  ◄──────┘
   Pane 3 view, and your ribbon actions
```

Everything above the dashed line exists today. Everything below it — activation,
the shell API actually reaching you, and anything being rendered — is ISSUE-002
and later.

The host contains zero business logic. It does not know what your data means. It
will not special-case you, and you should not need it to — if you cannot express
something through the public contract, that is a gap in the contract worth
reporting, not a reason to reach inside.

---

## The `LEAPExtensionBlueprint` contract

Your extension's entry point exports one blueprint object. It is data, not
behaviour: the host reads it during registration, before anything of yours
renders.

Every field below is required. There are no optional fields on the blueprint
itself — the only optional fields in the contract are `NavigationNode.badgeCount`,
`NavigationNode.children` and `RibbonAction.isDisabled`.

| Field | Type | Responsibility and rules |
|---|---|---|
| `id` | `string` | Stable, unique identifier. Indexes the registry and namespaces your persisted state. Must match `/^[a-z0-9][a-z0-9-]{0,63}$/` — lowercase alphanumerics and internal hyphens, 1–64 characters, first character alphanumeric — and must not be `__proto__`, `constructor` or `prototype`. Unique across the whole registry. Never change it after release; changing it orphans every user's saved state for your extension. |
| `name` | `string` | Human-readable extension name. Non-blank, at most 256 characters. **Untrusted display text** — see the security section. |
| `version` | `string` | Your version string, e.g. `"1.0.0"`. Non-blank, at most 32 characters. Completely opaque to the host: it is not parsed, compared or range-checked. |
| `navigationTree` | `readonly NavigationNode[]` | Your Pane 1 contribution. May be empty. At most 512 nodes in total across the whole tree, nested at most 8 deep (roots are depth 1). |
| `ribbonActions` | `readonly RibbonAction[]` | Your contextual ribbon commands. May be empty. At most 128. |
| `views` | `{ pane2: ExtensionView; pane3: ExtensionView }` | Your two pane components. Both are required; there is no blueprint-level Pane 1 view, because Pane 1 is the host's navigation chrome rendering *your* `navigationTree`. |

There is **no `icon` field on the blueprint.** Earlier drafts of this guide
described one; it does not exist. Icons are per ribbon action only.

### `NavigationNode`

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Same allowlist and reserved words as the extension id. Must be unique **within your own tree** — a duplicate anywhere in the tree, at any depth, rejects the whole blueprint. |
| `label` | `string` | **Untrusted display text.** Non-blank, at most 256 characters. |
| `badgeCount?` | `number` | Optional. Non-negative safe integer. An explicit `undefined` is treated as absent. |
| `children?` | `readonly NavigationNode[]` | Optional. An explicit `undefined` is treated as absent. Counts against the 512-node and 8-level limits. |

### `RibbonAction`

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Same allowlist and reserved words as the extension id. Must be unique within your own `ribbonActions`. |
| `label` | `string` | **Untrusted display text.** Non-blank, at most 256 characters. |
| `icon` | `string` | **Untrusted icon key.** Non-blank, at most 256 characters. Required. The host will resolve it through its own lookup table; it is never interpolated into a URL or into markup. |
| `isDisabled?` | `boolean` | Optional. When present it must be a boolean. Renders the action greyed out but still visible. |
| `isVisible` | `(ctx: RibbonContext) => boolean` | Required. Visibility predicate — **see the caveat in the predicates section below: the registry checks that this is a function, and nothing calls it yet.** |
| `onExecute` | `(ctx: RibbonContext) => void` | Required. Invoked on activation. Nothing calls it yet either; the ribbon renderer is ISSUE-002. |

### `ExtensionView` and its props

`ExtensionView` is `ComponentType<ExtensionViewProps>` — a React component. A
plain function component, a `React.memo` wrapper and a `React.forwardRef`
wrapper are all accepted.

```ts
interface ExtensionViewProps {
  readonly shell: IShellAPI;                  // deep-frozen host API
  readonly context: Readonly<RibbonContext>;  // host context at render time
}
```

### `RibbonContext`

The ambient host state passed to your predicates, your execute handlers and your
views. It is a real closed interface, not `any`:

```ts
interface RibbonContext {
  readonly activeExtensionId: string | null;  // owner of panes 2/3, or null
  readonly activeNavNodeId: string | null;    // selected pane-1 node, or null
  readonly selectedItemId: string | null;     // selection inside the view, or null
  readonly focusedPane: PaneId | null;        // 'pane1' | 'pane2' | 'pane3', or null
}
```

**Do not hand-write a type declaration matching these tables.** Import the real
types from the host's `src/core/types.ts` and let the compiler tell you what you
got wrong. That is the whole point of a type-safe registry.

---

## Registration: what the host does with your blueprint, and how it fails

The registry validates your blueprint before it stores it, and it reports
failure as a **returned value, never as a thrown exception**. `register` does
not throw — not for a malformed blueprint, not for a duplicate id, not for a
blueprint that detonates while it is being inspected. One bad plugin cannot take
the shell down through an error boundary.

```ts
type RegistrationResult =
  | { readonly ok: true;  readonly id: string; readonly alreadyRegistered: boolean }
  | { readonly ok: false; readonly error: ShellUXError };
```

`ShellUXError` carries a stable machine-readable `code` and, where the failure
is field-specific, the dotted `field` path that caused it — for example
`"ribbonActions[2].icon"`. The codes are:

| `code` | Meaning |
|---|---|
| `INVALID_PAYLOAD` | Not a plain object — `null`, an array, a string, or a value that threw while the host inspected it. |
| `MISSING_FIELD` | A required field was absent. |
| `INVALID_FIELD` | Present, but the wrong type, shape or value. |
| `INVALID_ID` | An id failed the allowlist pattern. |
| `RESERVED_ID` | An id was `__proto__`, `constructor` or `prototype`. |
| `DUPLICATE_ID` | The id is already registered by a different blueprint, or an id repeats inside your own tree or action list. |
| `PAYLOAD_TOO_LARGE` | A string or a collection exceeded its declared bound. |

**Use the `id` the result gives you, not `blueprint.id`.** On success the result
carries the id the registry actually validated and keyed your extension under.
That is the authoritative value.

### What the registry keeps is a copy of your blueprint, not your blueprint

The registry does not store the object you passed to `register`. It builds a
**normalised, host-owned record** from it and stores that. Concretely:

- Every validated scalar — `id`, `name`, `version`, every `label`, `icon`,
  `badgeCount` and `isDisabled` — is copied into a fresh value.
- `navigationTree`, `children` and `ribbonActions` are rebuilt as fresh arrays,
  each exactly as long as the count the registry bounds-checked.
- The record is frozen at every level the host owns.
- **Your functions and components are NOT copied.** `views.pane2`,
  `views.pane3`, `isVisible` and `onExecute` are carried across by reference,
  keep their identity, and stay callable. They are also left unfrozen — they are
  yours, and freezing them would break `memo`/`forwardRef` internals.

Two consequences you can rely on:

1. **`getExtension(id)` does not return the object you registered.** Comparing
   it with `===` against your exported blueprint will be `false`. Compare on
   `id` instead. It *is* stable: the same registration always yields the same
   record object, so `getExtension(id) === getExtension(id)`.
2. **Editing your blueprint after registering it does nothing.** If you need to
   change what the host shows, `unregister` and `register` again. Mutating the
   object in place is silently ineffective, by design.

This exists because a validated object you can still reach is a validated
object you can still edit, and the host cannot tell an honest edit from a
hostile one. Reference identity is still what makes StrictMode
re-registration idempotent — the registry remembers your original object
privately for exactly that comparison — so the module-level-singleton rule
below is unchanged.

### Export your blueprint as a module-level singleton

**This is the one registration rule that will bite you in development, and the
symptom looks like a host bug.**

The registry rejects a *different* object claiming an id that is already taken —
that is a real collision between two plugins, and it must be reported rather
than silently last-write-wins. It distinguishes that from benign
re-registration by **reference identity**: registering the exact same object
again is an idempotent no-op that succeeds with `alreadyRegistered: true`.

React StrictMode, which the host runs in development, mounts every subtree,
unmounts it, and mounts it again. So an extension that registers from an effect
runs `register` twice. If your blueprint is a module-level constant, the second
call sees the same object and succeeds. If you build a **fresh object literal on
every render**, the second call sees a different object claiming an id that is
already taken, and you get `DUPLICATE_ID` from what looks like your first
registration.

```ts
// CORRECT — src/extensions/my-ext/index.ts
// One object for the module's lifetime. Stable identity across StrictMode
// remounts, across re-renders, and across register/unregister effect pairs.
export const blueprint: LEAPExtensionBlueprint = {
  id: 'my-ext',
  name: 'My Extension',
  version: '1.0.0',
  navigationTree: [...],
  ribbonActions: [...],
  views: { pane2: Pane2View, pane3: Pane3View },
};

function MyExtension(): null {
  const registry = useRegistry();
  useEffect(() => {
    registry.register(blueprint);
    return () => { registry.unregister('my-ext'); };
  }, [registry]);
  return null;
}
```

```ts
// WRONG — a new object every render. Fails with DUPLICATE_ID under StrictMode.
function MyExtension(): null {
  const registry = useRegistry();
  useEffect(() => {
    registry.register({ id: 'my-ext', name: 'My Extension', /* ... */ });
  }, [registry]);
  return null;
}
```

`useMemo` is **not** a fix: React may discard memoized values, and StrictMode's
second mount re-runs the memo factory. Hoist the blueprint to module scope. This
also keeps your `views` component references stable, which is what stops the
host remounting your panes on every render.

The registry API object returned by `useRegistry` has a **stable identity for
the provider's whole lifetime**, so listing it in a dependency array is safe and
is the intended pattern. If you need to recompute when the registry's *contents*
change, subscribe to `useRegistryRevision()` instead — a counter that increases
by one on every successful registration or removal.

**`unregister` is not authorised, and that is deliberate.** Any caller holding
the registry can remove any id, including one it did not register. There is no
ownership token and none is planned for ISSUE-001. This is not a hole being
left open casually: extensions here are same-origin JavaScript in a shared
page, so an extension that wanted to remove another's UI could equally reach
into the DOM, and a token would advertise a guarantee the architecture cannot
make (see the "No sandbox" limit in ADR-0001). Only ever call `unregister` with
**your own** id. Removing someone else's is a contract violation that the
runtime will not stop you from committing.

---

## The `IShellAPI` contract

`IShellAPI` is what the host hands *you*. It is the entire surface you are
permitted to touch.

> **Forthcoming: activation.** The interface, and the `createShellAPI` factory
> that builds a deep-frozen instance of it, have landed and are tested. What has
> **not** landed is the moment the host hands one to an extension — activation
> happens when the shell renders your panes, which is ISSUE-002. Today nothing
> in `src/` calls `createShellAPI` outside its own tests. Write your views to
> take `shell` from their props, as the type says; just do not expect the host
> to mount them yet.

Two properties of it are load-bearing for how you write your code:

**1. It is deeply frozen.** Recursively — not just the root object. You cannot
add to it, replace anything on it, or patch a nested service. Attempts are a
no-op in sloppy mode and a `TypeError` under strict mode, which is how your
modules will run. This is not incidental hardening; it is the mechanism that
stops one extension from tampering with the shell services other extensions
depend on. Design your extension as a consumer of this object, never as a
modifier of it.

**2. Forthcoming — it will be scoped to you.** The design intent is that your
persisted state is namespaced by your extension id, so you cannot read or
overwrite another extension's state and it cannot read or overwrite yours.
**No persistence member exists on the interface today** (see the member list
below); state hydration and serialization are ISSUE-003. Design as though the
namespacing is there — it is the contract you will get — but do not write code
that calls a persistence method, because there is not one to call.

### The member list

As landed in `src/core/types.ts`, `IShellAPI` has exactly three members. It is
deliberately small — every addition is a new capability handed to untrusted
code.

```ts
interface IShellAPI {
  setSelectedItem(id: string | null): void;
  setBadgeCount(nodeId: string, count: number): void;
  getContext(): Readonly<RibbonContext>;
}
```

| Member | Behaviour |
|---|---|
| `setSelectedItem(id)` | Sets — or clears, with `null` — the currently selected item, which surfaces as `RibbonContext.selectedItemId`. **This one throws.** The value is opaque to the host — it is your own item identifier, not a registry key, so it is *not* held to `EXTENSION_ID_PATTERN` and may be a GUID, a path or a number-as-string. Its **type** is enforced: anything that is neither a `string` nor `null` raises `ShellUXError` with code `INVALID_FIELD` and field `"id"`, and the context is left unchanged. |
| `setBadgeCount(nodeId, count)` | Sets the badge count for one of your navigation nodes. **This one throws.** It raises `ShellUXError` with code `INVALID_ID` when `nodeId` is not a string, or does not match the same allowlist and reserved-word rules the registry applied to your node ids, and code `INVALID_FIELD` when `count` is not a non-negative safe integer. Call it with values you control, or wrap it. |
| `getContext()` | Returns a frozen snapshot of the current `RibbonContext`. A snapshot, not a live view: hold the result only for the duration of the work you are doing, and call again rather than caching it across renders. |

`setSelectedItem` and `setBadgeCount` both throw; `getContext` does not. Note
the asymmetry with `register`, which never throws — `IShellAPI` is called by
*you*, so a bad argument is your bug and is reported as an exception, whereas
`register` is called by the *host* on your data, where an exception would take
the shell down.

**Why `setSelectedItem` checks a value it otherwise treats as opaque.**
`RibbonContext.selectedItemId` is declared `string | null`, and the host hands
that snapshot to *other* extensions' `isVisible` predicates and `onExecute`
handlers. Letting an arbitrary object through would make the declared type a
runtime lie and would give one extension a way to push a live object — with its
own getters and its own prototype — into another extension's code. It rejects
rather than silently coercing to `null`, because a selection that mysteriously
never sticks is a much worse bug to find than an exception at the call site.

Both rejection messages describe an offending value by its `typeof` and never
stringify it. Do not expect the value itself to appear in the message unless it
was already a string.

**Nothing else exists yet.** Scoped persistence and shell-event notification are
described elsewhere in this guide as design intent; they are not on the
interface, and there is no other channel to reach them. Anything not in the
three-member list above is unbuilt.

Practical advice that holds as the interface grows: **keep your calls into
`IShellAPI` behind a thin adapter in your own code.** One small module that wraps
every host call gives you a single place to fix when the contract grows, instead
of a fix scattered through every view you wrote.

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

## How `ribbonActions` visibility predicates will work

> ### ⚠ Forthcoming behaviour — predicate evaluation is ISSUE-002
>
> **The host does not evaluate `isVisible` today. Nothing calls it.** There is no
> ribbon renderer in `src/`; the entire evaluation loop described in this section
> arrives with ISSUE-002, the three-pane layout and ribbon.
>
> **What the host does today is exactly one thing:** at registration the registry
> checks that `isVisible` is present and that `typeof isVisible === 'function'`,
> rejecting the blueprint with `INVALID_FIELD` on `ribbonActions[n].isVisible`
> otherwise. It does not call it, does not inspect its arity, does not evaluate
> its result, and has no opinion about what it returns. The same is true of
> `onExecute`.
>
> Read this section as the contract you should write your predicates *against*,
> not as behaviour you can observe. Nothing here can be verified against a
> running host yet, and the "Rules" below are correspondingly marked.

The ribbon is split: **global host actions on the left, your contextual actions
on the right.** Contextual means the set changes with context — and *you* define
what context means, because the host cannot.

Each ribbon action carries an **id**, a **label**, an **icon**, an optional
**disabled** flag, an **`onExecute` handler**, and an **`isVisible` predicate**.
All six are validated at registration; the two functions are checked for type
and then stored.

The predicate is the interesting one. Once ISSUE-002 lands, on each relevant
render the host will evaluate your predicate against the current
`RibbonContext` and show the action only if it returns true. That is the intended
mechanism by which "Reply" appears when a message is selected and disappears
when nothing is, without the host knowing what a message or a reply is.

```
  ISSUE-002, NOT YET IMPLEMENTED — intended ribbon render loop
  ───────────────────────────────────────────────────────────
  host renders ribbon
        │
        ├─ for each of your ribbonActions:
        │     evaluate action's isVisible against the current RibbonContext
        │        ├─ true  → render the action (label as a text node)
        │        ├─ false → omit it
        │        └─ threw → intended: omit it, report it, keep rendering the
        │                   rest. NOT IMPLEMENTED — there is no evaluation
        │                   site, so today a throwing predicate never runs
        │                   and therefore has no effect at all.
        │
        └─ ribbon renders
```

### Rules for writing predicates

The signature is settled — `isVisible(ctx: RibbonContext): boolean`, with
`RibbonContext` as printed earlier in this guide. The rules below are how you
should write against it. Everything describing what the *host* does with the
result is forthcoming ISSUE-002 behaviour.

- **Predicates must be pure and cheap.** They are intended to be evaluated on
  render, possibly often. No network calls, no writes, no state mutation, no
  `localStorage` access. Read the context you were given and return a boolean.
- **Forthcoming: a throwing predicate will be treated as "not visible."** The
  intent is that the host hides the action, reports the failure, and continues
  rendering the ribbon. **This containment does not exist yet** — there is no
  call site, so nothing catches anything. Do not rely on it, and do not treat a
  throwing predicate as a supported way to hide an action. Return `false`.
- **Predicates must be defensive about their input.** Every field of
  `RibbonContext` is nullable. Selection may be empty, or may reference an item
  that has since been removed. Write predicates that return false in states you
  do not understand rather than assuming a shape.
- **Do not use a predicate as a side-channel.** Using render-time predicate
  evaluation to trigger work is an abuse that will break the moment the host
  changes when it evaluates them.
- **Keep action ids stable and namespaced.** They must match the same allowlist
  as your extension id, and must be unique within your own `ribbonActions` —
  a repeat is a `DUPLICATE_ID` rejection of the whole blueprint at registration
  time. Prefixing with your extension id is the simple way to avoid collisions.
- **Labels are rendered as text nodes.** See below — this matters for security,
  and it also means markup in a label will be shown literally, not rendered.
- **Test your predicates directly.** Since nothing calls them yet, your own unit
  tests are currently the *only* thing exercising them. See the testing section.

---

## Working with the virtualized list

> **Forthcoming — the virtualizer is ISSUE-004 and does not exist.** There is no
> Pane 2 container in `src/`, virtualized or otherwise. The rules below are the
> constraints you should write your row renderers against so that they work when
> it lands; none of them can be observed against the host today.

Pane 2 is to be virtualized: only rows intersecting the viewport, plus a small
overscan, will be mounted. Consequences for your Pane 2 view:

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

> **Forthcoming — pane fault boundaries are ISSUE-004 and do not exist.** No
> error boundary component is present in `src/`. The one containment guarantee
> that *is* live today is at registration: `register` never throws, so a
> malformed or actively hostile blueprint is reported as a returned failure
> instead of unmounting the shell. Render-time containment is not yet built.

The host is specified to wrap each pane and each extension subtree in a fault
boundary. Once that lands, an extension that throws during render will degrade
to a contained error surface inside its own pane, naming your extension, while
the rest of the shell stays interactive.

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

The member list has landed, so here is the whole stub. Keep it typed as
`IShellAPI` rather than as a structural literal — that is what makes the
compiler tell you when the contract grows:

```ts
import { vi } from 'vitest';
// Adjust the relative depth to your own file's location.
import { deepFreeze } from 'src/core/ShellAPI';
import type { IShellAPI, RibbonContext } from 'src/core/types';

const context: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: 'my-ext',
  activeNavNodeId: null,
  selectedItemId: null,
  focusedPane: null,
});

export function makeShellStub(): IShellAPI {
  // Deep-frozen, because the real one is: a test double you can monkey-patch
  // will let code pass that fails against the host.
  return deepFreeze<IShellAPI>({
    setSelectedItem: vi.fn(),
    setBadgeCount: vi.fn(),
    getContext: vi.fn(() => context),
  });
}
```

If you prefer a real implementation over spies, `createShellStateStore()` and
`createShellAPI(store)` from `src/core/ShellAPI.ts` build a working, deep-frozen
instance backed by real state — useful when you want `getContext()` to reflect
the `setSelectedItem` calls your extension just made. That route also gives you
the real argument validation, so a test that passes a non-string to
`setSelectedItem` fails the way production would.

`deepFreeze` is safe to point at anything: it is **total and never throws**,
including on a Proxy whose `isExtensible`, `preventExtensions`, `ownKeys` or
`get` trap throws. An object that refuses to be frozen is returned unchanged
rather than exploding in your test setup. That said, if your double is an
ordinary object literal — as the stub above is — nothing exotic is happening
and the guarantee costs you nothing.

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

**5. Test your visibility predicates directly.** They are pure functions taking
a `RibbonContext`. Call them with the contexts you expect, plus the ones you do
not — every field null, a stale `selectedItemId`, an `activeNavNodeId` that is
not yours — and assert they return `false` rather than throwing. This matters
more than usual right now: **nothing in the host calls `isVisible` yet** (see the
predicates section), so your own tests are the only thing exercising them, and a
predicate that throws will not be contained by anything.

**6. Test your cleanup.** Mount and unmount your views repeatedly and assert
that listeners, timers, subscriptions and observers are released. Extension
switching in this shell causes real mount/unmount churn, and a leak in your
extension degrades the whole application.

**7. Do not test against the host's internals.** If a test needs to import
something from the host that is not part of the public contract, that test is
testing the wrong thing — or the contract has a genuine gap worth reporting.

---

## Checklist before you ship an extension

- [ ] `index.ts` exports the blueprint as a **module-level constant**, not an
      object literal rebuilt per render. Rebuilding it fails with `DUPLICATE_ID`
      under React StrictMode.
- [ ] Every id — extension, navigation node, ribbon action — matches
      `/^[a-z0-9][a-z0-9-]{0,63}$/` and is none of `__proto__`, `constructor`,
      `prototype`.
- [ ] No side effects, network calls or heavy imports at module scope in
      `index.ts`.
- [ ] Ribbon action ids are namespaced; no collisions.
- [ ] The `RegistrationResult` from `register` is checked, and the `id` it
      returns is used rather than re-reading `blueprint.id`.
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
| `src/core/types.ts` | **The source of truth for every contract in this guide.** Landed. |
| `src/core/RegistryContext.tsx` | The registry, its validation rules and its limits. Landed. |
| `src/core/ShellAPI.ts` | `createShellAPI`, `createShellStateStore`, `deepFreeze`. Landed. |
