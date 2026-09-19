# Getting Started

> Moved here verbatim from `README.md` on 2026-09-18, when the README was recast around the mission (decision D-31). Headings are one level higher; the text is unchanged except that relative links, and one in-document cross-reference that pointed at a section no longer above it, were corrected for this file's location.

## Prerequisites

| Tool | Requirement | Why this floor |
|---|---|---|
| **Node.js** | `^22.13.0 \|\| >=24` | Declared as `engines` in `package.json`. This is not a preference — it is the intersection of the `engines` constraints the dependency tree already carries. Two of those constraints are what removed the `^20.19.0` arm this project used to accept: **`electron`, which declares `>= 22.12.0`**, and `@testing-library/jest-dom` 7, which declares `>=22`. The arms that remain come from `eslint-visitor-keys` (via `@typescript-eslint`), whose `^20.19.0 \|\| ^22.13.0 \|\| >=24` is also the reason `>=24` is written as a separate arm rather than folding into `>=22` — it is what excludes the 23.x line. `test-exclude` contributes `20 \|\| >=22`, which rules out 21.x on the same principle. Nothing in the tree needs more. |
| **npm** | 10 or newer; 11.16.0 is what the lockfile was written with. **Corrected 2026-09-18: use 11.16.0.** npm 10.9.8 `npm audit fix` crashed on the lockfile before #126 (`Cannot read properties of null (reading 'edgesOut')`); see `docs/traps.md` for what was and was not reproduced | Pinned as `packageManager` so a laptop reaching for yarn or pnpm errors instead of silently resolving a different tree from the version ranges in `package.json`. |
| **git** | any recent version | The portability check below enumerates tracked files with `git ls-files`. |

`.nvmrc` tracks the major version CI uses, so `nvm use` (or `fnm use`) picks the
right one without being told. CI reads the same file rather than duplicating the
number.

**Node 20 is no longer supported, and that is a policy change, not a side effect.**
The floor above used to start at `^20.19.0`. It cannot any more: `electron` is a
devDependency of this project and refuses to install below 22.12.0. Dev-only does
not soften that — this package is `private`, so there is no consumer who installs
it without dev dependencies, and the 20.x line stopped being installable here for
everyone regardless of what `engines` claimed. Declaring a
version the tree cannot install is worse than declaring one fewer version, so the
arm was removed rather than left standing as a promise nothing keeps.

**The floor is enforced, not suggested.** The tracked `.npmrc` sets
`engine-strict=true`, so a Node below the floor fails `npm ci` immediately with a
readable message. Without it npm's default is to print `EBADENGINE`, carry on, and
hand you a tree that breaks later somewhere unrelated.

**And the floor is now executed, not only enforced.** Until recently every job in
every workflow took its Node version from `.nvmrc`, and `.nvmrc` has always named
a version comfortably above the floor — so `engine-strict` had nothing to catch
and the lower bound was the one claim in this file that nothing tested. A
dependency could raise its own `engines` past the floor and every check would stay
green while a developer on a supported version got a hard `EBADENGINE` on `npm ci`.
The `Declared Node floor` job in `ci.yml` installs and tests on the exact lowest
supported version, so that gap now fails in CI instead of on a laptop.

No other setup exists. There is nothing to configure, no environment variable to
set, and no `.env` file — nothing in this repository reads one.

## Install and run

```bash
git clone <repository-url>
cd leapware-shellux
npm ci
npm run dev
```

`npm run dev` starts the Vite dev server on its default port, 5173, and prints the
URL. Opening it renders the three-pane shell **with ISSUE-005's two verification
remotes from `src/mocks/` registered** — a navigation tree with entries in it,
rows to select, contextual commands, and live badges. That is the working
demo, and it is what the browser test lane drives.

This is a **dev-server-only rewrite, not a change to what ships.** A middleware in
`vite.config.ts` resolves `/` to `dev.html`; it is installed under
`configureServer`, which `vite build` never calls, and `build.rollupOptions.input`
is still at its default of `index.html` alone. So `dist/` contains exactly what it
contained before, and `dev.html`, `src/dev/` and `src/mocks/` remain unreachable
from anything a user installs. There is no flag to set and no environment
variable — ADR-0002 forbids one without a working default; see
`src/dev/DevShell.tsx`.

**The production shell is still reachable by name.** Open **`/index.html`** on the
same dev server for the real composition root: `src/App.tsx` registers no
extensions, so you get the context bar's host actions, a resizable and collapsible pane
1 with nothing in it, and two empty panes. See the Status section of [`README.md`](../README.md#status).
*Tests:* `e2e/dev-routing.spec.ts` — "serves the fixture shell at the bare root,
with both remotes registered", "keeps the URL at / rather than redirecting the
browser to /dev.html" and "leaves /index.html on the production shell, whose
registry is empty".

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot module replacement, on port 5173. |
| `npm run build` | Typechecks, then produces a production bundle in `dist/`. |
| `npm test` | Runs the Vitest suite once. |
| `npm run test:coverage` | Runs the suite and enforces the coverage gate in `vitest.config.ts` — 100% statements, branches, functions and lines over `src/core/**`, `src/components/**` and `src/hooks/**`. Everything else under `src/` is outside the gate. Exits non-zero if a threshold is unmet. |
| `npm run test:integration` | Runs `src/__tests__/IntegrationSuite.test.tsx` a **second** time under `--sequence.shuffle`, which is ISSUE-005's requirement that the integration cases pass in a randomised order. The flag lives here rather than in `vitest.config.ts` because that file is shared by all 35 test files and the wider suite has never been demonstrated to be order-independent. This entry used to assert that `src/core/__tests__/shellApi.test.ts` fails three of its own cases under `--sequence.shuffle`; **that claim has lost its evidence** — it has since passed 109/109 on every re-run, including under shuffle at different seeds — and it is neither reproduced nor disproven, because `--sequence.shuffle` reorders *files*, not cases. Treat it as unverified rather than as a known failure. Vitest prints the seed it used, and the seed defaults to the clock. |
| `npm run typecheck` | `tsc --noEmit`. Emits nothing; only checks. |
| `npm run lint` | ESLint at `--max-warnings 0`. There is no warning tier; a warning fails. |
| `npm run check:portability` | Enforces ADR-0002 — see below. |
| `npm run audit:prod` | `npm audit` over production dependencies at `--audit-level=high`. Needs network access. |
| `npm run audit:all` | `npm audit` over the whole tree, dev dependencies included, at `--audit-level=high`. Its own CI job, not a `verify` stage. Needs network access. |
| `npm run verify` | **The gate.** Runs all of the above in order: portability, citations, tokens, lint, typecheck, coverage, the randomised integration run, the script tests, build, audit. **Ten stages, and CI now runs every one of them.** `.github/workflows/ci.yml` runs the first nine on each of three operating systems; `audit:prod` runs in `audit-dependencies.yml` and `audit-schedule.yml`. **This row used to say "CI applies five of those nine", and that was true for as long as it stood** — `check:citations`, `tokens:check`, `test:integration` and `test:scripts` had no leg anywhere, so four stages were backed only by an author ticking a box on a pull request that, per HANDOFF.md §5, nobody is required to review. Tracked as #58, which was closed while every stage it named still ran nowhere. Running `verify` locally is now genuinely redundant with CI, which is the point: it means a green run and a green laptop are the same claim. **The narrower dev-tree gap is closed as of 2026-09-18:** `audit:prod` is still `npm audit --omit=dev`, and `npm run audit:all` audits the whole tree as its own job in `audit-dependencies.yml` and in the scheduled audit — not as a `verify` stage. |
| `npm run test:browser:install` | Downloads Chromium for the browser lane. Once per machine, and **not** part of `npm ci` — see "The browser test lane" below. |
| `npm run test:browser` | Runs the Playwright suite in `e2e/` against a real Chromium. Deliberately **not** part of `verify`. |
| `npm run build:desktop` | Compiles the main and preload processes to `dist-electron/` with `electron/tsconfig.json`. A second TypeScript program, not a second opinion — the root config describes a browser document and these files run under Node. |
| `npm run package:desktop` | `electron-builder --publish never`. Names no platform, because `electron-builder` with no platform flag builds for the machine it is running on — which is what `scripts/check-portability.mjs` now requires. Reads `electron-builder.yml`; writes to `release/`. |
| `npm run verify:desktop` | **The packaging acceptance test**, and deliberately **not** a stage of `verify`. Builds the renderer, compiles the host, and packages an installer. Setting no environment variable at all produces a working **unsigned** artifact; `docs/signing.md` declares every name that changes that, and `docs/RELEASE.md` is the checklist for actually releasing one. It is outside `verify` for the reason the browser lane is: an Electron binary and a signing certificate sit outside `npm ci` and outside `package-lock.json`. |

## The acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That is the definition of done for every change in this repository, and it is
mechanically enforced rather than merely stated. `npm run check:portability` runs
`scripts/check-portability.mjs`, which scans every tracked file for absolute paths,
home and scratch directories, developer login names, hardcoded hosts, ports and
addresses, platform-only build commands, case-colliding filenames, committed
carriage returns and byte-order marks, and any relative import in `src/` whose case
does not match the tracked filename. It is a plain Node script with no
dependencies, and it fails the build.

The mandate itself is in [`CONTRIBUTING.md`](../CONTRIBUTING.md); the reasoning, the
rejected alternatives and the honest limits of what a checker can decide are in
[`docs/adr/0002-no-local-environment-dependencies.md`](adr/0002-no-local-environment-dependencies.md).

`verify` needs network access, for `npm ci` and for the audit's advisory-database
query. It is not an offline operation, and that is a declared property rather than
a surprise.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the same steps on
`ubuntu-latest`, `macos-latest` and `windows-latest`. Three legs rather than one
because this project is developed on more than one laptop, and because macOS
support used to be *inferred* from the platform-specific optional dependencies in
`package-lock.json` rather than observed. It is now observed.

"The same steps" is meant literally and was not always true — see the `verify` row
above for what CI used to skip and why that mattered. `ci.yml` carries a second job
beside the matrix: **the declared Node floor**, which installs and tests on the exact
lower bound in `package.json`'s `engines` rather than on `.nvmrc`. It exists because
`.nvmrc` has always named a version above the floor, so `engine-strict` never had
anything to catch and a dependency could raise its own floor past this project's with
every leg staying green. That is not hypothetical: it happened, and it is why the job
is there.

A fifth workflow, [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml),
packages the Electron application on Windows and macOS. It is not part of `verify`
for the same reason the browser lane is not — see the `verify:desktop` row above —
and it publishes nothing.

The production-dependency audit is a separate workflow on purpose. An advisory
database that updates daily and a lockfile that does not means the audit result can
change with no commit at all, so a per-push blocking audit would turn `main` red
for a defect nobody introduced. Instead it blocks when `package.json` or
`package-lock.json` changes — the only kind of commit that can introduce a
vulnerable dependency — and blocks weekly on a timer, which is what notices a newly
published advisory without blaming an unrelated commit. See
[`.github/workflows/audit-dependencies.yml`](../.github/workflows/audit-dependencies.yml)
and [`.github/workflows/audit-schedule.yml`](../.github/workflows/audit-schedule.yml).

[`.github/workflows/browser.yml`](../.github/workflows/browser.yml) is a third,
separate workflow, and separate for a reason that is worth stating where a reader
will meet it: it needs a Chromium download, which `npm ci` does not perform and
`package-lock.json` does not pin. Folding it into `ci.yml` would mean the
acceptance test above no longer described what CI runs. It is Ubuntu-only and
Chromium-only, it caches the browser between runs, and it uploads the Playwright
trace when it fails. See "The browser test lane" under Testing and coverage.
