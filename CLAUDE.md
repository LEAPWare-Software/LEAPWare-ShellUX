# CLAUDE.md — working agreement for LEAPWare-ShellUX

Ops rules for anyone in this repo, human or AI. Why:
[`docs/adr/0003-quality-over-velocity.md`](docs/adr/0003-quality-over-velocity.md).
This file = what to *do*. Read ADR once. Then work from here.

**Quality first, no exception. Quality vs speed conflict → speed lose.** Every rule
below exist because absence cost this project something real. ADR name incident for each.

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

> **CORRECTED 2026-08-03, day this file merged.** Paragraph here said
> "**`verify` is NOT the same set CI runs, whatever `README.md` says**", and listed
> `check:citations`, `test:integration`, `test:scripts` as running on no leg.
> True when written, and got worse — `tokens:check` added to `verify`
> by native-host pivot, also no leg, so five of **ten**.
>
> **Fixed. CI now runs every stage of `verify`.** Matrix job in
> `.github/workflows/ci.yml` run first nine on three OSes; `audit:prod` run in
> `audit-dependencies.yml`. GitHub issue #58 tracked it, was closed as `COMPLETED`
> while nothing had closed it, now genuinely closed.
>
> **Run `verify` locally anyway — reason changed, not gone.**
> No longer "CI cannot catch this". Now: 12–13 min local failure cheaper than
> failed matrix leg, and rule 2 want real output in PR body, which only real run make.
>
> **Dev-tree gap CLOSED 2026-09-18.** `audit:prod` is still `--omit=dev`, but
> `npm run audit:all` now run as own job, "Audit all dependencies", in
> `audit-dependencies.yml`, and in scheduled audit, which also file an issue when
> it fail. Why it mattered: scheduled audit went red six Mondays running
> (2026-08-10 → 09-14, `js-yaml` high) and nobody saw it; dev tree held four more
> highs no check had ever shown. **Still true:** `audit:all` not a `verify` stage.

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
  six tests that asserted it worked. All six passed vacuously. **File that carried
  postmortem — `src/components/ui/RibbonToolbar.tsx` — gone: native-host pivot
  Phase 4 deleted ribbon, replaced with one command registry and four surfaces.**
  Lesson survive file, and is why this section exist; reproduction survive too, in
  `e2e/`, against real layout pass. Do not go looking for banner.
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

Do not rediscover these.

### `Object.freeze` does not stop `Set.add()`

Frozen `Set` keep its *properties*, not its *contents*. `Set` state live in internal
slots; `add`/`delete` are prototype methods on them, so freezing instance close
nothing. Claim frozen `Set` constant carry = "cannot be replaced", never "cannot be
changed", and **no prose about them may say otherwise**.
*Tests:* `src/core/__tests__/hostConstants.test.ts` — "does not claim more than a frozen Set delivers".

### GitHub's linking parser will close an issue you said you were not closing

PR body with "Explicitly **not** closed: #4, #10, ..." auto-closed issue #4 on merge.
GitHub matched fragment `closed: #4`; leading "not" is prose, parser not read prose.
Issue #4 reopened by hand.

**Keep every closing keyword — `close`, `closes`, `fix`, `fixes`, `resolve`,
`resolves`, `closed` — away from every issue reference**, both directions, in PR
bodies and commit messages. Write "still open: #4" or "deliberately untouched: #4".
Corrected body of PR #33 carry note recording mistake rather than erasing it.

### `ISSUE-00N` and GitHub `#N` are different numbering schemes and they collide

`.github/ISSUES_MANIFEST.md` define exactly five items, ISSUE-001 through ISSUE-005.
GitHub issue numbers unrelated and much higher. Two get conflated in conversation,
and **phantom `ISSUE-006` that no manifest section define is cited 31 times across
12 tracked files**. GitHub issue #53 track it.

When you write reference, make scheme unambiguous. Do not invent manifest id for
work that only have GitHub issue.

### `check:citations` can resolve a citation vacuously

`scripts/check-citations.mjs` read test titles out of AST, and for parameterised call
it compile title template to regex — each `${…}` hole or `%s`-style placeholder
become `.+?`, anchored `^…$`. Necessary so prose can cite filled-in form of `it.each`
title. Also mean **short or partial citation can match template it was never about**
and pass.

So cite **full** titles, or exact `describe` group. Checker own banner list what else
it not catch: cannot tell claim has no citation at all, not check cited title live in
cited file, cannot check test assert what sentence say.

### Stage a new file before you run `verify`

`check:portability` resolve import specifiers against **git index**, not working tree,
so first `verify` after you add source file and import it fail on `import-unresolved`
with target sitting right there on disk. Deliberate: untracked file not in clone.
Run `git add <path>` first.

### `--sequence.shuffle`: do not repeat the claim in the manifest

`.github/ISSUES_MANIFEST.md` say `src/core/__tests__/shellApi.test.ts` fail three of
its own cases under `--sequence.shuffle`. **It does not**, at `edc29db`: file alone
passed 109 of 109 under `--sequence.shuffle`, passed 109 of 109 under
`--sequence.shuffle.tests=true --sequence.seed=1234`, and whole suite under
`--sequence.shuffle` at seed `1785592035416` passed 1079 of 1079 across all 31 files.

Do not turn that into "suite is order-independent" either. `--sequence.shuffle`
reorder *files*, so what measured is one file order at one seed. Manifest conclusion
lost its evidence; nothing replaced it. See ADR-0003, "What could not be evidenced",
including environment mistake that nearly turned this into false finding in opposite
direction.

### `coverage/.tmp` ENOENT

If `test:coverage` fail with ENOENT under `coverage/.tmp`, delete gitignored
`coverage/` directory and re-run once. Stale state, not defect in change. Recorded as
operational advice from previous session, not measurement — did not occur in `verify`
run behind this file, so if you hit it, note invocation, per rule 9.

**NOW MEASURED, 2026-08-04.** It reproduced on `npm run verify` at `af6fdd9`'s tree.
`rm -rf coverage` and one re-run cleared it. Advice was right; it is no longer only
advice.

### `audit:prod` fail at random, and its error message blame your lockfile falsely

Stage ten of `verify` is `npm audit --omit=dev --audit-level=high`, and it query
npmjs.org, so it is only stage that need network. **Measured 2026-08-04, 13
invocations in ~15 minutes: 9 pass, 4 fail.** Two distinct failures, alternating:

```
npm warn audit 400 Bad Request - POST
  https://registry.npmjs.org/-/npm/v1/security/audits/quick
{ statusCode: 400, error: 'Bad Request',
  message: 'Invalid package tree, run  npm install  to rebuild your package-lock.json' }
```

```
npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/audits/quick
  failed, reason: read ECONNRESET
```

**The 400's message name local cause it did not have.** `npm ls --omit=dev --depth=0`
exit 0 on same tree, in same minute, listing all 11 production deps resolved;
`package.json` and `package-lock.json` untouched since `7fc8fbc`. **Do NOT run
`npm install` on strength of that sentence** — it will rewrite lockfile to fix
nothing. Endpoint also print `This endpoint is being retired`, which is likelier
cause than anything in this repo.

Re-run. It pass. **What this does NOT license:** treating any `verify` failure as
flake. This one is one stage, network-only, two known messages, and measured. A
failure anywhere in first nine stages is your change until proven otherwise.

Not filed as issue: a flaky third-party endpoint is not defect in this repository,
and there is nothing here to fix. If it become permanent, `audit:prod` is only gate
that need network and `HANDOFF.md` §6.2 already carry what it does and does not
audit.

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
| Why nothing tracked may depend on a laptop | `docs/adr/0002-no-local-environment-dependencies.md` |
| The rules for contributors, the portability rule ids, and the browser lane | `CONTRIBUTING.md` |
| What a real browser asserts that jsdom cannot | `e2e/`, `playwright.config.ts` |
| Where the project stands and what is in flight | `HANDOFF.md` |
| Writing an extension | `DEVELOPER.md` |
| The five-item work breakdown | `.github/ISSUES_MANIFEST.md` |
| What has actually been fixed, and what made each defect possible | `CHANGELOG.md` |
| Who this shell is for, what it must not look like, and what accessibility is committed to | `PRODUCT.md` |
| What the redesign is, in words, before any pixel exists | `docs/design/SHAPE-BRIEF.md` |
| The audit of the current UI that the redesign started from — an input, unreviewed | `docs/design/REDESIGN-SPEC.md` |

---

## Two things that will surprise you

> **Both true when written, BOTH NOW FALSE. Corrected 2026-08-03, day this file
> merged, rather than left for sweep — rule 3.**

- ~~**`npm run dev` renders an empty shell.**~~ **Fixed 2026-08-02.**
  `vite.config.ts` install `configureServer` middleware rewriting `/` to `dev.html`,
  so `npm run dev` open shell with both verification remotes in `src/mocks/`
  registered. `/index.html` still serve empty-registry production shell **by name**,
  and `src/App.tsx` still register nothing — that part never was defect. `dist/` is
  SHA-256 identical before and after change, measured on all three artifacts.
- ~~**No human has signed off on the running application.**~~ **#39 is CLOSED.**
  Native Electron window launched and screenshotted in Phase 1 (`673d75d`), and
  packaged app probed over CDP: read its baked `app-update.yml`, contacted feed,
  reported failure in own command palette. **Read that narrowly** — person has now
  seen app run, which is what #39 asked. Not usability review, and no assistive
  technology ever pointed at it (#60, still open).

**Where to start instead, if you here to write extension:**
`src/examples/HelloExtension.tsx` — whole contract in ~100 lines, registered and
driven by own test. Two modules under `src/mocks/` are verification remotes, ~1,000
lines each, wrong thing to read first.

Neither correction delivered by ADR-0003. Stated so no one read rule 5 as describing
more than it does — and so this file not do thing #90 was filed about: describe
shipped code as unbuilt.