# D-56 debate record: hardening `validateText`'s character-class rejection (#172)

Runbook §1 step 8 CTO/QA debate. Question: GitHub issue #172. Conducted by the
lane A conductor (cloud, 2026-09-26), dispatching a fresh `lw-architect`
(opus) as CTO and a fresh `lw-verifier` (opus) as QA, then resuming each
across rounds so every round saw the full prior exchange, per runbook §1 step
8. Reproduced here verbatim from the two subagents' own reports, per runbook
§1 step 8.5 — not a reconstruction or summary written after the fact.

**Note on this record's own history.** The implementation subagent's first
pass at this file (written without access to this conversation's transcript)
reconstructed a debate from scratch rather than reproducing the actual one,
and it under-reported the round count (2 rounds where 3 actually ran) and
invented different intermediate findings. That draft was replaced with this
one — the real transcript — before this PR was opened. Flagging it here
because CLAUDE.md rule 2 (evidence, not assertion) applies to this file as
much as to any other, and a debate record that isn't the debate is exactly
the failure mode rule 2 exists to catch.

## The question

`validateText` (`src/core/RegistryContext.tsx`, ~line 382-401) is the text
gate for seven fields a blueprint hands the host: blueprint `name`/`version`,
command `label`/`icon`, nav node `label`/`icon`, nav metric `description`. It
checks only type, `trim().length===0` for blank, and max length — it accepts
bidi control overrides, C0/C1 controls, and zero-width-only strings (GitHub
issue #172 has the measured repro).
`electron/main/plugins/pluginPackage.ts` already ships a stricter pair of
patterns for the manifest `title` (`TITLE_FORBIDDEN_PATTERN`,
`INVISIBLE_PATTERN`), applied in a fixed order, with a passing test. The
question: harden `validateText` to the same standard across all seven fields,
and decide the direction of the mirror between the registry and the package
validator, the exact character-class ranges, and whether this is a
`HOST_API_VERSION` bump.

---

## Round 1 — CTO proposal

**Recommendation: Option B — one source in `src/core`, recorded in the
baseline, mirrored into main.**

Mapped all seven `validateText` call sites (blueprint `name` :1275,
`version` :1280 bound `MAX_VERSION_LENGTH`; command `label`/`icon` :1130/:1137;
nav node `label`/`icon` :863/:885 via `normalizeNavigationNode`, reached from
`normalizeNavigationTree` :957 which also serves the runtime `setNavigationTree`;
nav metric `description` :781).

Cited the shipped precedent: `pluginPackage.ts:185`
`TITLE_FORBIDDEN_PATTERN = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/u`; `pluginPackage.ts:195`
`INVISIBLE_PATTERN = /[­ᅟᅠ᠎​-‍⁠ㅤ﻿ﾠ\u{E0000}-\u{E007F}]/gu`; applied in order
at :248-251 (forbidden-test, then strip-invisible-and-check-blank, then
length); pinned by a test at `electron/__tests__/pluginPackage.test.ts:172` covering
this exact rejection shape (also asserting `'Ma‍il'` is still accepted) —
the round-1-era title has since been widened by the implementation commit;
current title, *Tests:* "refuses a title carrying a bidi control, a C0 or C1
control, a line/paragraph separator, an interlinear-annotation control, or
nothing but invisible characters".

**Correction to the issue's own proposed set:** #172's invisible list
(U+200B-U+200D, U+2060, U+FEFF) is narrower than what already shipped —
the shipped set also covers the soft hyphen, the Hangul fillers U+115F,
U+1160, U+3164, U+FFA0, U+180E, and the tag block U+E0000-U+E007F. Reuse the
shipped set, not the issue's.

**Constraint:** main cannot import `src/` (ADR-0001 Amendment O decision 6,
`hostContract.ts:7-8`). Step 3 already solved this for the contract constants
via a mirror held to `src/sdk/api-surface.json` by a test
(`hostContract.ts:12-20`).

**Options:**
- A — paste the two regexes into `RegistryContext.tsx`. Rejected: a second
  hand-copied literal untied to `pluginPackage.ts`, invisible to the baseline.
- B (recommended) — one source in `src/core`, baseline-recorded, mirrored
  into main via the existing `hostContract.ts` mechanism.
- C — render-time neutralisation only (`<bdi>`/`dir="auto"`). Rejected as
  *the* fix: does nothing for a zero-width-only blank-check bypass, NUL, or
  LF; every render site would have to remember it; needs the browser lane
  (jsdom is blind). Worth filing separately as defence in depth.

**Versioning call: major, `HOST_API_VERSION` 1.1 → 2.0.** ADR-0006:354-356
defines major as "a plugin must change to keep working: a required blueprint
member, a narrowed allowlist…" — a plugin whose command label ends in `\n`
or whose nav icon is a lone zero-width character registers today and would
be refused after this change; that is the definition, and a narrowed
accepted-string-set is a narrowed allowlist in all but name. ADR-0006:368-369
names exactly this case (a validator starts refusing a previously-accepted
value) as one the baseline cannot see, so the call falls to review — this is
that review call. The MAX_SCOPES "minor on a judgement" precedent
(ADR-0006:790-797, kept minor because reaching it needs >1023 extensions
registered at once, so no single plugin can trigger it through its own
documented channel) does not transfer: here one plugin reaches the new
refusal directly, with one string it authors itself.

Considered against: a major marks every 1.x-built plugin incompatible
including clean ones (collateral damage); the installed base is first-party
only (D-23, three plugins) and pre-v1.0.0 (D-39); a narrow grep for the
refused classes in `plugins/*/src` found none (not exhaustive — literal
source text only, not computed strings). Concluded the cost is lowest now, so
major stands; a minor would make the rule mean "major unless we think nobody
is affected," contradicting ADR-0006:354. Did not check whether a major is
already queued elsewhere to ride with.

**Vocabulary:** entry-point validation, real only at `normalizeBlueprint`/
`normalizeNavigationTree` for the seven fields; says nothing about text
reaching host chrome through any other door (e.g. direct store writes,
ADR-0006:781-782). Not an integrity control.

**Noticed, not fixed (deferred to review):** U+2028/U+2029 (Zl/Zp, not Cc,
so not covered by the shipped forbidden pattern); U+FFF9-FFFB; a
variation-selector-only string or U+2800 not treated as blank; metric
`description` losing `\n`/`\t`; confusables/mixed-script out of scope;
Option C worth its own issue.

---

## Round 1 — QA attack

**Verdict: OBJECT.** Option B is the right shape, and the major bump is
justified by ADR-0006's own rule. But the proposal left the one question
that decides whether its guardrail works as an "open item." Answered it: as
specified, recording the patterns in the baseline would be a guardrail that
never fires. It also puts off the rest of the character sets until after the
major is spent, making a second major likely.

Verified all citations directly against `bc4026d` — `validateText`'s line
range and seven call sites, `TITLE_FORBIDDEN_PATTERN`/`INVISIBLE_PATTERN`'s
lines and application order, the pinning test title and its `'Ma‍il'`
acceptance case, the ADR-0006 versioning text and the MAX_SCOPES precedent,
and `hostContract.ts:5-20` — all held.

**Objections, what must change to concede:**

1. **CONFIRMED: the baseline will not see the new patterns unless
   `diffSurface` is changed.** `diffSurface` (`apiSurface.ts:190-229`) lists
   fields to compare by hand and never looks outside that list; the only test
   that sees a new key (`apiSurface.test.ts:84`) just forces the JSON file to
   match derived code — `assessContract` would still return `[]`. Failure
   scenario: a later commit loosens the forbidden pattern and updates
   `api-surface.json` to match; the version does not move and the suite stays
   green — rule 4, a green suite where the suite cannot see the behaviour.
   Required: name the edits to the `ApiSurface` type, `deriveApiSurface`,
   `canonicalSurface` and `diffSurface`, so any change to either pattern
   counts as major (as `extensionIdPattern` does at :222-227), including
   absent-to-present; add one `apiSurface.test` case per new row; update
   ADR-0006:359-363's "what the baseline records" list in the same commit;
   decide whether the patterns become `src/sdk` value exports (interacts
   with :43's export-list equality and the "exports (value)" diff at :192).

2. **The deferred character sets belong in this change, not "noticed, not
   fixed."** Ran the shipped regexes in node: U+2028/U+2029 (LS/PS), U+FFF9
   to U+FFFB (IAA), a variation-selector-only string, U+2800 and U+034F are
   ALL currently accepted (not refused, not treated as blank). Family-emoji
   and tag-flag sequences are correctly accepted (ZWJ/tag chars alongside
   visible chars). Since the proposal's own reasoning says a narrowed
   accepted set is a major with no "nobody is affected" exception, adding
   these later would be a second major or a minor contradicting this round's
   own reasoning. Required: decide the full sets now — include these
   characters, or state permanently and in writing why they're accepted, not
   "review should decide." Metric `description`'s `\n`/`\t` question matters
   less (a future change would only be a minor) but should still be decided
   now.

3. **The major bump's costs aren't listed.** Every `hostApiVersion`
   declaration site must move together:
   `electron/main/plugins/compatibility.ts`, `hostContract.ts`,
   `e2e-packaged/packaged.ts`, plus test fixtures in the pluginPackage/
   pluginIpc/pluginReleaseSource/pluginScheme tests, and possibly plugin
   manifests under `plugins/`. Any already-released plugin package via
   `pluginReleaseSource` would be refused post-bump. Required: enumerate
   these edits, and check open issues for other planned majors so one bump
   covers them all (admitted not checked).

4. **The "no plugin affected" grep evidence misses the likely real
   source.** The runtime door, `setNavigationTree`, is where user data
   arrives (a mail folder name, a DB table name) — the most likely place to
   actually contain `\n`/bidi/zero-width text. After this change such text
   throws at runtime instead of being refused at registration. Required:
   decide refuse-vs-clean for runtime text, and document the new error on
   `setNavigationTree` the way step 5 documented `PAYLOAD_TOO_LARGE`.

5. **Option C must be filed as an issue with evidence BEFORE merge**, per
   CLAUDE.md rule 7 ("no fix it later"), not deferred as "worth its own
   issue" with none actually filed. Also: an ordinary RTL *label* (not just
   bidi *controls*) can still reorder chrome next to it (e.g. a badge count)
   — not fixed by removing control characters, so the new docblock must not
   claim the change "prevents reordering," only that it's entry-point
   validation at the normalize functions.

**Conceded:** major-not-minor is correct (MAX_SCOPES precedent doesn't
transfer); Option A rejected correctly; Option C kept as separate defence,
not the fix; confusables correctly out of scope; vocabulary discipline
correct throughout.

**Not checked (QA, round 1):** how the manifest title gate was versioned
when it shipped; whether `setNavMetric` at runtime reaches `validateText`
through `description`; the full list of `hostApiVersion` declarations under
`plugins/`; open issues for planned majors.

---

## Round 2 — CTO revision

Accepted four of five objections outright; accepted the fifth (runtime text)
with a correction to its premise.

**Correction to round 1:** the two shipped patterns live in
`electron/main/plugins/pluginPackage.ts:185`/`:195`, not in `src/core`. So
the mirror direction is: the patterns become exports of
`src/core/RegistryContext.tsx` next to `EXTENSION_ID_PATTERN`; `validateText`
uses them; `hostContract.ts` gets copies; `pluginPackage.ts` deletes its
local constants and imports from `hostContract.ts`; the existing mirror test
title is extended and renamed so every citation moves with it.

**Objection 1 (baseline visibility):** `ApiSurface` type gains
`textForbiddenPattern`/`textInvisiblePattern`, storing `String(re)` (not
`.source` — both regexes rely on flags, and `.source` would lose them, so a
flag-only change would slip past the baseline; `extensionIdPattern` can use
`.source` because it has none). `deriveApiSurface` imports both patterns from
core and emits `String(...)`; `canonicalSurface` passes them through;
`diffSurface` adds two blocks after the `extensionIdPattern` block, each
pushing `bump:'major'` for any change including a widening (nothing can
mechanically check subset-acceptance between two regexes, and the id
pattern made the same call — a deliberate widening could still ship as a
minor "if argued for"). `apiSurface.test.ts` gets one row per field plus a
reason-string assertion each; `api-surface.json` gets the two rows and
`"version": "2.0"`; ADR-0006:359-363 gets both patterns with flags added to
"what the baseline records" in the same commit. Not exported from `src/sdk`
— `EXTENSION_ID_PATTERN` isn't an SDK export either; that's a separate,
not-made-here decision.

**Objection 2 (decide every character class now):** reran QA's node repro,
confirmed. Rejected `\p{Cf}` as a whole-class ban (would refuse Persian
ZWNJ, family emoji, flag sequences) and `\p{Default_Ignorable_Code_Point}`
as the mechanism (not frozen by Unicode's stability policy, so the recorded
`String(re)` would stay fixed while the accepted set silently grew across
Unicode-data updates, and Node/Chromium could disagree; `\p{Cc}` stays
because that set *is* frozen).

Added to forbidden: U+2028/U+2029 (line/paragraph separators, same class as
the already-refused `\n`); U+FFF9-FFFB (interlinear annotation, marks hidden
text, never display text); U+206A-U+206F (deprecated format controls, no
legitimate use).

Added to invisible: U+034F; U+17B4/U+17B5 (Khmer inherent vowels);
U+180B-U+180F (Mongolian variation selectors, absorbing the existing U+180E);
U+2061-U+2064 (invisible math operators); U+FE00-U+FE0F and
U+E0100-U+E01EF (variation selectors — must stay invisible-not-forbidden,
emoji presentation needs FE0F); U+FFF0-U+FFF8; U+1BCA0-U+1BCA3;
U+1D173-U+1D17A; U+E0080-U+E0FFF (widening the existing tag range); U+2800
(braille blank — only an all-blank string is refused).

Accepted permanently, recorded in the docblock: ordinary RTL letters
(legitimate text; reordering is Option C's problem); confusables/homoglyphs
(needs UTS #39, out of scope); ZWJ/ZWNJ/tag chars/soft hyphen/U+0600-U+0605
alongside visible text (still blank when alone).

Metric `description` gets the same rule — `\n`/`\t` refused there too, no
per-field exception; a future multi-line-tooltip design would be "a widening
(minor)".

**Objection 3 (enumerate every version site):** grepped for
`hostApiVersion`/`HOST_API_VERSION`/literal `'1.1'`. Must change by hand:
`src/sdk/index.ts:45`; `hostContract.ts:25`; `api-surface.json:2`;
`pluginPackage.test.ts:498` (literal `'1.1'` fixture); `pluginScheme.test.ts:167`
(stale comment); `pluginIpc.test.ts:34` (`hostApiVersion:'1.0'` — not yet
read what this test asserts, flagged for implementation). Follow the symbol
automatically: `pluginReleaseSource.test.ts:59`; `plugin-check.test.mjs:82,:289`;
`csp-smoke.mjs:87`; `e2e-packaged/packaged.ts:124`; `pluginStore.ts`/
`pluginPackage.ts`. Disputed QA's claim about `compatibility.ts` — it has no
literal, only doc comments, doesn't change. No `plugins/` manifest declares
`hostApiVersion`; no git tags exist and v1.0.0 gates on BuildCraft (D-39), so
no released package can be refused (measured only as "no tags in this repo").
Searched open issues/PRs for other planned majors: only #106 (React 19
migration). Declined to combine — an unscheduled migration with its own
risk; recorded #106 as the later 3.0 bump instead.

**Objection 4 (runtime text via `setNavigationTree`):** decision — refuse,
with the existing `INVALID_FIELD`, no new error code. Disputed QA's framing:
`RegistryContext.tsx:940-955`'s docblock says one validator runs at both
doors; its `@throws` already lists `INVALID_FIELD` and `PAYLOAD_TOO_LARGE`
for `setNavigationTree`; a whitespace-only folder name already throws there
today — so this adds a new reason under an existing code, not a new failure
mode, the same precedent QA itself named (`PAYLOAD_TOO_LARGE` refuses
oversized runtime text rather than truncating). Rejected sanitising: it
would change what the plugin reads back vs. what it stored, could produce a
collision or a new blank, and takes the decision away from the plugin that
owns the user data. Documentation: `@throws` on `IShellAPI.setNavigationTree`
in `types.ts` and `DEVELOPER.md`; new test, "setNavigationTree refuses a
label carrying a bidi control or a line separator".

**Objection 5 (Option C, rule 7):** agreed it must be filed before merge;
proposed title ("Chrome text beside plugin-authored strings is not
bidi-isolated: an ordinary RTL label can reorder an adjacent badge count")
and body (bidi *controls* are refused, strong RTL *letters* are not and are
legitimate; propose `<bdi>`/`unicode-bidi: isolate`; needs a Playwright
measurement, jsdom is blind; label "not verified in a browser"), left for
whoever implements to actually file. Docblock wording accepted per QA's
point: says only "entry-point validation," never "prevents reordering."

**What CTO did not do (round 2):** wrote/committed nothing; did not file
Option C; did not read `pluginIpc.test.ts`'s assertions; did not check
GitHub Releases beyond git tags; measured character classes only in node,
not Chromium; did not verify every U+E0080-U+E0FFF codepoint against
`\p{DI}` (flagged for the implementation commit to run and paste).

---

## Round 2 — QA attack

**Verdict: OBJECT, on three narrow points.** The revision answers all five
round-1 objections. Concedes Objections 3, 4 and 5 outright, and 1 and 2
except for the points below.

Verified independently against `bc4026d`: version sites
(`hostContract.ts:25`, `api-surface.json:2`, both test-fixture sites);
`deriveApiSurface.ts:118`'s `extensionIdPattern.source` pattern; the
`setNavigationTree` docblock and its existing `@throws` list — the CTO's
correction to Objection 4 is right, withdraws that framing; `compatibility.ts`
has no literal, only a doc comment — the CTO is right, QA's round-1 listing
was wrong (it listed every file containing the string without checking for a
literal); `pluginIpc.test.ts:34`'s `hostApiVersion` appears only in a
`PluginListing` data object nothing in that file compares — very likely
needs no edit, not run against a 2.0 host to confirm.

**What must still change:**

1. **CONFIRMED: U+2065 is not covered.** Tested the proposed sets in Node
   v22.22.2 (Unicode 17.0) over every codepoint against
   `\p{Default_Ignorable_Code_Point}`: `E0080-E0FFF DI: 3968/3968`,
   `FFF0-FFF8 DI: 9/9`, `180B-180F DI: 5/5`, `2061-4 DI: 4/4`,
   `206A-F DI: 6/6`, `1BCA0-3 DI: 4/4`, `1D173-A DI: 8/8`, `2800 DI: 0/1`,
   `FFF9-B DI: 0/3`, and — `DI uncovered: 2065`. U+2065 is unassigned and
   default-ignorable, sitting in the gap between the proposed U+2061-2064
   and U+206A-206F. Failure scenario: a label of just "U+2065" alone is not
   blank under the proposed rule and registers. Required: extend the
   invisible range to U+2060-2065, or forbid U+2065-206F; either way, paste
   an exhaustive scan showing "DI uncovered" empty, not a per-range spot
   check.

2. **Two sentences say something the proposed test will not allow.**
   Objection-1's revision says "a deliberate widening could still ship as a
   minor if argued for" — but under the proposed `diffSurface` blocks, ANY
   pattern change is unconditionally flagged major; `assessContract` would
   fail a minor bump, so "argued for" has no path short of editing the rule
   itself. Objection-2's revision says a future tooltip exception "would be
   a widening (minor)" — but that's a per-field `validateText` behavioural
   change the baseline can't see at all (ADR-0006:368-369), not a pattern
   change, so `diffSurface` says nothing about its version either way.
   Required: rewrite both, since they'll be copied into ADR-0006 and
   docblocks and must be literally correct (rule 2). Suggested replacements:
   "any change to either recorded pattern needs a major; shipping a widening
   as a minor means changing that rule in `apiSurface.ts`, with review" and
   "a per-field exception would be a widening the baseline cannot see;
   review sets its version."

3. **PLAUSIBLE: the `g` flag on the shared invisible-pattern export is a
   stateful trap.** Measured: `/a/g.test("a")` gives `true` then `false` on
   the same input. Today `INVISIBLE_PATTERN` is used only in one `.replace()`
   call, where `g` is needed and harmless; once it's a shared export used
   from three places, anyone who calls `.test()`/`.exec()` on it will see
   alternating results. Required: export the invisible pattern without `g`
   and build the global form at each use site, or keep `g` and document +
   trap-file the restriction. Also: don't call the exported pattern "fixed"
   or "immutable" — a RegExp's `lastIndex`/`compile()` remain mutable,
   `EXTENSION_ID_PATTERN` has the same property, "entry-point validation"
   remains correct.

**Conceded without conditions (round 2):** the mirror direction and
`String(re)`-not-`.source` choice; the file list for the version bump; the
character classes chosen apart from the U+2065 gap, and the reasons for
rejecting `\p{Cf}`/`\p{DI}` as whole-class rules; recording #106 as the later
3.0 bump; refuse-not-sanitise for runtime text with no new error code; the
Option C issue's wording (must still be filed before merge).

**Not checked (QA, round 2):** Unicode behaviour in Chromium (node only);
GitHub Releases beyond git tags; `pluginIpc.test.ts` run against a 2.0 host;
whether `check:citations` flags every citation of the renamed mirror test
title; any suite actually run.

---

## Round 3 — CTO final revision

Fixed all three remaining points; re-litigated nothing already conceded.
Measured in node v22.22.2 (Unicode 17.0).

**1. U+2065 gap, confirmed.** Fix: the invisible pattern's U+2060 plus
U+2061-2064 becomes one range, **U+2060-2065**; U+206A-U+206F stays
forbidden as round 2 had it. Rejected forbidding U+2065-206F instead: U+2065
is unassigned and draws nothing, like the other invisible-set members
(U+FFF0-FFF8, U+E0080-E0FFF) — it doesn't change layout the way the
forbidden set's bidi controls and line breaks do. The implementation commit
will paste an exhaustive full-codepoint scan (not spot checks), printing
per-range counts and one required line, "DI uncovered: none," plus the named
non-DI exceptions covered anyway (`\p{Cc}`, U+2028/2029, U+FFF9-FFFB
forbidden; U+2800 invisible). The script does not join `verify`, since its
result depends on the Node build's Unicode version — the PR body names the
version it ran under.

**2. Two contradictory sentences, retracted and replaced verbatim** with
QA's wording: (a) "Any change to either recorded pattern needs a major.
Shipping a widening as a minor means changing that rule in `apiSurface.ts`,
with review." (b) "A per-field exception, such as allowing `\n` in a metric
`description`, would be a widening the baseline cannot see. Review sets its
version." Both go into ADR-0006 and the relevant docblocks.

**3. The `g` flag, fixed via option (a): exported without `g`.**
`TEXT_INVISIBLE_PATTERN = /[...]/u` (no `g`); each `.replace()` call site
builds a fresh global copy inline: `value.replace(new RegExp(pattern.source, 'gu'), '')`.
Neither exported pattern then carries `lastIndex` state. Rejected option (b)
(keep `g`, document the restriction) — that would keep the bug and rely on
every future caller reading a warning. A pinning test asserts both patterns'
`.flags === 'u'` and that two consecutive `.test()` calls on the same input
agree; the `hostContract.ts` copy is held to the same flags by the extended
mirror test. Docblocks call neither pattern "fixed"/"frozen"/"immutable" — a
RegExp's `lastIndex`/`compile()` stay mutable, same as `EXTENSION_ID_PATTERN`;
the core patterns are described as entry-point validation, the
`hostContract.ts` copy as a guardrail.

**Still open for implementation, unchanged:** file the Option C issue before
merge (round-2 title/body); run `pluginIpc.test.ts` against a 2.0 host
rather than assume it's inert; paste the full-codepoint scan output.

---

## Round 3 — QA attack (final)

**Verdict: CONCEDE.** All three remaining objections resolved; checked each
fix directly rather than trusting the description.

1. **U+2065 gap closed.** Re-ran the full codepoint scan with the invisible
   range widened to U+2060-2065, in Node v22.22.2 (Unicode 17.0):
   `DI uncovered:` (empty); `persianZWNJ ACCEPTED`; `heartVS ACCEPTED`. No
   default-ignorable character is left uncovered, and the two strings that
   must still register still do. The reasoning for making U+2065 invisible
   rather than forbidden holds — unassigned, draws nothing, unlike the
   layout-changing forbidden-set members.
2. **The two sentences now match what the proposed baseline check and
   ADR-0006:368-369 actually enforce.**
3. **The `g` flag is gone from the exported pattern.** Confirmed a
   no-`g` pattern has `.flags === 'u'`, and rebuilding with
   `new RegExp(p.source, 'gu')` strips every match
   (`"a<ZWSP>b<ZWSP>"` → `"ab"`), unlike the direct call, which measured as
   removing only the **first** match (`"a<ZWSP>b<ZWSP>".replace(p, '')` has
   length 3, one invisible character still present). **One condition carried
   into implementation, not a new objection:** a refusal test for a string
   made of two-or-more *different* invisible characters is required at both
   the registry door and the package validator — the proposed pinning test
   (flags are `'u'`, two `.test()` calls agree) would not by itself catch a
   future call site that takes the direct-`.replace()` shortcut.

**Still open, for whoever implements this (unchanged from round 2, per the
CTO):** file the Option C issue before merge; run `pluginIpc.test.ts`
against a 2.0 host; paste the full-codepoint scan output into the
implementation commit.

**Not checked, either round:** Chromium's Unicode behaviour (node only); no
suite was run by either subagent in the debate itself — the debate covers
the design, not the implementation, which is verified separately by
`npm run verify` and cited in the PR body.

---

## The decision, as it stands

1. **Direction of the mirror (Option B):** `TEXT_FORBIDDEN_PATTERN` and
   `TEXT_INVISIBLE_PATTERN` are canonical exports of
   `src/core/RegistryContext.tsx`, next to `EXTENSION_ID_PATTERN`.
   `validateText` uses them directly. `electron/main/plugins/hostContract.ts`
   carries mirrored copies (main cannot import `src/`, ADR-0001 Amendment O
   decision 6). `pluginPackage.ts` deletes its own
   `TITLE_FORBIDDEN_PATTERN`/`INVISIBLE_PATTERN` and imports the mirror.
2. **No `g` flag on the exported invisible pattern.** Every call site that
   strips it builds a fresh, locally-scoped `'gu'` copy:
   `value.replace(new RegExp(TEXT_INVISIBLE_PATTERN.source, 'gu'), '')`. A
   dedicated adversarial test with two-or-more different invisible
   characters together, at both doors, catches the shortcut-`.replace()`
   regression that a single-character test would not.
3. **Character classes, on top of what `pluginPackage.ts` already had:**
   forbidden gains U+2028-2029, U+FFF9-FFFB, U+206A-206F; invisible gains an
   extended U+2060-2065 (closing the gap QA found), U+034F, U+17B4-17B5,
   U+180B-180F (superseding U+180E), U+FE00-FE0F and U+E0100-E01EF,
   U+FFF0-FFF8, U+1BCA0-1BCA3, U+1D173-1D17A, a widened U+E0080-E0FFF, and
   U+2800 named as a deliberate, non-property exception. Metric
   `description` gets the identical rule, no per-field exception.
4. **Baseline visibility.** `ApiSurface.textForbiddenPattern` and
   `.textInvisiblePattern` record `String(pattern)` (flags included).
   `diffSurface` treats any change to either, including a widening, as an
   unconditional major — same reasoning as `extensionIdPattern`.
   `src/sdk/api-surface.json` moves to `"version": "2.0"`.
5. **`HOST_API_VERSION` moves `1.1` → `2.0`**, in `src/sdk/index.ts` and its
   mirror in `hostContract.ts`, with every dependent test fixture re-derived
   from the constant rather than left as a stale literal.
   `pluginIpc.test.ts`'s `hostApiVersion: '1.0'` fixture is run and confirmed
   inert, left as-is.
6. **Deliberately, permanently accepted:** ordinary RTL letters (the
   adjacent-chrome reordering problem is filed as a sibling issue, not fixed
   here); confusables/homoglyphs (out of scope); ZWJ/ZWNJ, tag characters,
   soft hyphen and U+0600-0605 alongside visible text.
7. **The sibling filed, per rule 7:** chrome text beside a plugin-authored
   RTL label is not bidi-isolated by anything in this change — proposed
   fix `<bdi>`/`unicode-bidi: isolate`, needs a Playwright measurement
   (jsdom cannot observe layout), filed as its own issue rather than folded
   in here.

Vocabulary check (CLAUDE.md): both new patterns are **entry-point
validation** — real at `validateText`'s door and the package validator's
door, silent about a string that reaches display any other way. The
`hostContract.ts` mirror is a **guardrail**. Neither is described as
"fixed," "frozen" (in the sense of behaviour) or "immutable" anywhere in the
change.

---

## Post-implementation review findings (PR #236), not part of the debate above

Two `claude[bot]` review rounds on the implementation PR found three real
issues after the debate closed and the code was written. None reopens the
debate's decision; all three are corrected in the same PR, not deferred.

1. **A conceded round-2 deliverable was dropped between decision and
   implementation.** Round 2's resolution of Objection 4 committed to a
   dedicated runtime-door test ("setNavigationTree refuses a label carrying
   a bidi control or a line separator") plus doc updates in `types.ts`/
   `DEVELOPER.md`; round 3 and the final CONCEDE both still listed it as
   "still open, for whoever implements this," and the implementation commit
   did not carry it forward, nor did the PR's "Not done"/"Limits" sections
   name the gap — they instead asserted, uncited, that entry-point
   validation is real at the runtime door too. `claude[bot]` caught this
   exact chain (conceded → still-open → silently absent → asserted anyway).
   Fixed: the test now exists in `src/core/__tests__/navigationTree.test.tsx`,
   confirmed to pass against the already-shipped code (the runtime door
   already refused this input, it was only untested), and `types.ts`/
   `DEVELOPER.md` cite it with the user-data-cleaning guidance round 2 asked
   for.
2. **The exhaustive-scan numbers pasted into the PR body didn't reconcile
   with each other**, because they mixed raw pattern-match totals (any
   codepoint, matched or not by `Default_Ignorable_Code_Point`) with a claim
   framed as default-ignorable-restricted coverage. Tracing the exact
   240-codepoint gap `claude[bot]` found led to the actual defect: `TEXT_INVISIBLE_PATTERN`
   carried a `U+E0100-U+E01EF` sub-range that had become a strict subset of
   the wider `U+E0080-U+E0FFF` range added later in the same pattern —
   redundant, never changing which characters were matched, but the source
   of the confusing arithmetic. Removed the redundant sub-range from all
   three places it was recorded; the PR body's pasted numbers now report
   DI-restricted coverage that actually sums to the total scanned.
3. **The `unc-path` false-positive exclusion this same change added was
   file-agnostic and asserted a false "never."** `claude[bot]` correctly
   identified that a lowercase `u` plus four hex digits is a syntactically
   valid NetBIOS-style hostname, and that `accept` had no file check at all,
   so it silently weakened `unc-path` detection in every tracked file, not
   only the one JSON file it was written for. Its own suggested mechanism
   (`onlyFiles` on the whole rule) would have been a worse regression — that
   gates the entire rule, disabling `unc-path` detection everywhere but
   `api-surface.json` — so the actual fix checks `context.file` inside
   `accept` itself, and a new test proves the same escape-shaped text in a
   different file is still caught.
4. **A third `claude[bot]` review round found the "Object.freeze ... does
   not stop lastIndex/compile()" docblock sentence (repeated verbatim in
   this record's rounds 2 and 3, above) is itself factually wrong, not just
   informally imprecise — flagged as PLAUSIBLE rather than CONFIRMED because
   the reviewer could not execute code to measure it.** Measured directly:
   `lastIndex` is an own, writable data property, so `Object.freeze` makes it
   non-writable, and both a direct assignment and a call to `.compile()`
   (which re-writes `lastIndex` internally) throw a `TypeError` in this
   always-strict ES-module code. The debate rounds above are left as they
   are — that is what was actually said in the actual debate, wrong claim
   included, per this record's own opening note about reproducing the real
   transcript rather than a corrected one — but the shipped docblock in
   `RegistryContext.tsx` is corrected to state the measured fact (freeze
   *does* protect `lastIndex`; it costs nothing here only because neither
   pattern carries `g`/`y`, so nothing ever reads or writes it), and a new
   test pins the measurement rather than asserting it from memory a second
   time.
5. **An independent `shellux-cloud-reviewer` (opus, host-security path) pass
   found a fifth issue, F4: "all 7 fields" was claimed but only blueprint
   `name` was directly tested** — true by construction (one shared
   `validateText`), but unobserved for `version`, command `label`/`icon`,
   nav node `label`/`icon` and nav metric `description`. Flagged PLAUSIBLE
   (coverage gap, not disproven) rather than a functional defect, and not
   on the reviewer's own "Fix for MERGE" list, but closed anyway rather than
   left as a standing gap: a new test in `validation.test.ts` drives the
   same bidi override through each of the other six call sites directly,
   and `DEVELOPER.md`'s field tables (which the same review separately
   found had no `2.0`/bidi-restriction note anywhere) gain matching
   pointers and a dedicated subsection under "Security: plugin-supplied
   strings are untrusted."
6. **The same cloud-reviewer pass caught this PR's own bookkeeping error**:
   an earlier PR-body "Known defects" entry mislabeled the exhaustive-scan
   arithmetic fix as coming from `claude[bot]`'s round 2, when it was
   actually round 1's second finding (round 2's own findings were the
   `unc-path` and `setNavigationTree` gaps, items 1 and 4 above) — corrected
   in the PR body's next revision.
