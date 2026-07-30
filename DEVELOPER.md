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
                                                        │
                 activation mints your handle  ◄─────────┤
                                                        │
   receives ◄──  IShellAPI (deep-frozen, scoped,  ◄─────┤
                 revocable)                             │          ← BUILT
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄
                                                        │      ← ISSUE-002+
   host renders your Pane 1 entry, Pane 2 view,  ◄──────┘
   Pane 3 view, and your ribbon actions
```

Everything above the dashed line exists today: registration, activation, and a
real per-extension `IShellAPI` that reaches you. Everything below it — the
three-pane layout, the ribbon, and anything of yours being *rendered* or *called*
by the host — is ISSUE-002 and later.

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
itself — the optional fields in the contract are `NavigationNode.badgeCount`,
`NavigationNode.children`, `RibbonAction.isDisabled`, `RibbonAction.hotkey`, and
the four modifier flags on `Hotkey`.

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
| `icon` | `string` | **Untrusted icon key.** Non-blank, at most 256 characters. Required. The registry stores it verbatim and **nothing renders it today.** When a ribbon renderer exists (ISSUE-002) it **must** resolve the key through the host's own lookup table and **must not** interpolate it into a URL or into markup — a requirement on that renderer, **explicitly untested**, not a protection in place. See "Security: plugin-supplied strings are untrusted" below. |
| `isDisabled?` | `boolean` | Optional. When present it must be a boolean. Renders the action greyed out but still visible. |
| `hotkey?` | `Hotkey` | Optional keyboard chord for this action. Validated at registration — allowlisted key, boolean modifiers, the WCAG 2.1.4 rule, unique within your own `ribbonActions`. **Nothing dispatches it yet**; the dispatcher is Phase 2. See the `Hotkey` section below. |
| `isVisible` | `(ctx: RibbonContext) => boolean` | Required. Visibility predicate. **It gets the context and nothing else — deliberately no `IShellAPI`; see the predicates section.** Also see the caveat there: the registry checks that this is a function, and nothing calls it yet. |
| `onExecute` | `(ctx: RibbonContext, shell: IShellAPI) => void` | Required. Invoked on activation, with **your own shell handle** as the second argument — that is what lets an action actually change shell state. The host ribbon does not call it yet; the renderer is ISSUE-002. |

> **Contract change — `onExecute` gained a second parameter.** It used to be
> `(ctx: RibbonContext) => void`, which handed the handler four nullable strings
> and no capability, so a ribbon action provably could not change anything. It is
> now `(ctx, shell)`. This is **source-compatible**: a handler that ignores the
> second argument still satisfies the type, so nothing you have written breaks.
> To act on the shell, name the parameter:
>
> ```ts
> onExecute: (ctx, shell) => {
>   if (ctx.selectedItemId !== null) {
>     shell.setBadgeCount('inbox', 0);
>   }
> },
> ```
>
> `shell` is the same deep-frozen, per-extension instance the host holds for you,
> and it is revocable — see "What a released `IShellAPI` does" below. Use the one
> you are handed; do not stash it beyond the life of the call.

### `Hotkey` — a keyboard chord on a ribbon action

> ### ⚠ Declared and validated today. Nothing dispatches it.
>
> The host checks a `hotkey` at registration and stores a normalised, frozen copy
> of it. **There is no `keydown` listener anywhere in `src/`**, no dispatcher, and
> no evaluation site — so declaring a chord today has no observable effect beyond
> the registration succeeding or failing. The dispatcher is Phase 2, because it
> needs the foreground extension and a live `RibbonContext`, neither of which the
> registry has a view of.
>
> Pinned by "finds no listener registration and no key-event name in any module
> under src/" in `src/__tests__/noEventListener.test.ts`, which parses every
> non-test module under `src/` with the TypeScript compiler and fails on
> `addEventListener`, `removeEventListener` or a `keydown`/`keyup`/`keypress`
> name in any code position — so the sentence above stops being a promise the
> moment it stops being true. Comments are not scanned, which is how this
> paragraph is allowed to state the property; a listener reached through a name
> that is not text is outside what it can see, and the test says so. That
> `src/core/hotkeys.ts` itself exports exactly three pure helpers and attaches
> nothing is the separate, narrower "hotkeys module — does not attach anything"
> in `src/core/__tests__/hotkeys.test.ts`.
>
> Write your chords now if you want them; they will work when the ribbon lands.
> Do not write code that assumes one has fired.

```ts
interface Hotkey {
  readonly key: string;      // from the host allowlist, compared lowercased
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}
```

It is a **structured object, not a string.** `"Ctrl+Shift+K"` would need a parser
at the trust boundary, and that parser would have to decide — for untrusted input
— what `Cmd` means, whether `Esc` and `Escape` are one token, and what casing and
interior whitespace mean. Separate fields need none of those decisions. ADR-0001
Amendment H.

**The chord hangs off the action, not off the blueprint.** There is no
blueprint-level `hotkeys` collection, and that is deliberate: a hotkey is a second
way to fire *that action's* `onExecute`, gated by the same `isVisible` and the
same `isDisabled`, and it inherits the 128-action bound and the duplicate walk
that already visit every action. The accepted cost is that you cannot declare a
shortcut that is not also a ribbon action. Amendment H, Decision 1.

| Field | Rules |
|---|---|
| `key` | Required. Must be one of the allowlisted names below, compared lowercased; the registry stores the lowercased form. Anything else is `INVALID_FIELD` on `ribbonActions[n].hotkey.key`. |
| `ctrl?` `alt?` `shift?` `meta?` | Optional. Each must be a `boolean` when present; an explicit `undefined` is treated as absent, as everywhere else in this contract. The stored record materialises all four as explicit booleans. |

**The allowlist** is 61 names: `a`–`z`, `0`–`9`, `f1`–`f12`, `arrowup`,
`arrowdown`, `arrowleft`, `arrowright`, `home`, `end`, `pageup`, `pagedown`,
`enter`, `escape`, `delete`, `insert`, `backspace`.

**Three things are deliberately not on it**, and you should not read the omissions
as oversights:

- **`tab`** — Tab is how a keyboard user moves between controls. Owning it breaks
  focus order for everyone: WCAG 2.1 Success Criteria 2.1.1 Keyboard and 2.4.3
  Focus Order.
- **`space`** — Space activates the focused control. Claiming it globally means
  the focused button stops responding to the key that presses it.
- **Every modifier as a key** — `control`, `alt`, `shift`, `meta`, `capslock`,
  `altgraph`. A modifier is a *field* here; naming one as the `key` describes a
  chord that fires before you have pressed the key you were reaching for.

#### The rule that will surprise you: a single-character key needs Ctrl, Alt or Meta

```ts
{ key: 'k' }                          // REJECTED
{ key: 'k', shift: true }             // REJECTED — Shift produces a character too
{ key: 'k', ctrl: true }              // fine
{ key: 'k', alt: true, shift: true }  // fine
{ key: 'f5' }                         // fine — a function key is not a character
{ key: 'arrowdown' }                  // fine — nor is a navigation key
```

**This is WCAG 2.2 Success Criterion 2.1.4 Character Key Shortcuts, Level A**, not
a house style. A shortcut that is a single printable character and nothing else is
unusable for a speech-input user — dictation emits characters — and hostile to
anyone typing into a surface the shortcut is live over. The criterion is met by
letting the user turn the shortcut off, letting them remap it, or scoping it to
focus; this shell offers none of those three today, so it is met the fourth way:
the host refuses the declaration, with `INVALID_FIELD` on
`ribbonActions[n].hotkey` and a message naming the criterion.

`shift` does not satisfy the rule because Shift changes *which* character is
produced, not *whether* one is. Pinned by "validateBlueprint — the WCAG 2.1.4
modifier rule for character keys" in `src/core/__tests__/validation.test.ts`.

#### Chords bind `event.key`, not `event.code`

The key you name is the **character your layout produces**, not a physical switch
position. On a German QWERTZ keyboard the key where a US keyboard has Z reports
`event.key` as `"y"`, so `{ key: 'z', ctrl: true }` fires on the key that *says*
Z there rather than on the same physical switch. That is the right behaviour for a
mnemonic shortcut and the wrong one for a positional one, and only mnemonics are
offered. ADR-0001 Amendment H, Decision 3.

#### Uniqueness: within your blueprint, not across the shell

A chord may not repeat inside your own `ribbonActions`. The second declaration is
rejected with the code **`DUPLICATE_HOTKEY`** on `ribbonActions[n].hotkey`, and
the comparison is on a canonical form — so a different field order, an absent
modifier where you wrote `false` elsewhere, or a different key casing is the *same*
chord.

**Two different extensions may declare the same chord, and this is not a
conflict.** Hotkeys are scoped to the foreground extension, exactly as ribbon
actions are: only the extension that owns panes 2 and 3 has live chords.
Registration-time cross-extension rejection was considered and refused — it would
make load order semantically load-bearing in a lazily loaded shell, and it would
let the first extension to register squat 128 chords and deny them to everyone
else. The reasoning is in ADR-0001 Amendment H, Decision 6; the behaviour is
pinned by "lets two DIFFERENT extensions declare the same chord" in
`src/core/__tests__/validation.test.ts`.

The practical consequence for you: **do not assume your chord is yours alone.**
It is yours while you are in the foreground, and that is the whole promise.

#### `src/core/hotkeys.ts` — three helpers you may use today

```ts
hotkeyToken({ key: 'k', ctrl: true, shift: true })      // 'ctrl+shift+k'
describeHotkey({ key: 'k', ctrl: true, shift: true })   // 'Ctrl+Shift+K'
matchesHotkey(hotkey, event)                            // boolean, pure
```

`describeHotkey` is what a Phase-2 ribbon will put in a tooltip and in
`aria-keyshortcuts`; `matchesHotkey` takes only the five fields of a keyboard
event it reads (`key`, `ctrlKey`, `altKey`, `shiftKey`, `metaKey`), so a plain
record is enough and it holds no reference to anything live. It matches
**exactly**: a modifier your chord does not declare must also not be held, so
`Ctrl+K` does not fire on `Ctrl+Shift+K`. `Meta` is spelled `Meta` rather than
`Cmd` or `Win`, because the module cannot see the platform.

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
the shell down through an error boundary. Pinned by "register — hostile payloads never
crash the host" and "register — duplicate ids" in `src/core/__tests__/registry.test.tsx`,
"register — thrown values that resist inspection" in `registrySecurity.test.tsx`, and
"register — a weaponised ShellUXError cannot be relocated into the host" in
`registryNormalization.test.tsx`.

That contract is `register`'s. The separately exported `validateBlueprint` has no
`catch`: it throws instead of returning a result. Every rejection it decides on is a
`ShellUXError`, including a revoked `Proxy` in any field position — the raw `TypeError`
it used to leak from five `Array.isArray` sites was closed in Phase 1, pinned by
"validateBlueprint — a revoked Proxy" in `src/core/__tests__/validation.test.ts`. What it
still does is propagate a throwing property getter untyped, pinned as current behaviour
by "still propagates whatever a throwing property getter threw" in the same file and
recorded as an open follow-up in `.github/ISSUES_MANIFEST.md`. Use `register`.

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
| `DUPLICATE_HOTKEY` | Two of **your own** ribbon actions declared the same chord. Scoped to your blueprint on purpose — two *different* extensions claiming one chord is not a conflict, because only the foreground extension's chords are live. See the `Hotkey` section above and ADR-0001 Amendment H. |
| `PAYLOAD_TOO_LARGE` | A string or a collection exceeded its declared bound. |
| `REVOKED` | The `IShellAPI` you called has been revoked — your extension was released, unregistered, or **re-registered under the same id with a different blueprint** — so the call reached nothing and changed nothing. Never produced by `register`. **Provider teardown is not on that list**, and an earlier version of this row said it was; ADR-0001 Amendment F removed teardown revocation, and a write through a handle retained past its provider's unmount now succeeds against an orphaned store nothing can read. Do not park a handle that long. Pinned by "does not revoke, and the write it lets through cannot reach a live shell" in `src/core/__tests__/capability.test.tsx`. |
| `REENTRANT_NOTIFY` | A shell-store listener wrote back to the store and the notification cascade hit its depth limit. A listener is a signal to *re-read* the context, never a place to write to it. Never produced by `register`. |

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

   **When you take that upgrade path, the `IShellAPI` you were holding dies.** It
   has to: the id now belongs to a new registration, and a handle scoped to the old
   one would be writing badges into the new one's scope. So `unregister` +
   `register` under the same id revokes your previous handle even when both
   statements are in the same event handler and React batches them into one commit,
   and the next `activate` hands the host the *new* record rather than a cached copy
   of the old one. Take a fresh `shell` from your props and from `onExecute` after an
   upgrade; do not carry one across it. (This was a real defect: liveness used to be
   keyed on the id still being registered, which answered *yes* throughout the whole
   operation. ADR-0001 Amendment E.)

This exists because a validated object you can still reach is a validated
object you can still edit, and the host cannot tell an honest edit from a
hostile one. Reference identity is still what makes StrictMode
re-registration idempotent — the registry remembers your original object
privately for exactly that comparison — so the module-level-singleton rule
below is unchanged. Pinned by "register — the stored record is host-owned", "register —
a lying `length` cannot grow the payload after it is measured" and "keeps StrictMode
idempotency keyed on the plugin object, not on the copy" in
`src/core/__tests__/registryNormalization.test.tsx`.

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
runtime will not stop you from committing — pinned, from inside a plug-in subtree, by
"does NOT sever useRegistry, so unregister stays a route to ending a sibling" in
`src/core/__tests__/capability.test.tsx`.

---

## The `IShellAPI` contract

`IShellAPI` is what the host hands *you*. It is the entire surface you are
permitted to touch.

> **Activation has landed; pane rendering has not.** The host now mints a real
> per-extension `IShellAPI` for you: `ShellHostProvider` owns the shell state
> store, and **the host** activates you, which produces an `ActiveExtension`
> carrying your `id`, your host-owned `blueprint` record, and your `shell`. What
> is still ISSUE-002 is the *layout* — there is no three-pane surface that renders
> your views, so nothing calls your components or your ribbon actions for you yet.
> Write your views to take `shell` from their props, as the type says.
>
> **Do not call `useActivation()`.** An earlier version of this guide told you to
> reach for `useActivation().activate('your-ext')` to get your handle. That was
> wrong, and it was wrong in a way that mattered: the object `useActivation()`
> returns is the host's `ActivationController`, and it carries `release(id)` and
> `activate(id)` for *any* id — so following that instruction put a capability in
> your hands that could revoke a sibling extension and take over its `shell`.
> `useActivation()` now **throws** from inside an extension subtree, which is a
> guardrail against exactly that mistake rather than a boundary that stops a
> determined caller — see "There is no `revoke` on your `IShellAPI`" below for what
> that distinction means and why it is stated plainly. Your `shell` arrives the way
> the types always said it would: as a prop on your view, and as the second argument
> to `onExecute`.
>
> What you *can* ask for is [`useExtensionActivation()`](#useextensionactivation),
> which answers "am I in the foreground?" and nothing else.

Three properties of it are load-bearing for how you write your code:

**1. It is deeply frozen.** Recursively — not just the root object. You cannot
add to it, replace anything on it, or patch a nested service. Attempts are a
no-op in sloppy mode and a `TypeError` under strict mode, which is how your
modules will run. Design your extension as a consumer of this object, never as a
modifier of it. Pinned by "is deep-frozen: strict-mode reassignment throws", "is
deep-frozen: sloppy-mode reassignment is a silent no-op" and "cannot have its prototype
swapped" in `src/core/__tests__/shellApi.test.ts`.

**That is a claim about method replacement on this object, and nothing wider.** An
earlier version of this paragraph called it "the mechanism that stops one extension
from tampering with the shell services other extensions depend on", which is one step
too far: it stops a method being swapped out from under another holder, and that is all
the freeze does. It does not stop a listener seeing or overwriting what you write
(`src/core/__tests__/subscribe.test.tsx`), it does not stop another extension setting
properties on your view components (`capability.test.tsx`, "pins the accepted limit:
the view components and callbacks take new properties"), and it does not stop the fiber
walk (`reflection.test.tsx`).

**2. It is scoped to you, and you cannot name the scope — which buys
collision-resistance, not confinement.** Your instance is minted for your extension
id and closes over it. `setBadgeCount('inbox', 4)` writes to *your* `inbox`; another
extension calling `setBadgeCount('inbox', 9)` writes to its own, so **two extensions
that pick the same node id cannot overwrite each other**. **The scope is not a
parameter**, so through this interface there is nothing to pass and nothing to
spoof — an extra argument is ignored, because the implementation reads the two
parameters the interface declares. Pinned by "keeps two extensions that both use the
node id \"inbox\" apart" and "does not let an extension name the scope it writes to" in
`src/core/__tests__/dataflow.test.tsx`.

An earlier version of this paragraph ended "and neither can see or overwrite the
other's", and that was false. `useShellStore()` is public — this guide lists it —
and `store.getBadgeCount('other-ext', 'inbox')` reads another extension's badge
while `store.setBadgeCount('other-ext', …)` writes one. **Badge scoping is not a
privacy or confinement mechanism.** Do not put anything in a badge that would matter
if another extension read or changed it, and do not rely on the scope to keep
another extension out. What it genuinely gives you is that you may name your nodes
whatever you like without coordinating with other vendors. The *absence* of confinement
is pinned too — "reaches the host ActivationController by reflection anyway, and steals
a sibling handle" in `src/core/__tests__/reflection.test.tsx` reads a scope back out of
the store.

This scoping is real for badges today. It is also the shape persisted state will
take when ISSUE-003 lands; **no persistence member exists on the interface yet**
(see the member list below), so do not write code that calls one — and note that
persisted state will need its own confinement answer rather than inheriting this
one, because there isn't one here to inherit.

**3. It is revocable, and revocation is loud.** Your instance stays live across
any number of foreground changes, and dies for exactly two reasons: the host
`release`s your extension, or your extension is unregistered. After that, every
member throws — `getContext` included. See "What a released `IShellAPI` does" below.
Pinned by "mints a live IShellAPI on activation and revokes it on release", "losing the
foreground revokes nothing" and "revokes when the extension is unregistered" in
`src/core/__tests__/dataflow.test.tsx`.

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
| `setBadgeCount(nodeId, count)` | Sets the badge count for one of your navigation nodes, **in your own scope** — see property 2 above. **This one throws.** It raises `ShellUXError` with code `INVALID_ID` when `nodeId` is not a string, or does not match the same allowlist and reserved-word rules the registry applied to your node ids, and code `INVALID_FIELD` when `count` is not a non-negative safe integer. Call it with values you control, or wrap it. |
| `getContext()` | Returns a frozen snapshot of the current `RibbonContext`. A snapshot, not a live view: hold the result only for the duration of the work you are doing, and call again rather than caching it across renders. |

`setSelectedItem` and `setBadgeCount` reject a bad argument; `getContext` takes no
argument to reject. **None of the three is total, and `getContext` is not an
exception:** all three throw `REVOKED` once your extension is released or unregistered
(pinned in `dataflow.test.tsx`), and the two writers can additionally deliver whatever a
store listener throws — see "Where that stops" near the end of this guide. Note the
asymmetry with `register`, which never throws: `IShellAPI` is called by *you*, so a bad
argument is your bug and is reported as an exception, whereas `register` is called by the
*host* on your data, where an exception would take the shell down.

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

### The activation lifecycle — two states, not one

The host tracks **two independent things** about your extension. Confusing them
is the source of the bug report "why did my badge stop updating when the user
clicked away?", so it is worth two minutes.

| | **Foreground** | **Liveness** |
|---|---|---|
| What it means | You own panes 2 and 3 right now | You hold a usable `IShellAPI` |
| How you get it | The host `activate`s you | Your first activation |
| How many extensions at once | One, or none | Any number |
| How you lose it | The host activates someone else, or calls `blur()` | The host `release`s you, or your blueprint is unregistered |
| What losing it does to your `shell` | **Nothing. It stays live.** | Revokes it permanently |

Two consequences you can build on:

1. **Being backgrounded does not silence you.** Your views are unmounted when
   another extension takes the panes, but your `IShellAPI` still works. A mail
   module can go on pushing unread counts into pane 1 while a CRM module owns the
   content panes. This is the point of the split.
2. **Coming back to the foreground gives you the same handle.** Re-activation
   reuses your existing instance rather than minting a new one, so a reference you
   are holding stays valid. Only losing *liveness* invalidates it.

`RibbonContext.activeExtensionId` is the published view of the foreground: it is
your id while you are in front, and `null` while nobody is.

### What a released `IShellAPI` does

**It throws. It does not quietly do nothing.**

Once your extension is released or unregistered, every member of the instance you
were given raises `ShellUXError` with code `REVOKED`, and the shell state is left
exactly as it was. **This is immediate, not eventual.**

**What makes it true**, because until recently it was not quite: on every single
call the handle re-asks the host a question keyed on the exact blueprint **record**
it was minted against — `does the registry still hold this record under this id?` —
rather than the weaker "is this id still registered?". (That question used to have a
second clause, `and is the host provider still mounted?`; it is gone, and the
paragraph below the code block says why.) Being unregistered used to be checked from
an effect, so your handle
went on working for the rest of the event handler that removed you and across the
first `await` after it. Then the call-time check was keyed on id presence, which
covered that but silently did *not* cover `unregister` immediately followed by
`register` under the same id: React batches those into one commit, the id was
present throughout, and the old handle stayed live. Record identity is a fresh
object per registration, so both cases are now closed and neither depends on
anything having called the handle earlier. The statement after `unregister` fails:

```ts
// After the host has released 'my-ext':
retained.setSelectedItem('item-1');  // throws ShellUXError, code 'REVOKED'
retained.getContext();               // throws ShellUXError, code 'REVOKED'
```

This is deliberate, and it is the behaviour you should want. A silent no-op would
mean a selection that mysteriously never sticks and a badge that mysteriously
never appears, with nothing in the logs; an exception names the problem at the
call site. It also means **the honest fix is not a `try`/`catch`** — it is not
holding the handle past its life. Take `shell` from your props and from your
`onExecute` argument, use it for the work in front of you, and do not park it in a
module-level variable, a closure that outlives your view, or a `setTimeout` that
fires after your extension is gone.

**There is no third event, and this guide claimed there was one.** It said the host
tearing down its `ShellHostProvider` also revoked every handle it had minted. It no
longer does, and the two attempts to make it do so were both defects — each broken
in development and correct in production, because a React cleanup cannot tell a real
unmount from StrictMode's simulated remount. The second attempt permanently killed a
perfectly live handle whenever an extension used it inside the same mount effect that
took it, which is exactly the pattern shown in this guide.

So a handle retained past its provider's unmount does **not** throw. What it reaches
is an orphaned store: nothing subscribes to it, nothing can obtain it, and it is not
the store a replacement provider would create — so the write goes nowhere a user can
see, silently. That is a diagnostic loss and it is accepted, recorded in ADR-0001
Amendment F. **It makes the advice above load-bearing rather than belt-and-braces:**
do not park a handle in a module-level variable, a closure that outlives your view,
or a `setTimeout` that fires after your extension is gone. `release` and `unregister`
will still tell you loudly. Provider teardown will not tell you at all. All three
behaviours are pinned by "does not revoke, and the write it lets through cannot reach a
live shell" in `src/core/__tests__/capability.test.tsx`, which asserts the non-throwing
write, the orphaned store, and `release` and `unregister` each still ending a handle.

### There is no `revoke` on your `IShellAPI`, and the controller is not handed to you

There is no `revoke` member on your `IShellAPI`. `Object.keys(shell)` is exactly
the three members above, `revoke` lives on a wrapper object the host keeps, and it
closes over a variable no other scope can reach. That part is unconditional.

**What this section used to claim beyond that was false, twice over.** It first
said flatly that "no extension can release itself or anyone else", while the host's
`ActivationController` — which carries `release(id)` for any id, and whose
`activate(id)` *returns another extension's `shell`* — was published to the entire
provider subtree where your views render. Worse, this guide told you to call it.
Then it said the controller was host-only "and structurally so", which was also
wrong, for a reason worth understanding.

**What is actually in place — a guardrail, and a good one:**

- The host wraps your subtree in an `ExtensionHostBoundary`, which takes the
  controller out of context for everything below it.
- `useActivation()` **throws** below that boundary. It does not return a reduced
  controller; it refuses.
- The context objects involved are module-private, so you cannot re-provide them
  through the public API to undo it. Nesting your own `ShellHostProvider` inside a
  boundary does not hand the capability back through `useActivation()`, and passing
  a non-string `extensionId` to a boundary — which used to clear the scope marker
  rather than set it — is now a throw.

All three are pinned under "ExtensionHostBoundary severs the host activation controller"
in `src/core/__tests__/capability.test.tsx`, and what the guardrail *does* hand a plug-in
by "gives a plug-in no capability through the documented channel" in
`reflection.test.tsx`.

**What it is not: isolation.** The capability is not stored in React context; it is
stored in `useMemo`/`useCallback`/`useRef` hook state on the host provider's fiber,
and React attaches fibers to DOM nodes under an ordinary enumerable property. Any
script on the page reaches `document.body.firstElementChild`, enumerates its keys,
walks the fiber tree, and arrives at the controller — no ref, no export, no import,
and nothing the boundary can do about it. This is reproduced in the host's own test
suite (`src/core/__tests__/reflection.test.tsx`), which performs the escalation and
asserts that it works. Mitigations were tried and rejected; the evidence is in
ADR-0001 **Amendment E**, along with the firm condition under which this posture is
void and real isolation becomes mandatory.

So the honest statement for you as an author is: **do not call `useActivation()`,
and write your extension as though other extensions in the page can do anything you
can do.** The boundary exists to make the first of those a loud error rather than a
silent mistake. It does not make the second untrue.

**Three limits, and the fact that this list can be written is the point.** A
boundary that has to be defended by enumerating channels is not enforcing anything.

*First*, reflection over React's fiber tree, above. It is not closable in-page, and
it makes the other two secondary.

*Second*, this applies to a subtree the host *wrapped*. Host code that renders
extension components as its own siblings, outside any boundary, is handing them host
capability, and no structure in this module can prevent that. Pane rendering — the
code that will do the wrapping in production — is ISSUE-002 and does not exist yet.

*Third*, `useRegistry()` is **not** severed at the boundary, and `unregister`
carries no authorisation — the deliberate decision recorded above and in ADR-0001
Amendment B. So an extension can end a sibling's liveness by unregistering it, and
since revocation is immediate that takes effect at once. It can also call
`getExtension(someoneElsesId)` and get the sibling's host-owned record, whose view
components and callbacks are carried across **unfrozen** — see the next section but
one. `useRegistry` stays reachable because it is how you register yourself in the
first place; putting an ownership model in front of it needs its own issue and its
own threat model.

### What the host really guarantees, in three words

Read these before relying on anything above. The same three terms are used in
`README.md` and ADR-0001, and every security claim in this guide is placeable in
exactly one of them.

| Term | Means | Examples here |
|---|---|---|
| **Integrity control** | Real and unconditional; holds against any caller however hostile. | The shell state store cannot be subverted: its state is held in closure variables no reflective API can reach, the store object is frozen so none of its methods can be replaced, and every method validates — so nothing can put a value of the wrong shape into that store's context. Your deep-frozen `IShellAPI` cannot have a method swapped out. The registry stores a normalised, frozen, host-owned copy. Registry and badge stores are `Map`s, so a plug-in key can never reach `Object.prototype`. Revocation is keyed on the blueprint record, so it cannot be undone. |
| **Entry-point validation** | Real at the documented door; bypassable by a caller who reaches internals another way. | Id allowlisting, reserved-word refusal, every length and count bound, `setBadgeCount`/`setSelectedItem`/`patchContext` argument checks. |
| **Guardrail** | Prevents honest mistakes only; enforces nothing against deliberate action. | `ExtensionHostBoundary`, `useActivation()`'s refusal below it, `useExtensionActivation()`, the registry sweep's listener guard, and "`isVisible` predicates must be pure" — the signature closes the direct route, it does not close a captured one. |

Every one of those cells names its tests in `README.md`'s "Security posture" section,
which is where the full list lives. **No security sentence in this guide may stand
without naming the test that exercises it** — see "The rule about security claims"
below.

> **Corrected twice, and the second correction is why the rule below exists.**
>
> *First:* the integrity-control cell used to end its first example with "so
> `RibbonContext`'s declared types are true at runtime *for every caller*, and no
> other extension can push a live object into the `selectedItemId` your predicates
> read." The store object was not frozen when that was written, so another extension
> *could* replace `setSelectedItem` outright and decide what your predicates read —
> through the public `useShellStore()`, with no reflection involved. The freeze is in
> place now and the sentence is stated at its real width: it is a promise about **that
> store's** integrity. It is not a promise that the context object your component is
> handed came from that store, because the store is published through React context
> and ADR-0001 Amendment E covers what a determined caller reaches.
>
> *Second:* the cell **still** ended "and nothing can intercept or forge the writes
> another extension makes through it." That clause is **false and has been deleted.**
> The premise is about *replacing a member of the store*; `subscribe` needs nothing
> replaced. `subscribe` is one of the frozen members, it is reachable through the
> public `useShellStore()`, and it runs plug-in code synchronously inside your write.
> So another extension in this page **can** see every value you write before your call
> returns, **can** overwrite it by writing back from inside the notification, and
> **can** throw an arbitrary exception into your writing statement — including one that
> is not a `ShellUXError`, and including one that starves a subscribed pane so it keeps
> rendering a stale snapshot. Reproduced in `src/core/__tests__/subscribe.test.tsx`,
> the whole file. Freezing the store does not touch any of it, and neither will
> anything else in-page: a store that notifies nobody is a store no pane can render
> off.
>
> If your extension's behaviour must be tamper-evident against another extension in
> the same page, see the paragraph directly below.

### The rule about security claims

> **No security claim may appear in prose — in any `.md` file or any docblock —
> unless it names the test that exercises it.**

If nothing exercises a claim, the claim is narrowed until an existing test does, or it
is deleted. Deleting it is a correct outcome, not a failure. This guide is held to the
rule, and so is every docblock in `src/core/`.

The reason is seven consecutive review rounds that each found the same defect with the
*code being sound every time*: a conclusion written one step wider than the premise
licensing it. The history and the site from each round are in ADR-0001 **Amendment
G**. It is a review-time convention and **no script checks it** — so if you find a
security sentence here with no test named beside it, that is a documentation bug worth
reporting.

And one term that is deliberately *not* used: **confinement.** Nothing here confines
one extension from another. Badge scoping is collision-resistance. If your
extension's behaviour must be tamper-evident against another extension in the same
page, this architecture does not give you that today, and ADR-0001 Amendment E
records exactly what would have to change first.

<a id="useextensionactivation"></a>

### `useExtensionActivation()` — what you get instead

Facts, no capability:

```ts
interface ExtensionActivationView {
  readonly extensionId: string;            // yours
  readonly foregroundExtensionId: string | null;
  readonly isForeground: boolean;
}
```

It re-renders your component when the foreground changes, the returned object is
frozen, and its identity is stable until one of the two ids moves, so it is safe
in a dependency array. It throws when called outside an `ExtensionHostBoundary`.

Everything on it you could already read: `foregroundExtensionId` is
`getContext().activeExtensionId`, and `extensionId` is your own id, which you
wrote. That is the test a member has to pass to be on this interface — it tells
you nothing you could not already learn, and lets you *do* nothing at all.

### One thing the host does not protect: your components are mutable

Your view components and your `isVisible`/`onExecute` callbacks are carried into
the host's records **by reference and unfrozen**, as documented above — a
component reference has to keep its identity, and freezing it breaks `memo` and
`forwardRef` internals.

The consequence, stated rather than glossed: those function objects still accept
new own properties. Another extension can set, for example, `defaultProps` on your
view component and change what it renders. This has been reproduced; it is not
theoretical. Freezing is not the fix, and the host does not do it. Pinned by "pins the
accepted limit: the view components and callbacks take new properties" in
`src/core/__tests__/capability.test.tsx`.

**And the reach is not bounded.** This section used to say it "is bounded by who can
obtain an `ActiveExtension` — only the host-only `ActivationController` hands one
out — but within that boundary it is real." That does not hold. `getExtension(id)`
returns the host-owned record carrying the *same* function objects, and
`useRegistry()` is not severed at the boundary — so any component in the tree
reaches your view components without any `ActiveExtension` for you ever existing.
That has been reproduced from an extension subtree and is pinned by "does NOT sever
useRegistry, so unregister stays a route to ending a sibling" in
`src/core/__tests__/capability.test.tsx`. The reflective route in ADR-0001 Amendment E
reaches them too, pinned in `src/core/__tests__/reflection.test.tsx`.

This sits inside the **"No sandbox"** limit in ADR-0001, and it is the reason that
limit is worth reading rather than skimming. The containers the host owns are
frozen; the plug-in functions inside them are not, and nothing stands between them
and another extension. If your extension's behaviour must be tamper-evident against
another extension in the same page, this architecture does not give you that, and no
amount of freezing at this layer would.

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
**disabled** flag, an optional **hotkey**, an **`onExecute` handler**, and an
**`isVisible` predicate**. All seven are validated at registration; the two
functions are checked for type and then stored, and the hotkey — which nothing
dispatches yet — is normalised and frozen. See the `Hotkey` section above.

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

**Your predicate gets the context and nothing else. `onExecute` gets the
context and your `shell`.** That asymmetry is deliberate and it will not be
relaxed. A predicate is evaluated *during render*; a capability to mutate shell
state during render is a hazard, not a convenience — a predicate that wrote would
notify the store mid-render and re-enter the component that is rendering, which
loops or tears depending on timing. If an action needs to change something, that
belongs in `onExecute`, which is called in response to a user action and is handed
the handle to do it with.

> **Corrected.** This paragraph used to end "Keeping `isVisible`'s argument list
> read-only is what makes 'predicates must be pure' a structural fact rather than a
> request." It is not a structural fact. A signature constrains arguments, not
> closures: a predicate written inside a view that called `useShellStore()` captures
> a store and writes when it runs, which was reproduced — the context afterwards held
> `selectedItemId: "written-from-isVisible"`. Purity is a **guardrail** in the
> vocabulary this guide uses: the direct route is closed and the honest mistake is
> hard to make by accident. It stays **your** obligation, which is what the next
> bullet's last clause has always said.

- **Predicates must be pure and cheap.** They are intended to be evaluated on
  render, possibly often. No network calls, no writes, no state mutation, no
  `localStorage` access. Read the context you were given and return a boolean.
  You are not handed an `IShellAPI` here, so the most direct way to write is
  closed to you — do not reach for one you captured elsewhere either.
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
get proxied, get mirrored, and get compromised. The boundary has to be enforced at
render because that is the only place it *can* be enforced reliably — and "has to be"
is the accurate mood: **nothing in the host enforces it and no test exercises it**,
because there is no shell component that renders plug-in content yet (ISSUE-002,
ISSUE-004). The registry deliberately does not sanitize, since escaping data at rest
produces double-escaped text the moment a correct renderer is put in front of it.

### The rest of the rules

**These are obligations on your code, not protections the host provides.** None of them
is enforced by the host and none has a test in the host's suite; where the host *does*
enforce something, the claim names its test. Per ADR-0001 Amendment G, that distinction
is stated rather than left for you to infer from the imperative mood.

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
  contract violation. Note carefully that it is *not* impossible: the namespacing
  gives collision-resistance, not confinement, and `useShellStore()` reaches any
  scope. This is a rule you are asked to follow, and the runtime will not stop you
  breaking it — which also means you cannot assume another vendor's extension is
  being stopped.
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
compiler tell you when the contract grows.

**The imports below are relative, and deliberately so.** This repository declares
no path alias — there is no `paths` entry in `tsconfig.json` and no
`resolve.alias` in either Vite config — so a bare `src/core/...` specifier does
not resolve, and every one of the host's own imports is relative. An alias would
have to be declared in three separate files that nothing forces to agree, and it
would not exist at all in *your* build, which is where this snippet actually
runs. So the paths are relative, and the depth below assumes this file lives at
`src/extensions/my-ext/__tests__/shellStub.ts`. Count the `../` from wherever
you put yours.

```ts
import { vi } from 'vitest';
// Relative to src/extensions/my-ext/__tests__/ — three levels up is src/.
import { deepFreeze } from '../../../core/ShellAPI';
import type { IShellAPI, RibbonContext } from '../../../core/types';

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

Two things to know about that route:

- **Read badges back with the scope.** The store API is
  `getBadgeCount(extensionId, nodeId)`, because badge state is namespaced. The
  facade `createShellAPI(store)` builds is the *unscoped host* one, and its writes
  land in a host scope no extension id can name — so assert on the calls, or use
  `createRevocableShellAPI(store, 'my-ext')` and read back with your own id.
  **Both arguments are validated at both doors**, so `getBadgeCount` raises
  `ShellUXError` with code `INVALID_ID` on a malformed scope or node id rather than
  returning `undefined`. If a read is unexpectedly throwing in a test, check the
  spelling of the id before anything else. Pinned by "the badge scope and node id are
  validated at both doors" in `src/core/__tests__/shellApi.test.ts`.
- **`createRevocableShellAPI(store, 'my-ext')` returns `{ api, revoke }`** and is
  how you test the released state: call `revoke()`, then assert that your code
  gets a `ShellUXError` with code `REVOKED` rather than silently losing a write.
  That is exactly what production does to you when your extension is released. It
  validates `extensionId` up front — the `REVOKED` message names the extension, so
  the name has to be a real id — so pass a well-formed one.

`deepFreeze` is safe to point at anything: it is **total and never throws**,
including on a Proxy whose `isExtensible`, `preventExtensions`, `ownKeys` or
`get` trap throws. An object that refuses to be frozen is returned unchanged
rather than exploding in your test setup. Pinned by "deepFreeze — hostile objects cannot
make it throw" in `src/core/__tests__/shellApi.test.ts`, which covers all four traps.
That said, if your double is an
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

**5a. Test your `onExecute` handlers with a real shell.** They now take
`(ctx, shell)`, so they are testable end to end without the host: build a store,
mint a scoped handle, call the handler, and assert on the *state that resulted*
rather than on the spy. Cover the released case too — a handler invoked with a
revoked handle must not swallow the `REVOKED` error and report success.

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
- [ ] Every `hotkey` uses an allowlisted key, carries Ctrl/Alt/Meta if the key is
      a single character (WCAG 2.2 §2.1.4 — Shift does not count), and is unique
      within your own `ribbonActions`. No code assumes a chord has fired: nothing
      dispatches one yet.
- [ ] The `RegistrationResult` from `register` is checked, and the `id` it
      returns is used rather than re-reading `blueprint.id`.
- [ ] Every visibility predicate is pure, cheap, and returns false on states it
      does not understand. None of them writes through a captured `IShellAPI`.
- [ ] Every `onExecute` uses the `shell` it is handed as its second argument, and
      does not retain it past the call.
- [ ] No `IShellAPI` reference is parked in a module-level variable, a long-lived
      closure or a timer that can fire after the extension is released — a revoked
      handle throws `REVOKED`, it does not no-op.
- [ ] Badge node ids are your own tree's ids. Through `IShellAPI.setBadgeCount`
      the scope is not a parameter, so your write lands in your own scope and
      cannot collide with another extension's — a badge that "does not show up" is
      usually a wrong node id. **It is not *only* that**, and this item used to say
      "You cannot write to another extension's scope", which would send you looking
      in the wrong place: the store behind the facade is public, so anything in the
      page can write your scope through `useShellStore()`. If a badge holds a value
      you never wrote, that is possible, and it is a limit of the architecture
      rather than a bug in your extension. See "collision-resistance, not
      confinement" above, and `src/core/__tests__/dataflow.test.tsx` (badge isolation)
      for what *is* pinned.
- [ ] No assumption that a write you make is private, atomic, or exception-free.
      A store listener registered by anyone in the page runs inside your write: it
      sees the value, may overwrite it, and may throw into your call. See "Where that
      stops" near the end of this guide and
      `src/core/__tests__/subscribe.test.tsx`.
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
| `src/core/ShellAPI.ts` | `createShellAPI`, `createRevocableShellAPI`, `createShellStateStore`, `useShellContext`, `useShellStore`, `ShellStoreContext`, `deepFreeze`. Landed. |
| `src/core/ActivationContext.tsx` | `ShellHostProvider`, `ExtensionHostBoundary`, `useActivation` (host-only *by guardrail* — read the second banner in that file), `useExtensionActivation`, the two-state activation model and revocation. Landed. |
| `src/core/hotkeys.ts` | `hotkeyToken`, `describeHotkey`, `matchesHotkey`. Three pure functions over a chord — no DOM, no listener, no dispatcher. Landed. |

`useShellStore` and `ShellStoreContext` are in that list deliberately, and their
omission from an earlier version of it was a documentation defect rather than a
harmless one: `useShellStore()` is the public route to the raw, unscoped,
unrevocable store, and a reader who did not know it was exported could not judge
the trust boundary. It is exported, plug-in code can call it, and that is why every
member of the store validates its own arguments — see ADR-0001, Amendment D.

The store itself, by contrast, cannot be subverted. `context`, `badgeCounts`,
`listeners` and `notifyDepth` are closure variables inside `createShellStateStore`,
and JavaScript has no reflective API for a scope: no `Object.keys` for a closure,
nothing on a function object that exposes what it captured. Anything that gets hold
of the store gets its six methods and never the state behind them. And the store
object is **frozen**, so none of those six can be replaced, deleted or added to,
while every one of them validates its arguments. So nothing — however hostile — can
put a value of the wrong shape into that store's context. That is an **integrity
control**, and it is the reason you can write a predicate that trusts
`ctx.selectedItemId` to be a `string` or `null` and nothing else. Pinned by "gets the
store methods, cannot replace one, and cannot put an illegal value through one" and
"never reaches the badge map itself, because it is a closure variable" in
`src/core/__tests__/reflection.test.tsx`, by "the store handed out by useShellStore is
frozen" in `capability.test.tsx`, and by the whole of `contextPatch.test.ts`.

**Where that stops, and this is the part you have to plan around.** The paragraph above
used to continue "and nothing can intercept, suppress or forge the writes and reads
another extension makes through it." That is **false** and has been deleted. The
premise is about *replacing a member*, and `subscribe` needs nothing replaced:
`subscribe` is one of the frozen six, `useShellStore()` is public, and a listener runs
**synchronously inside your write, before your call returns**. So another extension in
this page can:

- **read every value you write**, as you write it;
- **overwrite it**, by writing back to the store from inside the notification — one
  shallow cascade is legal and is nowhere near the reentrancy cap;
- **throw into your statement**, with anything it likes. `setSelectedItem` is
  documented `@throws {ShellUXError}`; a listener can hand you a raw `TypeError`
  instead;
- **starve a pane.** A listener that throws aborts the whole notification pass, so
  every listener after it — including a pane's `useSyncExternalStore` subscription —
  is never told, and that pane keeps rendering the old snapshot until something else
  re-renders it.

All four are reproduced in `src/core/__tests__/subscribe.test.tsx`. None of them is
closable in-page: a store that notifies nobody is a store no pane can render off. **If
your extension's behaviour must be tamper-evident against another extension in the same
page, this architecture does not give you that** — and if you must guard one of your own
writes, wrap the call yourself, which is what the host does at the one call site it
cannot leave to you (the registry sweep in `ActivationContext.tsx`).

> **Corrected, and the hedge it refused is the correction.** This paragraph used to
> call the store "the one place this guide will state a security property without a
> hedge", and concluded that "the types printed in this guide for `RibbonContext` are
> true at runtime no matter who is calling". The store object was not frozen when
> that was written. Another extension could replace `setSelectedItem` and decide what
> your predicate reads — through the public `useShellStore()`, no reflection needed —
> which is precisely the property the sentence was asserting. Two lessons are kept
> rather than edited away: the freeze now exists, and the claim is scoped to **that
> store**. It is not a claim that the context object handed to your component came
> from that store; the store is published through React context, and ADR-0001
> Amendment E covers what a determined caller on the page reaches. A guide that
> announces it is dropping its hedges is announcing where to look for its next
> overclaim — and the very next sentence, the `subscribe` clause deleted above, is
> exactly where it was.

Three more files worth reading before you rely on any boundary in this guide:

| File | Why |
|---|---|
| `docs/adr/0001-ioc-registry-architecture.md`, **Amendment E** | Why there is no enforceable boundary between two extensions, what was tried, and the firm condition that voids the decision. |
| `docs/adr/0001-ioc-registry-architecture.md`, **Amendment G** | The rule that no security claim may be written without naming its test, and the seven rounds of evidence for why it was needed. |
| `src/core/__tests__/reflection.test.tsx` | The host's own test that *performs* the escalation and asserts it succeeds, so nobody mistakes a guardrail for a guarantee. |
| `src/core/__tests__/subscribe.test.tsx` | The host's own test that performs the interception, the suppression and the throw-into-your-frame, for the same reason. |
