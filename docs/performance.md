# Performance Targets (unverified)

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links were corrected for this file's location.

**No benchmark has been run. Not one.** The figures below are the targets this
project is being designed toward. They are **goals, not measurements**, and
must not be quoted as characteristics of the software.

| Target | Status |
|---|---|
| Smooth scrolling of a 100,000-row list in Pane 2 at 60fps | Unverified — no benchmark has been run |
| Sub-millisecond layout recalculation on pane resize | Unverified — no benchmark has been run |
| Extension activation without a visible frame drop | Unverified — no benchmark has been run |
| Shell boot to interactive without a flash of default layout | Unverified — no benchmark has been run |

These numbers exist to tell implementers what "fast enough" is supposed to mean
and to give the eventual benchmark suite something to fail against. They are not
claims. When a benchmark harness exists and has been run on defined hardware
with a stated methodology, this section will be replaced with measured results
and the hardware they were measured on. Until then, every row above reads
"unverified" because every row above *is* unverified.

If you find any of these figures repeated elsewhere as a statement of fact,
that is a documentation bug — please report it.
