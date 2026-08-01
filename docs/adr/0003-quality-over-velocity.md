# ADR 0003 — Quality Over Velocity: Review Before Merge, Evidence Before Assertion

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Enforced by:** review, `.github/PULL_REQUEST_TEMPLATE.md`, `CLAUDE.md` and
  `CONTRIBUTING.md`. One clause of it — that a citation names a test which exists —
  is additionally decided by `npm run check:citations`. See "What is checked and
  what is convention" below, which says plainly which is which rather than letting
  the reader assume.

> **This ADR is mostly convention, and it says so on the first page.** ADR-0002
> could be enforced by a script because every clause of it is decidable by reading
> the tracked files. Most of this decision is not: no script can tell that a
> reviewer read a diff before it merged, that a pasted terminal transcript came
> from the change under review, or that a feature was actually seen working in a
> browser. ADR-0001 Amendment G had to make the same admission and it stays
> honest by making it. Where a clause *can* be mechanised it is, and the rest is
> written as things a reviewer can decide by looking — did the contributor do this,
> yes or no — rather than as values to agree with.

---

## Context

Work on this repository was built fast and in parallel, then reviewed afterwards.
The code gates were strong throughout: 100% statements, branches, functions and
lines over the gated tree, lint at `--max-warnings 0`, zero inline suppressions, a
portability checker, a citation checker, and a three-operating-system CI matrix.
None of that was the problem.

**The order was the problem.** Adversarial review conducted after a wave of work
has landed will always find defects, and a large share of what it found here was
drift produced by the velocity itself — a claim written one step wider than the
premise licensing it, a test written to the shape of an idea rather than to the
behaviour, a document updated in a later sweep instead of in the change that made
it true. Every one of those is cheap to prevent at authorship and expensive to
find afterwards, and finding it afterwards is what this project has been doing.

The evidence below is the whole of the argument. Each item was re-verified against
the tree at `edc29db` before it was written here, and one candidate example was
dropped because measurement contradicted it — that dropped item is recorded in
"What could not be evidenced", because an ADR forbidding unevidenced assertion
cannot open with one.

### 1. A feature shipped that nobody could use, under six passing tests

The ribbon overflow menu shipped clipped to zero visible pixels and unclickable.
Its containing block sat inside two `overflow-hidden` ancestors, so CSS clipped
every pixel of it; `document.elementFromPoint` at the menu's own centre returned
the pane *below* the ribbon. Six tests asserted the menu worked. All six passed,
and all six passed **vacuously**, because jsdom has no layout engine and no notion
of a hit test — there is nothing there that can observe a clip.

It was found by measuring in a real browser against the compiled stylesheet, rather
than reading the JSX. It was not found by the suite, and adding tests to that suite
could not have found it: a clip is not representable in an environment with no
layout. The postmortem is the file banner in `src/components/ui/RibbonToolbar.tsx`,
under the heading beginning "THE OVERFLOW MENU IS RADIX'S, NOT OURS", and the
`Fixed` entry for `118aaac` in `CHANGELOG.md`.

### 2. A test named for a behaviour it never performed

`src/components/__tests__/ShellLayout.test.tsx` contains a case called
"survives a collapse toggled while a divider drag is in flight". It fires
`pointerDown`, then `pointerMove`, then `pointerUp`. **No drag ever starts.** This
jsdom implements no `PointerEvent`, so `fireEvent.pointerMove` falls back to a
plain `Event` that carries no `clientX`, and the panel library's delta arithmetic
is never handed a coordinate.

That is not inferred. It is measured, by name, in
`src/__tests__/IntegrationSuite.test.tsx`. *Tests:* "cannot be driven by a POINTER
drag at all, because this jsdom implements no PointerEvent" — which dispatches the
identical three-event sequence and asserts the pane sizes are unchanged.

The test in `ShellLayout.test.tsx` still earns its place: unmounting the handle
mid-gesture and finding the layout intact is a real assertion. But its name
describes a drag, a reader believes the drag happened, and it did not. A name is
a claim like any other.

### 3. Eight WCAG 2.2 AA blockers in code that had already passed review and the gate

An accessibility audit of the shipped shell found eight, enumerated in
`CHANGELOG.md`: the clipped overflow menu above, reflow at 320 px, dark-mode text
contrast raised from 4.18:1 to 7.85:1, selected-item and divider non-text
contrast, 24 px target sizes, focus dropped on the floor when the overflow menu
closed, and native `disabled` in place of `aria-disabled`, which put a disabled
action outside the tab order entirely.

Every one of those is a property of rendered geometry, colour or focus order.
Every one of them is invisible to the suite that was green over the same code.

### 4. Prose that repeatedly outran the code

Roughly **sixty documentation claims asserting security the code did not deliver
were corrected** (`CHANGELOG.md`, `294c9e0`). In every round the code was sound.
What was wrong was a conclusion written one step wider than the premise licensing
it. Ten review rounds, eight of which reproduced a real defect.

ADR-0001 carries Amendments E, F and G for exactly this. Amendment G is the rule —
no security claim without a named test — and it records **seven consecutive review
rounds** in which the code was sound every time and the sentence was wider than the
premise. Six correct code fixes in a row did nothing to prevent the seventh,
because the code was never what was broken. The same history is summarised in
`SECURITY.md`, in `DEVELOPER.md` and in `.github/ISSUES_MANIFEST.md`.

`scripts/check-citations.mjs` now mechanises the decidable half of Amendment G: a
citation naming a test that has been renamed, split or deleted fails the build. The
other half — that a security claim carries a citation at all — remains review's job
and the checker's own banner says so.

### 5. A gate that claimed to be CI, and was not

`README.md` states that `npm run verify` "is exactly what CI applies." It is not,
and was not when it was written. `package.json` chains nine scripts into `verify`:
`check:portability`, `check:citations`, `lint`, `typecheck`, `test:coverage`,
`test:integration`, `test:scripts`, `build`, `audit:prod`. The `verify` job in
`.github/workflows/ci.yml` runs five of them: `check:portability`, `lint`,
`typecheck`, `test:coverage`, `build`.

**The citation gate, the randomised integration run and the script tests execute
on no leg of that workflow.** (`audit:prod` does run in CI, but in
`.github/workflows/audit-dependencies.yml`, and only when `package.json` or
`package-lock.json` changed, plus weekly on a timer — so it is absent from most
pull requests by design rather than by omission.)

`CONTRIBUTING.md` carried the same claim in different words and it is corrected by
this change. `README.md` still carries it, and is filed rather than fixed here as
GitHub issue #58 — rule 7 below, applied to this ADR's own change, since correcting
`README.md` belongs with a change that owns that file.

This one matters more than its size. Every other rule in this document leans on
"the gate ran". A gate that is documented as stronger than it is converts a real
control into a believed one.

### 6. Nobody has ever run the application

`src/App.tsx` composes two providers and the shell, and registers nothing. Its own
docblock says so: "Nothing is registered here. The shell renders with an empty
registry". `npm run dev` therefore renders an empty shell. GitHub issue #39 records
the same finding against the whole repository — every automated case executes in
jsdom, and no script exists that drives the running application.

So the project has a comprehensive suite, a 100% gate, three ADRs, and no evidence
that a user could do anything at all.

### What could not be evidenced

One candidate example for this ADR was **dropped**. `.github/ISSUES_MANIFEST.md`
states that under `--sequence.shuffle`, `src/core/__tests__/shellApi.test.ts`
"fails three of its own cases". Three attempts to reproduce that at `edc29db`:

- that file alone under `--sequence.shuffle` — 109 of 109 passed;
- that file alone under `--sequence.shuffle.tests=true --sequence.seed=1234` —
  109 of 109 passed;
- the whole suite under `--sequence.shuffle`, seed `1785592035416` — **1079 of
  1079 passed across all 31 files**, `shellApi.test.ts` among them.

So the claim is not merely unreproduced, it is contradicted, and it is not
repeated here. State the result precisely, though: `--sequence.shuffle` reorders
*files*, so what these runs show is that the suite tolerated a shuffled file order
at one seed, plus one file tolerating a shuffled *case* order at one seed. That is
narrower than "the suite is order-independent", and the manifest's conclusion —
that the wider suite is "not yet order-independent" — has lost the evidence it
rested on without a replacement being established either way.

**A discarded fourth run is worth recording, because it nearly became a false
finding of its own.** An earlier whole-suite shuffled run reported 104 failures
across 9 files, almost all of them `Invalid Chai property: toHaveTextContent`, and
the explanation first reached for was memory pressure on the machine. Both readings
were wrong. That run was executed in a git worktree whose `node_modules` was a
junction to another checkout, which broke the module identity
`@testing-library/jest-dom` extends — so the matchers were absent in shuffled and
unshuffled runs alike, and the result said nothing about ordering at all. Replacing
the junction with `npm ci` in the worktree made the failures vanish.

Two things follow. The one that matters for this ADR is rule 9: the invocation and
the environment are part of a tooling claim, and a result read without them is not
evidence. The other is that a plausible-sounding cause — "the machine was busy" —
was reached for before the environment was checked, which is the same reflex as
writing a conclusion one step wider than its premise.

That is the rule working, and it is recorded rather than quietly omitted so that
the next reader knows the check was made and how far it got.

### The forces acting on the decision

1. **Review after the fact is the most expensive place to find a defect, and the
   only place this project has been finding them.** By then the change is merged,
   the author has moved on, and the fix is a second change with its own risk.
2. **A gate can only refute what it can observe.** Every defect in items 1, 2 and 3
   was outside the suite's observational range. Adding tests to a blind instrument
   produces confidence, not evidence.
3. **Prose decays faster than code, and nothing compiles it.** Items 4 and 5 are
   both documentation defects that a reader would have acted on.
4. **Velocity was not free; it was billed later.** Every item above was created by
   a wave and paid for by a subsequent audit round.
5. **Most of this cannot be mechanised, and pretending otherwise is the failure
   mode itself.** A rule that claims enforcement it does not have is the same
   defect as a sentence that claims security it does not have.

---

## Decision

**Quality is the first priority, without exception. Where quality and speed
conflict, speed loses, and the trade is not re-litigated per change.**

Ten numbered rules, plus 4b, which is a qualifier on rule 4 rather than a rule of
its own and is numbered that way so that renumbering never silently changes what a
cross-reference means. Each is written so a reviewer can decide it by looking at the
change — the contributor either did this or did not. A rule that cannot be answered
that way does not belong here.

### 1. Adversarial review precedes merge. It never follows it

A change is reviewed against the change, before it lands. Not after the wave, not
in a sweep, not by an audit round that opens issues against merged code.

The reviewer's posture is adversarial by default: the question is not "does this
look right" but "what does this claim, and what would have to be true for the claim
to be false". That posture is what produced Amendments E and F, and it produced
them a release too late every time.

*Decidable by:* the pull request has a review recorded against it, and the review
predates the merge.

### 2. Evidence, not assertion

"Passing", "covered", "verified", "secure", "fast", "isolated" and "cannot" are
worth nothing on their own. Each must arrive with one of:

- pasted output, in full, from the command that produced it — not a summary, not
  "all green", not a screenshot of part of it;
- the **full title** of a named test, after a citation marker so
  `npm run check:citations` can resolve it;
- a stated measurement with the method beside it.

ADR-0001 Amendment G established this for security claims. **It is generalised
here to every claim of a property.** The reviewer's question is mechanical — *which
output, which test, which measurement?* — and a sentence that cannot answer it is
narrowed or deleted. Deleting it is the rule working, not a failure.

*Decidable by:* every property-claiming sentence in the diff points at output, a
test title, or a measurement.

### 3. Documentation lands with the change that makes it true

Not a follow-up. Not a sweep. Not a later commit. The same commit that changes the
behaviour changes every sentence the behaviour falsifies, or the change is not
finished.

A documentation sweep is a symptom, not a workflow. Items 4 and 5 above are what
sweeps leave behind: prose that was accurate when written, was never re-read when
the code moved, and was believed in the interval.

*Decidable by:* the diff either touches no documentation because none of it moved,
or it touches every document the change falsifies, and the pull request names which
and why.

### 4. A green suite is not evidence of a working feature where the suite cannot observe the behaviour

**jsdom is blind to whole classes of defect, and this is a property of the tool,
not a gap to be closed with more tests.** Specifically, in the environment this
repository runs:

- **There is no layout engine.** Nothing is ever clipped by an ancestor, nothing
  overflows, nothing is off-screen, and no element ever occludes another.
- **`getBoundingClientRect` returns 0×0** unless a test stubs it, and a stub
  supplies the geometry rather than measuring it.
- **A pointer never hit-tests.** `document.elementFromPoint` is not a hit test
  against painted pixels.
- **There is no `PointerEvent`**, so `fireEvent.pointerMove` degrades to a plain
  `Event` carrying no coordinates. *Tests:* `src/__tests__/IntegrationSuite.test.tsx`
  — "cannot be driven by a POINTER drag at all, because this jsdom implements no
  PointerEvent".
- **There is no `ResizeObserver` and no `IntersectionObserver`.**
- **`Element.prototype.scrollIntoView` does not exist.**
- **Nothing is painted, so no colour, contrast ratio or focus ring is observable.**

Therefore: **anything geometric, visual, focus-ordered or pointer-driven is either
verified in a real browser or carries an honest "not verified in a browser" label.**
A third option does not exist. Writing a jsdom test for such a behaviour and
calling the feature covered is the precise defect in items 1 and 2, and it is worse
than writing no test, because the passing test tells everyone afterwards that the
question was answered.

Stubbing the environment to make such a test pass is stubbing the instrument. A
test that supplies the geometry is testing arithmetic over numbers it invented, and
must say so in its own name.

*Decidable by:* for every geometric, visual or pointer behaviour the change
touches, the pull request names the browser evidence or states that there is none.

### 4b. Coverage is not verification. 100% means the lines executed

The gate over `src/core/**` is 100% statements, branches, functions and lines. That
is a real and valuable control and it is **not** a statement about correctness.
It says every line ran. It does not say any line was asserted about, that the
assertion was the right one, that the test name describes what the test does, or
that the behaviour is reachable by a user.

Item 1 was fully covered code that no user could click. Item 3 was eight
accessibility blockers under the same gate. **This sentence is permanent and may
not be softened**, because "100% covered" is the single most load-bearing phrase in
this repository and it is routinely read as "verified".

*Decidable by:* no sentence in the change offers a coverage figure as evidence that
a behaviour works.

### 5. Run it

**A user-visible change is not done until a human has seen it work in a browser.**
Not the suite. Not a rendered snapshot. The running application, driven by hand or
by a browser-automation lane, with the compiled stylesheet in play.

The change states what was seen, how it was reached, and at what viewport if the
viewport matters. If it was not run, that is stated as a limit and the change is
labelled unverified rather than done.

**This rule became servable while this ADR was in review, and the change is
recorded rather than quietly absorbed.** When the Decision was drafted, nothing in
the repository could drive a real browser, and this paragraph said so. The browser
lane then landed on `main` independently, as `3ebf86d`: `e2e/` driven by
`playwright.config.ts`, `.github/workflows/browser.yml` running Chromium on Ubuntu
for every pull request, and a `dev.html` / `src/dev/` fixture that mounts the shell
with the two verification remotes registered.

So the answer to "how do I satisfy rule 5" is now `npm run test:browser`, with
`npm run test:browser:install` once per machine. Two things stay true and matter
here. `src/App.tsx` still registers nothing, so `npm run dev` still renders an empty
shell — the fixture is `dev.html`, not the production entry point. And the lane is
deliberately **not** chained into `npm run verify`, because Playwright needs a
browser download that `npm ci` does not perform, which would falsify the acceptance
test; `CONTRIBUTING.md` states that trade and it is the right one.

GitHub issue #42 asked for exactly this lane. Issue #39 — that no human has run the
application — is narrowed by it but not answered: an automated browser lane is not a
person looking at the thing.

*Decidable by:* the pull request describes an observation of the running
application, or states that none was made.

### 6. Parallel work needs disjoint file ownership, and two workstreams touching one file serialise

Concurrent work on this repository has already cost it twice, and both incidents
are on the record rather than recalled:

- **The gate could not be run.** `.github/ISSUES_MANIFEST.md` records that at the
  time ISSUE-005 was written, `npm run verify` "could not be run to a clean exit",
  and the reason was not that change: the working tree carried *another* change in
  flight across `src/core/**` and `src/components/**`, which left `ShellAPI.ts` and
  seven pre-existing test files failing `tsc`. A contributor could not tell their
  own result from somebody else's.
- **A premise went stale underneath an open issue.** GitHub issue #25 records stale
  file-and-line citations in issues #18 and #12, and #12's render-path premise
  being overtaken by work on the `phase-2-shell` branch.

Neither is a consequence of anyone being careless. Both are consequences of two
workstreams holding the same files at the same time.

So: before parallel work starts, the files each workstream may write are named.
Where two would touch one file, they **serialise** — one lands, the other rebases
onto it and re-reads what changed. "We will resolve the conflict later" is the
same promise as "we will document it later", and it fails the same way, except that
a text-level merge can succeed while the meaning is broken.

*Decidable by:* concurrent branches have named, disjoint file sets, or a stated
serialisation order.

### 7. No "fix it later"

A defect known at authorship time is **fixed in the change**, or **filed before the
change merges**, with the evidence attached — the reproduction, the file and line,
and what the correct behaviour is. Those are the only two options. A defect that is
known and neither fixed nor filed does not exist as far as the next reader is
concerned, and that reader is the one who pays.

This applies to defects the change reveals as much as to defects it introduces.
Finding something wrong nearby is not a reason to say nothing.

*Decidable by:* every defect named anywhere in the change's discussion is either
closed by the diff or carries an issue reference.

### 8. Say what you did NOT do

Every change states its limits: what a reader might reasonably assume it delivers
and it does not, which branch is executed but not asserted, which guarantee holds
in production and is untested here, what was left unbuilt, and what remains
unproven.

This is the most valuable section of a pull request in this repository and it is
required. A reader who later finds an unstated gap re-reads every other sentence
differently — and correctly so.

*Decidable by:* the "what this does NOT build" and "limits" sections are filled in
with specifics, not with "n/a".

### 9. A claim about tooling is measured on this repository, not recalled

The `--sequence.shuffle` claim in "What could not be evidenced" above is a claim
about a tool's behaviour that has been repeated across documents and was
*contradicted* the first time someone ran it. Tool behaviour drifts with versions,
platforms and configuration, and a remembered flag is exactly as unreliable as a
remembered guarantee — as is a remembered failure.

So a statement about what a command, a flag, a library or a browser does is
accompanied by the invocation that demonstrated it, run against this tree.

*Decidable by:* every tooling claim the change adds names the command that was run.

### 10. Name the failure mode when you fix it

When a defect is closed, the change records **why the defect was possible**, not
only what the fix was. `CHANGELOG.md`, the ADR amendments and the postmortem banner
in `RibbonToolbar.tsx` are the existing practice, and it is why this ADR could be
written from the repository's own record rather than from memory.

A fix without a recorded failure mode is a fix that will be re-made.

*Decidable by:* the diff or the pull request states what made the defect possible.

### What is checked and what is convention

Stated explicitly, so nobody reads a convention as a gate:

| Clause | Status |
|---|---|
| Rule 2, second half — a citation names a test that exists | **Checked.** `npm run check:citations`, in `verify`. |
| Rule 2, first half — every claim carries a citation | Convention. No definition precise enough to match on; see the checker's own LIMITS banner and GitHub issue #5. |
| Rules 1, 3, 4, 4b, 5, 6, 7, 8, 9, 10 | Convention, decided in review against `.github/PULL_REQUEST_TEMPLATE.md`. |
| ADR-0002's portability mandate | **Checked.** `npm run check:portability`, in `verify` and on all three CI legs. |
| The coverage gate and lint at zero warnings | **Checked**, and rule 4b governs what they may be cited as evidence *of*. |

---

## Consequences

### This will be slower, and that is the point

Not incidentally slower. **Structurally slower**, in ways worth naming so nobody is
surprised into abandoning the rule at the first deadline:

- **Review is now serial with merge, not parallel with the next change.** A branch
  waits. Throughput drops to roughly the rate one reviewer can read.
- **Rule 6 removes parallelism on purpose.** Two workstreams that would have touched
  one file now take turns.
- **Rule 5 adds a manual step to every user-visible change**, and today that step
  needs a harness that does not exist, so the first few changes under this rule pay
  to build one.
- **Rule 3 makes documentation part of the change**, so a change that moves a
  contract now carries edits to `README.md`, `DEVELOPER.md`, the manifest and an ADR
  amendment, and cannot be split to get the code in sooner.
- **Rules 2 and 9 add work at authorship** — running the command, pasting the
  output, finding the exact test title.
- **Rule 7 blocks a merge on filing an issue** that the author would rather have
  written down later, or not at all.

**Why that is the correct trade.** The velocity was never real. Every item in the
Context was produced by a fast wave and paid for by an audit round that cost more
than the review would have — plus a second change, a second review of that change,
and in item 4's case ten review rounds and roughly sixty corrected sentences.
Measured over the interval that contains both the writing and the fixing, reviewing
first is not slower. It only looks slower from inside the wave, because the wave is
where the borrowing happens and not where the bill arrives.

And the defects that velocity produced here were not cosmetic. A menu no user could
click. Eight accessibility blockers. A documented gate that was not the gate. Sixty
security sentences claiming more than the code delivered — the class of defect that
`SECURITY.md` names as a vulnerability in its own right, because a reader who trusts
an overclaimed sentence and ships against it is exposed by the sentence.

### What it buys

- **The suite's blind spots are named once, permanently, in a file every
  contributor and every AI session reads.** Item 1 cost a real-browser
  investigation to find; rule 4 means the next one is a review question.
- **A claim in this repository becomes worth something**, because the reader can
  ask which output or which test and always get an answer.
- **Documentation stops decaying**, because it can no longer be deferred to a
  sweep that may not happen.
- **The record of *why* survives**, so a reviewer three months from now does not
  re-derive the reasoning from a diff.

### What it costs beyond time

- **Contributor friction, including for the project owner.** These rules apply to
  everyone, and they are most irritating exactly when a change looks obviously
  correct. That is when they earn their place: every defect above was in code that
  looked obviously correct.
- **Some rules are unenforceable and can be quietly skipped.** Rules 1, 5 and 8 in
  particular. That is stated rather than papered over — this is the cost of the
  convention/gate split above, and the response to a skipped rule is review, not a
  new script that cannot decide it either.
- **A risk of ceremony.** Ten rules and a long template can become a form to fill
  in. The mitigation is that every rule cites a defect this project actually had; a
  rule that stops being able to do so should be deleted, and deleting it is
  legitimate.

### Reversibility

High for the mechanism, low for the intent. The template, `CLAUDE.md` and the
`CONTRIBUTING.md` section are text. Nothing in `src/` depends on any of it, and no
build step is added. Reversing the *decision*, though, means returning to the
Context, which is why the Context is written at the length it is.

### What this decision does not cover

- **It says nothing about security.** No claim in ADR-0001, in its amendments, or
  in the security posture section of `README.md` is changed, narrowed or widened by
  it. It generalises Amendment G's *discipline* to non-security claims; it does not
  touch Amendment G's *scope*.
- **It does not make any of items 1 through 6 untrue.** The false `README.md`
  sentence in item 5 is filed as GitHub issue #58, not fixed, by this change.
  `npm run dev` still renders an empty shell.
- **It did not build the browser lane, and no longer needs to.** That lane landed
  separately as `3ebf86d` while this decision was in review — see rule 5, which was
  rewritten when this branch merged `main` rather than left describing a repository
  that had moved. This ADR contributes the *rule*; `e2e/` is what makes the rule
  answerable.
- **It adds no automated check.** Rule 2's mechanical half was already `verify`'s;
  everything else here is decided by a human. A future issue may mechanise a clause,
  and until it does, no sentence in this repository may describe these rules as
  enforced.

---

## Alternatives considered

**Keep going fast and review after the wave — the status quo.** Rejected, and it is
the alternative with real evidence against it rather than a hypothetical one. It
was tried, at length, by a team with unusually strong code gates, and it produced:
a feature no user could reach under six passing tests; a test named for a gesture
it never performed; eight WCAG 2.2 AA blockers under a 100% coverage gate; roughly
sixty overclaiming security sentences across ten review rounds; a documented gate
that was not the gate; and an application nobody had ever run. The argument for it
is that review is a bottleneck and parallel work is faster. The measured result is
that the work still had to be reviewed, and reviewing it later cost a rewrite
instead of a comment. Its most expensive property is that the defects it produces
are *invisible while it is working* — every one of the six was found by someone
looking specifically for it, months after the code was green.

**Fix the tooling instead of the process.** Write more tests, sharpen the checkers,
add more CI legs. Rejected as insufficient rather than wrong. The tooling here is
already strong and none of it caught items 1, 2, 3 or 6, because a checker can only
refute what it can observe and the failures were outside every instrument's range.
Tooling should absolutely be improved where a clause is decidable — ADR-0002 is
that argument, and rule 2's mechanical half is the same argument — but "add a
checker" cannot answer "was this reviewed before it merged" or "has anyone run it".

**A written rule with no template.** Rejected. A principle nobody is prompted to
answer is a principle nobody answers, and this project has direct evidence: the
standing rules in `README.md` and `CONTRIBUTING.md` were in force through every
round in item 4. Turning each rule into a box a submitter must tick is what makes
the omission visible, and it is the difference between the two existing rule sets
and this one.

**Make every rule a gate, or drop it.** Rejected as the strongest-sounding option
and the one that would do the most damage. It would delete rules 1, 5, 6, 8 and 10
outright — the five that address the actual failure mode — because no script can
decide any of them. ADR-0002's "a build that does not fail is a rule nobody has to
follow" is true of clauses that *can* be decided mechanically, and it is not a
licence to discard the ones that cannot. The honest arrangement is the split table
above.

**Freeze feature work and audit everything first.** Rejected. It is the same
inversion in a different costume — a large audit wave, decoupled from authorship,
that leaves the next wave free to recreate the defects. It also stops the project.
The audits already run have produced the issue backlog; what was missing was
review at the point where a defect costs a comment.

**Adopt a heavier external process — sign-offs, staged environments, a QA gate.**
Rejected as disproportionate to a pre-alpha repository with a small number of
contributors, and as a poor fit for the actual failure mode. Every defect above was
a *content* defect that a careful reader would catch: a name that did not describe
the test, a sentence wider than its premise, a document that had stopped being
true. Process weight does not create careful readers, and this decision would be
worse if it competed with the reading for the contributor's attention.
