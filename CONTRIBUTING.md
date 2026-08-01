# Contributing to LEAPWare-ShellUX

The project is pre-alpha and the core contract is still being written. The most
useful contribution right now is review of the specification in
[`.github/ISSUES_MANIFEST.md`](.github/ISSUES_MANIFEST.md) and of the architecture
decision in [`docs/adr/0001-ioc-registry-architecture.md`](docs/adr/0001-ioc-registry-architecture.md).

Setup instructions are in [README.md](README.md#getting-started). This document is
the rules.

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

These predate this document and are unchanged. See the Contributing section of
[README.md](README.md) and ADR-0001 Amendment G.

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

That runs, in order: the portability check, lint at zero warnings, typecheck, the
test suite with the coverage gate, the production build, and a production-dependency
audit. It is the same gate CI applies, which is the point — CI should confirm what
you already know, not tell you something new.

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
shell with the two verification remotes in `src/mocks/` registered. It is
dev-server-only by construction — Vite's build input is `index.html` alone, so
`dev.html` is never emitted into `dist/` — and it uses **no environment
variable**, because ADR-0002 forbids one without a working default. What the
production bundle renders is unchanged.

**When you add a case here, make it one jsdom could not have made.** Assert
measured pixels, real clipping, a real pointer, or a real reload. A case that
only reads the DOM belongs in the Vitest suite, where it will run in a second
instead of a minute.
