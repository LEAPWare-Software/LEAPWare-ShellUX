# Changelog

All notable changes to LEAPWare-ShellUX are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from its first release.

**Nothing has been released.** `package.json` declares `0.1.0` and marks the
package `private`; there is no tag, no published artefact and no comparison link
to offer, so everything below sits under Unreleased. Entries are derived from the
commit history rather than written from memory, and each names the commit it came
from so a reader can check it.

## [Unreleased]

### Added

- **The inversion-of-control extension contract** — `src/core/types.ts`
  (`LEAPExtensionBlueprint`, `IShellAPI`, `RibbonContext`, `ShellUXError` and its
  code enum), `src/core/RegistryContext.tsx` (validation, normalisation, the
  registry provider) and `src/core/ShellAPI.ts` (the deep-frozen per-extension API
  and the shell state store). The host owns lifecycle and layout and holds no
  business logic; extensions are supplied to it and never imported by it.
  (`0a6596b`)
- **Reactive shell state.** The store gained `subscribe`, and `useShellContext` is
  built on `useSyncExternalStore`, so a write through one pane's handle reaches
  another. `patchContext` compares per field and skips both the allocation and the
  notification when nothing moved. (`294c9e0`)
- **The activation lifecycle** — `src/core/ActivationContext.tsx`. Foreground and
  liveness as two orthogonal states, a revocable per-extension `IShellAPI` minted
  against a host-owned record, and `ExtensionHostBoundary` with the
  `useActivation` / `useExtensionActivation` split that gives a plug-in subtree
  read-only facts instead of the host capability. (`294c9e0`)
- **Plug-in-registered keyboard shortcuts.** An optional structured `Hotkey` field
  on `RibbonAction`, `src/core/hotkeys.ts` (`hotkeyToken`, `describeHotkey`,
  `matchesHotkey` — pure, no DOM, no listener), the `HOTKEY_KEYS` host allowlist,
  and the `DUPLICATE_HOTKEY` error code. Structured rather than a string, so there
  is no parser at the trust boundary. Chords are scoped to the foreground
  extension, so two extensions may declare the same chord. Declared and validated
  only; nothing dispatched one yet at this point. (`7fb0649`, ADR-0001 Amendment H)
- **The three-pane resizable shell** — `ShellLayout.tsx`, `PaneWrapper.tsx` and
  `RibbonToolbar.tsx`. A 240px navigation tree that collapses to a 48px icon
  track, a 360px list pane, and a flexing third pane with its own header, scroll
  container and trailing drawer. The ribbon renders host actions on the left and
  plug-in contextual actions on the right, filtered through `isVisible`, with
  labels rendered as text nodes only. (`118aaac`)
- **Local persistence** — `src/core/services/HydrationEngine.ts` and
  `src/hooks/useLocalStorageState.ts`. Versioned, validated, debounced, discarding
  rather than migrating an unrecognised schema version, and degrading silently to
  memory when storage is unavailable. Landed wired to nothing. (`118aaac`)
- **Fault containment and a row virtualizer.** `FaultBoundary` stores the thrown
  value and reads nothing off it inside React's error path; the fallback renders no
  plug-in component and no plug-in markup; retry remounts rather than re-renders,
  is user-initiated, and stops after three consecutive failures. Ribbon, pane 1,
  pane 2 and pane 3 each get their own containment. `VirtualizedList` windows on
  declared row heights and never measures the DOM, with the window arithmetic in a
  separate pure module, `virtualWindow.ts`. (`cd52bbf`)
- **Hotkey dispatch.** Exactly one keydown listener, on `window`, in the bubble
  phase, attached by `ShellLayout` and removed on unmount with the identical
  function reference. Chords fire only for the foreground extension, and are gated
  by the same `isVisible` and `isDisabled` predicates as the ribbon button that
  carries them, so a chord is never a wider route to an action than the button
  already is. `aria-keyshortcuts` is advertised on chord-bearing actions in the UI
  Events key-value spelling. (`752ee83`, ADR-0001 Amendment J)
- **Live badges.** `useBadgeCount` is a `useSyncExternalStore` selector over the
  badge map, and the navigation tree prefers a store badge over the blueprint's
  static value, in the expanded tree and in the collapsed icon track alike.
  (`752ee83`)
- **Toolchain and CI.** Vite, React 18, TypeScript in strict mode, Tailwind and
  Vitest/jsdom; `.gitattributes` normalising to LF; a CI workflow running lint,
  typecheck, coverage, build and a production-only audit; a 100% coverage gate over
  `src/core/**` that exits non-zero below the threshold. (`cf84f18`)
- **Declared environment facts, so a wrong toolchain fails at install rather than
  later** — `engines.node`, `.nvmrc` read by CI through `node-version-file`,
  `.npmrc` with `engine-strict`, and `packageManager`. (`e504fd3`)
- **`scripts/check-portability.mjs`**, the mechanical half of ADR-0002: rules over
  `git ls-files` covering absolute paths, drive letters, home directories,
  case-insensitive filename collisions, CRLF, byte-order marks and import casing.
  Wired into `npm run verify` and into CI. (`e504fd3`)
- **`scripts/check-citations.mjs`**, the mechanical half of ADR-0001 Amendment G:
  it parses prose for cited test titles and fails on one that resolves to no test
  in the suite. It checks that a citation which **is** present resolves; it cannot
  tell that a security claim carries no citation at all, and says so. (`118aaac`)
- **Documentation** — the issue manifest, `README.md`, `DEVELOPER.md`, ADR-0001
  (the IoC registry architecture) and ADR-0002 (no local-environment
  dependencies), plus `CONTRIBUTING.md`. (`959e3ee`, `e504fd3`)
- **Two verification mocks under `src/mocks/`** that exercise the public contract
  the way a third party would. They produced eight contract-gap findings. (`118aaac`)

### Changed

- **`getExtension(id)` no longer returns the caller's object.** Validation and
  normalisation became one pass, and what is stored is a fresh host-owned record.
  A breaking change to the registry's read contract, made deliberately; the correct
  comparison for an extension author is on `id`. (`0a6596b`, ADR-0001 Amendment A)
- **`onExecute` gained a second parameter**, the `IShellAPI` handle. Before this a
  ribbon action provably could not change anything. Source-compatible for every
  implementer, and still a contract change. (`294c9e0`, ADR-0001 Amendment C)
- **Badge state is keyed by `${extensionId}:${nodeId}`** rather than by the bare
  node id, and the scope is supplied by the host at mint time rather than taken as
  a parameter. (`294c9e0`)
- **Liveness is re-checked at call time and keyed on the mint-time record.** The
  post-commit sweep is kept for bookkeeping and is no longer what stands between a
  forgotten extension and the store. (`294c9e0`, ADR-0001 Amendment D)
- **Provider teardown no longer revokes anything.** Liveness ends by exactly two
  events: `release(id)`, and being unregistered. Two implementations of teardown
  revocation were removed rather than repaired. (`294c9e0`, ADR-0001 Amendment F)
- **The dependency audit moved off the per-push path** onto a lockfile-scoped
  workflow plus a weekly scheduled run, so advisory drift cannot redden an
  unrelated commit. (`e504fd3`)
- **Lint runs at `--max-warnings 0`**, with the `react-refresh` exception narrowed
  to five named exports in `eslint.config.js` rather than suppressed inline. The
  repository holds zero inline suppressions. (`e504fd3`)
- **CI runs on Ubuntu, macOS and Windows**, so cross-platform support is observed
  rather than inferred from the lockfile's optional binaries. (`e504fd3`)
- **The no-listener invariant was narrowed twice rather than deleted** — once for
  the virtualizer's key handling, once for the hotkey dispatcher — each time to an
  exact allowlist asserted in both directions, and each time with the lost static
  guarantee replaced by a stronger runtime one. (`cd52bbf`, `752ee83`)
- **The coverage gate widened** from `src/core/**` to include `src/components/**`
  and `src/hooks/**`, and held at 100% on statements, branches, functions and
  lines. (`118aaac`)
- **The shared ribbon action guards — report, `isVisible`, execute — moved into
  `src/core/ribbonAction.ts`**, so the ribbon and the dispatcher cannot drift.
  Those semantics are security-relevant, and two copies of them would drift
  silently. (`752ee83`)

### Fixed

- **A registration hijack through a multi-read id getter.** A value the plug-in can
  still reach is a value the plug-in can still edit, so reading each field once was
  necessary and not sufficient; the host now owns the stored record. Single-read
  access was measured through a logging `Proxy` rather than inferred. (`0a6596b`,
  `a1df19d`)
- **A bounds check that bounded nothing.** A `Proxy` could report an honest
  `length` while it was measured and a larger one afterwards; collections are now
  rebuilt at exactly the bounds-checked length. (`0a6596b`)
- **`validateBlueprint` leaked a raw `TypeError`** when a revoked `Proxy` reached
  any of five unguarded `Array.isArray` sites. (`294c9e0`)
- **The shell state store object was never frozen.** A plug-in view could swap
  `setSelectedItem` through the public `useShellStore()` and swallow another
  extension's writes. (`294c9e0`, ADR-0001 Amendment F)
- **`patchContext` accepted what `setSelectedItem` refused** — an object with a
  getter in `selectedItemId`, an illegal pane id, an unregistered extension id. It
  is now validated field by field against a table pinned to `keyof RibbonContext`,
  applies all-or-nothing, normalises `undefined` to `null` instead of writing a
  value the declared type forbids, and uses `Object.hasOwn` rather than `in`, which
  had been walking the prototype chain. (`294c9e0`)
- **Handle resurrection across `unregister` then `register` under the same id.**
  Id presence was the wrong question; the liveness predicate now compares record
  identity. The same defect also made re-activation after a re-registration return
  the stale entry. (`294c9e0`)
- **A StrictMode path that permanently revoked live handles** — broken in
  development and correct in production, which is the worst shape a bug has.
  (`294c9e0`)
- **An unbounded notify cascade** became a depth-capped `REENTRANT_NOTIFY` raised
  at the offending write, instead of a `RangeError` from a blown stack, with the
  depth counter restored in a `finally`. (`294c9e0`)
- **A cross-extension state leak on foreground handover.** `publishForeground`
  patched only `activeExtensionId`, so a newly activated extension inherited the
  previous one's `selectedItemId` and `activeNavNodeId`. Both are now cleared on a
  real handover and left alone on a redundant republish. (`118aaac`)
- **The ribbon overflow menu was clipped out of existence** by two
  `overflow-hidden` ancestors, so every action past the fourth was unreachable by
  pointer — and six tests asserted it worked, passing vacuously because jsdom has
  no layout engine. The menu is now a portalled Radix dropdown. (`118aaac`)
- **Eight WCAG 2.2 AA blockers**, all of them: the clipped overflow menu above,
  reflow at 320px, dark-mode text contrast from 4.18:1 to 7.85:1, selected-item and
  divider non-text contrast, 24px target sizes, focus returning to the trigger
  after the menu closes, and `aria-disabled` in place of native `disabled` so a
  disabled action stays in the tab order. (`118aaac`)
- **A fault boundary that did not contain the row it was wrapping.** Handing the
  result of `renderRow(item, index)` to a boundary runs extension code *above* it,
  so a throwing row still took the whole list down. The call now happens inside a
  child component below the boundary. (`cd52bbf`)
- **The no-listener claim was pinned to a test covering one module**, so a listener
  added anywhere else would have left it green. Replaced with a scan over every
  non-test module under `src/`, parsed with the TypeScript compiler so prose about
  the absence is not mistaken for the thing itself, and verified by planting a
  listener and watching the suite go red. (`9e80280`)
- **Documentation that was wrong in both directions**: `@throws` declarations
  across `ShellAPI.ts` and `types.ts`, a hotkeys banner claiming four keyboard-event
  fields where the code reads five, an issue manifest carrying no row for
  `src/core/hotkeys.ts`, and a describe block named for badge *isolation* where the
  architecture only delivers badge collision-resistance. (`a1df19d`)
- **Housekeeping with real consequences**: `.claude/settings.local.json` was
  ignored only by a global gitignore that does not travel with a clone;
  `JSX.Element` was resolving through a transitive global and would break on a
  React 19 types bump; two `.gitignore` negations pointed at files that do not
  exist; remaining eager `useRef(new Map())` initialisers became lazy; and
  `release(id)` guards a non-string by returning `false` rather than throwing,
  matching `activate`'s report-do-not-throw contract. (`e504fd3`, `a1df19d`)

### Security

- **`escape` removed from the hotkey allowlist, and `enter` made
  modifier-required.** `HOTKEY_KEYS` admitted both as bare, unmodified chords,
  because the guard refused a bare chord only when the key name was a single
  character. Enter activates the focused control and submits a form in every
  browser and every assistive technology, which is the same reason `space` was
  already excluded — two keys with one failure mode sat on opposite sides of the
  list. `escape` has a second, concrete collision: it is the shell's dismissal key
  and dismisses the dialog dependency this project ships, so an extension holding
  bare `escape` and an open dialog would be in a fight neither side declared. A
  modifier-gated Escape was considered and refused as dead surface, since the
  modified forms are all claimed by the operating system. The allowlist goes from
  61 keys to 60. Done before any dispatcher existed, because once chords fire this
  is a breaking change for every extension that declared one, and the cost only
  rises. (GitHub issue #8, `118aaac`, ADR-0001 Amendment I)
- **The portability checker followed symbolic links and could read files outside
  the repository.** A tracked path that is, or that reaches through, a link is now
  reported by a structural `symlinked-path` rule and is deliberately not read —
  reading it would scan, and could clear, content no clone contains. Detection is
  by the mode git records in the index *and* by `lstat` on every path prefix in the
  working tree, because those are two independent questions and both have to be
  asked; `lstat` also makes a Windows junction detectable with no
  platform-specific code. The checker goes from 19 rules to 20 and gains its first
  tests. (GitHub issue #11, `118aaac`)
- **The same checker confirmed only the last segment of a path's spelling**, so on
  a case-insensitive filesystem it could advise adding a mis-cased path to the
  index — recording the very case collision it exists to prevent, on a developer's
  machine and never in CI. It now walks from the repository root one segment at a
  time, which also closed a separate hole where a specifier could address a path
  outside the repository. (`9e80280`)
- **Roughly sixty documentation claims asserting security the code did not
  deliver were corrected.** These were documentation defects, not runtime ones —
  in every round the code was sound and a conclusion had been written one step
  wider than the premise licensing it. Ten review rounds, eight of which
  reproduced a real defect. The between-extension boundary is **not** enforceable
  in-page: React fiber reflection reaches the host controller from any element on
  the page, verified in the production bundle, and `ExtensionHostBoundary` is
  retained as a guardrail against honest mistakes and documented as nothing more.
  ADR-0001 Amendments E, F and G record the decision, the trigger that voids it,
  and the rule that no security claim may appear in prose without naming the test
  that exercises it. (`294c9e0`)
- **The single-read discipline at the hotkey registration sites was left
  unlicensed** when the hotkey work landed — the claim stood in prose with no test
  asserting it, which is exactly what Amendment G forbids. Nine tests now measure
  it through a logging `Proxy`. (GitHub issue #7, `a1df19d`)
