<!--
This checklist is not generic. Every item below is here because this repository
has been bitten by its absence at least once. docs/adr/0003-quality-over-velocity.md
names the incident behind each rule; CONTRIBUTING.md and ADR-0001 Amendment G are
the long form of the rest.

Do not delete a section. If one does not apply, write why it does not apply —
"not applicable" with a reason is an answer, a deleted heading is not.

Do NOT put a closing keyword (close/closes/fix/fixes/resolve/resolves/closed)
next to an issue reference unless you mean it. That has already happened here: a
sentence beginning "Explicitly **not** closed:" and continuing straight into an
issue number auto-shut that issue on merge, because the parser reads the keyword
and the number and does not read the "not". Write "still open: <number>" or
"deliberately untouched: <number>" instead. CLAUDE.md records the incident.

This warning deliberately does not reproduce the offending fragment, because
this template is pasted verbatim into every pull request body and would then be
the bug rather than the warning.
-->

## What changed, and why

<!--
The why, not the diff. A reviewer can read the diff. What they cannot read is
the alternative you rejected, the constraint that forced the shape, or the
defect this closes. If this fixes something, say what the defect actually was,
how it was reproduced, and — rule 10 — what made it possible in the first place.
-->

## Review happened before this merged

Rule 1. Adversarial review precedes merge; it never follows it. Review after the
wave is what produced every defect listed in ADR-0003's Context.

- [ ] This branch is up for review **before** merge, and no part of it has already
      landed on `main` pending a later look.
- [ ] The change is scoped so a reviewer can actually read it. If it is large, the
      reason it could not be split is stated above.

## Review

<!--
The review record, for the head SHA it reviewed. Any push or rebase makes
"Reviewed SHA:" stale; the PR evidence check then fails until the record is
updated for the new head. Write the full 40-character SHA.

Rows reviewed: every register row (docs/claims.json) this change adds, changes, or
cites from a ticked plan item, by id (C-nn), or "none".
Items removed or reworded: each plan item this change removes or rewords, as
<file>:<line on the base branch>. The Prove claims log lists them.
Gate changes: every changed file under scripts/claims/, a change to the schema of
docs/claims.json, claims.yml, pr-evidence.yml, or .github/rulesets/. "none" if none.

"Done" has one recording form: a ticked item in docs/plans/** that cites a passing
register row. Prose (HANDOFF, CHANGELOG, this body) may point to an item; it does not
declare one done. docs/proof-of-completion.md is the protocol.
-->

Reviewer:
Reviewed SHA:
Verdict:
Rows reviewed:
Items removed or reworded:
Gate changes:

## Evidence

`npm run verify`, run locally. Paste the real output. Not a summary of it, not "all
green", not a screenshot of part of it. `verify` runs, in order: the portability
check, the citation check, the token and contrast checks, lint at zero warnings,
typecheck, the suite with the coverage gate, the randomised integration run, the
script tests, the build, and a production-dependency audit.

Capture the exit code directly, never through a pipe
(`npm run verify > verify.log 2>&1; echo VERIFY_EXIT=$?`), and put the line it prints
here on a line of its own. The `PR evidence` check fails without a `VERIFY_EXIT=0`
line in this section.

CI runs every stage of `verify`, across two workflows: `ci.yml` runs all but the audit
on three operating systems; the production audit runs in `audit-dependencies.yml` when
`package.json` or the lockfile changes, and weekly in `audit-schedule.yml`. The paste
still matters: it is the run on the tree you are asking a reviewer to read, and the
only audit a change that leaves the dependency files alone gets before merge.

The browser lane is a separate workflow and is deliberately outside `verify`; if
your change is geometric or visual, the section below is where it gets answered.

```text
paste the output here
```

- [ ] `npm run verify` exited 0 end to end, and its complete output is pasted above.
- [ ] If any check was skipped or could not run here, that is stated with the reason
      and with what is therefore unverified.

## Evidence for every claim this change makes

Rule 2. "Passing", "covered", "verified", "secure" and "fast" are worth nothing on
their own.

- [ ] Every sentence this change adds that claims a property points at pasted
      output, a **full** test title after a citation marker, or a stated
      measurement with its method.
- [ ] Every security sentence added or edited names the test asserting it
      (ADR-0001 Amendment G). Naming the test, narrowing the claim, or deleting it
      are all acceptable — deleting it is the rule working.
- [ ] No citation was made to resolve by widening the checker, and none was
      loosened to make prose pass. If a cited title moved, the citation moved with
      it. Citations quote **full** titles: `check:citations` compiles `it.each`
      templates to regexes, so a short citation can resolve vacuously.
- [ ] Every new security claim is placeable in one of the three words: **integrity
      control** (unconditional), **entry-point validation** (real at the door),
      **guardrail** (honest mistakes only).
- [ ] Rule 9 — every claim this change makes about what a command, flag, library
      or browser does names the invocation that demonstrated it, run against this
      tree.

## Was it observed, and by what?

Rules 4, 4b and 5. jsdom has no layout engine, no hit testing, no `PointerEvent`,
no `ResizeObserver`, no `scrollIntoView`, and `getBoundingClientRect` returns 0×0
unless a test stubs it. A ribbon menu once shipped clipped to zero pixels under six
passing tests, and a test named for a divider drag never started one.

Answer both. "No user-visible change" is a complete answer to the first.

- [ ] This change touches nothing geometric, visual, focus-ordered or
      pointer-driven — **or** the behaviour was seen working in a real browser, and
      what was seen, how it was reached, and at what viewport is described above.
- [ ] If it is geometric or visual, `e2e/` covers it and `npm run test:browser`
      passed, **or** the reason a case could not be written there is stated. A
      Playwright case that only reads the DOM belongs in the Vitest suite instead.
- [ ] Nothing here is labelled done on the strength of a jsdom test that cannot
      observe the behaviour it is named for. Anything unverified in a browser is
      labelled as unverified rather than as covered.
- [ ] No test in this change stubs the environment in order to pass. Where a test
      supplies its own geometry, its name says so.
- [ ] Rule 4b — no coverage figure is offered anywhere as evidence that a behaviour
      works.

## Coverage and suppressions

- [ ] Coverage is still 100% on statements, branches, functions and lines over the
      gated tree. The threshold was not lowered and the include list was not
      narrowed to route around an untested branch.
- [ ] No inline suppression was added — no `eslint-disable`, no `v8 ignore`, no
      `c8 ignore`, no `istanbul ignore`, no `@ts-expect-error`. This repository is
      at zero and a change that raises it is a change to a decision.

## Documentation landed with the change

Rule 3. Not a follow-up, not a sweep. A sweep is how roughly sixty overclaiming
sentences accumulated here.

- [ ] Every document this change falsifies is corrected **in this change** —
      `README.md`, `DEVELOPER.md`, `CLAUDE.md`, `.github/ISSUES_MANIFEST.md`,
      `CHANGELOG.md` and the relevant ADR — or the reason a given one was left is
      stated above.
- [ ] If the extension contract moved, an ADR amendment records the decision, not
      just the code.
- [ ] Nothing here asserts an unmeasured result, and anything aspirational is
      labelled as aspiration.

## Not done

What this deliberately does NOT build, and what is NOT covered. The `PR evidence`
check fails if this section is empty.

<!--
Rule 8, and required. State plainly what a reader might reasonably assume this
change delivers and it does not: the adjacent feature left unbuilt, the branch
that is exercised but not asserted, the guarantee that holds in production and is
untested in jsdom, the path that is defence-in-depth with no reachable failure.
A reader who finds an unstated gap later reads every other sentence here
differently.
-->

## Limits this change introduces or reveals

<!--
Different question from the one above. Not "what did I leave out" but "what is
now true that was not, and what did building this teach us about a limit that
was already there". A performance figure you did not measure, an assumption that
holds only at mount, an ordering that is reasoned about and not asserted by any
test, a contract that is now harder to change because someone may ship against
it.
-->

## Known defects: fixed here, or filed with evidence

Rule 7. Those are the only two options — including for defects this change merely
revealed nearby.

- [ ] Every defect discovered while writing this is either closed by this diff or
      carries an issue reference with a reproduction, a file and a line.
- [ ] Nothing is deferred to "a later sweep".

<!--
List them here. Two shapes, and mind the warning at the top of this file:

  handled in this diff — <what it was, and what made it possible>
  still open: #N — <what it is, and where the evidence is>

Only write a closing keyword next to a number when you actually intend that
issue to shut on merge.
-->

## Parallel work

Rule 6. Concurrent work on one tree has already made `verify` unrunnable here once
and overtaken an open issue's premise once — see ADR-0003 rule 6 for both.

- [ ] No other branch in flight writes any file this branch writes — **or** the
      serialisation order was agreed and is stated above.
