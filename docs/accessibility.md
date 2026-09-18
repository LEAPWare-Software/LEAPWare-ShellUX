# Accessibility

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links were corrected for this file's location.

> **The 1.0 position, decision D-37 (2026-09-18).** 1.0 is gated on keyboard operation: every command reachable from the palette, shortcuts shown in the interface, full keyboard operation with a visible focus ring, each pinned by a browser-lane spec. **Screen-reader support is not done**: WCAG 2.2 AA and an NVDA pass (#60) move to 1.1, and no assistive technology has been run against this application. The section below predates D-37 and stays as the record.

> **CHANGED 2026-08-03.** This section said **"This project targets WCAG 2.2
> Level AA"**, and that sentence is withdrawn rather than left standing. The
> owner's decision, recorded in `PRODUCT.md`, is **best effort with no stated
> conformance target.** A target nothing commits to is a claim without a test,
> and this project's own rule is that such a claim is narrowed to what is
> measured or deleted. The old sentence is quoted here rather than erased,
> because the record of what was claimed is worth more than a clean page.
>
> This is a narrowing of a *claim*, not a withdrawal of *work*. Everything below
> that has a test behind it still has that test behind it, and the three floors
> named next are enforced by gates that run on every pull request.

**There is no stated conformance target.** Three floors are real, because each
one is enforced mechanically rather than asserted:

- **Contrast pairs are gated.** `design/check-contrast.mjs` fails a semantic
  colour token with no row in `design/contrast-manifest.json`, and fails a row
  naming a token that does not exist. Individual manifest rows still cite the
  WCAG criterion they were measured against, because a measured ratio is a
  measurement whatever the project's overall posture is.
- **Focus is visible, measured on painted pixels.** `e2e/focus-visibility.spec.ts`
  runs in a real browser, which is the only place this is observable at all.
- **Colour is never the only channel.** Status carries a word or a mark as well
  as a hue.

Not committed to, and named so that no reader infers otherwise: screen-reader
semantics, any assistive-technology verification at all (still open: #60 — none
has ever been run against this application), reduced motion beyond what the two
existing motion tokens imply, and internationalisation or RTL (still open: #66).
Still open: #55, which records that an AA target was unattainable as written
anyway, because extensions render two of the three panes and are given one
accessibility obligation.

Work that was done under the old target, and still stands on its own tests:

- 4.5:1 contrast for body text, 3:1 for large text and for UI component
  boundaries.
- Full keyboard operability, including pane dividers, commands, and list
  navigation.
- Visible focus indication that survives the high-density styling.
- Accessible names preserved when Pane 1 collapses to its 48px icon track.
- Correct landmark and region structure across the context bar and three panes.

**Partly delivered by ISSUE-002, and one deliberate deviation to record.** The last
two items above now have code and tests behind them: pane-1 entries keep their
accessible names in both the expanded and the 48px-collapsed state, each pane is a
labelled region, and the dividers are keyboard-operable — that last one is
`react-resizable-panels`' own window-splitter implementation, not the host's.
*Tests:* `src/components/__tests__/ShellLayout.test.tsx` — "keeps the accessible
name of every pane-1 entry in both states", "names all three panes as regions",
"makes every divider keyboard-reachable and actually resizes with the arrow keys";
`src/components/__tests__/PaneWrapper.test.tsx` — "exposes the pane as a labelled
region carrying its pane id".

**The deviation:** the context bar uses `role="toolbar"` with every button individually
tabbable, *not* the roving-tabindex pattern the ARIA authoring practices recommend
for a toolbar. That was originally decided because a roving pattern needs an
arrow-key handler and no module under `src/` was permitted to name one. ISSUE-004
changed the second half of that: `src/components/shared/VirtualizedList.tsx` is now
allowlisted for exactly that reason, so the context bar's deviation stands on the
narrower ground it always really had — the bar has not needed the pattern. And
ISSUE-006's dispatcher did **not** change it either: that listener is on `window`
and routes declared chords, it puts no arrow-key handler on the toolbar, and every
context-bar control remains individually reachable by Tab. Recorded here rather than
left for an auditor to find. *Tests:*
`src/__tests__/noEventListener.test.ts` — "finds no key-event name in any module
outside the key-event allowlist" and "holds the key-event allowlist to
the exact spellings each listed module contains".

**List navigation is no longer scope.** `VirtualizedList` implements the single-tab-stop
`aria-activedescendant` listbox pattern — arrow keys, Home/End, Page Up/Down, and
scroll-into-view by assigning the container's own `scrollTop` rather than by
calling `scrollIntoView`. *Tests:*
`src/components/__tests__/VirtualizedList.test.tsx` — "keeps a single tab stop on
the container rather than roving focus onto rows", "moves by row with the arrow
keys and clamps at both ends", "moves by a viewport at a time with Page Up and Page
Down" and "scrolls the selected row into view by assigning scrollTop on its
own container".

**The context bar's overflow menu is a second exception, and it is worth being precise
about why that is not a contradiction.** Inside the menu the arrow keys, Home/End,
typeahead, Escape and outside-click dismissal all work, because the menu is
`@radix-ui/react-dropdown-menu`. That handling lives in `node_modules`, not in
`src/`, so the no-listener invariant is untouched — that test's own
docblock states the limit it has always had, under "What is not asserted": "a handler
installed by a third-party module `src/` merely imports — would pass".
`PanelResizeHandle` in `ShellLayout.tsx` is
the same arrangement. The invariant is a claim about the host's own modules, not a
claim that the shell has no keyboard behaviour.

**An accessibility audit on 2026-07-31 found eight blockers, and the fixes closed
those eight. That is the whole of the claim.** It is not an audit against the full
WCAG 2.2 AA criteria set, it was not performed by an external auditor, and it does
**not** move this project to conformance — the paragraph at the top of this section
still stands: there is no stated conformance target, AA included. What changed is
that eight specific, reproducible defects that had been found are no longer present:

- The overflow menu was **clipped to zero height** by two `overflow-hidden`
  ancestors, which made it invisible and unclickable rather than merely awkward. It
  is now portalled under `document.body`, outside every clipping ancestor by
  construction. *Tests:* `src/components/command/__tests__/ContextBar.test.tsx` — "renders the menu outside the context bar, which is what un-clips it".
- Activating a menu item **dropped focus onto `document.body`**, so the next Tab
  restarted from the top of the document (WCAG 2.4.3). Focus now returns to the
  trigger however the menu closed. *Tests:* same file — "returns focus to the trigger
  after an item is activated, not to document.body" and "closes on Escape and puts
  focus back on the trigger".
- `role="menu"` **promised an interaction model that did not exist** — arrows did
  nothing, Escape did not close, focus never entered, and an outside click left it
  open. Screen readers switch to application mode inside a menu and hand the arrow
  keys to the page, so the role actively misled the user. The full menu-button
  pattern is now real. *Tests:* the whole of "ContextBar — the overflow menu keyboard model", including "moves focus into the menu when it opens", "walks the
  items with the arrow keys, which is what the role promises" and "closes when the
  pointer goes down outside it".
- The menu is deliberately **not modal**, so opening it does not hide the rest of the
  shell from assistive technology. *Tests:* same file — "does not modally hide the
  rest of the shell while the menu is open".
- `aria-controls` **dangled at a non-existent id** while the menu was shut; it is now
  advertised only while the menu exists. *Tests:* same file — "advertises
  aria-controls only while the menu exists, so the id never dangles".
- An unavailable action used the native `disabled` attribute, which **removes it from
  the tab order entirely** — a screen-reader user could not discover that the action
  existed. It is now `aria-disabled`: reachable, announced, and still inert. *Tests:*
  same file — "marks an unavailable command aria-disabled rather than removing it from the tab order, on every surface" and "leaves a disabled menu item focusable, announced, and inert".
- Contrast and target-size defects in the shell chrome: muted body strings that
  failed 4.5:1 in dark mode, selection shown by fill alone, dividers too faint to
  read as controls, and rows below a 24px minimum. *Tests:*
  `src/components/__tests__/ShellLayout.test.tsx` — the whole of "ShellLayout —
  contrast and target size", including "routes every muted body string through one
  token instead of a per-theme patch", "carries the selected navigation state on a
  rule and a weight, not only a fill", "draws the dividers from the control tier
  rather than from the border tier", "gives every navigation row a 24px minimum
  height" and "gives every context-bar control a 24px minimum height".

  The first and third titles were renamed when the colours became design tokens,
  and the rename is the finding rather than a tidy-up: the muted-text case named a
  **dark-mode value**, and there is no longer a per-theme value for it to name —
  `--text-muted` resolves per theme and clears 4.5:1 on all eight surfaces, so the
  hand-written override beside every muted string is gone. What each case can
  still prove in jsdom is structural, and the titles now say so. **The ratio half
  moved to a lane that can measure it**: `npm run tokens:check` re-measures every
  declared pair against the shipped stylesheet, and `e2e/theme.spec.ts` — "clears
  the declared contrast ratios on rendered pixels in the light (the default)
  theme" and "keeps muted body text above 4.5:1 on the pane it is drawn on, in
  every theme" — computes the ratio from the colours a browser actually painted.
- A badge count folded a **bare digit into the button's accessible name**, and
  dividers were not reported as vertical separators. *Tests:* same file — "names the
  badge count instead of folding a bare digit into the button name" and "reports every
  divider as a vertical separator".

**One criterion is already enforced by the host rather than being scoped work.**
A plugin-declared `hotkey` whose `key` is a single character and which carries no
`ctrl`, `alt` or `meta` modifier is **refused at registration**, with a message
naming WCAG 2.2 Success Criterion **2.1.4 Character Key Shortcuts (Level A)**.
`shift` does not satisfy the rule, because Shift produces a character too.
2.1.4's three conformance routes — turn the shortcut off, remap it, or make it
active only on focus — need a settings surface, a remapping UI or a
component-scoped dispatcher, and the shell offers none of the three: ISSUE-006's
dispatcher is extension-scoped, not component-scoped, which is exactly the route
this rule was written not to rely on. So the criterion is met the fourth way: the
declaration does not happen. Function keys and the
named navigation keys are exempt **from this criterion**, because no dictation and
no typing produces them — `enter` is refused bare by a different rule, below, and
not by this one.
*Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the WCAG
2.1.4 modifier rule for character keys > rejects a bare single-character key and
names the criterion", with "rejects shift alone, because Shift produces a
character" and "exempts every non-character key in the allowlist, which may be
bare" beside it.
This is one rule at one door, not an audit: it is **entry-point validation** in
the vocabulary of "Security posture" below. It is enforced at the declaration door
only, and there is deliberately no second suppression inside the dispatcher — see
ADR-0001 Amendment I Decision 3, and "Keyboard shortcuts on commands" above.

**A second bare-chord rule shares that door and is deliberately not this
criterion.** `enter` is on the allowlist but may never be declared bare, because
Enter **activates the focused control** — the default button, a focused link, a
table row — so a bare Enter chord would fire on top of the activation the user
asked for. That is the same failure mode `space` is excluded outright for, and it
has nothing to do with 2.1.4: the criterion governs single printable *character*
keys and genuinely does not reach `enter`, `backspace`, `delete` or `insert`.
Extending the 2.1.4 message to cover Enter would have been the smaller change and
would have stated something false about the criterion, so the refusal carries its
own message, naming the activation and ADR-0001 Amendment I — no criterion, no
level. `shift` satisfies neither rule; `Ctrl+Enter` is accepted and is the chord
this family was wanted for.
*Test:* `src/core/__tests__/validation.test.ts` — "validateBlueprint — the
activation rule for keys that must carry a modifier > does NOT cite WCAG 2.1.4 for
enter, which is not a character key" asserts the Enter message names neither
2.1.4, nor Character Key Shortcuts, nor Level A, and "leaves the 2.1.4 message
alone for a genuine character key" asserts the character-key message still names
the criterion — so a future edit merging the two fails one of them whichever way
it merges; with "rejects a bare enter, which activates the focused control",
"rejects enter with shift only, because Shift does not stop the activation" and
"accepts ctrl+enter, the one genuinely wanted chord in this family" beside them.

**This commitment constrains the architecture, and the constraint is recorded
rather than discovered later.** ARIA IDREF attributes — `aria-labelledby`,
`aria-describedby`, `aria-controls`, `aria-activedescendant`, `aria-owns` — resolve
**within a single document**. A context-bar control cannot point at a listbox in another
document, and focus order and roving-tabindex composite widgets stop at a document
boundary. So full keyboard operability across the context bar and panes **cannot be
delivered if extensions render into separate documents**, which is what real
per-extension isolation via iframes would require. That trade-off is the reason
isolation was not chosen now, and it is written down in ADR-0001 Amendment E
together with the condition that overrides it.

## AAA as a stretch goal — and its known conflicts

Level AAA is recorded here as an aspiration only. It is **not** targeted,
and it is currently contradicted by the design system in specific, concrete
ways:

- **Contrast, 1.4.6 Contrast (Enhanced).** AAA requires a 7:1 contrast ratio for
  text. **The AA half of this is now closed and the AAA half is not.** The border
  token was `border-neutral-200`, roughly **1.2:1** on white — not a near miss
  but an order of magnitude from AAA, and below the 3:1 AA threshold for non-text
  UI boundaries as well. `--border-default` replaces it at **3.95:1** on the pane,
  and the boundaries that must be *perceived* to be operated each got a token
  chosen for that job: `--control-divider` at 5.94:1 on the app background for
  the pane divider, `--focus-ring` at 6.41:1 on its offset, `--border-selected`
  for the selection rule. Measured across three themes by
  `npm run tokens:check`, and measured again on rendered pixels by
  `e2e/theme.spec.ts`.

  **This made the shell visibly heavier, and that was the point.** CHANGELOG.md
  announces it. What remains open is AAA itself: 7:1 for text is met by
  `--text-primary` and not by `--text-muted`, which is specified at 4.5:1 across
  all eight surfaces rather than at 7:1 on one.
- **Visual presentation, 1.4.8.** AAA calls for user-adjustable line spacing of
  at least 1.5× and block spacing of 2.25×, plus text blocks no wider than 80
  characters. A high-density shell built on `p-1`–`p-3` padding and 11px–13px
  type is in direct tension with this. Meeting it would mean abandoning the
  density that is the product's reason for existing.
- **Target size, 2.5.5.** AAA asks for 44×44 CSS pixel targets. A 48px collapsed
  icon track can accommodate this; 11px-type commands at `p-1` cannot,
  without redesigning the context bar.

Anyone who tells you a 1.2:1-hairline interface is WCAG 2.2 AAA compliant is
mistaken. This project has never made that claim, and clearing the 3:1 AA
boundary threshold does not bring it any closer to making one.
