# LEAPWare-ShellUX — Issues Manifest

This manifest is the authoritative work breakdown for the initial build of
LEAPWare-ShellUX. Except where an issue is explicitly marked `LANDED`, it is a
**specification of intended work**, not a record of completed work. Nothing
marked otherwise should be read as a claim that the described behaviour
currently exists.

## Status legend

| Marker | Meaning |
|---|---|
| `LANDED` | Merged. The source files exist, are tested, and pass the coverage gate. |
| `IN PROGRESS` | Someone is actively writing this code now. |
| `NOT STARTED` | Specified only. No source file exists. |
| `BLOCKED` | Cannot start until a listed dependency lands. |

## Current state

| Issue | Title | Status |
|---|---|---|
| ISSUE-001 | Type-Safe IoC Extension Registry & Primitives | `LANDED` |
| ISSUE-002 | Compact Desktop 3-Pane Resizable Layout Matrix | `LANDED` — merged 2026-08-02. The ribbon half was later **deleted** by the native-host pivot's Phase 4; see below |
| ISSUE-003 | UI State Hydration & Serialization Engine | `LANDED` — merged 2026-08-02, engine and shell consumption both |
| ISSUE-004 | High-Throughput Row Virtualizer & Fault Boundaries | `LANDED` — merged 2026-08-02. **`VirtualizedList` still has zero consumers**; see #91 and HANDOFF §6.7 |
| ISSUE-005 | Verification Remotes & Adversarial Integration Suite | `LANDED` — merged 2026-08-02; one Definition-of-Done clause deliberately substituted, see "As landed" below |

> **RESOLVED 2026-08-03. The four rows above said `IN PROGRESS` — "implemented and
> green, not merged" — and all four merged on 2026-08-02.** The careful reasoning
> below is kept because it was right when written and because it is the record of a
> marker being refused rather than rounded up; read it in the past tense. Every one of
> the four is now `LANDED` by the legend's own four-part definition: merged, the source
> files exist, they are tested, and they pass the coverage gate.
>
> **Two of the four carry a correction rather than a plain promotion**, and rounding
> those up would repeat the mistake this note is about. ISSUE-002's ribbon renderer was
> **deleted** by the native-host pivot's Phase 4 and replaced by one command registry
> with four surfaces; the pane layout it also specified is what survives. And
> ISSUE-004's `VirtualizedList` landed with **zero consumers** and still has none — see
> #91 and `HANDOFF.md` §6.7. Closing #27.

**No marker in the legend fitted ISSUE-002 exactly, and it was recorded that way
rather than rounded up.** `LANDED` is defined as four things: *merged*, the source
files exist, they are tested, and they pass the coverage gate. The last three are
true — `src/components/layout/ShellLayout.tsx`,
`src/components/layout/PaneWrapper.tsx` and `src/components/ui/RibbonToolbar.tsx`
exist, carry 120 tests across five files in `src/components/__tests__/` — five of
them ISSUE-004 fault-containment cases added to `ShellLayout.test.tsx`, and 28 of
them the ISSUE-003 persistence and issue-#12 badge cases in
`ShellLayoutPersistence.test.tsx` and `ShellLayoutBadges.test.tsx` — and the
full suite runs 915 tests green at 100% statements, branches, functions and lines
with `src/components/**` inside the `vitest.config.ts` coverage include list. **The
first is false.** The work is committed on branch `phase-2-shell` and has not been
through review or merge; the older form of this paragraph said it was uncommitted on
`phase-1-hotkeys` with `src/components/` untracked, and both of those stopped being
true when the branch was cut. `IN PROGRESS` is therefore the closest true marker, and the row
carries the qualification inline so that nobody reads it as either "not written" or
"merged". This row must be changed to `LANDED` when, and only when, the merge
happens; the tests and the gate are already satisfied and will not need re-checking
for that transition.

**ISSUE-003 now misses `LANDED` by ONE thing rather than two, and the second miss
being closed is the change worth recording.**
`src/core/services/HydrationEngine.ts` and `src/hooks/useLocalStorageState.ts`
exist, carry 146 tests across
`src/core/services/__tests__/hydrationEngine.test.ts` and
`src/hooks/__tests__/useLocalStorageState.test.tsx`, and sit inside the same 100%
statements/branches/functions/lines gate. So "the source files exist", "they are
tested" and "they pass the coverage gate" are all true, and *merged* is false for the
same reason it is false for ISSUE-002: the work is on branch `phase-2-shell` and has
not been through review or merge.

**The second miss is closed: the shell consumes the engine.** This paragraph used to
say that `src/components/layout/ShellLayout.tsx` and `src/App.tsx` neither read nor
wrote persisted state, that they imported neither `useLocalStorageState` nor an
engine, and that what existed was "a tested engine with no consumer". All of that
has stopped being true. `ShellLayout` now binds the pane-1 collapsed flag through
`useLocalStorageState`, takes a mount-time snapshot of the pane sizes for its
`defaultSize` props, writes back through `setSlot` on every layout the panel group
commits, and restores the foreground extension through `selectActiveExtensionId`.
`App.tsx` composes nothing for it and does not need to: `ShellLayout` resolves
`getDefaultHydrationEngine()` when no engine is supplied, and that is the instance
the running shell uses. 20 tests in
`src/components/__tests__/ShellLayoutPersistence.test.tsx` drive the assembled shell
over a real `ShellStorage`, inside the same coverage gate.

**Exactly three slots are persisted, and the boundary is recorded here so that a
later reader does not have to infer it:** the pane sizes, the pane-1 collapsed
flag, and the id of the foreground extension. Deliberately NOT persisted — the
utility drawer flag, the selected navigation node, the selected item, the measured
group width, and any pane size changed while pane 1 is collapsed. Per-extension
scoped persistence is supported by the engine and reached by nothing, because
`IShellAPI` still has no persistence member; that channel belongs to ISSUE-005's
reload-and-restore cases and is not claimed here.

**Two Definition-of-Done items that could not be met by the engine alone are now
met.** "No flash of default layout on reload" is asserted on the RENDER LOG rather
than on the final DOM — the restored value is in the shell's first render and the
number the shell would have computed for itself is in no render at all — and the
ISSUE-002 dependency ("consumes pane sizes and collapse state") is satisfied in both
directions, restore and write. *Tests:*
`src/components/__tests__/ShellLayoutPersistence.test.tsx` — "renders the restored
pane sizes on the panel group first render, and the measured default never",
"renders the collapsed icon track on the first render, and the expanded navigation
panel never", "coalesces a keyboard-driven resize into one storage write rather than
one per frame", "clamps a restored pane size that no longer fits the pane minimums
at this width", "discards a hand-edited record whose pane size is outside the engine
band, and renders the measured defaults" and "renders, resizes and collapses with a
storage that throws on every access". `IN PROGRESS` is still the closest true marker,
and this row becomes `LANDED` on merge and on nothing else.

**Issue #12 — the badge render path — is closed in the same change, and it was the
render half only.** `IShellAPI.setBadgeCount` had been implemented, validated and
tested since ISSUE-001 and the value it wrote reached no renderer:
`ShellLayout` drew `NavigationNode.badgeCount` off the registry's frozen blueprint
record, so a runtime badge write was invisible. `src/core/ShellAPI.ts` grew
`useBadgeCount(extensionId, nodeId)` as the selector, and the nav tree now subscribes
through it with the store OVERRIDING the blueprint and the blueprint as the fallback
— in the collapsed 48px icon track as well as the expanded pane, and for a count
written back down to `0`. *Tests:*
`src/components/__tests__/ShellLayoutBadges.test.tsx` — "lets a setBadgeCount write
through a live IShellAPI change what the sidebar renders", "overrides a blueprint
badge with the store value, including down to zero", "shows a runtime badge in the
collapsed 48px icon track too" and "renders the blueprint badge for a node the store
has never been written for"; `src/core/__tests__/badgeSelector.test.tsx` for the
selector in isolation.

ISSUE-001 was verified against running code by an independent adversarial
verification on **2026-07-29**. What that verification actually did, so the
claim is checkable rather than decorative:

- Re-ran `npm run lint`, `npm run typecheck`, `npm run test:coverage` and
  `npm run build` itself rather than trusting a reported result.
  `src/core/types.ts`, `src/core/RegistryContext.tsx` and `src/core/ShellAPI.ts`
  exist and hold a 100% statement/branch/function/line gate over `src/core/**`.
- Reproduced eight attack classes against the built registry and confirmed all
  eight are closed. Each is a standing test in the suite, not a one-off session
  transcript — per ADR-0001 Amendment G the class is only listed here if it can
  name the test that holds it:
  1. Registration hijack via a mutating `id` getter — `registrySecurity.test.tsx`,
     "register — a shifting id cannot hijack another extension > registers under
     the id that was validated, leaving the victim untouched".
  2. Reserved-id bypass — `registrySecurity.test.tsx`, "register — a shifting id
     cannot smuggle a reserved key into the store > never stores \"__proto__\" as
     a live key".
  3. `register` throwing rather than returning a failure — `registry.test.tsx`,
     "register — hostile payloads never crash the host > rejects a payload whose
     getter throws an Error, without propagating it".
  4. A hostile `setBadgeCount` — `shellApi.test.ts`, "setBadgeCount rejects an
     unstringifiable nodeId with a ShellUXError > never runs a plugin-supplied
     toJSON".
  5. A hostile `setSelectedItem` — `shellApi.test.ts`, "setSelectedItem validates
     its argument > does not stringify the rejected value".
  6. `Proxy` `length` mutation between the bounds check and the walk —
     `registryNormalization.test.tsx`, "register — a lying `length` cannot grow
     the payload after it is measured > stores exactly the ribbon actions it
     bounds-checked, and nothing past them".
  7. Post-registration mutation of the stored record —
     `registryNormalization.test.tsx`, "register — the stored record is
     host-owned > is unaffected by the plugin mutating its own blueprint
     afterwards".
  8. A weaponised `ShellUXError` relocated into the host —
     `registryNormalization.test.tsx`, "register — a weaponised ShellUXError
     cannot be relocated into the host > rejects an attacker-chosen code and
     defuses a detonating message getter".
- Measured, through a logging `Proxy`, that every untrusted property is read
  exactly once — not asserted from reading the source. *Test:*
  `registrySecurity.test.tsx` — "reads the id exactly once, so no later read can
  differ from the checked one", plus the duplicate-id and StrictMode variants
  beside it.

**What that attestation does not reach, stated so its date is not over-read.** It
ran on **2026-07-29** and names three files. `src/core/hotkeys.ts` did not exist
then: it landed on **2026-07-30**, the day after, in commit `7fb0649`, which also
added the `HOTKEY_KEYS` allowlist and `normalizeHotkey` to
`src/core/RegistryContext.tsx`. `src/core/ActivationContext.tsx` is likewise not
among the three files enumerated above. **Nothing in the attestation is a claim
about either file, or about `RegistryContext.tsx` as it stands after `7fb0649`.**
The hotkey work carries its own tests — named in "As landed" below — but it has
not been through an independent adversarial verification, and this note exists so
that a reader cannot borrow the 2026-07-29 date to cover it. The attestation
itself is unchanged and remains true of what it enumerates.

**The caveat that stood here is closed.** The same verification found that
`validateBlueprint` could escape a raw `TypeError` rather than a `ShellUXError`
on exotic input. That was fixed in Phase 1 — all five `Array.isArray` sites are
now guarded — and is pinned by "validateBlueprint — a revoked Proxy" in
`src/core/__tests__/validation.test.ts`. The history is kept under "Follow-up
defects" below rather than deleted. One narrower exposure remains open and is
recorded there: a throwing property getter on the payload still propagates out of
`validateBlueprint` untyped, which is why callers of that export must guard it.
Neither was ever reachable through `register`.

Its unblocking of ISSUE-002 is why that row stopped reading `BLOCKED`; ISSUE-002
has since been written and is recorded above. **No issue other than ISSUE-001 has
been verified against running code by an independent adversarial verification** —
ISSUE-002 passing its own suite is not that, and the two must not be conflated.
Every remaining "Definition of Done" is a gate that still has to be passed.

---

## ISSUE-001 — Type-Safe IoC Extension Registry & Primitives

**Status:** `LANDED`

### Technical Specification

Establish the inversion-of-control contract that every other part of the system
depends on. The shell host owns lifecycle, layout and routing; it owns **no**
business logic. Extensions are supplied to the host, not imported by it.

The work has three parts:

1. **Type primitives (`src/core/types.ts`).** Define the extension contract —
   referred to throughout the docs as `LEAPExtensionBlueprint` — and the shell
   service contract, `IShellAPI`. The blueprint must at minimum carry: a stable
   unique extension id, a human-readable display label, an optional icon
   reference, the Pane 1 navigation entry, the Pane 2 (master/list) view
   component, the Pane 3 (detail) view component, and a collection of ribbon
   actions. Ribbon actions must each carry an id, a label, an invoke handler,
   and a **visibility predicate** evaluated against current shell state so that
   contextual actions can appear and disappear without the host knowing what
   they mean.

2. **Registry container (`src/core/RegistryContext.tsx`).** A React context
   plus provider that accepts a set of blueprints, validates them, indexes them
   by id, and exposes read access to consumers. Registration is the only way an
   extension becomes reachable; there is no side-channel. The registry must
   reject duplicate ids deterministically rather than silently last-write-wins,
   and must survive a malformed blueprint without taking the host down.

3. **Shell API construction (`src/core/ShellAPI.ts`).** Build the per-extension
   `IShellAPI` instance handed to each extension at activation. The object
   handed out must be **deeply frozen** before it crosses the boundary, so that
   a plugin cannot monkey-patch shell services for other plugins. Frozen means
   recursively frozen — a shallow `Object.freeze` on the root is not sufficient
   and will not pass review. As landed this holds for every container the **host**
   owns, and deliberately not for the plug-in functions carried inside them — see
   ADR-0001 Amendments D and E, and the accepted limit in `README.md`. *Tests:* the
   deep-freeze gate in the Definition of Done below names them.

The precise TypeScript signatures are settled *by this issue*. Downstream
documents must not assume signatures ahead of this issue landing.

### Explicit File Paths

- `src/core/types.ts`
- `src/core/RegistryContext.tsx`
- `src/core/ShellAPI.ts`
- `src/core/ActivationContext.tsx`
- `src/core/hotkeys.ts`

The last two were not named by the original specification and were added as the
issue landed, so they are recorded here rather than left to be discovered in the
tree: `ActivationContext.tsx` holds the activation lifecycle that mints the
per-extension `IShellAPI`, and `hotkeys.ts` holds the three pure chord helpers
`RegistryContext.tsx` deduplicates hotkeys with. Both sit under `src/core/**` and
therefore under the same coverage gate as the other three.

### Adversarial Edge-Cases to Handle

- Two extensions registering the same id. Must be a deterministic, reported
  failure — not a silent overwrite.
- A blueprint missing required fields, or with fields of the wrong runtime type
  (a string where a component was expected). Must be rejected at registration
  with the offending id named, not thrown at first render.
- An extension mutating the `IShellAPI` object it was given, or mutating a
  nested service object on it. Deep freeze must make this a no-op in sloppy
  mode and a `TypeError` in strict mode; either way no other extension may
  observe the change.
- An extension retaining a reference to the API object after it is deactivated
  and calling into it later.
- Circular references inside a blueprint (e.g. a ribbon action closing over the
  blueprint itself). The deep-freeze walk must not infinite-loop.
- An extension id that is not a safe key — `__proto__`, `constructor`,
  `prototype`, the empty string. Prototype pollution via the id index is the
  specific attack to close.
- A ribbon action whose visibility predicate throws. A throwing predicate must
  be treated as "not visible" and reported, never allowed to break the ribbon.
- Zero registered extensions. The shell must boot to an empty but usable state.

### Dependencies

None. This is the root of the dependency graph.

### Definition of Done

- `src/core/types.ts`, `src/core/RegistryContext.tsx` and `src/core/ShellAPI.ts`
  exist and type-check under the project's `tsconfig.json` with no `any` in the
  public contract surface and no `@ts-ignore`.
- Deep freeze is verified by test: a nested property of a handed-out
  `IShellAPI` cannot be reassigned, and the attempt is observable in a test.
  *Tests:* `src/core/__tests__/shellApi.test.ts` — "is deep-frozen: strict-mode
  reassignment throws" and "is deep-frozen: sloppy-mode reassignment is a silent
  no-op"; the `deepFreeze` walk itself in "freezes nested objects and arrays",
  "freezes function-valued properties", "freezes symbol-keyed properties too" and
  "terminates on a cyclic graph".
- Duplicate-id registration is covered by a test asserting the deterministic
  failure behaviour. *Tests:* `src/core/__tests__/registry.test.tsx` — "register —
  duplicate ids > rejects a different blueprint claiming an id that is already
  taken" and "treats re-registering the identical blueprint object as an
  idempotent no-op".
- Prototype-pollution-shaped ids are covered by a test. *Tests:*
  `src/core/__tests__/validation.test.ts` — "validateBlueprint — identifier
  hardening > rejects the prototype-pollution identifier \"%s\" as RESERVED_ID"
  and "leaves Object.prototype untouched after a __proto__ registration attempt";
  `src/core/__tests__/registrySecurity.test.tsx` — "never stores \"__proto__\" as
  a live key", which asserts the `Map` store as well as the filter.
- ~~A throwing visibility predicate is covered by a test asserting the action is
  hidden and the ribbon still renders.~~ **Carried to ISSUE-002 — and NOW MET
  there.** This gate could not be met by ISSUE-001: containing a throwing
  predicate requires a call site, and the ribbon renderer that evaluates
  predicates is ISSUE-002. That call site now exists, in
  `src/components/ui/RibbonToolbar.tsx`, which calls `isVisible` inside a guard and
  treats a throw as "not visible". *Test:*
  `src/components/command/__tests__/ContextBar.test.tsx` — "the context bar hides a command whose isVisible predicate throws and still renders the rest", which asserts all three
  halves of the gate: the throwing action is absent, the sibling contextual action
  and the host action are both still in the document, and the failure is reported
  once with the offending action id in the message. Beside it, "the context bar survives a console.error that itself throws while reporting a bad predicate" closes the
  report path, so a tampered `console` cannot convert the containment into an
  escape. What ISSUE-001 enforces on its own remains the narrower thing: that
  `isVisible` and `onExecute` are functions at registration.

  **The gate is met but the entry is kept struck-through and in place**, because
  it is ISSUE-001's Definition of Done and ISSUE-001 did not meet it. The history
  of a carried gate is worth more than a tidy list.
- The Vitest coverage gate passes for `src/core/**`.
- `DEVELOPER.md` is updated to replace its "signature not yet settled" notes
  with the real, as-shipped signatures.
- **Every security claim in prose names the test that exercises it.** No sentence
  asserting a security property may land in a `.md` file or a docblock unless it
  names the test file and `it(...)` description that asserts it. A claim with no
  such test is **narrowed** until an existing test does assert it, or **deleted**;
  deleting it is a correct outcome, not a failure. A claim that genuinely cannot be
  tested yet — because the call site it would need does not exist — is kept only if
  it is explicitly labelled as untested and attributed to the issue that will
  provide the call site.

  This is a **review-time convention. No script checks it**, and ADR-0001
  **Amendment G** says so plainly rather than implying enforcement. Amendment G also
  records the seven consecutive review rounds that produced the rule: in every one of
  them the code was sound and the sentence was wider than the premise licensing it,
  so six correct code fixes in a row did nothing to stop the seventh. The reviewer's
  question is mechanical — *which test?* — and a sentence that cannot answer it is a
  finding.

### As landed — decisions taken during implementation

- **The registry stores a normalised copy, not the caller's object.**
  Validating a payload and then keeping the plugin's live object leaves every
  check revocable: fields stay re-readable through getters and mutable through
  ordinary assignment, so a bounds check measures a number the plugin can
  revise afterwards. Registration therefore reads each untrusted value once and
  writes it into a host-owned, deeply frozen record, which is what
  `getExtension` returns. Function and React-component references are carried
  across unchanged — they must stay callable and keep their identity — and the
  plugin's original object is retained privately for the StrictMode
  reference-identity check and nothing else.
  *Tests:* `src/core/__tests__/registryNormalization.test.tsx` — "register — the
  stored record is host-owned > is frozen at every host-owned level", "is
  unaffected by the plugin mutating its own blueprint afterwards", "carries
  functions and components across by reference, unfrozen and callable", and "keeps
  StrictMode idempotency keyed on the plugin object, not on the copy".
- **`unregister` has no authorisation, deliberately.** See ADR-0001 and the
  declaration comment in `src/core/RegistryContext.tsx`. This issue never
  specified an ownership model and one was not invented here. The absence is
  pinned rather than only stated — *test:*
  `src/core/__tests__/capability.test.tsx` — "does NOT sever useRegistry, so
  unregister stays a route to ending a sibling", which performs the removal from
  inside a plug-in subtree.
- **A ribbon action may declare a keyboard chord. Declaration and validation
  exist; dispatch does not.** `RibbonAction` gained one optional field, `hotkey`,
  typed by the new `Hotkey` interface in `src/core/types.ts` — a structured record
  of `key` plus the four optional modifiers `ctrl`, `alt`, `shift` and `meta`,
  rather than a string such as `"Ctrl+Shift+K"`, so no parser sits at the trust
  boundary deciding for untrusted input what `Cmd` means or whether `Esc` and
  `Escape` are one token. `normalizeHotkey` in `src/core/RegistryContext.tsx`
  checks the shape, the allowlist, the accessibility rule and intra-extension
  uniqueness, then stores a fresh host-owned chord with all four modifiers
  materialised as explicit booleans and frozen before it is assigned into the
  action. `src/core/hotkeys.ts` is new and exports pure functions over a chord —
  `hotkeyToken` (the canonical token, the deduplication key), `describeHotkey` (a
  display spelling for a tooltip), `matchesHotkey` (an exact match, in both
  directions, so no chord swallows the supersets of itself) and, since ISSUE-006,
  `ariaKeyShortcuts` (the UI Events key-value spelling `aria-keyshortcuts`
  requires). **Nothing dispatched any of it when ISSUE-001 landed** — there was no
  `keydown` listener, no dispatcher and no evaluation site anywhere in `src/`, and
  declaring a chord had no observable effect beyond the registration succeeding or
  failing. **ISSUE-006 built the dispatcher**, in `src/core/hotkeyDispatch.ts`,
  and this row is left in its original tense with that correction attached rather
  than rewritten, because it records what ISSUE-001 shipped. Design and rejected
  alternatives: ADR-0001 Amendment H, and Amendment J for the dispatcher.
  *Tests:* `src/__tests__/noEventListener.test.ts` — "finds no listener
  registration in any module outside the hotkey-dispatch allowlist", which parses
  every non-test module under `src/` with the TypeScript compiler and fails on
  `addEventListener` or `removeEventListener` in any code position outside a
  one-entry allowlist, with "visits every module under src/, so an empty scan
  cannot pass vacuously" and "reports a planted listener, however it is spelled"
  beside it so the scan cannot pass by scanning nothing; the key-event half of the
  same file is scoped to a named allowlist since ISSUE-004 and is "finds no
  key-event name in any module outside the key-event allowlist"; `hotkeys.test.ts` —
  "hotkeys module — does not attach anything > exports only pure helpers — the
  dispatcher is a separate module" and "registers no keyboard listener when its
  functions are called", plus "hotkeyToken", "describeHotkey", "ariaKeyShortcuts"
  and "matchesHotkey";
  `registryNormalization.test.tsx` — "register — the stored record is host-owned >
  freezes the stored hotkey", "materialises all four modifiers, so the canonical
  token has no undefined branch", "is unaffected by the plugin mutating its own
  hotkey afterwards" and "omits hotkey entirely from an action that declared
  none".
- **`key` is drawn from a 60-name host allowlist, and a bare chord is refused
  under two separate rules.** `HOTKEY_KEYS`, exported from
  `src/core/RegistryContext.tsx`, holds 60 `event.key` names: the 26 Latin
  letters, the 10 digits, `f1` through `f12`, the four arrows, and `home`, `end`,
  `pageup`, `pagedown`, `enter`, `delete`, `insert`, `backspace` — 26 + 10 + 12 +
  4 + 8. An allowlist rather than "any string", for the same reason ids get one —
  the value arrives from an untrusted manifest. Four groups are absent on purpose:
  `tab`, because an extension that owned it would break focus order for every
  user; `space`, because it activates the focused control; `escape`, because it is
  the shell's dismissal key — it closes the ribbon's overflow menu, cancels a
  drag, leaves fullscreen and dismisses a Radix dialog, and this project ships
  `@radix-ui/react-dialog` — so an extension owning it would break dismissal for
  the whole shell; and every modifier named as a key, because a modifier is a
  *field* on `Hotkey`. `escape` was removed outright rather than made
  modifier-only, because the modified forms are claimed by the OS and the window
  manager and would be dead surface. ADR-0001 Amendment I.
  Separately, a chord whose key is a single character **must** carry `ctrl`, `alt`
  or `meta`, or registration is refused with a message naming **WCAG 2.2 Success
  Criterion 2.1.4 Character Key Shortcuts (Level A)**. `shift` does not satisfy
  it, because Shift produces a character too. 2.1.4's three conformance routes —
  turn the shortcut off, remap it, or make it active only on focus — are all
  unavailable in Phase 1, so the criterion is met the fourth way: the declaration
  does not happen. Function keys and the named navigation and editing keys are
  exempt **from that criterion**, because no dictation and no typing produces
  them.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — ribbon
  action hotkeys > accepts every key in the host allowlist", which also asserts
  `HOTKEY_KEYS.size` is 60 and that `escape` is absent, so a key joining or
  leaving the list is a failing test rather than a silent widening, and the
  `it.each` table "rejects %s as a hotkey key" beside it, which walks `tab`,
  `space`, `escape`, a literal space, each modifier named as a key, `capslock`,
  `altgraph` and `f13` case by case; and "validateBlueprint — the
  WCAG 2.1.4 modifier rule for character keys > rejects a bare single-character
  key and names the criterion", "rejects a bare digit — a digit is a character key
  too", "rejects shift alone, because Shift produces a character", "rejects all
  four modifiers explicitly false" and "exempts every non-character key in the
  allowlist, which may be bare".
- **`enter` is on the allowlist but may never be declared bare, and that rule is
  NOT WCAG 2.1.4.** A second export beside the allowlist,
  `HOTKEY_MODIFIER_REQUIRED_KEYS`, holds the keys that may not go bare whatever
  their length; today it holds `enter` alone. Enter is refused bare on
  **activation** grounds — it presses the default button, follows a focused link,
  opens a focused table row and submits a form, so a bare Enter chord fires on top
  of the activation the user asked for. That is the same failure mode `space` is
  excluded outright for. `shift` does not satisfy this rule either, because
  Shift+Enter still activates the focused control. The key stays on the list
  because **`Ctrl+Enter`** — "send", "commit", "run" — is the one genuinely wanted
  chord in the family and collides with nothing; removing `enter` would have taken
  that with the rest. The two rules meet at one check in `normalizeHotkey`, so
  there is one door and no second suppression at dispatch time, but they carry
  **separate messages**: 2.1.4 governs single printable *character* keys and
  genuinely does not reach `enter`, `escape`, `backspace`, `delete` or `insert`,
  so citing it for Enter would state something false about the criterion and teach
  an author a wrong rule. The Enter message names the activation and ADR-0001
  Amendment I — no criterion, no level.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
  activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4
  for enter, which is not a character key", which asserts the Enter message
  contains neither 2.1.4, nor Character Key Shortcuts, nor Level A, and "leaves
  the 2.1.4 message alone for a genuine character key", which asserts the
  character-key message still names the criterion — the pair pins the separation
  in both directions, so an edit merging the two messages fails one of them
  whichever way it merges; with "rejects a bare enter, which activates the focused
  control", "rejects enter with shift only, because Shift does not stop the
  activation", "rejects every key on the modifier-required list when bare",
  "accepts ctrl+enter, the one genuinely wanted chord in this family" and "holds
  exactly the keys that activate the focused control", which pins the exported
  set's contents and that every member of it is a real allowlist key.
- **Chord uniqueness is intra-extension, not shell-wide, and rejecting
  cross-extension collisions was refused.** `ShellUXErrorCode` gained
  `DUPLICATE_HOTKEY`. The same chord declared twice **inside one blueprint** is an
  unambiguous author error with a deterministic answer, so the second declaration
  loses, with the error naming `ribbonActions[n].hotkey`. Uniqueness is decided on
  the canonical token from `hotkeyToken`, so a chord spelled with its fields in a
  different order, with an absent modifier where another wrote `false`, or with a
  different key casing, is the same chord. The check is threaded through the walk
  over `ribbonActions` that already runs for duplicate action ids, so there is no
  second traversal and the chord count inherits `MAX_RIBBON_ACTIONS` rather than
  needing a bound of its own. Two **different** extensions declaring the same
  chord is not a conflict and is not rejected: chords are live only for the
  foreground extension, exactly as only its `ribbonActions` appear on the ribbon.
  Rejecting them was considered and refused on three grounds recorded in ADR-0001
  Amendment H — it would make registration order semantically load-bearing in a
  lazily loaded shell, it would hand any extension a 128-chord squatting attack
  against a registry with no ownership model, and it would couple validation to
  registry state, which is the time-of-check/time-of-use shape normalisation
  exists to close.
  *Tests:* `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  duplicate hotkeys within one extension > rejects the same chord twice, with
  DUPLICATE_HOTKEY on the second action", "sees through a different spelling of
  the same chord", "sees through a different key casing", "accepts two chords that
  differ only by one modifier", "does not confuse an action with no hotkey for a
  duplicate of another" and "lets two DIFFERENT extensions declare the same
  chord"; `registryNormalization.test.tsx` — "reports a duplicate chord through
  register rather than by throwing", which asserts `register` returns the failure
  and leaves the registry empty rather than throwing it; and, for the inherited
  bound, "register — a lying `length` cannot grow the payload after it is
  measured > applies MAX_RIBBON_ACTIONS to the stored count, not to a revocable
  one".

### Follow-up defects — one closed, two open, none blocking

Found by the 2026-07-29 adversarial verification. Each was reproduced, not
inferred. None of them blocked ISSUE-001 from landing, and none was a reason to
weaken its status — but they were real, and they are recorded here rather than
quietly dropped, in the same spirit as the struck-through carried-forward gate
above. The history stays even once an entry is closed.

- **~~`validateBlueprint` can throw a raw `TypeError`.~~ CLOSED in Phase 1.**
  `Array.isArray` throws when handed a revoked `Proxy`, and five call sites in
  `src/core/RegistryContext.tsx` reached it with an unvalidated value: `isRecord`,
  `describeType`, the `children` check in `normalizeNavigationNode`, and the
  `navigationTree` and `ribbonActions` checks in `normalizeBlueprint`. Every field
  position in the blueprint could steer a revoked `Proxy` into one of them, and the
  path that actually bit was `describeType` rather than `isRecord`: `validateId`,
  `validateText`, `validateFunction` and `validateViewComponent` `typeof`-check
  first, `typeof` does not trap, and the failure path then builds its message.
  **Never reachable through `register`** — its `try`/`catch` absorbed the throw and
  returned a `ShellUXError`, so the "never throws" contract was intact throughout;
  only the exported `validateBlueprint`, which has no catch, leaked it.
  **Fixed:** all five sites now go through a total `checkArray` helper that cannot
  throw, and a revoked `Proxy` is an ordinary typed rejection naming the field.
  *Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — a revoked
  Proxy", which walks every field position that can reach one of the five sites,
  asserts `ShellUXError` at each, and asserts the message names the value rather
  than guessing its type. It was written failing first: 21 of its 23 cases failed
  against the unguarded code with *"expected TypeError: Cannot perform 'IsArray' on
  a … to be an instance of ShellUXError"*.
- **`validateBlueprint` still propagates a throwing property getter untyped.**
  OPEN, and narrower than the entry above. Reading a field off the payload is a
  call into plugin code, a getter may throw anything, and the exported
  `validateBlueprint` has no catch, so that value reaches its caller unchanged. It
  is not a rejection the validator decided on, but a consumer catching only
  `ShellUXError` is still surprised by it. **Not reachable through `register`.**
  Not closed here because the fix is a contract decision — wrap every field read,
  or give the export a result type — and not a guard. *Test:* pinned as a
  known-current behaviour by `src/core/__tests__/validation.test.ts` —
  "validateBlueprint — a revoked Proxy > still propagates whatever a throwing
  property getter threw", so a future fix has to change that test deliberately.
- **A revoked `Proxy` over a function passes `validateFunction` and
  `validateViewComponent`.** OPEN. Its `typeof` is `'function'`, so it satisfies
  the check and is stored by reference like any other handler; calling it later
  throws. This sits within ADR-0001's stated limit — the host validates shape at
  registration and does not vouch for what a handler does when invoked — but the
  host has **no invocation guard**, so the first caller wears the throw. Worth
  closing when a call site exists (ISSUE-002 for `isVisible`/`onExecute`,
  ISSUE-004 for the view components). **Untested, and untestable from here:** there
  is no invocation site in `src/` to assert against, only the registration-time
  acceptance, which is the current behaviour rather than the defect.
- **Untrusted fields are read through the prototype chain.** OPEN. Field reads use
  plain property access with no `Object.hasOwn` guard, so a polluted
  `Object.prototype.badgeCount` is inherited by a navigation node that declares
  none. **No unvalidated value can be smuggled in this way** — an inherited
  value goes through exactly the same checks as an own value, so the type and
  bound guarantees hold either way. *Test:* the guarantee those checks provide is
  pinned by `src/core/__tests__/validation.test.ts` — "validateBlueprint —
  navigation tree > rejects %s as badgeCount" and the bound tests beside it, which
  hold irrespective of where the value came from. **The inheritance itself has no
  test** — nothing asserts that an inherited field is read at all — so the
  "robustness and least-surprise" framing below is reasoning about the code, not a
  measured property. It is a robustness defect, **not a validation bypass**, and it
  is stated that way deliberately rather than inflated.

---

## ISSUE-002 — Compact Desktop 3-Pane Resizable Layout Matrix

**Status:** `IN PROGRESS` — all three files exist, 57 tests pass across
`src/components/__tests__/`, and the coverage gate is green at 100%. **Not merged**,
which is the one clause of `LANDED` it fails; see the note under "Current state"
above for why that marker was not used.

### Technical Specification

Build the Outlook-paradigm shell chrome: a full-width contextual ribbon above
three horizontally resizable panes.

**Ribbon (`src/components/ui/RibbonToolbar.tsx`).** Full container width.
Global host actions are left-aligned. Plugin-injected contextual actions are
right-aligned and are sourced from the active extension's `ribbonActions`, each
filtered through its visibility predicate against current shell state. The
ribbon **must** render plugin-supplied labels as **text nodes only** — no HTML
injection path may exist in this component.

**As implemented, that gate is met at this component.** *Tests:*
`src/components/command/__tests__/ContextBar.test.tsx` — "the context bar renders a markup-shaped plug-in label as a text node, not as markup" and "the module source contains no
HTML-injection sink at all", the latter parsing the module with the TypeScript
compiler so the absence is asserted against the source rather than trusted to
review, with "reports a planted sink, so the scan above cannot pass vacuously"
beside it so the scan cannot pass by scanning nothing.

**Panes (`src/components/layout/ShellLayout.tsx`,
`src/components/layout/PaneWrapper.tsx`).** Three panes using
`react-resizable-panels` with draggable dividers:

- **Pane 1 — navigation sidebar.** 240px default. Collapsible to a 48px icon
  track. Collapse is a distinct state, not merely a small width: at 48px the
  pane shows icons only, with accessible names preserved.
- **Pane 2 — master/list.** 360px default. Hosts the virtualized list from
  ISSUE-004.
- **Pane 3 — detail.** Flexes to fill. Owns its own header region, its own
  scroll container, and a utility drawer slot on its trailing edge.

`PaneWrapper` is the shared shell for a pane: border, overflow discipline, and
the slot contract that lets a pane declare a header and a scrollable body
independently.

**Design system.** High-density desktop, explicitly not airy mobile-web
spacing. Padding stays in the `p-1`–`p-3` range. Base type is 11px–13px.
Borders are 1px. **The spelling above is superseded:** this said
`border-neutral-200` in light theme and `border-neutral-800` in dark, and neither
survives. Every colour under `src/` is now a semantic design token — one
declaration, resolved per theme, with no palette literal and no `dark:` variant
anywhere — so the border is `border-border-default`, and the light-theme
`--border-default` is a value chosen to clear the 3:1 non-text threshold rather
than the hairline the two neutrals were. The rule is enforced, not documented:
*Tests:* `src/__tests__/noRawColor.test.ts` — "finds no raw palette colour or
theme() call in any module, with no exemptions at all" and "finds no dark: variant
in any module outside the allowlist, which is empty".

### Explicit File Paths

- `src/components/layout/ShellLayout.tsx`
- `src/components/layout/PaneWrapper.tsx`
- `src/components/ui/RibbonToolbar.tsx`

### Adversarial Edge-Cases to Handle

- Viewport narrower than the sum of the minimum pane widths. Panes must degrade
  predictably rather than overflowing the document and producing a horizontal
  page scrollbar.
- Dragging a divider fully to one edge. A pane must not become a 0px unfocusable
  void that the user cannot recover by dragging back.
- Collapse toggled while a drag is in flight.
- Restored persisted sizes (from ISSUE-003) that do not sum to 100%, or that
  encode a pane width no longer legal after a min-width change.
- Ribbon overflow: more contextual actions than fit. Must not wrap into a second
  row that shifts the panes downward.
- An extension supplying a very long label, or a label containing markup
  characters. Renders as text, truncates, does not break layout.
- Keyboard-only divider adjustment and focus order across ribbon → Pane 1 →
  Pane 2 → Pane 3.
- No active extension selected. Ribbon right side is empty; layout still valid.

### Dependencies

- **ISSUE-001** — needs the registry to read the active extension and its
  `ribbonActions`, and needs the visibility-predicate contract.

### Definition of Done

- The three files exist, type-check, and render a working three-pane shell.
- Pane 1 collapses to a 48px icon track and expands back, with accessible names
  present in both states.
- Dividers are operable by mouse and by keyboard.
- Density rules hold: no padding above `p-3` in shell chrome, base type within
  11px–13px, 1px borders using the specified neutral tokens in both themes.
- Ribbon renders contextual actions from the registry, honouring visibility
  predicates, with plugin labels as text nodes.
- Overflow, zero-width and no-extension cases are covered by tests.
- The Vitest coverage gate passes for the files in scope.

**Every gate above is met by the implementation described below**, with the
exception of nothing — the coverage gate runs at 100% across `src/components/**`
and the named cases each have a test. What is *not* met is the merge, which is why
the status is `IN PROGRESS`. The gates were checked by running
`npm run test:coverage`, not by reading the source.

### As landed — decisions taken during implementation

- **The ribbon icon table is a `Map`, not an object literal, because the key is
  untrusted.** `RibbonAction.icon` arrives from a plug-in manifest and is used as a
  lookup key. An object literal answers `icons['__proto__']` with
  `Object.prototype` — an inherited value reached from a key that matches no own
  property, and an object React then refuses to render. `SHELL_ICONS` is therefore
  a `ReadonlyMap` of host-authored inline SVGs, for the same reason the registry's
  stores are `Map`s: no prototype chain means no inherited answer, by construction
  rather than by filtering. An unrecognised key renders `FALLBACK_ICON`. It was
  named `RIBBON_ICONS` and lived inside `RibbonToolbar.tsx` until GitHub issue #19
  gave `NavigationNode` an `icon` too; it moved to
  `src/components/ui/shellIcons.tsx` with its `Map` semantics and this argument
  intact, because two copies of a lookup table drift the way two copies of a
  validation rule do. Nothing a
  plug-in supplies ever reaches an SVG `d` attribute, an `href` or a `src`.
  *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "the context bar does not resolve a prototype-shaped icon key to anything inherited", "the context bar resolves an unknown icon key through the host fallback rather than through the key", "resolves a known icon key through the host table on every surface", and "the module source names no URL-bearing
  attribute a plug-in value could reach".
- **Ribbon overflow splits on a fixed inline count, not on measured width.** The
  edge case the specification names is that overflow "must not wrap into a second
  row that shifts the panes downward". A fixed limit of four inline actions
  (`INLINE_ACTION_LIMIT`) guarantees a fixed row height on every viewport without
  measuring anything; measuring available width would mean observing the element on
  every layout change, which is a live subscription this issue does not need. **The
  accepted cost is stated rather than hidden:** a wide monitor could have shown a
  fifth action inline and does not. The split runs on the *visible* set, after
  predicate filtering, so a hidden action cannot occupy an inline slot and push a
  visible one into the menu.
  *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "moves commands past the inline limit into an overflow menu rather than a second row", "never wraps: the bar is a single no-wrap line that scrolls on x only", "does not render an overflow
  trigger when everything fits", "counts only visible commands toward the inline limit", "closes the overflow menu and executes the command when a menu item is chosen", and "closes the overflow menu when the trigger is toggled again".
- **Pane sizes are percentages, and the group width is measured exactly once.**
  `react-resizable-panels` v2 has no pixel unit, and percentages are the right
  primitive for the narrow-viewport case. **The reason they cannot overflow is not
  that they sum to 100, and that distinction had to be corrected here:** the sizes
  are emitted as `flex-grow` factors on panels with `flex-basis: 0` inside a group
  the library styles `width: 100%; overflow: hidden`, so they are *ratios that
  divide* the group's width rather than widths that add up to it. A set of factors
  summing to 187.8 divides 360px exactly as one summing to 100 divides 1000px;
  neither has a pixel in it to spill. **Summing to 100 is in fact FALSE below about
  700px** — `PANE_PX`'s minimums are 176 + 240 + 260 = 676px plus the dividers, so
  from there down the library clamps each panel to its own floor and the total runs
  away from 100. What summing to 100 does buy, where it holds, is that a separator's
  `aria-valuenow` is a percentage of the whole. Both halves are pinned by test so
  that neither can be widened back by accident. But "240px default" is a pixel
  statement, so the group element is
  measured once on mount through a callback ref — during commit, so the second
  render lands before paint and there is no flash — and `PANE_PX` is converted
  against that width. **There is deliberately no `ResizeObserver`.** A later
  viewport change rescales the panes proportionally and leaves the percentage
  minimums where they were, which is predictable and cannot overflow; re-deriving
  pixel minimums live belongs with ISSUE-003, which has to answer the same question
  for restored sizes. When the width is unmeasurable — 0, as it is in jsdom —
  `percentOf` falls back to a declared percentage band rather than dividing by zero.
  *Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "converts the pixel
  pane constants against a measured group width", "falls back to the declared
  percentage band when the group cannot be measured", "sizes every pane as a flex
  ratio of the measured group, so the group width is divided and never exceeded"
  (rendered at 1000, 800, 700, 600, 480 and 360 CSS px rather than at jsdom's
  unmeasurable 0), "keeps the sizes summing to 100 only while the pixel minimums fit,
  which is 800px and wider" for where that weaker property holds and where it stops,
  "leaves no 0px void when a divider is driven fully to either edge", and "reports a
  non-zero minimum on every divider, which is the floor above".

  *Superseded 2026-09-19, twice, and kept as written above because it is the record
  of what ISSUE-002 shipped.* The pane bands have followed an observed width since the
  native-host pivot (`src/hooks/useElementWidth.ts`), and since GitHub issue #23 the
  live layout is re-fitted on every group-width change and the correction is never
  persisted — decision 1 of the banner in `src/components/layout/ShellLayout.tsx`
  is the current statement, and `e2e/pane-refit.spec.ts` measures it.
- **`role="toolbar"` with every button individually tabbable, and NOT the roving
  tabindex the ARIA toolbar pattern recommends.** This is a real deviation and it is
  recorded as one. The roving pattern requires an arrow-key handler, and when
  ISSUE-002 was written an `onKeyDown` prop anywhere under `src/` turned
  `src/__tests__/noEventListener.test.ts` red: its forbidden-spelling regex was
  `/(?:add|remove)EventListener|key(?:down|up|press)/i`, matched case-insensitively
  against every code position in every non-test module, so `onKeyDown` was caught by
  the `KeyDown` alternative. **ISSUE-004 has since split that regex**, because the
  list virtualizer cannot implement arrow-key row navigation without handling a key
  event; the listener half stayed repo-wide with no allowlist at all, and the
  key-event half is now scoped to one named module. The ribbon's deviation therefore
  now rests on the narrower ground it always really had — it has not needed the
  pattern. **ISSUE-006's dispatcher did not change that either:** its listener is on
  `window` and routes declared chords, it puts no arrow-key handler on the toolbar,
  and every ribbon control stays individually reachable by Tab.
  Tab-through is the honest description of what the ribbon does. **Divider keyboard
  operation was not lost to this decision**, because it is the library's own:
  `PanelResizeHandle` renders `role="separator"` with `tabIndex={0}` and implements
  the window-splitter pattern internally, so the host attaches nothing.
  *Tests:* `src/__tests__/noEventListener.test.ts` — "finds no key-event name in any
  module outside the key-event allowlist" and "holds the key-event
  allowlist to the exact spellings each listed module contains", with "reports a
  planted listener, however it is spelled" beside them, whose planted cases include a
  JSX `onKeyDown` attribute specifically; `src/components/__tests__/ShellLayout.test.tsx` — "makes
  every divider keyboard-reachable and actually resizes with the arrow keys", and
  "renders the context bar and three panes in context bar → pane 1 → pane 2 → pane 3 order"
  for the required focus order.
- **`RibbonContext.focusedPane` was left `null`, nothing in the shell ever wrote
  it, and it has since been REMOVED.** Populating it needed focus tracking — which
  pane holds focus, updated as focus moves — and that is a listener, or a
  `focusin` handler, which is the same invariant as above. This entry used to end
  by saying it remained a validated field of the declared contract that simply
  never changed value, and that recording the fact was enough. It was not: a field
  that is permanently `null` invites predicates that can never fire, which is worse
  than an absent one because it looks available. GitHub issue #13 deleted it from
  `RibbonContext`, from the store's validator table and from every document that
  described it. `PaneId` survives as a layout type and `PANE_IDS` survives as the
  runtime exhaustiveness pin `HydrationEngine`'s pane-size record is checked
  against. See ADR-0001 Amendment K Decision 6.
- **No `aria-keyshortcuts` was emitted on any ribbon button, deliberately — and
  ISSUE-006 reversed it, for the same reason.** While nothing dispatched a chord,
  advertising one would have promised a shortcut that does not fire, which is a
  worse failure than the absent attribute: a screen-reader user would be told a key
  works and find that it does not. Now that `src/core/hotkeyDispatch.ts` fires
  chords, the silence became the lie instead, so the ribbon emits
  `aria-keyshortcuts` on exactly the actions the dispatcher will fire — a plug-in
  action carrying a `hotkey` that is not disabled, on the bar and in the overflow
  menu, and never on a host action. The value comes from `ariaKeyShortcuts`, not
  `describeHotkey`: ARIA wants UI Events key values, where the control key is
  `Control`.
  *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "advertises a chord-bearing command with aria-keyshortcuts, in key values rather than display spelling", "omits aria-keyshortcuts from a disabled command, because the chord will not fire", "advertises a chord on an overflow menu item too" and "never advertises a chord on a host command"; that the ribbon module itself still attaches nothing is
  `src/__tests__/noEventListener.test.ts` — "finds no listener registration in any
  module outside the hotkey-dispatch allowlist" and "finds no key-event name in any
  module outside the key-event allowlist", neither of whose allowlists names it.
- **A plug-in view is never rendered as a host sibling.** `views.pane2` and
  `views.pane3` mount only inside `ExtensionHostBoundary`. `ActivationContext.tsx`'s
  banner flagged host-rendered siblings as an outstanding hole in that guardrail
  while pane rendering did not exist; ISSUE-002 is the code that could have opened
  it and does not. **This is a guardrail, not isolation** — ADR-0001 Amendment E is
  unchanged, and reflection over the fiber tree still reaches the controller.
  *Test:* `src/components/__tests__/ShellLayout.test.tsx` — "renders both plug-in
  views inside an ExtensionHostBoundary once activated".
- **Collapse is a different component tree, not a small width.** The specification
  says the 48px icon track is "a distinct state, not merely a small width", so a
  collapsed pane 1 renders outside the panel group as a fixed `w-12` track — 48px in
  CSS on every viewport — and its `Panel` and adjacent divider leave the group
  entirely. This also answers "collapse toggled while a drag is in flight" — and the
  answer is split across two lanes, because **jsdom cannot produce the drag half of
  it.** Measured against `react-resizable-panels` 2.1.9: `getResizeEventCoordinates`
  reads `clientX`/`clientY` only when the event reports `isPrimary`, and jsdom's
  plain-`Event` fallback carries neither, so the library is handed
  `{x: Infinity, y: Infinity}` and the handle never leaves
  `data-resize-handle-state="inactive"`. Supplying a `PointerEvent` constructor does
  not rescue it; that was probed directly. **The jsdom case therefore pins the limit,
  not the drag.** It fires the pointer sequence, asserts in its own body that the
  handle is still `inactive` and that no pane moved, and then pins what the unmount
  really does: collapsing removes the handle with no half-applied layout, because the
  library re-normalises the remaining panels to 100% — asserted as the exact pair
  `[47.4, 52.6]`, not as a sum. **The drag half is pinned in the browser lane**,
  where a real pointer puts the handle into its `drag` state — observed *before* the
  collapse, so an interruption that never interrupted anything fails rather than
  passes — and where the collapse is dispatched rather than clicked, because
  `locator.click()` performs its own mouse down and up and would end the very gesture
  the case is holding open. Accessible names survive the transition — the label stays
  in the tree as an `sr-only` text node rather than being dropped — so the same
  `getByRole('button', { name })` query finds the same button in both states.
  *Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "collapses to a 48px
  icon track and expands back", "keeps the accessible name of every pane-1 entry in
  both states", "shows a monogram in place of the label in the icon track", and
  "survives a collapse toggled while a divider drag is in flight";
  `e2e/pane-dividers.spec.ts` — "ends a drag that is genuinely in flight when the
  pane collapses under it".

### Not built by this issue — do not read them in

Stated because the three files exist and a reader could reasonably assume the shell
is more finished than it is:

- **No fault boundary — CLOSED BY ISSUE-004, which is in this tree and unmerged.**
  A plug-in view that throws during render used to unmount the whole shell. It now
  degrades to a contained surface inside its own pane; `ShellLayout` composes the
  boundaries, and `PaneWrapper` is deliberately still not one of them.
- **No virtualization in the HOST — unchanged, and correctly so.** Pane 2 is still a
  scroll container that mounts whatever the extension renders. ISSUE-004 added
  `VirtualizedList` as a component an extension's own `views.pane2` renders, because
  the host does not know what a row is; an extension that mounts a thousand rows
  directly still has a thousand rows in the DOM.
- **No persistence.** Pane sizes and the collapse state are React state and reset on
  reload. ISSUE-003's engine now exists and is tested, but `ShellLayout.tsx` does not
  import it, so this gap is unchanged from the user's side. ISSUE-003.
- **No hotkey dispatch — CLOSED by ISSUE-006.** This gap stood while ISSUE-002
  shipped: chords were validated at registration and evaluated by nothing.
  `src/core/hotkeyDispatch.ts` now evaluates them, foreground-scoped and gated by
  the same `isVisible`/`isDisabled` as the ribbon button.

---

## ISSUE-003 — UI State Hydration & Serialization Engine

**Status:** `IN PROGRESS` — both specified files now exist, are tested and pass the
coverage gate; the work is unmerged, and **nothing in the shell consumes it.** See
the note under "Current state" above for why no legend marker fits, and "As landed"
below for the decisions taken.

**It was never marked `BLOCKED`**, so ISSUE-002's arrival did not clear a marker
here; what it did was give ISSUE-003's dependency a concrete shape to consume. The
pane state to be persisted is real and can be named: the panel-group
percentages `ShellLayout` derives through `percentOf`, the `isNavCollapsed` flag,
and the `isDrawerOpen` flag — all three still React state that resets on
reload, because the engine that could persist them is not wired to them. Note that
ISSUE-002 measures the group width **once** and does not observe
it, so the "restored sizes that are no longer legal" edge case below is genuinely
ISSUE-003's to answer, and the engine as built answers only the static half of it: a
restored pane size is checked against a fixed percentage band (`MIN_PANE_PERCENT` 2,
`MAX_PANE_PERCENT` 90 — ISSUE-002's own clamp restated rather than imported, so the
host never depends on the layout), and a size outside it discards the whole record.
Nothing checks a restored size against the width the group actually has on this
viewport, because the engine never sees that width. `HydrationEngine.ts` names the
consequence itself: if the two constants ever drift, "the symptom is a restored layout
that the layout immediately re-clamps, not a broken shell". That reconciliation
belongs with the wiring, and the wiring is not done.

### Technical Specification

Persist and restore shell UI state locally so a reload returns the user to the
layout they left. Local-first: no network dependency, no server round trip.

**`src/core/services/HydrationEngine.ts`.** Owns serialization and
deserialization of persisted shell state — pane sizes, Pane 1 collapsed state,
active extension id, and per-extension scoped UI state. Requirements:

- A **schema version** is written alongside the payload. Reads of an unknown or
  older version must migrate or discard, never blindly spread into live state.
- Every read is **validated**, not trusted. Persisted data is user-writable via
  devtools and must be treated as untrusted input.
- Per-extension state is **namespaced by extension id**, so two extensions cannot
  collide on a key.
  > **Read ADR-0001 Amendment E before writing this.** Namespacing delivers
  > collision-resistance, not confinement, and this line previously specified
  > "so one extension cannot read or clobber another's persisted state" — a
  > requirement that **cannot be met in-page** by namespacing, exactly as badge
  > scoping does not meet it today. Either this issue records the same limit
  > honestly, or it depends on the real-isolation work Amendment E's trigger calls
  > for. It must not ship with the stronger sentence and the weaker mechanism.
- Writes are debounced. Dragging a divider must not produce a write per frame.

**`src/hooks/useLocalStorageState.ts`.** The React binding: a state hook backed
by the hydration engine. Must render correctly on first paint without a flash
of default layout, and must not throw when storage is unavailable.

### Explicit File Paths

- `src/core/services/HydrationEngine.ts`
- `src/hooks/useLocalStorageState.ts`

### Adversarial Edge-Cases to Handle

- `localStorage` throwing on access: Safari private mode, disabled storage,
  and quota exhaustion on write. The shell must run with persistence silently
  degraded to in-memory, not crash.
- Corrupt JSON, truncated JSON, or valid JSON of the wrong shape.
- A persisted payload from a future schema version (user downgraded the app).
- Hand-crafted hostile payloads: `__proto__` keys, enormous strings, deeply
  nested objects intended to blow the stack during a recursive validate.
- Two browser tabs writing concurrently — last write wins is acceptable, silent
  interleaved corruption is not.
- Persisted state referencing an extension id that is no longer registered.
- Values that do not survive JSON round-tripping (`undefined`, `NaN`,
  `Infinity`, `Date`, `Map`, `Set`) being handed to the hook.
- Quota exceeded mid-write leaving a partial record.

### Dependencies

- **ISSUE-001** — needs extension ids to namespace per-extension state.
- **ISSUE-002** — consumes pane sizes and collapse state; the two must agree on
  the shape and on what happens when restored sizes are illegal.

### Definition of Done

- Both files exist and type-check.
- Schema version is written and honoured; an unknown version is handled by an
  explicit, tested path.
- All reads pass validation before entering state; a corrupt-payload test and a
  `__proto__`-payload test both pass.
- Storage-unavailable and quota-exceeded paths are tested and degrade to
  in-memory without throwing.
- Writes are debounced, verified by a test that a drag produces one write rather
  than one per frame.
- No flash of default layout on reload.
- The Vitest coverage gate passes for the files in scope.

**Which of these are met.** All but one. "Both files exist and type-check", the
schema-version path, the validation-before-state path, the storage-unavailable and
quota paths, the debounce and the coverage gate are all met and are cited below. **"No
flash of default layout on reload" is met by the hook in isolation and by nothing in
the shell** — `useLocalStorageState` renders the persisted value on its first paint,
but no shell component calls it, so on a real reload the shell still paints its
defaults and keeps them. The ISSUE-002 dependency — "consumes pane sizes and collapse
state" — is likewise unmet: nothing consumes anything yet.

### As landed — decisions taken during implementation

- **An unknown schema version is DISCARDED, never migrated.** ISSUE-003 above allows
  "migrate or discard"; this implementation discards, and the reason is that there has
  only ever been one schema version, so a migration would migrate from a version that
  never shipped — untestable fiction, and dead code the 100% gate would then have to be
  lied to about. The version field is still written, so a future version *can* migrate;
  `loadFrom`'s `version !== SCHEMA_VERSION` branch is the single place to add it. One
  branch covers an older payload, a newer one (the user downgraded the app), a missing
  version and a version of the wrong type alike.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "discards a payload
  from an older schema version", "discards a payload from a FUTURE schema version,
  rather than guessing at it", "discards a payload with no version at all", and
  "discards a version of the wrong type, so \"1\" is not 1".
- **The whole record is written with ONE `setItem` of one key, which is what makes a
  half-written record unconstructible.** Two tabs are last-write-wins, and the unit of
  that is the entire record rather than a field — there is no interleaving for a reader
  to observe, because there is no second write to interleave with. This is also why the
  engine registers no `storage` event listener and does no cross-tab reconciliation,
  pinned by "finds no listener registration in any module outside the
  hotkey-dispatch allowlist" in `src/__tests__/noEventListener.test.ts` — an
  allowlist naming `core/hotkeyDispatch.ts` and nothing else, so this engine is
  covered by the scan rather than exempted from it.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — the whole of "two
  tabs over one storage entry", specifically "the loser's whole record is replaced,
  never interleaved with the winner's" and "interleaving the two tabs still produces
  one complete record"; and "a write that fails on quota leaves the previous record
  exactly as it was".
- **Records handed out are frozen objects with a `null` prototype, not `Map`s.** The
  registry answers the untrusted-key problem with a `Map`; the persistence layer cannot
  reuse that answer wholesale, because these records are *handed out*. `Object.freeze`
  on a `Map` leaves `map.set(...)` fully working, so a frozen `Map` handed to a consumer
  is still host state that consumer can edit. A null-prototype object has no prototype
  chain to pollute — the same property that made the `Map` attractive — **and** it can
  be genuinely frozen. The engine therefore keeps its extension-id index in a private
  `Map` and hands out frozen null-prototype records, which is the same split the
  registry already makes.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "hands out a frozen
  scoped record with a null prototype", "hands out an empty scope constant that is
  frozen and has no prototype", "stores a host-owned copy, so mutating the argument
  afterwards changes nothing", and for the filter layered over it, "refuses a __proto__
  key inside an extension scope" and "refuses a __proto__ extension id and leaves
  Object.prototype untouched".
- **Writes are debounced, and a change that changes nothing schedules no write at
  all.** Dragging a divider coalesces into one write rather than one per frame. The
  window is configurable, `flush` writes immediately and cancels what was pending, and
  `dispose` flushes and releases.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — the whole of "writes
  are debounced", specifically "coalesces a whole drag into one write", "does not
  schedule a write for a change that changed nothing", "honours a custom window",
  "writes immediately on flush, and cancels the pending window", "schedules nothing at
  all when there is no storage", and "flushes and releases on dispose".
- **No storage is a supported mode, not an error.** Safari private mode, storage
  disabled, and a `localStorage` whose getter throws all degrade silently to in-memory:
  the shell runs, state lives for the session, and nothing throws at the caller. A
  quota failure mid-write leaves the previous record intact and the pending record is
  retried on the next flush, so a transient failure recovers rather than poisoning the
  entry.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — the whole of "storage
  that fails", specifically "degrades to memory when reading throws, and reports it",
  "runs with persistence degraded to memory, and nothing throws", "a write that fails on
  quota leaves the previous record exactly as it was", and "retries the pending record
  on the next flush, so a transient failure recovers"; plus "degrades to memory when
  reading localStorage throws" under "the ambient localStorage";
  `src/hooks/__tests__/useLocalStorageState.test.tsx` — "renders and updates with
  storage unavailable, and nothing throws".
- **Per-extension namespacing is collision-resistance, and it is NOT confinement.**
  Recorded here in the same terms `HydrationEngine.ts` states it, because ADR-0001
  Amendment E forbids the stronger sentence and the specification above names the exact
  phrasing that may not ship. What the namespace buys is that two extensions which both
  persist a key named `selection` write to two different scopes and cannot overwrite
  each other by accident. It confines nothing, for two independent reasons. **The scope
  is an argument, not a closure:** `setExtensionState(id, state)` takes the scope from
  its caller, and there is no per-extension facade closing over a validated id the way
  `createRevocableShellAPI` does for badges, because `IShellAPI` has no persistence
  member and this engine is host-side. Any holder of the engine can name any scope —
  weaker than badge scoping, not equal to it. **And the store is one `localStorage`
  entry under one origin:** any script on the page reads and rewrites it without going
  through the engine at all, the same shape as `useShellStore()` being public. Both
  halves of the absence are reproduced by test rather than asserted in prose. **Nothing
  confidential belongs in persisted UI state.**
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — the whole of "the
  namespace — collision-resistance, and the confinement it does not deliver": "keeps two
  extensions that both use the key \"selection\" apart" for what it does buy, and "lets
  any caller name any scope, so the namespace confines nothing" and "reads and rewrites
  another extension's scope straight through the storage entry" for what it does not.
- **Orphaned scopes are retained, never pruned.** Persisted state for an extension the
  registry does not currently know is kept, because a lazily loaded extension that has
  not registered yet is indistinguishable from one that is gone, and dropping it would
  lose the layout of every extension the user has not opened this session. The host
  decides what to do about an orphan instead: `selectActiveExtensionId` refuses to hand
  back an active id the registry does not know, and `forgetExtension` exists for a host
  that really wants a scope gone.
  *Tests:* `src/core/services/__tests__/hydrationEngine.test.ts` — "retains the scope of
  an extension that is not registered, so a lazily loaded one gets its state back" and
  "refuses an active extension id the registry no longer knows".

### Not built by this issue — do not read it in

- **No shell component is wired to any of this.** `src/components/layout/ShellLayout.tsx`
  and `src/App.tsx` do not import `useLocalStorageState` and do not construct or consume
  a hydration engine. Pane sizes, the pane-1 collapsed flag and the drawer flag are
  still plain React state and still reset on every reload. **A reader who sees "ISSUE-003
  implemented" and expects a shell that restores their layout will be wrong.**
- **No reconciliation of a restored size against the live group width**, for the reason
  given under Status above: the engine checks a fixed percentage band and never sees the
  measured width.
  *Superseded 2026-09-19 by GitHub issue #23:* the engine still never sees a width, and
  `ShellLayout` now re-fits a restored size against the live one — see decision 1 of its
  banner.
- **No `IShellAPI` persistence member.** The interface is unchanged — extensions cannot
  reach this engine, and the scoped-persistence surface described in `DEVELOPER.md`
  remains design intent.

---

## ISSUE-004 — High-Throughput Row Virtualizer & Fault Boundaries

**Status:** `IN PROGRESS` — implemented and green, **not merged**. Both specified
files exist, along with a third the specification did not name, and all three sit
inside the same 100% coverage gate as everything before them. The marker is not
`LANDED` for exactly the reason ISSUE-002's is not: `LANDED` is defined as merged
plus three other things, and only the other three are true.

**What exists:**

- `src/components/error/FaultBoundary.tsx` — the one class component in `src/`,
  because `getDerivedStateFromError` has no function-component form.
- `src/components/shared/VirtualizedList.tsx` — the windowed listbox.
- `src/components/shared/virtualWindow.ts` — **not in the specified file list, and
  here is why it is a third file rather than a second export.** The windowing
  arithmetic has to be assertable directly: jsdom has no layout engine, and an
  empty list, a 0px container and a start index past the end of a shrunken list are
  all statements about arithmetic that would otherwise be asserted against a fake
  layout. It could not simply be a second export of `VirtualizedList.tsx`, because
  `react-refresh/only-export-components` runs at `--max-warnings 0` and reports a
  non-component export from a module that also exports a component. Splitting the
  module was the option that neither disabled a lint rule nor put the arithmetic
  out of reach of a direct test.

**No dependency was added.** `@tanstack/react-virtual` was considered and rejected;
the honest counter-argument — that it gives *measured* dynamic row heights, which
this implementation deliberately does not — is recorded in the module's own
docblock rather than only here, along with the condition that should trigger a
revisit.

**One existing test was narrowed, deliberately and in one direction only.**
`src/__tests__/noEventListener.test.ts` forbade `(?:add|remove)EventListener` and
`key(?:down|up|press)` in every non-test module under `src/`, and the virtualizer's
`onKeyDown` turns that red. The listener half was left unchanged with no allowlist
mechanism at all — that half is what the repo-wide "no dispatcher, no evaluation
site" claim rested on. The key-event half is scoped to an allowlist naming
exactly `components/shared/VirtualizedList.tsx` and the exact spellings it may
contain, checked in both directions so a stale entry fails as loudly as an
unreviewed new one. Every prose site that stated the wider claim was re-pointed in
the same change: ADR-0001 Amendment H, `DEVELOPER.md`, `README.md`, this file, the
`Hotkey` docblock in `src/core/types.ts`, `HydrationEngine.ts` and
`ShellLayout.tsx`. **ISSUE-006 then had to narrow the listener half too**, because
a hotkey dispatcher is a global `keydown` listener and there is no version of it
that is not; see ADR-0001 Amendment J Decision 7 for why narrowing beat deleting
the file and beat leaving a title that had stopped being true.

**What ISSUE-004 does NOT do, stated so the row is not read as more than it is:**

- **The host does not virtualize Pane 2 for you.** `VirtualizedList` is a component
  an extension's own `views.pane2` renders. The host does not know what a row is,
  how many there are, or how tall one should be, so it cannot window the pane on the
  extension's behalf — and an extension that mounts a thousand rows directly still
  has a thousand rows in the DOM.
- **Row heights are declared, never measured.** A row that renders taller than it
  declared overlaps its neighbour, and a height that changes after mount is not
  noticed. ISSUE-004's edge-case list asks for "rows whose height changes after
  mount"; what is delivered is the declared-height half of that, and the measured
  half is explicitly not built.
- **No scroll anchoring.** Items prepended above the scroll position move the
  content under the viewport.
- **The pane-1 and ribbon fault boundaries have no reachable failure through the
  public contract.** Both render validated primitive strings and host-owned
  callbacks, so nothing an extension can register makes either throw during render.
  They are defence-in-depth. The ribbon boundary is nonetheless tested, by
  substituting a throwing ribbon in `ShellLayout.test.tsx`; the pane-1 boundary is
  not, and that is recorded here rather than glossed.

### Technical Specification

**`src/components/shared/VirtualizedList.tsx`.** Windowed list for Pane 2.
Only rows intersecting the viewport (plus a small overscan) are mounted. The
component is generic over the row item type and takes a row renderer from the
extension; it does not know what a row means. Selection, keyboard navigation
(arrow keys, Home/End, Page Up/Down) and scroll-into-view for the selected row
are the virtualizer's responsibility. Row content supplied by an extension **must** be
rendered as text nodes, and the virtualizer **must** offer no HTML-injection path.
This is a gate on **this** issue, not a description of the host: ISSUE-002 met the
equivalent gate at the ribbon, and that says nothing about a component that does not
exist. `RibbonToolbar.test.tsx`'s pair — one hostile-input case plus one
compiler-driven source scan — is the shape this issue should copy.

**`src/components/error/FaultBoundary.tsx`.** A React error boundary placed
around each pane and around each extension-supplied subtree. A plugin that
throws during render must degrade to a contained error surface inside its own
pane, naming the failing extension, with the rest of the shell still
interactive. The boundary must offer a retry that remounts the subtree.

Note the deliberate limitation, and document it rather than overselling it:
React error boundaries catch render, lifecycle and constructor errors. They do
**not** catch errors thrown in event handlers, in `setTimeout`, or in unhandled
promise rejections. Those need separate handling and must not be described as
covered by `FaultBoundary`.

### Explicit File Paths

- `src/components/shared/VirtualizedList.tsx`
- `src/components/error/FaultBoundary.tsx`

### Adversarial Edge-Cases to Handle

- Empty list, single-item list, and a list whose length changes while scrolled
  deep into it.
- Variable row heights and rows whose height changes after mount.
- The container being 0px tall during initial layout, producing a divide-by-zero
  or a zero-item window that never recovers.
- Fast scroll producing blank regions where recycling has not kept up.
- Selection index pointing past the end of the list after items are removed.
- A row renderer that throws for one specific item — must not take out the whole
  list.
- A plugin that throws *inside* the `FaultBoundary` fallback itself.
- A plugin that throws on every retry, producing a retry loop.
- Rapid extension switching while a fetch or render is in flight.
- Pane resize (ISSUE-002) forcing a recompute of the visible window mid-scroll.

### Dependencies

- **ISSUE-001** — the row renderer and detail view arrive through the registry.
- **ISSUE-002** — the virtualizer is hosted inside Pane 2 and must react to
  `PaneWrapper` sizing.

### Definition of Done

Every line met, with the test that meets it named. All titles below live in
`src/components/__tests__/FaultBoundary.test.tsx`,
`src/components/__tests__/VirtualizedList.test.tsx` or
`src/components/__tests__/ShellLayout.test.tsx`.

- **Both files exist and type-check.** `npm run typecheck` and `npm run build` are
  clean; a third module, `virtualWindow.ts`, exists for the reason given under
  Status.
- **Mounted row count is bounded by viewport plus overscan, not by total item
  count.** *Tests:* "mounts a window bounded by the viewport rather than by the item
  count" over 100,000 items, and "bounds the window by viewport plus overscan rather
  than by item count" on the arithmetic directly.
- **Keyboard navigation and scroll-into-view are tested.** *Tests:* "moves by row
  with the arrow keys and clamps at both ends", "moves by a viewport at a time with
  Page Up and Page Down", "pages a variable-height list by the rows that actually
  fit", "scrolls the selected row into view by assigning scrollTop on its own container",
  "leaves the scroll position alone when the new row is already visible" and "leaves
  every other key to the page, so typing and Tab still work".
- **A throwing row renderer is contained; the rest of the list still renders.**
  *Tests:* "contains a row renderer that throws for one item only" and "keeps the
  position of a failed row in the set".
- **A throwing extension subtree is contained to its pane; the ribbon and other
  panes remain interactive.** *Tests:* "contains a throwing pane-2 view to pane 2, leaving the context bar and pane 3 interactive" and "contains a throwing pane-3 view to
  pane 3, leaving pane 2 interactive".
- **The documented limits of `FaultBoundary` are stated in the source doc comment
  and in `DEVELOPER.md`.** *Test:* "documents in both the source and DEVELOPER.md
  what a boundary cannot catch", which fails if either copy drops a limit.
- **The Vitest coverage gate passes for the files in scope.** 100% of statements,
  branches, functions and lines across all three new modules, inside the existing
  repo-wide gate.

Each adversarial edge case above maps to a test as well: the empty, single-item and
shrinking-list cases to "mounts nothing at all for an empty list", "mounts the
single item of a one-item list" and "keeps a window over a list that shrinks while
it is scrolled deep"; variable heights to "honours declared variable row heights";
the 0px container to "still yields a row when the container is 0px tall, so a pane
cannot stay blank" and "divides by the row height and never by the item count"; fast
scroll to the overscan cases; a stale selection index to "clamps a selection left
pointing past the end after items are removed"; a throwing fallback to "renders no
plug-in element in the fallback"; a retry loop to "stops offering a retry after three
consecutive failures" and "never retries on its own"; rapid extension switching to
"clears a pane error surface when the active extension changes"; and pane resize
mid-scroll to "re-measures through a ResizeObserver when the environment has one"
and "still windows correctly with no ResizeObserver in the environment".

---

## ISSUE-005 — Verification Remotes & Adversarial Integration Suite

**Status:** `IN PROGRESS` — implemented and green, **not merged**. See "As landed"
at the end of this section, which also records the one Definition-of-Done clause
that was **substituted rather than satisfied**, and the two contract gaps the
suite exposed that no open issue covers.

### Technical Specification

Two complete, operational mock extensions plus the integration suite that drives
the assembled shell through them. The mocks are *verification remotes*: they
exist to exercise the public registry contract from the outside, exactly as a
third party would, with no privileged access to host internals. If a mock needs
something the public contract does not expose, that is a finding against
ISSUE-001, not a licence to reach inside.

**Mail module (`src/mocks/MailPlugin.tsx`).** The Outlook-shaped case. Folder
tree in Pane 1 with unread badge counts, message list in Pane 2, message body in
Pane 3 with the utility drawer in use.

**Inventory Database module (`src/mocks/DatabasePlugin.tsx`).** The deliberately
different case, proving the shell is not quietly shaped around mail. Schema or
category tree in Pane 1 with stock-level badges, record list in Pane 2, record
detail in Pane 3.

Both modules must be genuinely operational, not stubs. Between them they must:

- **Independently drive layout state** — each module owns its own Pane 1
  selection, Pane 2 selection and drawer state, and switching modules must not
  bleed one module's layout state into the other.
- **Dynamically alter ribbon action sets** — the set of contextual ribbon
  actions must change in response to in-module state (for example, selection
  versus no selection, or multi-selection), driven through the ISSUE-001
  visibility predicates rather than by the host special-casing anything.
- **Mutate unread/badge counts on navigation nodes** — badge values on Pane 1
  nodes change at runtime and the sidebar reflects the change, including while
  Pane 1 is collapsed to the 48px icon track.
- **Pass event streams across panes** — a selection or action in one pane emits
  events consumed by another pane, so cross-pane ordering is genuinely
  exercised rather than assumed.

**Integration suite (`src/__tests__/IntegrationSuite.test.tsx`).** End-to-end
tests through the real assembled shell — real registry, real layout, real
hydration, real virtualizer — never through test doubles of the host. Registers
both modules and drives extension switching, pane resize and collapse,
persisted-state reload, virtualized scrolling, keyboard navigation, and a forced
plugin fault to confirm containment.

### Explicit File Paths

- `src/mocks/MailPlugin.tsx`
- `src/mocks/DatabasePlugin.tsx`
- `src/__tests__/IntegrationSuite.test.tsx`

### Adversarial Edge-Cases to Handle

- **Rapid extension switching (mount/unmount churn).** Switching back and forth
  faster than a module's async work can settle. A resolving fetch or a pending
  state update belonging to an unmounted module must not write into the live
  one, and must not produce an update-after-unmount warning.
- **Listener and timer cleanup on unmount.** Every subscription, event listener,
  interval, timeout, observer and abort controller a module creates is released
  when it unmounts. Repeated mount/unmount cycles must not accumulate
  registrations. This is asserted, not assumed.
- **Keyboard navigation mapping.** Arrow keys plus `J`/`K` move the Pane 2
  selection. The `J`/`K` bindings must not fire while focus is in a text input
  or any editable surface, and must not conflict with the host's own shortcuts.
  Focus must remain visible and the selected row scrolled into view.

  > **Constraint — see ADR-0001 Amendment H, Decision 8.** `J` and `K` must be
  > implemented as key handling **local to the Pane 2 list view**, live only while
  > that list holds focus, and must never be declared as a `RibbonAction.hotkey`
  > or otherwise registered as a global shortcut — bare single-character keys
  > fail WCAG 2.2 §2.1.4 Character Key Shortcuts at Level A. This constraint is a
  > requirement on Phase 5 work and **has no test**, because no hotkey dispatcher
  > exists. What *is* tested today is the narrower thing: `normalizeRibbonAction`
  > rejects a modifier-less character-key `hotkey` at registration, per
  > "validateBlueprint — the WCAG 2.1.4 modifier rule for character keys" in
  > `src/core/__tests__/validation.test.ts`.
- **Cross-pane event ordering.** Events emitted by one pane and consumed by
  another must arrive in a defined order, with no case where Pane 3 renders
  detail for a Pane 2 row that a later-arriving event has already replaced.
  Interleaved rapid selections must settle on the last selection, not a race
  winner.
- Both modules registering conflicting ids, or conflicting ribbon action ids.
- One module throwing during activation while the other is healthy — the healthy
  module must remain fully usable.
- A badge count updating for a module that is not currently active.
- Integration tests that pass only because of test ordering, or that leak
  persisted state between cases. Each case starts from clean storage.
- Timer-driven module logic making tests flaky under fake timers.

### Dependencies

- **ISSUE-001** — modules register through the registry and drive ribbon
  visibility predicates.
- **ISSUE-002** — integration tests drive the real pane layout, collapse and
  resize.
- **ISSUE-003** — reload-and-restore cases need the hydration engine, including
  per-module state namespacing.
- **ISSUE-004** — list scrolling, keyboard navigation and fault containment
  cases need the virtualizer and the fault boundary.

### Definition of Done

- All three files exist and type-check.
- Both modules are operational — each drives its own layout state, alters its
  ribbon action set from in-module state, mutates navigation badge counts at
  runtime, and passes events across panes.
- Both modules register and run through the public registry contract only, with
  no privileged import of host internals.
- **Extension switching** is proven by integration flow: switch Mail → Database
  → Mail, asserting each module's layout state is independent and correctly
  restored, with no state bleed.
- **Memory and listener cleanup is verified**, not asserted in prose: a test
  performs repeated mount/unmount cycles and asserts that listener, timer and
  subscription counts return to their pre-mount baseline, and that no
  update-after-unmount warning is emitted.
- **Keyboard navigation** is proven: Arrow keys and `J`/`K` move selection,
  the bindings are suppressed while focus is in an editable surface, and the
  selected row is scrolled into view.
- Cross-pane event ordering is covered by a test that interleaves rapid
  selections and asserts the final rendered detail matches the final selection.
- Integration tests pass in a randomized order and with storage cleared between
  cases.
- The Vitest coverage gate passes for the files in scope.

### As landed

**Status is `IN PROGRESS`, not `LANDED`, and the miss is the same one ISSUE-002
through ISSUE-004 have: it is unmerged.** All three files exist and type-check,
the suite is green, and the coverage gate is untouched by it. The work is on
branch `phase-2-shell` and has not been through review or merge.

`src/__tests__/IntegrationSuite.test.tsx` is the new file and the only one this
change adds. It carries **60 tests** and is the first place in this repository
where an operational plug-in is mounted at all: every one of the 915 tests that
stood before it mounted ONE unit against fixtures whose views are
`(): null => null`. The two verification remotes — `src/mocks/MailPlugin.tsx` and
`src/mocks/DatabasePlugin.tsx` — were already written; what was missing was
anything that ran them.

**Nothing under `src/core/**`, `src/components/**`, `src/hooks/**` or
`src/mocks/**` was changed.** One line of `package.json` was added and one
amended; see "Randomisation" below.

#### The Definition-of-Done clause that was SUBSTITUTED, not satisfied

**"…and that no update-after-unmount warning is emitted" is unsatisfiable as
written, and it is recorded here rather than quietly passed.** React removed that
warning in React 18 (`facebook/react#22114`), and this project is on
`react@^18.3.1` — so a test asserting the ABSENCE of that warning would pass
whatever the shell did, including a shell that wrote into an unmounted module on
every switch. It is a vacuous assertion, not a weak one.

What replaced it is two assertions that are not vacuous, over a churn tight enough
that `MailPlugin`'s 120ms body fetch is always in flight when its module is
unmounted:

1. **Zero `console.error` and zero `console.warn` for the whole churn**, captured
   rather than sampled. *Test:* `src/__tests__/IntegrationSuite.test.tsx` — "emits
   no console error or warning while extensions are switched faster than a fetch
   settles".
2. **A behavioural assertion that the unmounted module's resolving work writes
   nothing** — not into the live module, and not into its own store either, which
   is the half a console assertion could never reach. *Test:* same file — "lets an
   unmounted module resolving fetch write nothing, into its own store or the live
   one".

The clause above is left standing in the Definition of Done unedited, so that the
substitution is visible as a substitution.

#### Three clauses that were narrowed to what jsdom can observe

Each is narrowed in the test's own NAME, so a reader cannot mistake the narrower
claim for the wider one.

- **"the selected row is scrolled into view."** `Element.prototype.scrollIntoView`
  does not exist in jsdom, and `VirtualizedList` deliberately does not call it —
  it assigns `scrollTop` on its own container, for the two reasons in decision 3
  of that module's banner. The assertion is on the assignment. *Test:* same file —
  "asks for the selected row to be scrolled into view by assigning scrollTop,
  which is what jsdom can observe".
- **A pointer DRAG of a divider.** This jsdom implements no `PointerEvent`, so
  `fireEvent.pointerMove` falls back to a plain `Event` carrying no `clientX` and
  the panel library's delta arithmetic is never handed a coordinate. Asserting a
  moved pane after that sequence would be asserting against a no-op, so the no-op
  is asserted instead and the resize cases drive the library's own window-splitter
  KEYBOARD path over a stubbed `getBoundingClientRect`. *Tests:* same file —
  "cannot be driven by a POINTER drag at all, because this jsdom implements no
  PointerEvent" and "resizes a pane through the library own window-splitter
  keyboard path, against geometry this file supplied".
- **`J`/`K` list navigation.** Not implemented by either remote and not added
  here; ADR-0001 Amendment H Decision 8 requires it to be view-local, and no
  extension in this repository declares it. Arrow keys, `Home`/`End` and
  `PageUp`/`PageDown` ARE proven, through the real virtualizer, and the
  editable-surface suppression clause is proven against a real `<input>`. *Tests:*
  same file — "moves the pane-2 selection with the arrow keys, and the selection
  reaches pane 3", "moves to the first and last rows with Home and End", "moves a
  viewport at a time with PageDown and PageUp" and "does not fire a chord while
  focus is in the extension own text input".

#### Randomisation — which route was taken

`sequence.shuffle` is a global Vitest setting and `vitest.config.ts` is shared by
every suite in the repository, so switching it on there would have re-ordered all
28 test files at once. It was **not** switched on. A dedicated script carries the
flag for this one file instead:

```
"test:integration": "vitest run --sequence.shuffle src/__tests__/IntegrationSuite.test.tsx"
```

It is chained into `verify` between `test:coverage` and `test:scripts`, so the
randomised run is a build gate rather than something a developer has to remember.
Vitest prints `Running tests with seed "<n>"` on every such run and the seed
defaults to the clock, so consecutive runs really are different orders. The suite
was run under three seeds during development and was green in all three.

**Not switching it on repo-wide was not merely caution.** Run under
`--sequence.shuffle`, `src/core/__tests__/shellApi.test.ts` fails three of its own
cases — that is pre-existing, is nothing to do with this change, and is the direct
evidence that the wider suite is not yet order-independent. Making it so is not
ISSUE-005's work and is not claimed here.

#### The known limits this suite pins

Each is a characterisation of CURRENT behaviour, titled `PINS A KNOWN LIMIT — `
and carrying a comment in the test body saying so. **None of them is a safety
claim**, and several describe something a reader might otherwise assume is
prevented. All are in `src/__tests__/IntegrationSuite.test.tsx`:

1. "PINS A KNOWN LIMIT — badge scoping is collision-resistance, not confinement: a
   plug-in writes into a sibling scope and the sibling sidebar renders it (no issue
   filed; ADR-0001 Amendment E records it as accepted)". The correct-behaviour case
   sits beside it: "two extensions that both name a node inbox do not collide,
   which is the property the scope really has".
2. "PINS A KNOWN LIMIT — persisted-state namespacing is collision-resistance too:
   one extension reads and overwrites another persisted scope through the public
   HydrationEngine (no issue filed; the engine banner records it as accepted, and
   GitHub issue #4 covers only documenting it)".
3. "PINS A KNOWN LIMIT — the IShellAPI deep-freeze does not reach plug-in-supplied
   functions: a sibling view component obtained from the public registry is
   mutable, and the sibling rendered output changes (no issue filed; ADR-0001
   records it as accepted, because freezing a component breaks memo and
   forwardRef)".
4. "PINS A KNOWN LIMIT — unregister has no authorisation model: one extension
   removes another while the victim holds the foreground, and the shell simply
   carries on (no issue filed; the unregister docblock defers an ownership model to
   its own issue)".
5. "PINS A KNOWN LIMIT — the host tells a plug-in nothing about where keyboard
   focus is, so no ribbon predicate can key on it (GitHub issue #13)".
6. "PINS A KNOWN LIMIT — a FaultBoundary does not catch a plug-in throw from a
   setTimeout callback: it escapes to the host environment and no fallback is
   rendered (no issue filed; this is React error-boundary semantics and the
   FaultBoundary banner records it)".
7. "PINS A KNOWN LIMIT — a FaultBoundary does not catch a plug-in rejected promise:
   the rejection is delivered to the promise and no fallback is rendered (no issue
   filed; this is React error-boundary semantics and the FaultBoundary banner
   records it)".
8. "PINS A KNOWN LIMIT — with no ResizeObserver in the environment, moving a
   divider does not re-window the list: it corrects on the next render the list
   performs for any other reason (no issue filed; VirtualizedList decision 4
   records the fallback as accepted)".
9. "PINS A KNOWN LIMIT — neither shipped verification remote renders
   VirtualizedList, so ISSUE-004 has no consumer in src/ outside this suite (no
   issue filed; reported with this change)".

The contained case is asserted beside the two uncontained ones, so that "a fault
boundary catches nothing" is not the reading anyone takes away: a ribbon
`onExecute` that throws IS guarded, by `RibbonToolbar`'s own wrapper. *Test:* same
file — "contains a throwing command inside the shared command guard, without taking the shell down".

#### Two contract gaps this suite exposed that issues #12–#18 do not cover

Neither is fixed here — both are `src/` production changes, which this change was
scoped out of.

1. **ISSUE-004's virtualizer has no consumer.** `ShellLayout` deliberately does not
   window pane 2, and neither verification remote calls `VirtualizedList`:
   `DatabasePlugin` maps all 280 records into a plain `<ul>`. So the Definition of
   Done's keyboard-navigation clause could not be met through either remote, and is
   met against a third, test-authored extension registered through the same public
   contract. Pinned by limit 9 above.
2. **`DatabasePlugin` republishes its three top-level badges from its pane-2 mount
   effect**, so any badge written into one of those nodes by anything else — the
   host, another extension, or the module's own earlier call — is overwritten the
   moment that pane remounts. It is not wrong, and it is not documented anywhere.
   Both badge cases below therefore write to a LEAF node, and say why in a comment.
   *Tests:* same file — "shows a badge written while the extension was NOT in the
   foreground, on re-activation" and limit 1 above.

#### One obligation discharged that its own source comment still calls outstanding

Both mock banners describe the untrusted-content rule as an obligation met in code
and not yet pinned by a test at that site, because the integration suite was
blocked on ISSUE-003 and ISSUE-004. It is pinned now, by a compiler-parsed source
scan of each mock plus a rendered case, and **those two comments are stale in the
safe direction** — they understate what is covered. They were not corrected because
this change does not edit `src/mocks/**`. *Tests:* same file — "the %s source
contains no HTML-injection sink at all", "the %s source names no URL-bearing
attribute a plug-in value could reach", "reports a planted sink, so the two scans
above cannot pass vacuously" and "renders a markup-shaped extension string as a
text node in the mounted shell".

#### What was NOT confirmed, stated so the green is not over-read

At the time this section was written, `npm run verify` **could not be run to a
clean exit**, and the reason is not this change: the working tree carried another
change in flight across `src/core/**` and `src/components/**` — the removal of
`RibbonContext.focusedPane` and the addition of `selectedItemIds` — which left
`src/core/ShellAPI.ts` and seven pre-existing test files failing `tsc`. The
integration suite itself was green, 60 of 60, under three shuffle seeds against
that tree. **`verify` has to be re-run to a clean exit before this row moves to
`LANDED`, and the coverage figure has to be re-read at that point rather than
carried over.**

---

## Cross-cutting gates

These apply to every issue above and are not restated per ticket.

- **Type safety.** No `any` in a public contract. No `@ts-ignore` without a
  written justification in the same commit.
- **Coverage.** The Vitest coverage threshold is enforced as a build gate by
  `.github/workflows/ci.yml`, whose `Test with coverage` step runs
  `npm run test:coverage` on every push to `main` and every pull request;
  `vitest.config.ts` sets the threshold and Vitest exits non-zero when it is
  unmet, failing the job. The threshold applies per module as each module lands.
  There is no project-wide coverage figure to report yet, and none should be
  claimed.
- **Accessibility.** **No stated conformance target**, decided 2026-08-03 and
  recorded in `PRODUCT.md`. This line said "WCAG 2.2 **AA** is the target" and
  the target is withdrawn, not met — a target nothing commits to is a claim
  without a test. Three floors survive because each is gated rather than
  asserted: contrast pairs (`design/check-contrast.mjs`), visible focus measured
  on painted pixels (`e2e/focus-visibility.spec.ts`), and colour never being the
  only channel. See `docs/accessibility.md` (moved from `README.md` § Accessibility on 2026-09-18) for what is explicitly not
  committed to.
- **Untrusted plugin content.** Any surface that renders extension-supplied
  strings **must** render them as text nodes, and `dangerouslySetInnerHTML` is
  prohibited in extension-content paths. The gate for each render site is that the
  rule arrives **with a test at that site**.

  **Met at one site.** `src/components/ui/RibbonToolbar.tsx` renders
  `RibbonAction.label` as a text node and resolves `RibbonAction.icon` through a
  host-owned `Map`. *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` —
  "the context bar renders a markup-shaped plug-in label as a text node, not as markup" and "the
  module source contains no HTML-injection sink at all", the latter parsing the
  module with the TypeScript compiler, with "reports a planted sink, so the scan
  above cannot pass vacuously" beside it.

  **Not met at the others, and this must not be generalised into a host-wide
  claim.** `src/components/layout/ShellLayout.tsx` renders `NavigationNode.label`
  and the extension `name` with ordinary JSX interpolation, which is the correct
  pattern, but `ShellLayout.test.tsx` carries no injection case and no source scan —
  so that site is an **untested obligation**, not a control, and closing it is
  outstanding work. See `README.md`, under the heading about intent with no test,
  which holds the same label for what remains untested. The row virtualizer added
  by ISSUE-004 is the second site that DOES carry the pair.
  *Tests:* `src/components/__tests__/VirtualizedList.test.tsx` — "the module source
  contains no HTML-injection sink at all", "renders extension row content as text,
  with no HTML-injection path" and "reports a planted sink, so the scans above
  cannot pass vacuously".
- **Performance.** Targets are stated in `README.md` and are explicitly
  unmeasured. No ticket may be closed on a performance claim that has not been
  benchmarked.
