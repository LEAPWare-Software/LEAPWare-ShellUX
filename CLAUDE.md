# CLAUDE.md — working agreement for LEAPWare-ShellUX

Ops rules for anyone in this repo, human or AI. Why:
[`docs/adr/0003-quality-over-velocity.md`](docs/adr/0003-quality-over-velocity.md).
This file = what to *do*. Read ADR once. Then work from here.

**Quality first, no exception. Quality vs speed conflict → speed lose.** Every rule
below exist because absence cost this project something real. ADR name incident for each.

**Mission (D-31): best-in-class UI/UX shell hosting application plugins**, measured
against VS Code, Linear, Raycast, Outlook/Teams. Plan: `docs/plans/v1-production.md`.
**SDLC led by LEAPWare BuildCraft; v1.0.0 waits for it (D-39).** Convention until
then: `docs/sdlc.md`. Visual system: `DESIGN.md`. Decisions: `docs/DECISIONS.md`.

---

## The rules, in short

Numbered same as ADR-0003, so "rule 4b" mean same thing everywhere in repo.

1. **Adversarial review precedes merge.** Never after wave.
2. **Evidence, not assertion.** Pasted output, full test title, or stated
   measurement. Nothing else count.
3. **Documentation lands in the commit that makes it true.** Not sweep.
4. **A green suite is not evidence where the suite cannot observe the behaviour.**
   See "jsdom is blind" below — this one cost most.
4b. **Coverage is not verification.** 100% mean lines executed.
5. **Run it.** User-visible change not done until someone see it work in browser.
6. **Parallel work needs disjoint file ownership.** Two workstreams, one file → serialise.
7. **No "fix it later".** Fixed in change, or filed with evidence before merge.
8. **Say what you did NOT do.** Every change state limits.
9. **A tooling claim is measured, not recalled.** Name command you ran.
10. **Name the failure mode when you fix it.** Record why defect was possible,
    not only what fix was.

Full text, evidence for each, and which a script can decide → ADR-0003.
`.github/PULL_REQUEST_TEMPLATE.md` = same list as checkboxes.

---

## The gates

```bash
npm run verify
```

Runs, in order: `check:portability`, `check:citations`, **`tokens:check`**, `lint`,
`typecheck`, `test:coverage`, `test:integration`, `test:scripts`, `build`,
`audit:prod`. **Ten stages.** Must exit 0 end to end before PR opens, and **real
output** go in PR body.

Needs network, for audit advisory-database query.

**CI runs every stage of `verify`** (`ci.yml` on three OSes; `audit:prod` in
`audit-dependencies.yml`); `audit:all` audits the dev tree as its own job. Run `verify`
locally anyway: rule 2 wants real output in the PR body. History: `docs/traps.md`.

**Browser lane is fourth CI leg, deliberately NOT in `verify`.**

```bash
npm run test:browser:install   # once per machine — downloads Chromium
npm run test:browser
```

`.github/workflows/browser.yml` run it on Chromium on Ubuntu every PR.
Stays out of `verify` because Playwright need browser download that `npm ci` not
perform, and chaining it in would falsify acceptance test below. **Do not "fix"
that by editing acceptance test** — `CONTRIBUTING.md` spell out why that wrong end
of trade. This lane = how rule 5 get answered; see it for what belong there rather
than in Vitest suite.

Standing invariants, both at zero, both decision not number:

- **Zero inline suppressions.** No `eslint-disable`, no `v8 ignore`, no `c8 ignore`,
  no `istanbul ignore`, no `@ts-expect-error`. Exception go in config with written
  reason; `eslint.config.js` have worked example.
- **100% coverage over gated tree** — statements, branches, functions, lines.
  Do not lower threshold, do not narrow include list to route around untested
  branch. See rule 4b for what figure is *not* evidence of.

---

## jsdom is blind. This is the single most expensive fact in the repository

Suite run in jsdom. jsdom not paint. So cannot observe:

| What is invisible | Consequence |
|---|---|
| Layout | Nothing ever clipped by ancestor, nothing overflows, nothing occluded |
| `getBoundingClientRect` | Returns 0×0 unless test stubs it |
| Hit testing | Pointer never hit-tests; `document.elementFromPoint` not paint test |
| `PointerEvent` | Does not exist. `fireEvent.pointerMove` degrades to plain `Event`, no `clientX` |
| `ResizeObserver`, `IntersectionObserver` | Do not exist |
| `Element.prototype.scrollIntoView` | Does not exist |
| Colour, contrast, focus rings | Nothing painted, so none observable |

**Two worst defects in project were geometric, suite green through both.**

- Ribbon overflow menu shipped clipped to zero visible pixels, unclickable, under
  six tests that asserted it worked; all six passed vacuously. Phase 4 deleted the
  ribbon; the lesson and a reproduction in `e2e/` survive it.
- Case called "survives a collapse toggled while a divider drag is in flight" in
  `src/components/__tests__/ShellLayout.test.tsx` never start drag. Measured by name.
  *Tests:* `src/__tests__/IntegrationSuite.test.tsx` — "cannot be driven by a POINTER
  drag at all, because this jsdom implements no PointerEvent".

**So:** anything geometric, visual, focus-ordered or pointer-driven either verified
in real browser or carry honest "not verified in a browser" label. No third option.
Passing jsdom test not one — worse than no test, because it tell next reader question
was answered.

**`e2e/` is where first half get done.** Both defects above now reproduced there
against real layout pass, so geometric blind spot guarded not merely documented.
Put case there when it need measured pixels, real clipping, real pointer or real
reload; keep in Vitest suite when it only read DOM, where it run in second not minute.

Stubbing environment to make such test pass = stubbing instrument. Test that supply
own geometry do arithmetic over invented numbers and must say so in own name.

---

## Traps this repository has already paid for

Full text, evidence and citing tests: [`docs/traps.md`](docs/traps.md). Read it before
touching the area named.

- **`Object.freeze` does not stop `Set.add()`.** A frozen `Set` "cannot be replaced", never "cannot be changed".
- **GitHub's linking parser closes issues you said you were not closing.** Keep every closing keyword away from every issue reference, in PR bodies and commit messages.
- **`ISSUE-00N` and GitHub `#N` collide.** Make the scheme unambiguous; never invent a manifest id.
- **`check:citations` can resolve a citation vacuously.** Cite full test titles.
- **Stage a new file before `verify`.** `check:portability` reads the git index.
- **`--sequence.shuffle` proves one file order at one seed**, not order-independence.
- **`coverage/.tmp` ENOENT**: delete `coverage/` and re-run once.
- **`audit:prod` fails at random with a false lockfile message.** Re-run; never `npm install` on its word.
- **Use npm 11.16.0**, the declared `packageManager`. npm 10.9.8 `audit fix` crashed (`edgesOut` of null) on the lockfile before #126; not on today's. `docs/traps.md`.

---

## Vocabulary you must use precisely

Three words. Every security claim in repo placeable in exactly one. Getting this wrong
= failure mode that produced ADR-0001 Amendments E, F, G — roughly sixty overclaiming
sentences across ten review rounds, code sound every time.

| Term | Means |
|---|---|
| **integrity control** | Unconditional. Holds against any caller, however hostile. |
| **entry-point validation** | Real at the door it guards, and says nothing about other doors. |
| **guardrail** | Closes the documented route and makes the honest mistake loud. Enforces nothing against deliberate action. |

Words **not** available: *isolation*, *sandbox*, *confinement*, *private*,
*cannot be read by*, *structural* — except where ADR-0001 explicitly earn them.
Badge scoping and persisted-state namespacing are **collision-resistance, not
confinement**. There is **no boundary between two extensions** in this page; ADR-0001
Amendment E is binding statement, must be read before any sentence describing
extension separation is written.

**No security claim goes into a `.md` file or a docblock without naming the test
that exercises it** (ADR-0001 Amendment G). Three ways to satisfy, all acceptable:
name the test, narrow claim until existing test assert it, or delete claim. Deleting
= rule working.

Citation markers checker recognise: `*Tests:*`, `*Test:*`, `pinned by`.

---

## Also standing

1. **Do not assert unmeasured results.** Not benchmarked, audited or measured →
   label it target.
2. **Label aspiration as aspiration.** Reader must always tell what exists from what
   is planned.
3. **Nothing tracked may depend on one developer's machine** — ADR-0002, decided by
   `check:portability`. Acceptance test for every change: **fresh clone on different
   OS runs `npm ci && npm run verify` with no local setup and no edits.**
4. **The host owns zero business logic.** `src/core/**` have no import edge to any
   extension; adding one is review failure. ADR-0001.

---

## Where to read next

| Question | File |
|---|---|
| Why these rules, and the evidence for each | `docs/adr/0003-quality-over-velocity.md` |
| Why a registry IoC contract, and what it does *not* guarantee | `docs/adr/0001-ioc-registry-architecture.md` — Amendments **E**, **F**, **G** first |
| Contributor rules, portability rule ids, the browser lane; why nothing may depend on a laptop | `CONTRIBUTING.md`; `docs/adr/0002-no-local-environment-dependencies.md` |
| What a real browser asserts that jsdom cannot | `e2e/`, `playwright.config.ts` |
| Where the project stands and what is in flight | `HANDOFF.md` |
| The plan to 1.0, and what "best in class" is measured by | `docs/plans/v1-production.md` |
| What is decided and what is open | `docs/DECISIONS.md` |
| How work moves through stages, under BuildCraft | `docs/sdlc.md` |
| The visual system every UI change follows | `DESIGN.md` |
| Every trap in full, and two corrected surprises | `docs/traps.md` |
| Writing an extension | `src/examples/HelloExtension.tsx` first (the whole contract in ~100 lines), then `DEVELOPER.md`; not `src/mocks/` |
| The five-item work breakdown | `.github/ISSUES_MANIFEST.md` |
| What has actually been fixed, and what made each defect possible | `CHANGELOG.md` |
| Who this shell is for, what it must not look like, and what accessibility is committed to | `PRODUCT.md` |
| The redesign in words (gate 2), and the UI audit it started from (gate 1, unreviewed) | `docs/design/SHAPE-BRIEF.md`, `docs/design/REDESIGN-SPEC.md` |
