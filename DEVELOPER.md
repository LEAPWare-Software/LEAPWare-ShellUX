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

**ISSUE-002 — the three-pane resizable layout and the ribbon renderer — has now
been implemented and is covered by tests**, so the passages describing the ribbon
and the panes are written in the present tense and name the tests that hold them.
It has **not yet been merged**; see the status note against ISSUE-002 in
[`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md), which explains why it
is not marked `LANDED`.

**ISSUE-003's hydration engine now exists, is tested, and the shell consumes it.**
`src/core/services/HydrationEngine.ts` and `src/hooks/useLocalStorageState.ts` are
implemented and inside the same 100% coverage gate, and
`src/components/layout/ShellLayout.tsx` now restores and writes **three** slots:
the pane sizes, the pane-1 collapsed flag and the id of the foreground extension.
An earlier version of this paragraph said nothing in the shell was wired to any of
it; that stopped being true and the correction is the reason this paragraph is
still here rather than deleted.

**What is NOT persisted, stated because "hydration is wired" invites the opposite
assumption:** the utility drawer flag, the selected navigation node and the
selected item, the measured window width, and pane sizes changed while pane 1 is
collapsed. And — the part that matters most to you — **`IShellAPI` still has no
persistence member, so your extension cannot reach the engine at all.** The
per-extension scopes the engine supports are reached by no code in the shell. The
three slots above are the host's own, and the host writes them.
*Tests:* `src/components/__tests__/ShellLayoutPersistence.test.tsx` — "persists a
pane size the user changed, and a second shell over the same storage opens into
it", "persists the pane-1 collapsed flag, and a second shell over the same storage
opens collapsed", "brings the persisted extension back to the foreground once it
registers" and "persists no drawer state, so a reload opens with the drawer shut".

ISSUE-004 has since landed the row virtualizer and the fault boundaries, and
ISSUE-006 has landed hotkey dispatch; all three sections below have been rewritten
out of the future tense. What is still specified only is the mock extensions and
the integration suite (ISSUE-005). This guide marks such passages explicitly.

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
                                                        │
   host renders your Pane 1 entry, Pane 2 view,  ◄──────┤          ← BUILT
   Pane 3 view, and your ribbon actions                 │
   the shell restores its layout and your foreground  ◄──┤          ← BUILT
   position across reloads                              │
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄
                                                        │   ← ISSUE-005
   YOUR OWN per-extension state is persisted for you   ◄─┘
```

Everything above the dashed line exists today: registration, activation, a real
per-extension `IShellAPI` that reaches you, and — since ISSUE-002 — a host that
actually renders your navigation entries, mounts both your pane views, and
evaluates and invokes your ribbon actions.

Since ISSUE-004, the fault boundaries and the row virtualizer are there too: a
view of yours that throws during render degrades to a contained surface inside its
own pane instead of taking the shell down, and
`src/components/shared/VirtualizedList.tsx` is available for your Pane 2 view to
window its own rows with. ISSUE-003's persistence is wired to the running shell as
well, for the **host's** three slots — pane sizes, the pane-1 collapsed flag and
which extension holds the foreground — so a user who left your extension in the
foreground comes back to it. What remains below the line is a persistence channel
for state of your OWN, and the mock extensions and integration suite (ISSUE-005).
Hotkey dispatch has landed too: a chord you declare now fires, under the four
conditions set out in the `Hotkey` section below.

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
described one; it does not exist. Icons are per ribbon action and per navigation
node — the extension rows above the navigation tree keep their monogram, because
the host will not invent an icon for you from one of your nodes.

### The icon vocabulary

These are the keys `RibbonAction.icon` and `NavigationNode.icon` may name. Any
other string renders the host's fallback glyph — a plain square — which is a
deliberate soft landing and not an error, so a key you got wrong will not break
your ribbon. It will also not tell you it was wrong, which is why the list is
here.

<!-- icon-vocabulary:start -->

| Key | Glyph |
|---|---|
| `save` | floppy disk |
| `open` | open folder |
| `edit` | pencil |
| `delete` | waste bin |
| `refresh` | circular arrow |
| `search` | magnifier |
| `add` | plus |
| `settings` | cog |
| `navigation` | three stacked rules |
| `drawer` | split panel |
| `close` | cross |
| `folder` | closed folder |
| `box` | isometric box |
| `layers` | stacked sheets |
| `droplet` | droplet |

<!-- icon-vocabulary:end -->

The table lives in `src/components/ui/shellIcons.tsx`, and the comment markers
around the list above are load-bearing: "publishes every icon key in
DEVELOPER.md, and no key it does not have" in
`src/components/__tests__/ShellLayoutIcons.test.tsx` reads both this list and the
map, and fails if either one has a key the other does not. So the list cannot go
stale by omission, and it cannot document a key that does not exist.

### `NavigationNode`

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Same allowlist and reserved words as the extension id. Must be unique **within your own tree** — a duplicate anywhere in the tree, at any depth, rejects the whole blueprint. |
| `label` | `string` | **Untrusted display text.** Non-blank, at most 256 characters. |
| `icon?` | `string` | Optional. **Untrusted icon key.** Non-blank, at most 256 characters. An explicit `undefined` is treated as absent. Resolved through the same host-owned table `RibbonAction.icon` uses — a **lookup key only**, never interpolated into a URL or into markup. It is drawn in the collapsed 48px pane-1 track, which otherwise shows a monogram taken from the first letter of your `label`; a node that declares no icon keeps that monogram, and a key the host does not publish gets the host's fallback glyph rather than the monogram. The published key list is in "The icon vocabulary" below. *Tests:* `src/components/__tests__/ShellLayoutIcons.test.tsx` — "renders a declared node icon in the collapsed track instead of the monogram", "falls back to the host glyph for an icon key the host does not publish", "keeps the monogram for a node that declares no icon" and "does not resolve a prototype-shaped node icon key to anything inherited". |
| `badgeCount?` | `number` | Optional. Non-negative safe integer. An explicit `undefined` is treated as absent. **This is the value the node is BORN with, and it is frozen at registration.** To change a badge at runtime call `IShellAPI.setBadgeCount(nodeId, count)`; pane 1 reads the store first and falls back to this field only when the store holds nothing for that node, so a runtime write of `0` really does clear a badge this field declared as `3`. *Tests:* `src/components/__tests__/ShellLayoutBadges.test.tsx` — "renders the blueprint badge for a node the store has never been written for" and "overrides a blueprint badge with the store value, including down to zero". |
| `children?` | `readonly NavigationNode[]` | Optional. An explicit `undefined` is treated as absent. Counts against the 512-node and 8-level limits. |

### `RibbonAction`

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Same allowlist and reserved words as the extension id. Must be unique within your own `ribbonActions`. |
| `label` | `string` | **Untrusted display text.** Non-blank, at most 256 characters. |
| `icon` | `string` | **Untrusted icon key.** Non-blank, at most 256 characters. Required. The registry stores it verbatim; the ribbon resolves it through `SHELL_ICONS`, a host-owned `Map` of inline SVGs shared with the pane-1 navigation track, and an unrecognised key renders a host fallback glyph. **The key list is published** — see "The icon vocabulary" below; before GitHub issue #18 it was not, so a vendor who guessed wrong got a silent fallback and no way to find the real keys. Your string is a **lookup key only** — it is never interpolated into a URL or into markup, so an icon key is not a route to anything. *Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "resolves a known icon key through the host table", "resolves an unknown icon key through the host fallback rather than through the key", "does not resolve a prototype-shaped icon key to anything inherited", and "the module source names no URL-bearing attribute a plug-in value could reach". See "Security: plugin-supplied strings are untrusted" below. |
| `isDisabled?` | `boolean` | Optional. When present it must be a boolean. Renders the action greyed out but still visible. |
| `hotkey?` | `Hotkey` | Optional keyboard chord for this action. Validated at registration — allowlisted key, boolean modifiers, the two bare-chord rules (WCAG 2.1.4 for a single-character key; activation for `enter`), unique within your own `ribbonActions`. **Dispatched since ISSUE-006**, but only while your extension is in the foreground and only for an action that is visible and not disabled. See the `Hotkey` section below for all four conditions. |
| `isVisible` | `(ctx: RibbonContext) => boolean` | Required. Visibility predicate. **It gets the context and nothing else — deliberately no `IShellAPI`; see the predicates section.** The ribbon evaluates it on every render and shows the action only when it returns the boolean `true`; a throwing predicate is treated as "not visible". See "How `ribbonActions` visibility predicates work" below for the tests. |
| `onExecute` | `(ctx: RibbonContext, shell: IShellAPI) => void` | Required. Invoked when the user activates the action, with **your own shell handle** as the second argument — that is what lets an action actually change shell state. The host ribbon calls it inside a guard, so a handler that throws is reported and does not unmount the shell. *Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "hands onExecute the context and the extension shell", "survives an onExecute that throws, leaving the ribbon interactive". |

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

> ### Declared, validated and — since ISSUE-006 — dispatched.
>
> The host checks a `hotkey` at registration, stores a normalised frozen copy, and
> `src/core/hotkeyDispatch.ts` routes a matching keystroke to your `onExecute`.
> **Four things decide whether your chord fires, and all four are worth knowing
> before you declare one:**
>
> 1. **Your extension must be in the FOREGROUND.** Chords are scoped exactly as
>    `ribbonActions` are — see ADR-0001 Amendment H Decision 6, which is also why
>    another vendor claiming your chord is not a conflict and is not rejected.
>    While you are in the background none of your chords are live. *Tests:*
>    `src/core/__tests__/hotkeyDispatch.test.tsx` — "fires a visible, enabled chord
>    on the foreground extension" and "does not fire a background extension chord
>    while another extension is in the foreground".
> 2. **The action must be VISIBLE and NOT DISABLED**, through the same `isVisible`
>    and `isDisabled` your ribbon button passes. A hotkey is a second route to an
>    `onExecute` the button could already fire, and never a wider one. *Tests:*
>    same file — "does not fire a chord on an action whose predicate hides it" and
>    "does not fire a chord on a disabled action".
> 3. **The keystroke must not be suppressed.** A chord is ignored when the event
>    was already handled by something below (`defaultPrevented`), when it is
>    auto-repeat from a held key, while an IME composition is in flight, and while
>    focus is in an `input`, `textarea`, `select`, a `contenteditable` subtree, or
>    an element with `role="textbox"`, `role="searchbox"` or `role="combobox"`.
>    *Test:* same file — the `it.each` table "does not fire while focus is in %s".
> 4. **The listener is on `window` in the BUBBLE phase.** If your view handles a
>    key itself and calls `stopPropagation()`, the chord never reaches the host.
>    That is deliberate — it is what keeps view-local navigation such as the Pane 2
>    list's arrow keys working — but note the consequence: stopping propagation
>    starves *your own* chords, and nobody else's.
>
> **The suppression list in point 3 is a guardrail, not a boundary.** If your view
> renders a custom editor out of a bare `div` with no recognised role, a chord WILL
> fire while the user is typing in it. The host cannot know what your DOM means.
> Give the element `role="textbox"`, or call `stopPropagation()` on it.
>
> **Where the key handling lives, exactly.** Two modules under `src/` touch a key
> event and both are allowlisted by name and by exact spelling:
> `src/core/hotkeyDispatch.ts` holds the repository's only `addEventListener`, and
> ISSUE-004's `src/components/shared/VirtualizedList.tsx` puts an `onKeyDown` on the
> list's scroll container for arrow keys, Home/End and Page Up/Down — it reads no
> `hotkey`, consults no registry, and reaches no `window` or `document`. Pinned by
> "finds no listener registration in any module outside the hotkey-dispatch
> allowlist", "finds no key-event name in any module outside the key-event
> allowlist", "holds the key-event allowlist to the exact spellings each listed
> module contains" and "holds the hotkey-dispatch allowlist to the exact spellings
> the dispatcher contains" in `src/__tests__/noEventListener.test.ts`. That the one
> listener is really removed on unmount, with the identical function reference, is
> something a source scan cannot see and is pinned at runtime by "adds exactly one
> keydown listener and removes the identical handler on unmount".
>
> Comments are not scanned, which is how these paragraphs are allowed to state the
> property; a listener reached through a name that is not text is outside what the
> scan can see, and the test says so. That `src/core/hotkeys.ts` itself exports
> four pure helpers and attaches nothing is the separate, narrower
> "hotkeys module — does not attach anything" in
> `src/core/__tests__/hotkeys.test.ts`.

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

**The allowlist** is 60 names: `a`–`z`, `0`–`9`, `f1`–`f12`, `arrowup`,
`arrowdown`, `arrowleft`, `arrowright`, `home`, `end`, `pageup`, `pagedown`,
`enter`, `delete`, `insert`, `backspace`. That is 26 letters + 10 digits + 12
function keys + 4 arrows + 8 named navigation and editing keys. *Pinned by*
"validateBlueprint — ribbon action hotkeys > accepts every key in the host
allowlist" in `src/core/__tests__/validation.test.ts`, which asserts
`HOTKEY_KEYS.size` is 60 and that `escape` is not a member, so a key quietly
joining or leaving the list is a failing test.

**Four things are deliberately not on it**, and you should not read the omissions
as oversights:

- **`tab`** — Tab is how a keyboard user moves between controls. Owning it breaks
  focus order for everyone: WCAG 2.1 Success Criteria 2.1.1 Keyboard and 2.4.3
  Focus Order.
- **`space`** — Space activates the focused control. Claiming it globally means
  the focused button stops responding to the key that presses it.
- **`escape`** — Escape is the shell's dismissal key. It closes the ribbon's
  overflow menu, cancels a drag, leaves fullscreen and dismisses a Radix dialog —
  and this project ships `@radix-ui/react-dialog`. An extension owning it globally
  would break dismissal for the whole shell at once. It was removed outright
  rather than made modifier-only, because a modifier-gated Escape is dead surface
  and not a compromise: `Ctrl+Escape` opens the Windows Start menu, and
  `Alt+Escape` and `Meta+Escape` belong to the window manager. Escape belongs to
  the focused component, exactly as `tab` and `space` do. ADR-0001 Amendment I.
- **Every modifier as a key** — `control`, `alt`, `shift`, `meta`, `capslock`,
  `altgraph`. A modifier is a *field* here; naming one as the `key` describes a
  chord that fires before you have pressed the key you were reaching for.

*Pinned by* the `it.each` table "rejects %s as a hotkey key" in
`src/core/__tests__/validation.test.ts`, which walks `tab`, `space`, `escape`, a
literal space, each modifier named as a key, `capslock`, `altgraph` and `f13` case
by case.

#### The rules that will surprise you: two reasons a bare chord is refused

```ts
{ key: 'k' }                          // REJECTED — rule 1, a character key
{ key: 'k', shift: true }             // REJECTED — Shift produces a character too
{ key: 'k', ctrl: true }              // fine
{ key: 'k', alt: true, shift: true }  // fine
{ key: 'f5' }                         // fine — a function key is not a character
{ key: 'arrowdown' }                  // fine — nor is a navigation key
{ key: 'enter' }                      // REJECTED — rule 2, it activates what has focus
{ key: 'enter', shift: true }         // REJECTED — Shift does not stop the activation
{ key: 'enter', ctrl: true }          // fine — the chord this family was wanted for
```

**Two rules, not one.** They meet at a single check — so a bare chord is refused
once, at the declaration door, and there is no second suppression at dispatch time
— but they are refused for genuinely different reasons and they carry different
messages. Learning them as one rule teaches you something false about WCAG.

**Rule 1 — a single-character key must carry `ctrl`, `alt` or `meta`. This is WCAG
2.2 Success Criterion 2.1.4 Character Key Shortcuts, Level A**, not a house style.
A shortcut that is a single printable character and nothing else is
unusable for a speech-input user — dictation emits characters — and hostile to
anyone typing into a surface the shortcut is live over. The criterion is met by
letting the user turn the shortcut off, letting them remap it, or scoping it to
focus; this shell offers none of those three today, so it is met the fourth way:
the host refuses the declaration, with `INVALID_FIELD` on
`ribbonActions[n].hotkey` and a message naming the criterion.

`shift` does not satisfy the rule because Shift changes *which* character is
produced, not *whether* one is. Pinned by "validateBlueprint — the WCAG 2.1.4
modifier rule for character keys" in `src/core/__tests__/validation.test.ts`.

**Rule 2 — `enter` must carry `ctrl`, `alt` or `meta`, because it activates the
focused control.** Enter presses the default button, follows a focused link,
opens a focused table row, and submits a form — in every browser and every
assistive technology. A bare Enter chord fires on top of the activation the user
actually asked for, which is the same failure mode that keeps `space` off the
allowlist entirely. `enter` keeps its place on the list because **`Ctrl+Enter`** —
"send", "commit", "run" — is the one genuinely wanted chord in this family and it
collides with nothing; removing the key would have taken that with the rest.
`shift` does not satisfy this rule either: Shift+Enter still activates the focused
control. The keys under this rule are exported as `HOTKEY_MODIFIER_REQUIRED_KEYS`,
so you can assert against the set rather than trust this paragraph; today it holds
`enter` alone.

**This rule is not 2.1.4, and its message deliberately does not cite it.** 2.1.4
is about single printable *character* keys and genuinely does not reach `enter`,
`escape`, `backspace`, `delete` or `insert`. A message telling you the criterion
forbids your bare Enter would state something false about the criterion and teach
you a wrong rule to carry into your next project, so the Enter refusal names the
activation and ADR-0001 Amendment I instead — no criterion, no level.
*Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4 for
enter, which is not a character key" asserts the Enter message contains neither
2.1.4, nor Character Key Shortcuts, nor Level A, and "leaves the 2.1.4 message
alone for a genuine character key" asserts the character-key message still names
the criterion; the pair pins the split in both directions, so an edit merging the
two messages fails one of them whichever way it merges. Beside them, "rejects a
bare enter, which activates the focused control", "rejects enter with shift only,
because Shift does not stop the activation", "accepts ctrl+enter, the one
genuinely wanted chord in this family" and "holds exactly the keys that activate
the focused control", which pins the exported set's contents.

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

#### `src/core/hotkeys.ts` — four helpers you may use today

```ts
hotkeyToken({ key: 'k', ctrl: true, shift: true })       // 'ctrl+shift+k'
describeHotkey({ key: 'k', ctrl: true, shift: true })    // 'Ctrl+Shift+K'
ariaKeyShortcuts({ key: 'k', ctrl: true, shift: true })  // 'Control+Shift+K'
matchesHotkey(hotkey, event)                             // boolean, pure
```

`describeHotkey` is the spelling a **user** reads, and it is what the ribbon puts
in a button's `title`. `ariaKeyShortcuts` is the spelling **ARIA** requires, and
it is what the ribbon emits as `aria-keyshortcuts`: that attribute is defined over
UI Events `KeyboardEvent.key` values, where the control key is `Control`, and
`Ctrl` is not one — which is why these are two functions and not one. The ribbon
emits the attribute only on a chord-bearing action that is **not disabled**,
because the dispatcher skips a disabled action and advertising it would be a lie.
*Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "advertises a
chord-bearing action with aria-keyshortcuts, in key values rather than display
spelling" and "omits aria-keyshortcuts from a disabled action, because the chord
will not fire". `matchesHotkey` takes only the five fields of a keyboard
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
  readonly activeExtensionId: string | null;   // owner of panes 2/3, or null
  readonly activeNavNodeId: string | null;     // selected pane-1 node, or null
  readonly selectedItemIds: readonly string[]; // the WHOLE selection, in order
  readonly selectedItemId: string | null;      // derived: the last of those, or null
  readonly contextKeys: Readonly<Record<string, string | number | boolean | null>>;
}
```

**`selectedItemIds` is the selection; `selectedItemId` is derived from it.** The
array is the source of truth and `selectedItemId` is its last element, or `null`
when it is empty. There is one writer, so the two can never disagree — you will
never be handed a `selectedItemId` that is not in `selectedItemIds`. If your
extension only ever selects one row, go on reading `selectedItemId` and calling
`setSelectedItem`; nothing about that case changed. If it supports
shift-clicking, read `selectedItemIds` and call `setSelectedItems`.

**`contextKeys` is your own extension's context keys** — see `setContextKey` in
the member list below. It is a plain record of primitives, frozen, and it is
cleared whenever the foreground moves.

**`focusedPane` is gone.** It used to be declared here as `PaneId | null` and no
host code ever wrote it, so it was permanently `null`: a predicate branching on
it could not fire, and a field that is permanently null is worse than an absent
one because it looks available. It was removed rather than populated, because
populating it needs focus tracking the shell deliberately does not do. `PaneId`
itself still exists as a layout type. ADR-0001 Amendment K Decision 6.

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

> **Activation and pane rendering have both landed.** The host mints a real
> per-extension `IShellAPI` for you: `ShellHostProvider` owns the shell state
> store, and **the host** activates you, which produces an `ActiveExtension`
> carrying your `id`, your host-owned `blueprint` record, and your `shell`.
> `ShellLayout` then mounts `views.pane2` and `views.pane3` inside
> `ExtensionHostBoundary`, passing that `shell` and a context snapshot as props —
> so take `shell` from your props, as the type says, and do not reach for it any
> other way. *Test:* `src/components/__tests__/ShellLayout.test.tsx` — "renders
> both plug-in views inside an ExtensionHostBoundary once activated".
>
> **`ExtensionHostBoundary` is a guardrail, not isolation**, and pane rendering
> does not change that — see the three limits below and ADR-0001 Amendment E.
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

This scoping is real for badges today. It is also the shape persisted state takes:
ISSUE-003's `src/core/services/HydrationEngine.ts` now exists and namespaces
per-extension persisted state by extension id, and it records **the same limit in
the same terms** — collision-resistance, not confinement. It is in fact weaker than
badge scoping, because the scope is an argument rather than a closure: any holder of
the engine can name any scope, since there is no per-extension facade over
persistence the way `createRevocableShellAPI` is one over badges. *Tests:*
`src/core/services/__tests__/hydrationEngine.test.ts` — "keeps two extensions that
both use the key \"selection\" apart" for what the namespace does buy, and "lets any
caller name any scope, so the namespace confines nothing" for what it does not.

**No persistence member exists on the interface yet** (see the member list below), so
do not write code that calls one — you cannot reach that engine from an extension at
all today. Persisted state needed its own confinement answer rather than inheriting
this one, because there isn't one here to inherit; the answer it records is that
there is no confinement, and that nothing confidential belongs in persisted UI state.

**3. It is revocable, and revocation is loud.** Your instance stays live across
any number of foreground changes, and dies for exactly two reasons: the host
`release`s your extension, or your extension is unregistered. After that, every
member throws — `getContext` included. See "What a released `IShellAPI` does" below.
Pinned by "mints a live IShellAPI on activation and revokes it on release", "losing the
foreground revokes nothing" and "revokes when the extension is unregistered" in
`src/core/__tests__/dataflow.test.tsx`.

### The member list

As landed in `src/core/types.ts`, `IShellAPI` has exactly seven members. It is
deliberately small — every addition is a new capability handed to untrusted
code — and it **grew from three to seven** in the contract-hardening wave
recorded as ADR-0001 Amendment K. If you are reading an older copy of this guide
that says "exactly three", the four new members are `setSelectedItems`,
`setActiveNavNode`, `getBadgeCount` and `setContextKey`.

```ts
interface IShellAPI {
  setSelectedItem(id: string | null): void;
  setSelectedItems(ids: readonly string[]): void;
  setActiveNavNode(nodeId: string | null): void;
  setBadgeCount(nodeId: string, count: number): void;
  getBadgeCount(nodeId: string): number | undefined;
  setContextKey(key: string, value: string | number | boolean | null): void;
  getContext(): Readonly<RibbonContext>;
}
```

| Member | Behaviour |
|---|---|
| `setSelectedItem(id)` | Sets — or clears, with `null` — the currently selected item, which surfaces as `RibbonContext.selectedItemId`. **This one throws.** The value is opaque to the host — it is your own item identifier, not a registry key, so it is *not* held to `EXTENSION_ID_PATTERN` and may be a GUID, a path or a number-as-string. Its **type** is enforced: anything that is neither a `string` nor `null` raises `ShellUXError` with code `INVALID_FIELD` and field `"id"`, and the context is left unchanged. |
| `setBadgeCount(nodeId, count)` | Sets the badge count for one of your navigation nodes, **in your own scope** — see property 2 above. **This one throws.** It raises `ShellUXError` with code `INVALID_ID` when `nodeId` is not a string, or does not match the same allowlist and reserved-word rules the registry applied to your node ids, and code `INVALID_FIELD` when `count` is not a non-negative safe integer. Call it with values you control, or wrap it. **Since issue #12 it is also RENDERED.** The value used to reach no renderer at all — pane 1 drew the frozen blueprint field and nothing else — so a write appeared to do nothing. It now changes the sidebar for as long as your extension holds the foreground, in the expanded pane and in the collapsed 48px icon track alike, and it does so without a re-render of any other row. *Tests:* `src/components/__tests__/ShellLayoutBadges.test.tsx` — "lets a setBadgeCount write through a live IShellAPI change what the sidebar renders" and "shows a runtime badge in the collapsed 48px icon track too". |
| `setSelectedItems(ids)` | Replaces the **whole** selection, which surfaces as `RibbonContext.selectedItemIds`; `selectedItemId` is recomputed from the last element in the same patch. **This one throws.** `ids` must be an array of distinct strings, at most `REGISTRY_LIMITS.MAX_SELECTED_ITEMS` of them; each element is opaque and type-checked exactly as `setSelectedItem`'s `id` is. **A repeated id is rejected, not deduplicated** — a selection holding the same row twice is your bug, and quietly returning a shorter selection than you asked for would hide it. The array is read once and stored as a frozen host-owned copy, so editing the array you passed afterwards changes nothing. `INVALID_FIELD` for a bad shape or a repeat, `PAYLOAD_TOO_LARGE` for the bound. *Tests:* `src/core/__tests__/shellApi.test.ts` — the "setSelectedItems validates its argument" group. |
| `setActiveNavNode(nodeId)` | Sets — or clears, with `null` — the selected pane-1 navigation node, which surfaces as `RibbonContext.activeNavNodeId`. **This one throws.** Before issue #15 your extension could not navigate at all: the field was writable only by the host's own pane-1 click handler. Unlike `setSelectedItem`'s `id`, `nodeId` **is** a host lookup key and is held to the same allowlist and reserved words the registry applied to your node ids — `INVALID_ID` otherwise. It is **not** checked against your own tree, deliberately: name a node you do not own and you get a field none of your own rendering will match, which is the same posture `setSelectedItem` takes. *Tests:* `src/core/__tests__/shellApi.test.ts` — "setActiveNavNode validates its argument". |
| `getBadgeCount(nodeId)` | Reads back the badge count for one of your navigation nodes, or `undefined` when none was ever set. **This one throws** — `INVALID_ID` for a `nodeId` that is not registry-valid. Scoped by the same closure `setBadgeCount` is scoped by, so it reads back exactly what this handle can write and offers no parameter through which to name another extension's scope. Before issue #12 you could write a badge and had no way to read one, so a module wanting to increment its own count had to keep a shadow copy. *Test:* `src/core/__tests__/dataflow.test.tsx` — "reads back only its own scope, and offers no parameter to name another". |
| `setContextKey(key, value)` | Publishes one named primitive fact about your extension, which surfaces as `RibbonContext.contextKeys[key]` for your own predicates to branch on. **This one throws.** See "Context keys" below — it is a mechanism rather than a field, and it is worth reading before you reach for it. |
| `getContext()` | Returns a frozen snapshot of the current `RibbonContext`. A snapshot, not a live view: hold the result only for the duration of the work you are doing, and call again rather than caching it across renders. |

Every member but `getContext` rejects a bad argument; `getContext` takes no
argument to reject. **None of the seven is total, and `getContext` is not an
exception:** all seven throw `REVOKED` once your extension is released or unregistered
(pinned in `dataflow.test.tsx`, which walks the whole member list rather than a
representative one), and the five writers can additionally deliver whatever a
store listener throws — see "Where that stops" near the end of this guide. Note the
asymmetry with `register`, which never throws: `IShellAPI` is called by *you*, so a bad
argument is your bug and is reported as an exception, whereas `register` is called by the
*host* on your data, where an exception would take the shell down.

### Context keys — how to make the ribbon react to state the host does not model

Your `isVisible` predicate is a pure function of `RibbonContext` and is handed no
capability. That is deliberate and it will not be relaxed — see "Rules for
writing predicates" — but it used to leave you with no way to make the ribbon
re-evaluate from state the host does not know about. A mail module that wants
"Reply" hidden until the message body has loaded had nothing to say so with:
`selectedItemId` says a row is selected, not that its body arrived.

`setContextKey` is the answer, and the shape is deliberately **VS Code's**: named
host-owned values that visibility expressions read, the same idea as a `when`
clause over a context key.

```ts
// In your pane view, when the body finishes loading:
shell.setContextKey('message-loaded', true);

// In your ribbon action:
isVisible: (ctx) => ctx.contextKeys['message-loaded'] === true,
```

Five things to know:

- **Primitives only: `string`, `number`, `boolean` or `null`.** Nothing else,
  ever, and the narrowness is the design rather than a limitation waiting to be
  lifted. An object would put a getter you wrote inside a render-phase predicate
  read, hand another extension a live prototype chain into your code, and defeat
  the equality check that keeps an unchanged write from waking every subscriber
  in the shell. A `number` must be finite. Anything else is `INVALID_FIELD`.
- **`key` is a host lookup key** and is held to the registry's allowlist and
  reserved words, exactly as `setBadgeCount`'s `nodeId` is. You may hold at most
  `REGISTRY_LIMITS.MAX_CONTEXT_KEYS` distinct keys, and a `string` value may be at
  most `REGISTRY_LIMITS.MAX_CONTEXT_VALUE_LENGTH` characters.
- **There is no delete.** Spell "unset" `null`; the key still occupies a slot.
  A key that vanished would be indistinguishable, to a predicate reading it, from
  one that was never set.
- **Your keys are cleared whenever the foreground moves**, in the same single
  patch that clears the selection and the nav node — including when you are the
  one leaving. Publish them from your view's mount, the way you would publish an
  opening badge.
- **This is collision-resistance, not confinement.** You write only into your own
  namespace and have no parameter with which to name another's. But the published
  record is whatever the FOREGROUND extension put there, and anything holding a
  context can read it. Do not put anything in a context key that would matter if
  another extension read it.

*Tests:* `src/core/__tests__/contextKeys.test.tsx` — "setContextKey validates its
value", "keeps two extensions' context keys apart, and publishes only the
foreground's", "clears every extension's context keys on a foreground handover",
"does not notify when a context key is rewritten with the value it already holds"
and "does not notify for a background extension's own context key".

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
the seven members above, `revoke` lives on a wrapper object the host keeps, and it
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
code that does the wrapping in production — landed with ISSUE-002, and it does wrap:
`ShellLayout` renders `views.pane2` and `views.pane3` only inside
`ExtensionHostBoundary`, never as its own sibling. *Test:*
`src/components/__tests__/ShellLayout.test.tsx` — "renders both plug-in views inside
an ExtensionHostBoundary once activated". That closes **this** route, in **this**
host, today; it is not a guarantee about host code written later, which is why the
limit is stated as a standing one rather than struck out.

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

**It has now been reproduced END TO END, in the assembled shell, against a real
extension.** The unit test above proves the function object takes a property; the
integration case proves a hostile extension turning that into a rendered
consequence. From inside its own pane, one extension calls the public
`useRegistry().getExtension('inventory-db')`, reaches the sibling's pane-3 view
component, and writes to its `prototype`. React reads that property to decide
whether to CALL the component or to CONSTRUCT it — so the sibling's detail pane
throws on its next render and degrades to the host's fault surface, while its list
pane, one subtree away, is untouched. That last part is the shell behaving
correctly about something it could not prevent. Pinned by "PINS A KNOWN LIMIT — the
IShellAPI deep-freeze does not reach plug-in-supplied functions: a sibling view
component obtained from the public registry is mutable, and the sibling rendered
output changes (no issue filed; ADR-0001 records it as accepted, because freezing a
component breaks memo and forwardRef)" in
`src/__tests__/IntegrationSuite.test.tsx`.

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
- **`views/Pane2View.tsx`** is your list. It renders inside the host's Pane 2
  scroll container, and it is where you mount `VirtualizedList` — so it renders
  *rows*, and it must not assume every item is in the DOM. See the virtualization
  notes below.
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
  DECLARED variable heights, and measures nothing; consistent heights scroll
  better, look correct at density, and cannot disagree with what you declared.

The density exists because a user of this shell is looking at a lot of rows on a
large screen and values seeing more of them over seeing them spaciously. An
extension that ignores this makes the whole application feel inconsistent.

---

## How `ribbonActions` visibility predicates work

> ### Implemented in ISSUE-002 — this section describes running code
>
> **The host evaluates `isVisible` on every ribbon render.** The call site is
> `RibbonToolbar` in `src/components/ui/RibbonToolbar.tsx`, and the behaviour
> below is asserted by `src/components/__tests__/RibbonToolbar.test.tsx` rather
> than promised. Where a sentence here states a containment property, it names
> the test that holds it, per ADR-0001 Amendment G.
>
> **What the registry does at registration is unchanged**, and is a separate
> thing from evaluation: it checks that `isVisible` is present and that
> `typeof isVisible === 'function'`, rejecting the blueprint with `INVALID_FIELD`
> on `ribbonActions[n].isVisible` otherwise. It still does not call it at
> registration, and has no opinion about what it returns. The same is true of
> `onExecute`.
>
> **Do not read more into the guard than is there.** It is not a guard around
> your *component's* render; see "Fault containment" below. And it now runs on two
> routes rather than one — the ribbon button and the keyboard chord both call the
> same `isVisible` through the same guard, which is deliberate: a chord must never
> reach an action the button would have hidden.

The ribbon is split: **global host actions on the left, your contextual actions
on the right.** Contextual means the set changes with context — and *you* define
what context means, because the host cannot.

Each ribbon action carries an **id**, a **label**, an **icon**, an optional
**disabled** flag, an optional **hotkey**, an **`onExecute` handler**, and an
**`isVisible` predicate**. All seven are validated at registration; the two
functions are checked for type and then stored, and the hotkey — which the shell
dispatches under the four conditions listed above — is normalised and frozen. See
the `Hotkey` section above.

The predicate is the interesting one. On each render the host evaluates your
predicate against the current `RibbonContext` and shows the action only if it
returns `true`. That is the mechanism by which "Reply" appears when a message is
selected and disappears when nothing is, without the host knowing what a message
or a reply is. *Test:* "renders only the actions whose predicate returns true for
this context", which also asserts your predicate is handed the very context
object the host holds.

```
  ISSUE-002 — the ribbon render loop, as implemented
  ──────────────────────────────────────────────────
  host renders ribbon
        │
        ├─ for each of your ribbonActions:
        │     evaluate action's isVisible against the current RibbonContext
        │        ├─ === true       → keep it (label renders as a text node)
        │        ├─ anything else  → omit it, including a truthy non-boolean
        │        └─ threw          → omit it, report it on console.error, and
        │                            keep evaluating the rest
        │
        ├─ split the SURVIVORS: first 4 stay inline, the rest go to an
        │  overflow menu — never a second row that would push the panes down
        │
        └─ ribbon renders
```

**The predicate must return the boolean `true`, not merely something truthy.**
The host compares with `=== true`. A predicate returning `"yes"` or `1` is a
contract violation, and it is resolved the safe way — the action is hidden rather
than shown on an accident. *Test:* "treats a non-boolean isVisible result as not
visible".

**Only visible actions compete for the four inline slots.** The predicate filter
runs before the overflow split, so an action you hid does not silently occupy a
slot on the bar and push a visible one into the menu. *Test:* "counts only
visible actions toward the inline limit".

**With no extension in the foreground the contextual side is simply empty**, and
the ribbon and the panes are still valid. *Test:* "renders no contextual action
when there is no active extension".

**Your action behaves the same whether it lands on the bar or in the overflow
menu**, and you cannot tell which from inside `isVisible` or `onExecute` — the
split is the host's and it is not part of your contract. What you can rely on is
that the menu is a real menu rather than a styled `div`: it is built on
`@radix-ui/react-dropdown-menu`, so it opens with focus moved into it, walks its
items with the arrow keys, closes on Escape and on an outside pointer-down, and
returns focus to the trigger afterwards — including after your action runs, so a
keyboard user is never dropped onto `document.body`. It is portalled out of the
ribbon, which is what stops the ribbon's own clipping from hiding it. It is
deliberately **not modal**: the rest of the shell stays reachable to assistive
technology while the menu is open.
*Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — the whole of
"RibbonToolbar — the overflow menu keyboard model", specifically "moves focus into
the menu when it opens", "walks the items with the arrow keys, which is what the
role promises", "closes on Escape and puts focus back on the trigger", "returns
focus to the trigger after an item is activated, not to document.body", "closes when
the pointer goes down outside it", "renders the menu outside the ribbon, which is
what un-clips it", and "does not modally hide the rest of the shell while the menu is
open".

**An action you make unavailable stays in the tab order rather than vanishing from
it.** The host marks it `aria-disabled` instead of using the native `disabled`
attribute, so a screen-reader user can still reach it and hear that it exists and is
currently unavailable — a disabled native button is skipped by keyboard navigation
entirely, which silently hides the action rather than explaining it. It does not
execute while unavailable.
*Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "marks an unavailable
action aria-disabled rather than removing it from the tab order", "still runs an
action that is not disabled", and "leaves a disabled menu item focusable, announced,
and inert".

### Rules for writing predicates

The signature is settled — `isVisible(ctx: RibbonContext): boolean`, with
`RibbonContext` as printed earlier in this guide. The rules below are how you
should write against it. Everything describing what the *host* does with the
result is now implemented behaviour and names its test.

One field of `RibbonContext` used to be worth calling out before you branched on
it, and it is now worth calling out because it is **gone**. `focusedPane` was
declared `PaneId | null` and no host code ever wrote it, so it was permanently
`null` and a predicate requiring it to be non-null showed nothing, ever. This
guide's advice was to be aware of that and route around it, which is advice about
a defect rather than a fix for one: **a field that is permanently null is worse
than an absent one, because it looks available.** It has been removed from the
contract (GitHub issue #13, ADR-0001 Amendment K Decision 6). If you branched on
it, your predicate was already dead code; delete the branch.

What you should reach for instead depends on what you meant. For "is anything
selected", read `selectedItemIds` or `selectedItemId`. For state the host does not
model at all, publish a **context key** and branch on `ctx.contextKeys[...]` —
that is the mechanism the removal leaves you with, and it is described in full
under "Context keys" above.

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

- **Predicates must be pure and cheap.** They are evaluated on every ribbon
  render, which is often — the host re-evaluates the whole set rather than
  caching, so a slow predicate is a slow shell. No network calls, no writes, no
  state mutation, no `localStorage` access. Read the context you were given and
  return a boolean. You are not handed an `IShellAPI` here, so the most direct way
  to write is closed to you — do not reach for one you captured elsewhere either.
- **A throwing predicate is treated as "not visible" — and this is now real.**
  The host calls `isVisible` inside a guard: a throw hides that one action,
  is reported on `console.error` with the offending action id in the message, and
  the remaining actions — yours and the host's — still render. The report path is
  itself guarded, so a page that has replaced `console.error` with a throwing
  function cannot turn the containment back into an escape. *Tests:*
  `src/components/__tests__/RibbonToolbar.test.tsx` — "hides an action whose
  isVisible predicate throws and still renders the rest" and "survives a
  console.error that itself throws while reporting a bad predicate".

  **Containment is not permission.** This exists so one buggy predicate cannot
  blank the ribbon, not so that throwing becomes a supported way to hide an
  action. Return `false`. A throw costs you the action *and* an error in the
  user's console, and the host reserves the right to treat a persistently
  throwing predicate more harshly.
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
  and it also means markup in a label is shown literally, not rendered. A very
  long label is truncated with an ellipsis rather than widening the row. *Tests:*
  `src/components/__tests__/RibbonToolbar.test.tsx` — "renders a markup-shaped
  plug-in label as a text node, not as markup", "truncates a very long label
  instead of widening the ribbon".
- **Test your predicates directly anyway.** The host now exercises them, but your
  own unit tests are still the only place their *logic* is checked — the host's
  tests assert containment and filtering, not that your rule is the rule you
  meant. See the testing section.

---

## Working with the virtualized list

> **Landed with ISSUE-004 — and it is a component YOU render, not something the
> host wraps around you.** `src/components/shared/VirtualizedList.tsx` exists and
> is exported for your `views.pane2` to use. The host does not window your pane
> for you and cannot: it does not know what a row is, how many there are, or how
> tall one should be. Pane 2 is still the resizable scroll pane ISSUE-002 built;
> if you render a thousand `<div>`s into it directly, a thousand `<div>`s is what
> you get.

Only rows intersecting the viewport, plus a small overscan, are mounted.
Consequences for your Pane 2 view:

- **Never assume all your rows are in the DOM.** Do not query the document for
  rows, measure the full list by walking DOM nodes, or use `Ctrl+F`-style
  find-in-page as a supported flow. Only the visible window exists.
- **Row renderers must be side-effect-free and fast.** They run during scroll.
- **A row renderer that throws is contained to that row.** Your `renderRow` runs
  inside a per-row `FaultBoundary`, and the failed row keeps its place and its
  `aria-posinset` in the set while its siblings render normally. Do not rely on
  that as error handling: validate your data. *Tests:*
  `src/components/__tests__/VirtualizedList.test.tsx` — "contains a row renderer
  that throws for one item only" and "keeps the position of a failed row in the set".
- **Keep row keys stable.** Index-based keys break under insertion and removal. A
  `rowKey` that throws, or that answers with something other than a string, falls
  back to a positional key for that row rather than failing the list — "survives a
  key function that throws or answers with a non-string", same file.
- **Row heights are DECLARED, never measured.** `rowHeight` is a number, or a
  function of the index. Nothing observes the DOM, so a row that renders taller
  than it declared overlaps its neighbour and a height that changes after mount is
  not noticed at all. If you need content-measured rows, say so — that is the
  stated trigger for revisiting the decision not to take a windowing dependency.
- **Keyboard navigation belongs to the list, not to your rows.** Arrow keys,
  Home/End and Page Up/Down move the selection; the container holds the only tab
  stop and names the active row with `aria-activedescendant`. Do not put a
  `tabIndex` on a row: a virtualizer unmounts rows as they leave the window, and
  focus parked on one of them lands on `<body>` mid-scroll.
- **There is no scroll anchoring.** Prepending items above the current scroll
  position moves the content under the viewport.
- **In an environment with no `ResizeObserver`, a pane resize does not re-window
  the list until something else re-renders it.** The list re-measures on every
  render, which is the documented fallback; what it cannot do without an observer
  is notice a resize on its own, and a divider move re-renders the PANEL rather
  than your subtree inside it. So the window is briefly stale and corrects on the
  next interaction — a keystroke, a scroll, new items. That is jsdom, older
  embedded WebViews, and nothing a modern browser does. Pinned by "PINS A KNOWN
  LIMIT — with no ResizeObserver in the environment, moving a divider does not
  re-window the list: it corrects on the next render the list performs for any
  other reason (no issue filed; VirtualizedList decision 4 records the fallback as
  accepted)" in `src/__tests__/IntegrationSuite.test.tsx`.

> **Neither shipped verification remote uses this component, and that is a gap
> rather than a recommendation.** `src/mocks/MailPlugin.tsx` lists a dozen messages
> and `src/mocks/DatabasePlugin.tsx` maps all 280 of its records into a plain
> `<ul>` — so as things stand `VirtualizedList` has no consumer anywhere under
> `src/` outside the integration suite's own test-authored extension. If you are
> looking for a worked example to copy, there is not one yet; the props table above
> and `src/components/__tests__/VirtualizedList.test.tsx` are what exist. Pinned by
> "PINS A KNOWN LIMIT — neither shipped verification remote renders
> VirtualizedList, so ISSUE-004 has no consumer in src/ outside this suite (no
> issue filed; reported with this change)" in
> `src/__tests__/IntegrationSuite.test.tsx`.

---

## Fault containment — and its real limits

> **Landed with ISSUE-004.** `src/components/error/FaultBoundary.tsx` exists, and
> `ShellLayout` wraps every pane's children in one — pane 1 included — plus a
> second one around each extension subtree in panes 2 and 3, and one around the
> ribbon. `ExtensionHostBoundary` is still **not** an error boundary and still
> catches nothing; it severs host context, which is a different job. The fault
> boundary sits OUTSIDE it.

A view of yours that throws during render now degrades to a contained error
surface inside its own pane. The pane keeps its border, its accessible name and
its header; the body becomes host-authored text naming the surface, your
extension id as a text node, a guarded message read off whatever you threw, and a
**Retry** button. Three consecutive failures and the button is replaced by host
text — nothing retries automatically, because a component that throws
deterministically plus an automatic retry is an unbounded render loop. Switching
extension clears the surface, so yesterday's failure does not sit over today's
view. *Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "contains a
throwing pane-2 view to pane 2, leaving the ribbon and pane 3 interactive",
"contains a throwing pane-3 view to pane 3, leaving pane 2 interactive" and
"clears a pane error surface when the active extension changes";
`src/components/__tests__/FaultBoundary.test.tsx` — "stops offering a retry after
three consecutive failures".

**None of that is licence to throw.** A contained failure is still a pane your
user cannot use, and the containment is a floor, not a feature you get to build
on.

**Be clear about what this does not cover.** React error boundaries catch errors
in render, in lifecycle methods and in constructors. They do **not** catch:

- errors thrown in **event handlers** (your click handler, your ribbon action's
  invoke handler — the ribbon guards its own calls to `isVisible` and
  `onExecute`, and that guard is not this boundary),
- errors thrown in **`setTimeout` / `setInterval` / `requestAnimationFrame`**
  callbacks,
- **unhandled promise rejections** from your async work,
- errors thrown during **server-side rendering**,
- anything thrown by the fallback surface itself, or by a component ABOVE the
  boundary. A boundary never catches itself, which is why the host composes
  several of them rather than one at the root, and why the fallback renders no
  plug-in component and no plug-in markup at all.

Those are yours to handle. Wrap your own async work and your own handlers. An
unhandled rejection in your extension will surface as a global error, not as a
tidy contained pane. The same list is in the docblock at the top of
`src/components/error/FaultBoundary.tsx`, and the two are kept in step by
"documents in both the source and DEVELOPER.md what a boundary cannot catch" in
`src/components/__tests__/FaultBoundary.test.tsx`.

**Two entries on that list are no longer only a list.** The `setTimeout` case and
the unhandled-rejection case are now reproduced through the assembled shell by an
extension that really throws from a timer and one that really rejects a promise: in
both, the pane goes on rendering its normal content, **no fallback appears at all**,
and the failure goes wherever an uncaught failure goes in the host environment. If
you were hoping the boundary would quietly absorb these, it does not, and now there
is a test that says so out loud. Pinned by "PINS A KNOWN LIMIT — a FaultBoundary
does not catch a plug-in throw from a setTimeout callback: it escapes to the host
environment and no fallback is rendered (no issue filed; this is React
error-boundary semantics and the FaultBoundary banner records it)" and "PINS A KNOWN
LIMIT — a FaultBoundary does not catch a plug-in rejected promise: the rejection is
delivered to the promise and no fallback is rendered (no issue filed; this is React
error-boundary semantics and the FaultBoundary banner records it)" in
`src/__tests__/IntegrationSuite.test.tsx`.

The **event-handler** entry is the one that cuts the other way, and it is worth
knowing which side of the line you are on: a throw from your `onExecute` IS
contained, by the ribbon's own guard rather than by a boundary — reported, and the
shell stays interactive. Pinned by "contains a throwing ribbon action inside the
ribbon own guard, without taking the shell down" in the same file. A throw from a
click handler you wrote inside your own pane is not covered by that guard and is
yours.

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
render, because that is the only place it *can* be enforced reliably. The registry
deliberately does not sanitize, since escaping data at rest produces double-escaped
text the moment a correct renderer is put in front of it.

**Where the host now holds this rule under test, and where it does not.** ISSUE-002
gave the host its first render sites for plug-in strings. **One of them is tested:**
the ribbon renders `RibbonAction.label` as a text node. *Tests:*
`src/components/__tests__/RibbonToolbar.test.tsx` — "renders a markup-shaped plug-in
label as a text node, not as markup" and "the module source contains no
HTML-injection sink at all", the second of which parses the component with the
TypeScript compiler, so it still holds if a second render path is added later.

**The other render site is not tested for this, and the difference is stated rather
than glossed.** `ShellLayout` renders your `NavigationNode.label` and your extension
`name` into pane 1 with ordinary JSX interpolation, which is the correct pattern —
but `src/components/__tests__/ShellLayout.test.tsx` contains no injection case and no
source scan, so there is nothing pinning it and it must not be cited as a control.
Per ADR-0001 Amendment G that makes it an untested obligation on the host, not a
protection the host delivers.

**And none of it covers what is inside your panes.** Everything `views.pane2` and
`views.pane3` render is yours, the host does not inspect it, and there is no
sanitizer between your JSX and the DOM. `VirtualizedList` is a third host render
site and it is held to the same standard as the ribbon — it offers no injection
sink of its own, pinned by "the module source contains no HTML-injection sink at
all" and "the module source names no URL-bearing attribute a plug-in value could
reach" in `src/components/__tests__/VirtualizedList.test.tsx` — but what your
`renderRow` returns is still entirely yours. So for your own content the rules
below remain exactly what they say: obligations on your code, which nothing in the
host enforces.

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
  selectedItemIds: Object.freeze([]),
  selectedItemId: null,
  contextKeys: Object.freeze({}),
});

export function makeShellStub(): IShellAPI {
  // Deep-frozen, because the real one is: a test double you can monkey-patch
  // will let code pass that fails against the host.
  return deepFreeze<IShellAPI>({
    setSelectedItem: vi.fn(),
    setSelectedItems: vi.fn(),
    setActiveNavNode: vi.fn(),
    setBadgeCount: vi.fn(),
    getBadgeCount: vi.fn(() => undefined),
    setContextKey: vi.fn(),
    getContext: vi.fn(() => context),
  });
}
```

> **This stub grew with the contract, and that is the mechanism working rather
> than a breaking change to apologise for.** `IShellAPI` went from three members
> to seven in ADR-0001 Amendment K. Because the stub is typed as `IShellAPI`
> rather than as a structural literal, the compiler failed on the old
> three-member version the moment the interface widened — which is exactly the
> signal the paragraph above promises, arriving exactly when it was supposed to.
> If you copied the old stub, the four members to add are the four in the snippet
> that are not `setSelectedItem`, `setBadgeCount` or `getContext`.

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

### Four traps this repository walked into first, so you do not have to

These were all found writing `src/__tests__/IntegrationSuite.test.tsx`, which
drives the assembled shell through the two extensions in `src/mocks/`. They are
about the *test environment*, not about the contract, and none of them is
discoverable by reading a docblock.

**Your module state outlives a mount, and that is correct.** A well-written
extension keeps its cache, its selection and its event log in module scope, so two
pane views in unrelated subtrees can share it through `useSyncExternalStore` — the
only shape that works, because the host mounts your `pane2` and your `pane3` in
subtrees neither of which is an ancestor of the other. The consequence for your
tests is that one case leaks into the next. **Do not add a `resetForTests()` export
to fix that.** A test-only door in shipping plug-in code is a second way in, and it
is exactly what the two verification remotes here refuse to have. Use
`vi.resetModules()` followed by a dynamic `import()` of your own module: it is the
only reset that is not also a hole. It is safe for React, which is externalised
rather than transformed and so is not re-evaluated by the reset.

**`@testing-library/user-event` deadlocks against Vitest's fake timers, and the
documented fix does not fix it.** The usual advice is
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. That handles
`user-event`'s own inter-event wait and not the deadlock that actually bites, which
is one layer up: `@testing-library/react` installs an `asyncWrapper` that drains
the microtask queue after every async interaction by awaiting a real
`setTimeout(resolve, 0)`, and advances the clock only `if
(jestFakeTimersAreEnabled())` — a helper that begins `typeof jest !== 'undefined'`.
Vitest defines no global `jest`, so the detection is false, the awaited timer is
faked, and every `await user.click(...)` hangs until the case times out. Measured
in this environment: `jest` is `undefined` while `setTimeout` does carry sinon's
`clock`. If your extension owns a timer, use `fireEvent` — synchronous, no async
wrapper — and advance the clock yourself inside `act`. Avoid `waitFor` under fake
timers for the same reason: its own timeout is faked while it waits for it.

**A timer that fires outside `act()` is a warning, not a mystery.** The inventory
mock runs a 200ms interval that writes badges through `IShellAPI`. Under real
timers it fires between assertions and React complains. Fake timers plus
`act(() => { vi.advanceTimersByTime(n); })` makes the whole thing deterministic,
including the interval's own cleanup: `vi.getTimerCount()` returning to its
pre-mount baseline after unmount is the cleanest assertion available for trap 6
above.

**jsdom cannot do three things you may be about to test for.**
`Element.prototype.scrollIntoView` does not exist, `ResizeObserver` and
`IntersectionObserver` do not exist, and there is no `PointerEvent` — so a
`fireEvent.pointerMove` degrades to a plain `Event` carrying no `clientX` and any
drag you build on it silently does nothing. Assert the narrower thing and say so in
the test's name, rather than asserting the wider thing against a no-op. The
virtualizer, for instance, deliberately assigns `scrollTop` rather than calling
`scrollIntoView`, and that assignment is observable. *Tests:*
`src/__tests__/IntegrationSuite.test.tsx` — "asks for the selected row to be
scrolled into view by assigning scrollTop, which is what jsdom can observe" and
"cannot be driven by a POINTER drag at all, because this jsdom implements no
PointerEvent".

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
- [ ] Every `hotkey` uses an allowlisted key — `escape` is not one — carries
      Ctrl/Alt/Meta if the key is a single character (WCAG 2.2 §2.1.4) or is
      `enter` (it activates the focused control, which is a separate rule and not
      2.1.4), and is unique within your own `ribbonActions`. Shift counts for
      neither rule. A chord fires only while you are in the foreground and only
      for an action that is visible and enabled; no code assumes otherwise.
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
      confinement" above, and `src/core/__tests__/dataflow.test.tsx` (badge
      collision-resistance) for what *is* pinned.
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
| `src/core/hotkeys.ts` | `hotkeyToken`, `describeHotkey`, `ariaKeyShortcuts`, `matchesHotkey`. Four pure functions over a chord — no DOM, no listener, no dispatcher. Landed. |
| `src/core/hotkeyDispatch.ts` | `useHotkeyDispatch`. The shell's one `keydown` listener, called once by `ShellLayout`: foreground-scoped, bubble phase, gated by the same `isVisible`/`isDisabled` as the ribbon button. Landed. |
| `src/core/ribbonAction.ts` | `isVisible`, `execute`, `report`. The two guards every route to a plug-in action goes through, in one copy so the button and the chord cannot drift apart. Landed. |

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
