# Contributing to LEAPWare-ShellUX

The project is pre-alpha and the core contract is still being written. The most
useful contribution right now is review of the specification in
[`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) and of the architecture
decision in [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md).

Setup instructions are in [README.md](README.md#getting-started). This document is
the rules.

---

## The working agreement: quality first, without exception

**Quality is the first priority. Where quality and speed conflict, speed loses,
and that trade is not re-argued per change.**

This is not a values statement. It is ten rules, each written so that a reviewer
can decide it by looking at the change — you either did this or you did not. The
argument for them, the incident behind each one, and the honest table of which are
machine-checked and which are convention are all in
[`docs/adr/0003-quality-over-velocity.md`](docs/adr/0003-quality-over-velocity.md).
Read it once; it is not repeated here.

1. **Adversarial review precedes merge, never follows it.** Your change is reviewed
   against the change, before it lands — not after a wave, not by a later audit
   round opening issues against merged code.
2. **Evidence, not assertion.** "Passing", "covered", "verified", "secure" and
   "fast" are worth nothing alone. Each arrives with pasted output, the **full**
   title of a named test, or a stated measurement with its method. ADR-0001
   Amendment G established this for security claims; it now applies to every claim
   of a property.
3. **Documentation lands in the commit that makes it true.** Not a follow-up, not a
   sweep. A sweep is a symptom.
4. **A green suite is not evidence of a working feature where the suite cannot
   observe the behaviour.** jsdom has no layout engine, no hit testing, no
   `PointerEvent`, no `ResizeObserver`, no `scrollIntoView`, and
   `getBoundingClientRect` returns 0×0 unless you stub it. Anything geometric,
   visual, focus-ordered or pointer-driven is either verified in a real browser or
   labelled "not verified in a browser". There is no third option.
4b. **Coverage is not verification.** 100% means the lines executed. It says
   nothing about whether the assertion was right, whether the test name describes
   what the test does, or whether a user can reach the behaviour.
5. **Run it.** A user-visible change is not done until a human has seen it work in
   a browser. If you did not, say so and label the change unverified. "The browser
   test lane" below is how this is answered mechanically, and `dev.html` is the
   fixture to look at by hand — `npm run dev` renders an empty shell by design.
6. **Parallel work needs disjoint file ownership.** Name the files each workstream
   may write before it starts. Where two would touch one file, they serialise.
   Concurrent work on one tree has already made `npm run verify` unrunnable here
   once, and overtaken an open issue's premise once.
7. **No "fix it later".** A defect you know about is fixed in the change or filed —
   with a reproduction, a file and a line — before the change merges. Those are the
   only two options.
8. **Say what you did NOT do.** Every change states its limits: what a reader might
   reasonably assume it delivers and it does not, which branch is executed but not
   asserted, what is left unproven.
9. **A tooling claim is measured on this tree, not recalled.** Name the invocation
   that demonstrated it. A remembered flag is as unreliable as a remembered
   guarantee.
10. **Name the failure mode when you fix it.** Record why the defect was possible,
    not only what the fix was. A fix without a recorded failure mode gets re-made.

[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) turns these
into boxes you have to answer, and [`CLAUDE.md`](CLAUDE.md) is the operational
version — the same rules plus the specific traps this repository has already paid
for, in the file every AI session reads automatically.

**These rules will make you slower.** ADR-0003 says so plainly, says by how much
and in which places, and argues why that is the correct trade. The short form: the
velocity was never real, and every defect it produced was paid for later by an
audit round that cost more than the review would have.

---

## The one acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That is the definition of done for every change here, not only for changes that
look like build configuration. If your change requires anybody to install
something undeclared, edit a tracked file for their machine, or run a command that
only works on one operating system, it is not finished.

---

## The mandate: no local-environment dependencies

**No tracked file may contain any of the following.**

1. An absolute path — including one anchored to a Windows drive letter, and
   including a UNC path naming a specific host.
2. A path through a per-user home directory, or a per-user application-data
   directory.
3. A reference to any developer's local directory layout, by any route: a login
   name, a machine name, or a per-user environment variable standing in for a home
   directory.
4. A machine-specific temporary or scratch directory.
5. A hardcoded hostname or IP address, or a port assumption other than a
   documented default.
6. An environment assumption that is not declared and defaulted. Nothing in this
   repository reads an environment variable today; a first reader needs a declared
   name and a working default in the same change.
7. A platform-only script, build command, or path separator.
8. A filename that collides case-insensitively with another tracked file.
9. A committed line ending that contradicts [`.gitattributes`](.gitattributes), or
   a UTF-8 byte-order mark.

**This is enforced, not requested.** `scripts/check-portability.mjs` decides every
clause above. It runs as `npm run check:portability`, it is the first step of
`npm run verify`, and it is a step in CI on all three operating systems. A
violation fails the build.

The reasoning, the alternatives that were rejected, and the limits of what the
checker can and cannot decide are in
[`docs/adr/0002-no-local-environment-dependencies.md`](docs/adr/0002-no-local-environment-dependencies.md).

### When the checker fails

It names the file, the line, the column, the rule and the offending text. There
are exactly two acceptable responses:

1. **Fix the file.** Nearly always the right answer: make the path relative to the
   repository, declare and default the environment value, rename the colliding
   file, or convert the command to something every platform runs.
2. **Sharpen the rule, or allowlist the match with a written reason.** If the match
   is genuinely legitimate, prefer making the pattern more precise — an exemption
   stops checking a file, a sharper pattern does not. If precision cannot reach it,
   add an entry to `ALLOWLIST` at the top of `scripts/check-portability.mjs`. Each
   entry names exact paths, names rule ids explicitly, and carries a reason. There
   is no wildcard, deliberately.

Weakening the acceptance test is not one of the options.

### Stage a new file before you run `verify`

The checker scans what git tracks, and `import-case` and `import-unresolved`
resolve import specifiers against the **git index**, not against your working
tree. So the first `npm run verify` after you add a new source file and import it
fails at the very first gate, on an import whose target is sitting right there on
disk:

```
src/core/RegistryContext.tsx:12:1  import-unresolved
  found an import whose target "src/core/hotkeys.ts" exists in this working tree
  but is not tracked by git, so a fresh clone would not have it and this import
  would fail there — run `git add src/core/hotkeys.ts`
```

(The `found` line is wrapped above to fit this page; the checker emits it on one
line.)

**This is deliberate, and it is not a bug in the checker.** An untracked file is
not in a clone. Whoever clones this repository gets the index, so an import
pointing at a file you never staged is a genuinely broken import for everybody but
you — which is the exact class of "works on my machine" failure ADR-0002 exists to
catch, and it is worth more caught here than in CI on Linux. Resolving against the
filesystem instead would make the check pass on the machine that made the mistake
and fail nowhere else.

The fix is `git add <path>`, before `npm run verify`, not after. The message above
is the one that means "staging, not typing". A specifier that resolves to nothing
on disk still reports the generic `an import that resolves to no tracked file` —
and that one is a real typo or a real missing file.

### The rules, by id

| Rule id | What it reports |
|---|---|
| `windows-drive-path` | An absolute path anchored to a Windows drive letter. |
| `home-directory-path` | A path through a per-user home directory. |
| `environment-home-reference` | A per-user environment variable or shell shorthand for a home directory. |
| `appdata-path` | A Windows per-user application-data directory. |
| `temp-or-scratch-path` | A machine-specific temporary or scratch directory. |
| `absolute-posix-path` | An absolute POSIX path anchored outside the repository. |
| `unc-path` | A UNC path naming a specific host. |
| `developer-username` | A developer's login name. Enforced on developer machines; see ADR-0002 for why it is not hardcoded and what that does not cover. |
| `hardcoded-ip-address` | An IP address literal in code or configuration. |
| `hardcoded-hostname` | A DNS name in code or configuration. |
| `undocumented-port` | A port assumption that is not a documented default. |
| `platform-only-invocation` | A build command only one operating system can run. |
| `platform-only-path-separator` | A Windows path separator in a build command. |
| `line-endings` | A carriage return, where `.gitattributes` mandates LF. |
| `byte-order-mark` | A UTF-8 byte-order mark. |
| `case-collision` | Two tracked paths differing only in case. |
| `import-case` | An import whose case does not match the tracked filename. |
| `import-unresolved` | An import that resolves to no tracked file. A target that exists in the working tree but was never staged is the same violation and reports its own message naming the `git add` that fixes it; see "Stage a new file before you run `verify`" above. |
| `unreadable-tracked-file` | A path the index lists that the working tree does not have — a fresh clone and this tree would not agree. |

---

## Standing rules for anything written here, including documentation

These predate this document and are unchanged. Their live home is `CLAUDE.md`
("Also standing"); as first written they were the Contributing section of the
README, archived verbatim in
[`docs/history/readme-status-2026-08.md`](docs/history/readme-status-2026-08.md).
See also ADR-0001 Amendment G. Rule 2 of the working agreement
above generalises rule 3 below from security claims to every claim of a property;
neither replaces the other.

1. **Do not assert unmeasured results.** If it has not been benchmarked, audited
   or measured, label it a target and say so.
2. **Label aspiration as aspiration.** A reader must always be able to tell what
   exists from what is planned.
3. **Name the test, narrow the claim, or delete it.** No security claim goes into a
   `.md` file or a docblock without naming the test that exercises it. This one is
   a review-time convention and no script checks it; ADR-0001 Amendment G says so
   plainly and records the seven rounds of evidence behind it.

---

## Two invariants that are defended, and how

Both are currently at zero, and a change that raises either is not a change to a
number — it is a change to a decision, and needs to be argued for as one.

**Zero inline suppressions.** There is no `eslint-disable`, no `v8 ignore`, no
`c8 ignore`, no `istanbul ignore` and no `@ts-expect-error` anywhere in this
repository. An inline directive drifts onto unrelated lines, goes stale in silence,
and is invisible from anywhere except the line it sits on. When a rule genuinely
needs an exception, the exception goes in configuration with a written reason —
`eslint.config.js` has a worked example: five hook exports in the two React context
modules are declared to `react-refresh/only-export-components` by name, so a *new*
non-component export in either file still fails the build.

`npm run lint` runs with `--max-warnings 0`, so there is no warning tier to hide in.

**100% coverage on `src/core/**`.** Statements, branches, functions and lines, set
in [`vitest.config.ts`](vitest.config.ts) and enforced by Vitest exiting non-zero.
The threshold applies per module as each module lands. Do not lower it and do not
narrow the include list to route around an untested branch.

---

## Before you open a pull request

```bash
npm run verify
```

That runs, in order: the portability check, the citation check, lint at zero
warnings, typecheck, the suite with the coverage gate, the randomised integration
run, the script tests, the production build, and a production-dependency audit.

**It is not the same set CI applies, and this paragraph used to say that it was.**
The `verify` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs five
of those nine — the portability check, lint, typecheck, the coverage run and the
build. The citation check, the randomised integration run and the script tests
execute on no leg of that workflow, and the audit runs in
[`.github/workflows/audit-dependencies.yml`](.github/workflows/audit-dependencies.yml)
only when the dependency graph changed, plus weekly on a timer. So `verify` is the
stronger gate, and it only runs where somebody runs it. Do not skip it on the
theory that CI will catch it.

[`README.md`](README.md) still carries the same incorrect sentence in its script
table. It is filed rather than fixed here, as GitHub issue #58, under rule 7 of the
working agreement above — correcting it belongs with a change that owns that file.
**Since corrected:** #58 was closed for real on 2026-08-03, and the README was
recast on 2026-09-18; the script table now lives in `docs/getting-started.md`.

`verify` needs network access, for `npm ci` and for the audit's advisory-database
query. It is not an offline operation.

---

## The browser test lane

```bash
npm run test:browser:install   # once per machine — downloads Chromium
npm run test:browser
```

**What it is for.** Every other suite in this repository runs under jsdom, which
has **no layout engine**. Nothing is ever laid out, `getBoundingClientRect`
answers 0×0, no ancestor clips anything and no pointer hit-tests. That is fine
for logic and fatal for geometry, and this project has already shipped two
defects it made invisible:

- The ribbon's overflow menu was **clipped out of existence** by two
  `overflow-hidden` ancestors — zero visible pixels, and a pointer click at its
  centre hit-testing to a different pane. Six jsdom tests asserted the menu
  worked. All six passed, vacuously.
- A case named for surviving "a divider drag in flight" **never started a drag**,
  because a 0×0 rect cannot intersect a 12px hit area.

Both were found by rendering in a real browser as throwaway session work that
the repository could not reproduce. `e2e/` is that work, made permanent.

**It is deliberately NOT part of `npm run verify`, and that is not an
oversight.** The acceptance test is *"a fresh clone on a different operating
system runs `npm ci && npm run verify` with no local setup and no edits."*
Playwright needs `npx playwright install` — a browser download that is outside
`npm ci` and outside `package-lock.json`, which is exactly the local setup that
sentence rules out. Chaining the lane into `verify` would make the claim false;
giving the lane its own script and its own workflow keeps it true. **If you find
yourself editing that sentence to accommodate a test, stop — that is the wrong
end of the trade.**

`.github/workflows/browser.yml` runs it on Ubuntu, on Chromium, on pull requests
and pushes to `main`, and uploads the trace when it fails. `ci.yml` is untouched
and still runs `verify` on three operating systems.

**What is under `e2e/`, and why it is not under `src/`.** `vitest.config.ts`
includes `src/**/*.{test,spec}.{ts,tsx}` and `src/__tests__/noEventListener.test.ts`
walks `src/` from its own location, so a Playwright spec under `src/` would be
executed by Vitest — where it cannot run — and scanned by the listener check,
where its `page.keyboard` calls are not the finding that test is about. The
directory sits at the repository root so that neither happens, and `tsconfig.json`
includes it so it is still typechecked by `npm run typecheck`.

**Chromium only.** The defects this lane exists for are layout and hit-testing
defects, not engine-compatibility defects — they reproduce anywhere there is a
layout pass. A second and third browser would re-run identical assertions for
three times the CI minutes. Add one when there is a rendering difference this
project actually cares about, not before.

**The fixture.** `src/App.tsx` registers no extension, so the production shell
has nothing for a browser test to drive. `dev.html` and `src/dev/` mount the same
shell with the two verification remotes in `src/mocks/` registered, and the dev
server serves that fixture at **`/`** as well as at `/dev.html` — a middleware in
`vite.config.ts` rewrites the one path. It is dev-server-only by construction
twice over: the middleware is installed under `configureServer`, which `vite
build` never calls, and Vite's build inputs are listed in `vite.config.ts` and
`dev.html` is not among them, so it is never emitted into `dist/`. It uses **no environment variable**, because ADR-0002
forbids one without a working default. What the production bundle renders is
unchanged, and `/index.html` still serves it on the dev server.

**Two servers, since ADR-0006 step 2.** `playwright.config.ts` also runs `vite
build` and serves `dist/` with `vite preview` on port 4173, which sends the
renderer's Content-Security-Policy (`preview.headers` in `vite.config.ts`, imported
from `electron/main/rendererCsp.ts`). A case about what the bundler *emits* — the
`/shared/*.js` modules — belongs there, because the dev server emits nothing.
The preview server is Vite's static server with the same header; it is not the
`shellux:` scheme handler, and a case run against it says nothing about the
packaged app's asar.

**When you add a case here, make it one jsdom could not have made.** Assert
measured pixels, real clipping, a real pointer, or a real reload. A case that
only reads the DOM belongs in the Vitest suite, where it will run in a second
instead of a minute.
