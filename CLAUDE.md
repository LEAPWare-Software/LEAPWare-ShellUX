# CLAUDE.md — working agreement for LEAPWare-ShellUX

Operational instructions for anyone working in this repository, human or AI. The
reasoning behind all of it is
[`docs/adr/0003-quality-over-velocity.md`](docs/adr/0003-quality-over-velocity.md);
this file is what to *do*. Read that ADR once. Then work from this page.

**Quality is the first priority, without exception. Where quality and speed
conflict, speed loses.** Every rule below exists because its absence cost this
project something real, and the ADR names the incident for each one.

---

## The rules, in short

Numbered exactly as ADR-0003 numbers them, so a reference to "rule 4b" means the
same thing everywhere in this repository.

1. **Adversarial review precedes merge.** Never after the wave.
2. **Evidence, not assertion.** Pasted output, a full test title, or a stated
   measurement. Nothing else counts.
3. **Documentation lands in the commit that makes it true.** Not a sweep.
4. **A green suite is not evidence where the suite cannot observe the behaviour.**
   See "jsdom is blind" below — this is the one that has cost the most.
4b. **Coverage is not verification.** 100% means the lines executed.
5. **Run it.** A user-visible change is not done until someone has seen it work in
   a browser.
6. **Parallel work needs disjoint file ownership.** Two workstreams on one file
   serialise.
7. **No "fix it later".** Fixed in the change, or filed with evidence before it
   merges.
8. **Say what you did NOT do.** Every change states its limits.
9. **A tooling claim is measured, not recalled.** Name the command you ran.
10. **Name the failure mode when you fix it.** Record why the defect was possible,
    not only what the fix was.

The full text, the evidence for each, and which of them a script can decide are in
ADR-0003. `.github/PULL_REQUEST_TEMPLATE.md` is the same list as checkboxes.

---

## The gates

```bash
npm run verify
```

Runs, in order: `check:portability`, `check:citations`, **`tokens:check`**, `lint`,
`typecheck`, `test:coverage`, `test:integration`, `test:scripts`, `build`,
`audit:prod`. **Ten stages.** It must exit 0 end to end before a pull request opens,
and its **real output** goes in the pull request body.

It needs the network, for the audit's advisory-database query.

> **CORRECTED 2026-08-03, on the day this file merged.** The paragraph here said
> "**`verify` is NOT the same set CI runs, whatever `README.md` says**", and listed
> `check:citations`, `test:integration` and `test:scripts` as executing on no leg.
> That was true when written and had got worse — `tokens:check` was added to `verify`
> by the native-host pivot, also with no leg, so it was five of **ten**.
>
> **It is fixed. CI now runs every stage of `verify`.** The matrix job in
> `.github/workflows/ci.yml` runs the first nine on three operating systems and
> `audit:prod` runs in `audit-dependencies.yml`. GitHub issue #58 tracked it, was
> closed as `COMPLETED` while nothing had closed it, and is genuinely closed now.
>
> **Run `verify` locally anyway, and the reason has changed rather than gone away.**
> It is no longer "CI cannot catch this". It is that a 12–13 minute local failure is
> cheaper than a failed matrix leg, and that rule 2 asks for real output in the pull
> request body, which only a real run produces.
>
> **One narrower gap survives and is NOT #58's:** `audit:prod` is
> `npm audit --omit=dev`, so **the dev tree is audited by nothing on any leg**. That
> is the mechanism that made two CVSS 9.8 criticals in `vitest` structurally
> invisible to CI. `HANDOFF.md` §6.2 carries it.

**The browser lane is a fourth CI leg and is deliberately NOT in `verify`.**

```bash
npm run test:browser:install   # once per machine — downloads Chromium
npm run test:browser
```

`.github/workflows/browser.yml` runs it on Chromium on Ubuntu for every pull
request. It stays out of `verify` because Playwright needs a browser download that
`npm ci` does not perform, and chaining it in would falsify the acceptance test
below. **Do not "fix" that by editing the acceptance test** — `CONTRIBUTING.md`
spells out why that is the wrong end of the trade. This lane is how rule 5 gets
answered; see it for what belongs there rather than in the Vitest suite.

Standing invariants, both currently at zero, both a decision rather than a number:

- **Zero inline suppressions.** No `eslint-disable`, no `v8 ignore`, no `c8 ignore`,
  no `istanbul ignore`, no `@ts-expect-error`. An exception goes in configuration
  with a written reason; `eslint.config.js` has a worked example.
- **100% coverage over the gated tree** — statements, branches, functions, lines.
  Do not lower the threshold and do not narrow the include list to route around an
  untested branch. And see rule 4b for what the figure is *not* evidence of.

---

## jsdom is blind. This is the single most expensive fact in the repository

The suite runs in jsdom. jsdom does not paint. It therefore cannot observe:

| What is invisible | Consequence |
|---|---|
| Layout | Nothing is ever clipped by an ancestor, nothing overflows, nothing is occluded |
| `getBoundingClientRect` | Returns 0×0 unless a test stubs it |
| Hit testing | A pointer never hit-tests; `document.elementFromPoint` is not a paint test |
| `PointerEvent` | Does not exist. `fireEvent.pointerMove` degrades to a plain `Event` with no `clientX` |
| `ResizeObserver`, `IntersectionObserver` | Do not exist |
| `Element.prototype.scrollIntoView` | Does not exist |
| Colour, contrast, focus rings | Nothing is painted, so none of it is observable |

**Two of this project's worst defects were geometric and the suite was green
through both.**

- The ribbon overflow menu shipped clipped to zero visible pixels and unclickable,
  under six tests that asserted it worked. All six passed vacuously. **The file that
  carried the postmortem — `src/components/ui/RibbonToolbar.tsx` — no longer exists:
  the native-host pivot's Phase 4 deleted the ribbon and replaced it with one command
  registry and four surfaces.** The lesson survives the file and is the reason this
  section exists; the reproduction survives too, in `e2e/`, against a real layout
  pass. Do not go looking for the banner.
- A case called "survives a collapse toggled while a divider drag is in flight" in
  `src/components/__tests__/ShellLayout.test.tsx` never starts a drag. That is
  measured by name. *Tests:* `src/__tests__/IntegrationSuite.test.tsx` — "cannot be
  driven by a POINTER drag at all, because this jsdom implements no PointerEvent".

**So:** anything geometric, visual, focus-ordered or pointer-driven is either
verified in a real browser or carries an honest "not verified in a browser" label.
There is no third option, and a passing jsdom test is not one — it is worse than no
test, because it tells the next reader the question was answered.

**`e2e/` is where the first half of that gets done.** Both defects above are now
reproduced there against a real layout pass, so the geometric blind spot is guarded
rather than merely documented. Put a case there when it needs measured pixels, real
clipping, a real pointer or a real reload; keep it in the Vitest suite when it only
reads the DOM, where it runs in a second instead of a minute.

Stubbing the environment to make such a test pass is stubbing the instrument. A
test that supplies its own geometry is doing arithmetic over invented numbers and
must say so in its own name.

---

## Traps this repository has already paid for

Do not rediscover these.

### `Object.freeze` does not stop `Set.add()`

A frozen `Set` keeps its *properties*, not its *contents*. `Set` state lives in
internal slots and `add`/`delete` are prototype methods operating on them, so
freezing the instance closes nothing. The claim a frozen `Set` constant carries is
"cannot be replaced", never "cannot be changed", and **no prose about them may say
otherwise**. *Tests:* `src/core/__tests__/hostConstants.test.ts` — "does not claim
more than a frozen Set delivers".

### GitHub's linking parser will close an issue you said you were not closing

A pull request body containing "Explicitly **not** closed: #4, #10, ..." auto-closed
issue #4 on merge. GitHub matched the fragment `closed: #4`; the leading "not" is
prose and the parser does not read prose. #4 had to be reopened by hand.

**Keep every closing keyword — `close`, `closes`, `fix`, `fixes`, `resolve`,
`resolves`, `closed` — away from every issue reference**, in both directions, in
pull request bodies and commit messages. Write "still open: #4" or "deliberately
untouched: #4" instead. The corrected body of PR #33 carries a note recording the
mistake rather than erasing it.

### `ISSUE-00N` and GitHub `#N` are different numbering schemes and they collide

`.github/ISSUES_MANIFEST.md` defines exactly five items, ISSUE-001 through
ISSUE-005. GitHub issue numbers are unrelated and much higher. The two get
conflated in conversation, and a **phantom `ISSUE-006` that no manifest section
defines is cited 31 times across 12 tracked files**. GitHub issue #53 tracks it.

When you write a reference, make the scheme unambiguous, and do not invent a
manifest id for work that only has a GitHub issue.

### `check:citations` can resolve a citation vacuously

`scripts/check-citations.mjs` reads test titles out of the AST, and for a
parameterised call it compiles the title template to a regular expression — each
`${…}` hole or `%s`-style placeholder becomes `.+?`, anchored `^…$`. That is
necessary so prose can cite the filled-in form of an `it.each` title. It also means
**a short or partial citation can match a template it was never about** and pass.

So cite **full** titles, or an exact `describe` group. The checker's own banner
lists what else it does not catch: it cannot tell that a claim has no citation at
all, it does not check that the cited title lives in the cited file, and it cannot
check that the test asserts what the sentence says.

### Stage a new file before you run `verify`

`check:portability` resolves import specifiers against the **git index**, not the
working tree, so the first `verify` after you add a source file and import it fails
on `import-unresolved` with the target sitting right there on disk. This is
deliberate: an untracked file is not in a clone. Run `git add <path>` first.

### `--sequence.shuffle`: do not repeat the claim in the manifest

`.github/ISSUES_MANIFEST.md` says `src/core/__tests__/shellApi.test.ts` fails three
of its own cases under `--sequence.shuffle`. **It does not**, at `edc29db`: the file
alone passed 109 of 109 under `--sequence.shuffle`, passed 109 of 109 under
`--sequence.shuffle.tests=true --sequence.seed=1234`, and the whole suite under
`--sequence.shuffle` at seed `1785592035416` passed 1079 of 1079 across all 31
files.

Do not turn that into "the suite is order-independent" either. `--sequence.shuffle`
reorders *files*, so what is measured is one file order at one seed. The manifest's
conclusion has lost its evidence; nothing has replaced it. See ADR-0003, "What could
not be evidenced", including the environment mistake that nearly turned this into a
false finding in the opposite direction.

### `coverage/.tmp` ENOENT

If `test:coverage` fails with an ENOENT under `coverage/.tmp`, delete the
gitignored `coverage/` directory and re-run once. It is stale state, not a defect
in the change. Recorded as operational advice from a previous session rather than
as a measurement — it did not occur in the `verify` run behind this file, so if you
hit it, note the invocation, per rule 9.

---

## Vocabulary you must use precisely

Three words, and every security claim in this repository is placeable in exactly
one of them. Getting this wrong is the failure mode that produced ADR-0001
Amendments E, F and G — roughly sixty overclaiming sentences across ten review
rounds, with the code sound every time.

| Term | Means |
|---|---|
| **integrity control** | Unconditional. Holds against any caller, however hostile. |
| **entry-point validation** | Real at the door it guards, and says nothing about other doors. |
| **guardrail** | Closes the documented route and makes the honest mistake loud. Enforces nothing against deliberate action. |

Words that are **not** available: *isolation*, *sandbox*, *confinement*,
*private*, *cannot be read by*, *structural* — except where ADR-0001 explicitly
earns them. Badge scoping and persisted-state namespacing are
**collision-resistance, not confinement**. There is **no boundary between two
extensions** in this page; ADR-0001 Amendment E is the binding statement and must
be read before any sentence describing extension separation is written.

**No security claim goes into a `.md` file or a docblock without naming the test
that exercises it** (ADR-0001 Amendment G). Three ways to satisfy it, all three
acceptable: name the test, narrow the claim until an existing test asserts it, or
delete the claim. Deleting it is the rule working.

Citation markers the checker recognises: `*Tests:*`, `*Test:*`, and `pinned by`.

---

## Also standing

1. **Do not assert unmeasured results.** Not benchmarked, audited or measured means
   labelled a target.
2. **Label aspiration as aspiration.** A reader must always be able to tell what
   exists from what is planned.
3. **Nothing tracked may depend on one developer's machine** — ADR-0002, decided by
   `check:portability`. The acceptance test for every change is that **a fresh clone
   on a different operating system runs `npm ci && npm run verify` with no local
   setup and no edits.**
4. **The host owns zero business logic.** `src/core/**` has no import edge to any
   extension and adding one is a review failure. ADR-0001.

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

> **Both of these were true when written and BOTH ARE NOW FALSE. Corrected
> 2026-08-03, the day this file merged, rather than left for a sweep — rule 3.**

- ~~**`npm run dev` renders an empty shell.**~~ **Fixed 2026-08-02.**
  `vite.config.ts` installs a `configureServer` middleware rewriting `/` to
  `dev.html`, so `npm run dev` opens the shell with both verification remotes in
  `src/mocks/` registered. `/index.html` still serves the empty-registry production
  shell **by name**, and `src/App.tsx` still registers nothing — that part was never
  the defect. `dist/` is SHA-256 identical before and after the change, measured on
  all three artifacts.
- ~~**No human has signed off on the running application.**~~ **#39 is CLOSED.** A
  native Electron window was launched and screenshotted in Phase 1 (`673d75d`), and
  the packaged application was probed over CDP: it read its baked `app-update.yml`,
  contacted the feed and reported the failure in its own command palette. **Read that
  narrowly** — a person has now seen the application run, which is what #39 asked. It
  is not a usability review, and no assistive technology has ever been pointed at it
  (#60, still open).

**Where to start instead, if you are here to write an extension:**
`src/examples/HelloExtension.tsx` — the whole contract in about a hundred lines,
registered and driven by its own test. The two modules under `src/mocks/` are
verification remotes, ~1,000 lines each, and are the wrong thing to read first.

Neither correction is delivered by ADR-0003. They are stated so that no one reads
rule 5 as describing more than it does — and so that this file does not do the thing
#90 was filed about, which is describe shipped code as unbuilt.
