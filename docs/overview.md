# What this is

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links were corrected for this file's location.

LEAPWare-ShellUX is the container. You bring the product.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONTEXT BAR (32px)  host commands ········ contextual commands     │
├───────────────┬───────────────────┬─────────────────────────────────┤
│  PANE 1       │  PANE 2           │  PANE 3                         │
│  navigation   │  master / list    │  detail                         │
│  240px        │  360px            │  floating toolbar (selection)   │
│  ↕ collapses  │  virtualized      │  header + scroll + drawer slot  │
│    to 48px    │                   │  omnibox composer, docked       │
└───────────────┴───────────────────┴─────────────────────────────────┘
                   Cmd-K opens the command palette, over everything
        ⇕                   ⇕                       ⇕
              all dividers user-resizable
```

An extension supplies a navigation entry, a Pane 2 list view, a Pane 3 detail
view, and a set of commands. The host renders them. The host never knows
whether it is showing email, inventory records, or something else entirely.

## Keyboard shortcuts on commands

A command may carry an optional `hotkey`: a **structured chord**, `key`
plus the optional `ctrl`, `alt`, `shift` and `meta` booleans, rather than a string
like `"Ctrl+Shift+K"` that would need a parser at the trust boundary.

> **Declared, validated and — since ISSUE-006 — dispatched.**
>
> `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener, attached to
> `window` in the **bubble** phase and called once by `ShellLayout`. A chord is
> live only for the **foreground** extension — ADR-0001 Amendment H Decision 6
> makes two extensions claiming `Ctrl+K` legal, so a shell-wide table would be
> ambiguous by construction — and only for an action that is **visible** and **not
> disabled**, through the same `isVisible` and `isDisabled` guards the button
> passes. A chord is suppressed outright when the event was already handled, when
> it is auto-repeat, while an IME composition is in flight, and while focus is in
> an `input`, `textarea`, `select`, a `contenteditable` subtree or an ARIA
> `textbox`/`searchbox`/`combobox`. **That list is a guardrail, not a boundary:** a
> plug-in that builds a custom editor out of a bare `div` will get chords fired
> into it, and its remedy is `stopPropagation()`, which the bubble phase
> deliberately leaves working.
>
> `aria-keyshortcuts` is now emitted, on exactly the actions that will fire — a
> chord-bearing action that is not disabled, on the bar and in the overflow menu.
> A disabled action gets none, because advertising a shortcut that does not fire
> is a lie to assistive technology in either direction.
>
> **The no-listener scan was narrowed rather than deleted, and both halves are now
> allowlisted.** ISSUE-004 scoped the key-event half to one named module for the
> list virtualizer and deliberately left the listener half absolute; a dispatcher
> is a global listener, so ISSUE-006 scoped that half too — to exactly
> `core/hotkeyDispatch.ts`. Both allowlists are exact in both directions, so a
> stale entry and an unreviewed widening each fail. What a source scan cannot see —
> that the one listener is really removed, with the identical function reference —
> is pinned at runtime instead. *Tests:*
> `src/__tests__/noEventListener.test.ts` — "finds no listener registration in any
> module outside the hotkey-dispatch allowlist", "finds no key-event name in any
> module outside the key-event allowlist", "holds the key-event allowlist to the
> exact spellings each listed module contains", "holds the hotkey-dispatch
> allowlist to the exact spellings the dispatcher contains" and "holds the
> dispatcher to exactly one addEventListener and one removeEventListener";
> `src/core/__tests__/hotkeyDispatch.test.tsx` — "adds exactly one keydown listener
> and removes the identical handler on unmount" and "registers once under
> StrictMode, whose simulated remount is symmetric".

What the host does enforce, at registration:

- **`key` must name one of 60 keys on the `HOTKEY_KEYS` allowlist** — the 26
  letters, the 10 digits, `f1`–`f12`, the four arrows and eight named navigation
  and editing keys. `tab` (it owns focus order), `space` (it activates the focused
  control), `escape` (it is the shell's dismissal key — it closes the context bar's
  overflow menu, cancels a drag, leaves fullscreen and dismisses a Radix dialog,
  and this project ships `@radix-ui/react-dialog`) and every modifier named as a
  key are deliberately absent.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — ribbon
  action hotkeys > accepts every key in the host allowlist", which also pins the
  size at 60 and asserts `escape` is not a member, and the `it.each` table
  "rejects %s as a hotkey key" beside it, which walks `escape` alongside `tab` and
  `space`.
- **A bare chord is refused, under two rules that are deliberately kept apart.** A
  **single-character** key (`k`, `7`) carrying no `ctrl`, `alt` or `meta` is
  refused under WCAG 2.2 §2.1.4 Character Key Shortcuts, Level A — see
  Accessibility below. Separately, **`enter`** is refused bare because it
  *activates the focused control* — the default button, a focused link, a table
  row — which is the same reason `space` is off the allowlist entirely. 2.1.4 is
  about *character* keys and does not reach `enter`, so the Enter refusal names no
  criterion and no level. **`Ctrl+Enter` stays legal**, and is the one genuinely
  wanted chord in that family.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
  activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4
  for enter, which is not a character key", "leaves the 2.1.4 message alone for a
  genuine character key" — the two together pin the split in both directions — and
  "accepts ctrl+enter, the one genuinely wanted chord in this family".
- **The same chord twice inside one extension is refused**, with the
  `ShellUXError` code `DUPLICATE_HOTKEY`. Scoped to one extension on purpose:
  chords are live only for the foreground extension, so two *different*
  extensions both claiming `Ctrl+K` is not a conflict and is not rejected.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  duplicate hotkeys within one extension > rejects the same chord twice, with
  DUPLICATE_HOTKEY on the second action" and "lets two DIFFERENT extensions
  declare the same chord".

`src/core/hotkeys.ts` exports four pure functions over a chord and nothing else:
`hotkeyToken` (the canonical token that deduplicates at registration),
`describeHotkey` (`"Ctrl+Shift+K"`, the spelling a user reads in a tooltip),
`ariaKeyShortcuts` (`"Control+Shift+K"`, the UI Events key values ARIA requires —
`Ctrl` is not a valid key value, which is why these are two functions) and
`matchesHotkey` (an exact match against the five keyboard-event fields it
declares). The dispatcher is a separate module, which is what keeps every one of
these callable on a plain record with no DOM.
*Test:* `src/core/__tests__/hotkeys.test.ts` — "hotkeys module — does not attach
anything > exports only pure helpers — the dispatcher is a separate module" and
"ariaKeyShortcuts > spells the control key Control, which describeHotkey
deliberately does not".

The author-facing contract in full is in [`DEVELOPER.md`](../DEVELOPER.md) under
"`Hotkey` — a keyboard chord on a command"; the decisions and what was
rejected are ADR-0001 Amendment H.

## Architectural influences

- **Eclipse RCP / OSGi** — the extension registry model. Capabilities are
  declared and discovered through a registry rather than wired by direct
  reference.
- **VS Code** — the *shape* of a restricted API surface: an extension is handed
  one object describing everything it may ask for, rather than a reference to
  host internals. **Borrowed as an API-design idea, not as an isolation
  mechanism**, because VS Code does not provide one either. Microsoft's own
  runtime-security documentation states that the extension host runs with the
  same permissions as VS Code itself, and that an extension can read and write
  files, make network requests and run external processes. Their protection model
  is vetting, publisher verification and a trust prompt — reputation, not
  enforcement. An earlier version of this line said extensions "cannot reach into
  the host or into each other"; that was false about this shell and false about
  VS Code. What ShellUX takes is the restricted-object contract; see "Security
  posture" below for what that contract does and does not deliver here.
- **Vite** — local-first, lazy module loading. Extensions load on demand, from
  local modules, with no build-time coupling to the host and no network
  dependency for the shell to function.

The registry decision and its rejected alternatives are recorded in
[`docs/adr/0001-ioc-registry-architecture.md`](adr/0001-ioc-registry-architecture.md).

---

# Design system: high-density desktop

This is a **desktop information tool**, not a mobile web page. The density is a
deliberate, enforced constraint, not a stylistic preference.

| Property | Rule |
|---|---|
| Padding | `p-1` to `p-3`. Nothing looser in shell chrome. |
| Base type | 11px – 13px. |
| Borders | 1px, `border-border-default`. One declaration, every theme. |
| Colour | Always a semantic token. No palette literal, no `dark:` variant. |
| Pane 1 | 240px default, collapses to a 48px icon track. |
| Pane 2 | 360px default. Virtualized by the extension's own view, with the host's `VirtualizedList`. |
| Pane 3 | Flex. Own header, own scroll container, utility drawer slot. |

Airy mobile-web spacing is explicitly out of scope. A user of this shell is
expected to be looking at a lot of rows on a large screen and to value seeing
more of them over seeing them spaciously.
