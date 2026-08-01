<!--
This checklist is not generic. Every item below is here because this repository
has been bitten by its absence at least once; CONTRIBUTING.md and ADR-0001
Amendment G are the long form of why.

Do not delete a section. If one does not apply, write why it does not apply —
"not applicable" with a reason is an answer, a deleted heading is not.
-->

## What changed, and why

<!--
The why, not the diff. A reviewer can read the diff. What they cannot read is
the alternative you rejected, the constraint that forced the shape, or the
defect this closes. If this fixes something, say what the defect actually was
and how it was reproduced.
-->

## `npm run verify`, run locally

Paste the real output. Not a summary of it, not "all green", not a screenshot of
part of it. `verify` runs, in order: the portability check, the citation check,
lint at zero warnings, typecheck, the suite with the coverage gate, the
integration suite, the script tests, the build, and a production-dependency
audit. CI should confirm what you already know rather than tell you something
new.

```text
paste the output here
```

- [ ] `npm run verify` passed locally, and its output is pasted above.
- [ ] If any check was skipped or could not run here, that is stated with the reason.

## Security claims name their tests

ADR-0001 Amendment G: **no security claim may stand in a `.md` file or a docblock
unless it names the test that exercises it.** Three ways to satisfy it, all three
acceptable — name the test, narrow the claim until an existing test asserts it,
or delete the claim. Deleting it is the rule working, not a failure.

`npm run check:citations` is now a gate on the second half of that rule: a
citation that names a test which has been renamed, split or deleted fails the
build. It cannot tell that a claim carries no citation at all — that half is
still review's job, and it is this checkbox.

- [ ] Every security sentence this change adds or edits names the test asserting it.
- [ ] No citation was made to resolve by widening the checker, and none was
      loosened to make prose pass. If a cited title moved, the citation moved with it.
- [ ] Every new claim is placeable in one of the three words: **integrity control**
      (unconditional), **entry-point validation** (real at the door), **guardrail**
      (honest mistakes only).

## Coverage

- [ ] Coverage is still 100% on statements, branches, functions and lines over the
      gated tree. The threshold was not lowered and the include list was not
      narrowed to route around an untested branch.
- [ ] No inline suppression was added — no `eslint-disable`, no `v8 ignore`, no
      `c8 ignore`, no `istanbul ignore`, no `@ts-expect-error`. This repository is
      at zero and a change that raises it is a change to a decision.

## What this deliberately does NOT build, and what is NOT covered

<!--
Required, and the most valuable section in this template. State plainly what a
reader might reasonably assume this change delivers and it does not: the
adjacent feature left unbuilt, the branch that is exercised but not asserted,
the guarantee that holds in production and is untested in jsdom, the path that
is defence-in-depth with no reachable failure. A reader who finds an unstated
gap later reads every other sentence here differently.
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

## Documentation

- [ ] `README.md`, `DEVELOPER.md`, the issue manifest and the relevant ADR are
      consistent with this change, or the inconsistency is named above.
- [ ] If the extension contract moved, an ADR amendment records the decision —
      not just the code.
- [ ] Nothing here asserts an unmeasured result, and anything aspirational is
      labelled as aspiration.
