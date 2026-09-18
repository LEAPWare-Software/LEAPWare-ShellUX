# Testing and coverage

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links were corrected for this file's location.

Tests run under Vitest, in jsdom — with one lane that does not, described below.

Coverage is enforced as a **build gate**, not reported as an achievement, and
the gate is checkable rather than aspirational: `.github/workflows/ci.yml` runs
`npm run test:coverage` on every push to `main` and every pull request, and
Vitest exits non-zero when a threshold set in `vitest.config.ts` is unmet, which
fails the job. The threshold applies **per module, as each module lands** — a
module cannot merge below the gate, and modules that do not exist yet are not
counted for or against anything.

There is deliberately no coverage percentage in this README and no coverage
badge. A project-wide figure would be meaningless while most of the project is
unwritten, and a badge would imply a verified state that does not exist. When
there is a meaningful, measured, project-wide figure produced by CI, it will be
reported with the date and commit it was measured at.

## The browser test lane, and what coverage does not tell you

**A 100% coverage gate over code that is never laid out is a weaker statement
than it sounds.** jsdom has no layout engine: every `getBoundingClientRect`
answers 0×0, no ancestor clips anything, and no pointer ever hit-tests. Two of
the worst defects this project has had were geometric, and the suite was green
through both — the context bar's overflow menu **clipped to zero visible pixels** by
two `overflow-hidden` ancestors while six tests asserted it worked, and a case
named for surviving "a divider drag in flight" that **never started a drag**,
because a 0×0 rect cannot intersect a 12px hit area. Both lines of code were
covered. Neither behaviour was.

`e2e/` closes that gap with Playwright against a real Chromium: measured pixels,
real ancestor clipping, `elementFromPoint`, a real pointer drag, a real reload
and real keyboard focus. It is run with `npm run test:browser`, after a one-time
`npm run test:browser:install`, and
[`.github/workflows/browser.yml`](../.github/workflows/browser.yml) runs it on every
pull request and every push to `main`.

**It is not part of `npm run verify`, on purpose.** Playwright needs a browser
download that `npm ci` does not perform and `package-lock.json` does not pin —
which is precisely the "local setup" the acceptance test above rules out. So the
lane gets its own script and its own workflow, and the `npm ci && npm run verify`
promise stays true exactly as written rather than being softened to accommodate a
test. The cost of that choice is stated rather than hidden: a fresh clone runs
`verify` and gets no browser coverage until it runs the install step, and CI is
where the lane is guaranteed to have run.

The two defects above each have a regression case, and both were confirmed to
fail when the fix is reverted rather than merely to pass while it is present.
