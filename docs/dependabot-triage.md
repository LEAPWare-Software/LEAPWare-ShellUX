# Dependabot triage — PRs #34–#38

**Date:** 2026-08-02 · **Scope:** the five open Dependabot pull requests on
`LEAPWare-Software/LEAPWare-ShellUX`. HANDOFF §8 item 9.

**No action was taken.** Nothing was merged, closed, approved or commented on. No git
state was mutated, no install was run. `npm audit --json` was run read-only; `eslint` was
run from the already-installed `node_modules`.

> **Note for whoever commits this file.** `check:portability` enforces a
> `hardcoded-hostname` rule over tracked files, and only two tracked files contain a dotted
> hostname today — `CODE_OF_CONDUCT.md` and `package-lock.json`, both long-standing.
> **[reproduced — `git ls-files` swept]** This document therefore cites advisories by GHSA
> ID and upstream issues by number rather than by URL, so that it can be tracked without
> tripping the gate. Keep it that way. While untracked it is outside the checker's scope and
> cannot affect anyone else's run.

### Evidence tags

| Tag | Meaning |
|---|---|
| **[reproduced]** | Run here, on this machine, and the output observed. |
| **[reported]** | Read from a CI job log, a config file, or an upstream document. Not re-run locally. |
| **[reasoned]** | Inference from the two above. Stated as inference, not as measurement. |

### Method note — the `gh pr checks` trap (HANDOFF §11)

Every status below is read from the **status column**, never from the exit code. Measured
here: `gh pr checks` returned **exit 1 on #34, #35 and #38** (failed legs) and **exit 0 on
#36 and #37** (all-pass). No PR had a pending leg at read time, so this run could not
re-confirm the pending-exits-non-zero half of the trap — but the rule was still applied.
**[reproduced]**

---

## 0. Lead finding — the security fix is not in this queue, and cannot get into it

**None of #34–#38 resolves any known CVE.** Not one of them touches `vitest`, `vite` or
`esbuild`, which are where every open advisory lives. **[reproduced — `npm audit --json`
cross-referenced against all five diffs]**

Current state of the dev tree, unchanged by any of these PRs:

| Package | Severity | Advisory | Score | Vulnerable range |
|---|---|---|---|---|
| `vitest` | **critical** | `GHSA-5xrq-8626-4rwp` — UI server allows arbitrary file read/execute | **9.8** | `<3.2.6` |
| `@vitest/coverage-v8` | **critical** | via `vitest` | — | `<=3.2.5` |
| `vite` | **high** | `GHSA-fx2h-pf6j-xcff` — `server.fs.deny` bypass on Windows alternate paths | 7.5 | `<=6.4.2` |
| `vite` | moderate | `GHSA-4w7w-66w2-5vf9`, `GHSA-v6wh-96g9-6wx3` | — | `<=6.4.2` |
| `esbuild` | moderate | `GHSA-67mh-4wv8-2f99` | 5.3 | `<=0.24.2` |
| `@vitest/mocker`, `vite-node` | moderate | via `vite` | — | — |

Totals: **6 vulnerabilities — 3 moderate, 1 high, 2 critical.** This matches HANDOFF §6.2
exactly. **[reproduced]**

**Why Dependabot has never proposed the fix.** `.github/dependabot.yml` sets
`open-pull-requests-limit: 5`, and deliberately excludes major updates from the
`minor-and-patch` group so each major gets its own PR. There are **exactly five open
Dependabot PRs**. The queue is saturated. `npm audit` reports the fixes as
`vitest@4.1.10` (semver-major), `@vitest/coverage-v8@4.1.10` (semver-major) and
`vite@8.2.0` (semver-major) — three ungrouped majors that need **three free slots**, and
there are zero. **[reproduced — config read, PR count read, `fixAvailable` read from
audit JSON]**

So the structural gap HANDOFF §6.2 records has a second half. CI cannot *see* the
criticals (`audit:prod` is `npm audit --omit=dev`), **and** Dependabot cannot *offer* the
fix while five slots are held by bumps that are, without exception, chores. The two
recommendations below to close #35 and #38 free two of the three slots needed.

**The vitest/vite migration is not a merge — it is a coordinated hand-driven upgrade**
(`vitest` 2→4, `vite` 5→8, `@vitest/coverage-v8` 2→4, and almost certainly
`@vitejs/plugin-react` alongside it, since it peers on Vite). **[reasoned]** It should be
scheduled as its own piece of work. **It must land before pivot Phase 6**, which puts the
entire cross-process transport under jsdom unit test — that is the phase where a
compromised or unpatched test runner has the most reach, and where the runner becomes
load-bearing rather than incidental. **[reasoned, from `docs/plans/native-host-pivot.md`
§8 Phase 6]**

---

## 1. Summary table

| PR | Package | From → To | Major? | CI (status column) | Root cause of red | Resolves CVE | Recommendation |
|---|---|---|---|---|---|---|---|
| **#34** | `eslint-plugin-react-refresh` (in `minor-and-patch` group) | 0.4.26 → 0.5.3 | Not by semver (pre-1.0); **breaking upstream** | Verify ×3 **fail**, Audit pass. *No browser lane.* | Real incompatibility. `only-export-components` newly emits **11 warnings**; `--max-warnings 0` makes that a build gate | No | **Hold.** Upstream false positive; the only fix dilutes a defended invariant |
| **#35** | `typescript` | 5.9.3 → 7.0.2 | **Yes (two majors)** | Verify ×3 **fail**, Browser **fail**, Audit pass | Real incompatibility. `npm ci` dies at **ERESOLVE** — `typescript-eslint@8.65.0` peers `typescript >=4.8.4 <6.1.0` | No | **Close.** Unmergeable until typescript-eslint supports TS 7 |
| **#36** | `@types/node` | 22.20.1 → 26.1.2 | **Yes** | Verify ×3 **pass**, Audit pass. *No browser lane.* | — | No | **Hold until Phase 1.** Types should track Electron's bundled Node, not the newest |
| **#37** | `@testing-library/jest-dom` | 6.9.1 → 7.0.0 | **Yes** | **All 5 pass** | — | No | **Merge after raising the `engines` floor to `>=22`** — green CI is structurally blind to this |
| **#38** | `tailwindcss` | 3.4.19 → 4.3.3 | **Yes** | Verify ×3 **fail**, Browser **fail**, Audit pass | Real incompatibility. PostCSS plugin moved to `@tailwindcss/postcss`; `postcss.config.js` and `src/index.css` are both v3-shaped | No | **Close and supersede.** Fold into pivot Phase 2/3, which is designed on Tailwind **3** |

**Base staleness — a negative finding.** All five PRs are behind `main`. `#34`/`#36` are
based on `edc29db7`; `#35`/`#37`/`#38` on `3ebf86d1`; `main` is at `0ed78e36`. **No red is
caused by base staleness** — every failure is deterministic and identical on all three OS
legs. **[reproduced — base OIDs read via `gh pr view`; cross-OS legs read below]**

**No environmental failure mode was observed.** HANDOFF §11's memory-exhaustion signature
— `test:coverage` OOM-kill, `exit 127 fork: Resource temporarily unavailable` — appears in
**none** of the nine failing jobs read. Every failure has a named, deterministic cause.
**[reported — grepped all failing logs for those signatures, zero hits]**

**The browser lane gap.** `#34` and `#36` carry **no `Browser tests (chromium)` check at
all**, because their base commit `edc29db7` predates the browser lane's merge at
`3ebf86d1` (HANDOFF §1a, PR #70). `#36`'s green is therefore narrower than `#37`'s green,
and the two are not comparable evidence. **[reproduced]**

---

## 2. Per-PR findings

### #34 — `eslint-plugin-react-refresh` 0.4.26 → 0.5.3 — **Hold**

**Why it is red.** Not a flake, not memory, not a stale base. `npm run lint` produces
**`✖ 11 problems (0 errors, 11 warnings)`** and then `ESLint found too many warnings
(maximum: 0)`. The identical count and identical message appear on **all three OS legs** —
ubuntu, macos and windows. **[reported — three job logs read]**

**Baseline, measured here.** With the currently installed `eslint-plugin-react-refresh@0.4.26`,
those same four files lint **clean, exit 0, no output**. The 11 warnings are entirely new
in 0.5.3. **[reproduced]**

**What changed upstream.** The 0.5.0 changelog states the internal logic was revamped to
"better make the difference between random call expressions like
`export const Enum = Object.keys(Record)` and actual React HOC calls," and that "HOC call
validation became stricter." **[reported]**

**Where this repo hits it.** Ten of the 11 warnings sit on — or are dragged in by — an
export whose initialiser is a **call expression**, specifically `Object.freeze(...)`, the
exact shape named in that changelog entry. The eleventh is a plain function export:

- `src/core/RegistryContext.tsx:62` `EXTENSION_ID_PATTERN = Object.freeze(/…/)`
- `src/core/RegistryContext.tsx:76` `RESERVED_IDS = Object.freeze(new Set([…]))`
- `src/core/RegistryContext.tsx:90` `REGISTRY_LIMITS = Object.freeze({…})`
- `src/core/RegistryContext.tsx:190` `HOTKEY_KEYS = Object.freeze(new Set([…]))`
- `src/core/RegistryContext.tsx:247` `HOTKEY_MODIFIER_REQUIRED_KEYS = Object.freeze(new Set([…]))`
- `src/components/error/FaultBoundary.tsx:202` `export function describeFault(…)` — **not** a
  call expression; a non-component function exported beside the `FaultBoundary` class at
  `:242`. 0.4.26 did not flag it and 0.5.3 does; 0.5.3's changelog entry is *"fixed check
  for non-component classes exported via `export { }`"*, which is adjacent but not obviously
  the same code path. **[reasoned]**
- `src/mocks/DatabasePlugin.tsx:574, :619, :694` and `src/mocks/MailPlugin.tsx:580, :661` —
  these files export **exactly one** symbol each
  (`export const DatabasePlugin: LEAPExtensionBlueprint = Object.freeze({…})` at line 948,
  and the same shape in `MailPlugin.tsx`), and the new logic misreads that frozen-object
  export as a possible HOC, which drags every local component in the file into the report.
  The warning text even says so: *"If all exports are HOCs, add them to the `extraHOCs` option."*

This looks like an **upstream false positive**: 0.5.0's stated goal was to *reduce*
misclassification of `Object.keys(Record)`-shaped exports, and `Object.freeze(…)` is the
same shape being misclassified in the other direction. I searched the upstream repo and
could not locate an existing issue for it. **[reasoned; the absence of an upstream issue is
[reproduced] only to the extent that a web search found none]**

**Why "hold" and not "fix the config."** `eslint.config.js` carries a 25-line defended
rationale for keeping `allowExportNames` **narrow on purpose**: the five names are listed
individually "so a *new* non-component export in either file still fails the build and has
to be argued for on purpose," and the file states that "this repository has zero inline
suppressions and that is a defended invariant." Silencing these 11 warnings means adding
**eight more names** (five `RegistryContext` constants, `describeFault`, `DatabasePlugin`,
`MailPlugin`) — which is precisely the dilution that comment exists to prevent, and it
would be done to work around an upstream defect rather than to accept a real design cost.
**That is a doctrine decision and needs a human to agree to it.** **[reasoned]**

**One thing that is *not* a problem.** 0.5.0 also moved to ESM-only and replaced the
default export with a `{ plugin, configs }` object. The current `eslint.config.js` uses the
old `import reactRefresh from '…'` + `plugins: { 'react-refresh': reactRefresh }` shape.
The CI log shows `react-refresh/only-export-components` **firing** under 0.5.3, so the
plugin loaded correctly and the config shape is not an additional blocker.
**[reported — direct evidence from the failing log]**

**Also worth noting:** Dependabot classified this as `minor-and-patch` because 0.4→0.5 is a
semver-*minor* for a pre-1.0 package. Upstream shipped it as a breaking release. The result
is that a group PR designed to batch harmless bumps is holding a queue slot for a single
breaking change, with only one package in it. **[reproduced — diff contains one package]**

**One hedge on scope.** `lint` is the **third** step in the Verify job, ahead of `typecheck`,
`test:coverage` and `build`. Those three never ran on any #34 leg. So "11 warnings" is the
*first* failure this PR produces, not provably the *only* one — silencing the rule could
expose further breakage behind it. **[reasoned]**

**Recommendation: hold.** Revisit when upstream fixes the `Object.freeze` classification,
or when a human decides the `allowExportNames` list may grow. Nothing here is urgent —
0.4.26 has no advisory against it.

---

### #35 — `typescript` 5.9.3 → 7.0.2 — **Close**

**Why it is red.** It never reaches a test. `npm ci` fails at dependency resolution:

```
npm error code ERESOLVE
npm error Found: typescript@7.0.2
npm error Could not resolve dependency:
npm error peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.65.0
```

Identical on **ubuntu, macos, windows and the browser lane** — four jobs, one cause.
**[reported — four job logs read]**

**Does the repo hit the breaking change?** The question does not get that far. This is not
"TypeScript 7 might break our code"; it is "the tree cannot be installed." TypeScript 7 is
the native (Go) compiler port and sits entirely outside `typescript-eslint`'s published
peer range. Upstream closed the TS 7.0.2 support issue as **not planned**, and forcing the
install with `--force` / `--legacy-peer-deps` reportedly crashes inside `typescript-estree`
with `TypeError: Cannot read properties of undefined (reading 'Cjs')`. **[reported — web
sources, single-source and dated 2026-08; not independently verified here]**

Sources: `typescript-eslint` issue **#12518** ("TypeScript 7.0.2 Support", closed as *not
planned*), and the project's published *Dependency Versions* page. Both read via web search
on 2026-08-02.

**Recommendation: close.** This PR cannot be made green by any change to this repository.

**On re-proposal — read this before closing.** Closing a Dependabot PR unmerged tells
Dependabot not to recreate a PR *for that version*; it opens a fresh one only when a **newer
version of `typescript` ships** (7.0.3+). It does **not** watch `typescript-eslint`'s peer
range and will not re-raise on a compatibility change alone. **[reasoned — documented
Dependabot close behaviour; not verified against this repository]** So closing #35 is not a
snooze-until-compatible: someone has to put "revisit TypeScript 7 once `typescript-eslint`
supports it" somewhere durable. A compiler swap of that magnitude deserves its own ADR, not
a dependency bump. Closing it frees one of the three queue slots the vitest/vite security
fix needs.

---

### #36 — `@types/node` 22.20.1 → 26.1.2 — **Hold until Phase 1**

**Green, but narrower green than it looks.** All three Verify legs pass and the production
audit passes. It carries **no browser-lane check** — its base `edc29db7` predates that
workflow. **[reproduced]**

**Blast radius — measured, not assumed.** `@types/node` only matters where Node globals are
typed. Root `tsconfig.json` sets `"types": ["node"]` and
`"include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]`,
so Node types **are** in scope for `npm run typecheck`. **[reproduced — tsconfig read]**
Actual Node API surface inside that scope is thin but real: several test files import
`node:fs`, `node:path` and `node:url` (e.g. `src/components/__tests__/FaultBoundary.test.tsx:1-3`,
`src/components/command/__tests__/commandSurfaces.test.tsx:1-3`), and `playwright.config.ts` reads
`process.env.CI`. `scripts/**` is `.mjs` and **outside** the program entirely — it is
lint-checked, never typechecked. **[reproduced — grepped]**

So the exposure is small and confined to test/config files, not to shipped `src/` code. That
is why this PR is green and why it is likely to stay green.

**Why hold anyway.** `@types/node@26` describes the Node 26 API surface. This project's
declared floor is `^20.19.0 || ^22.13.0 || >=24` and `.nvmrc` pins **24**. Types that
describe a runtime nobody runs will accept code that does not exist at execution time — a
`node:fs` API added in Node 25 or 26 would typecheck clean and throw on a supported Node.
The failure mode is silent and lands at runtime, not at `tsc`. Small blast radius, but the
wrong direction. **[reasoned]**

**The Phase 1 connection, and it sharpens the case.** `electron/main/index.ts`,
`electron/preload/index.ts` and `electron/tsconfig.json` already exist untracked in this
tree, and pivot Phase 1 makes them real. That second tsconfig is a **separate program** with
`"types": ["node"]`, `"lib": ["ES2023"]`, no `DOM`, and `moduleResolution: "NodeNext"` — it
is *pure* Node code, so its exposure to `@types/node` is far larger than the renderer's, and
it resolves the same hoisted `@types/node`. **[reproduced — `electron/tsconfig.json` read]**
Once Electron is a dependency, the correct `@types/node` is **the one matching Electron's
bundled Node**, not the newest published. No Electron version is pinned anywhere yet —
not in `package.json`, not in the plan — so the right answer is not yet knowable.
**[reproduced — searched `package.json` and the plan for an Electron version pin, found
none]**

**Recommendation: hold until Phase 1 pins Electron.** If the drift is felt to be too large
to sit on, the safe interim move is `@types/node@^24` to match `.nvmrc`, not `^26`. This PR
is safe to merge in the narrow sense that CI is green; it is unwise in the sense that it
sets the types ahead of every runtime this project supports.

---

### #37 — `@testing-library/jest-dom` 6.9.1 → 7.0.0 — **Merge after raising the `engines` floor**

**The only fully green PR in the queue** — all five checks pass, including the browser lane.
**[reproduced]**

**And CI is structurally blind to its one breaking change.** jest-dom 7 raises its
`engines` to `node: >=22` (the diff changes it from `>=14`) and adds
`@testing-library/dom` as a **required** peer dependency. **[reproduced — read directly
from the PR's lockfile diff]** The peer is already a direct devDependency at `^10.4.0`,
which satisfies the new `>=10 <11` range, so that half is fine. **[reproduced]**

The Node floor is not fine. `package.json` declares `"node": "^20.19.0 || ^22.13.0 || >=24"`
— **20.19 is a supported version of this project.** The tracked `.npmrc` sets
`engine-strict=true`, with a comment stating its whole purpose is to "turn the `engines`
floor in package.json from a warning into a hard failure." **[reproduced]** So after this
merges, a developer on the declared-supported Node 20.19 runs `npm ci` and gets a hard
`EBADENGINE` failure rather than a warning. **[reasoned, from two configs read here]**

CI cannot catch this: `.nvmrc` is `24`, and `ci.yml` uses `node-version-file: '.nvmrc'` on
all three legs. Every runner is on Node 24, which satisfies `>=22`. The `engines` field is
the *only* place this project's Node 20 support is asserted, and nothing tests it.
**[reproduced]**

**Recommendation: merge after raising `package.json` engines to drop the `^20.19.0` arm**
(i.e. `"^22.13.0 || >=24"`), in the same change or immediately before. That is a real
support-policy decision — it drops a Node line this repo currently promises — and it should
be made deliberately rather than absorbed silently by a dev-dependency bump. If dropping
Node 20 is unacceptable, hold #37 instead. **Do not merge it as-is on the strength of the
green tick.**

---

### #38 — `tailwindcss` 3.4.19 → 4.3.3 — **Close and supersede**

**Why it is red.** Unit tests and coverage **pass** — jsdom never processes the stylesheet.
The `build` step fails, and then the browser lane fails on top of it:

```
[vite:css] [postcss] It looks like you're trying to use `tailwindcss` directly as a
PostCSS plugin. The PostCSS plugin has moved to a separate package …
file: /…/src/index.css
```

Identical on ubuntu, macos and windows. In the browser lane the same error repeats as a
Vite dev-server 500 on every page load, which cascades into Playwright assertions like
`expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible()` failing with
*element(s) not found* — those are **downstream symptoms, not independent failures**.
**[reported — four job logs read]**

**Which breaking changes this repo actually hits.** Three, all confirmed against files in
this tree:

1. **`postcss.config.js:3`** declares `plugins: { tailwindcss: {} }`. v4 moved the PostCSS
   plugin to `@tailwindcss/postcss`. **This is the error above.** **[reproduced — file read]**
2. **`src/index.css:1-3`** uses `@tailwind base; @tailwind components; @tailwind utilities;`.
   v4 replaces all three with a single `@import "tailwindcss"`. **[reproduced — file read]**
3. **`tailwind.config.js`** is a v3 JS config. v4 does not auto-discover it; it requires an
   explicit `@config` directive, or migration to CSS-first `@theme`. **[reasoned]**

**This is not an isolated bump, and that is the important part.** `docs/plans/native-host-pivot.md`
**Phase 2** is *"token pipeline, no component touched"* and specifies verbatim:
`tailwind.config.js` colors, `darkMode: ['selector', …]`, and — explicitly — *"Verify the
**Tailwind 3** `<alpha-value>` + `oklch(var(--x))` shape with one scratch utility **before**
committing the semantic set."* Plan §9 risk **R5** is literally about that Tailwind 3
construct being unverified. **The theming design in §3.6 is built on Tailwind 3 config-file
semantics.** **[reproduced — plan read at §3.6, §8 Phase 2, §9 R5]**

Merging #38 now would invalidate the design of a phase that has not started. Tailwind 4 is
a *reordering of the pivot*, not a dependency update — and the plan already knows it: §1
line 7 names the current state as a "browser-only React 18 + Vite 5 + **Tailwind 3** SPA,"
and Phase 2 builds the token pipeline on that assumption rather than on v4.

**Recommendation: close and supersede.** Fold Tailwind 4 into Phase 2/3 as a planned
migration with its own scope: `@tailwindcss/postcss`, the `@import` rewrite, the config
migration, the `<alpha-value>` re-verification under v4 semantics, and the 51 `dark:`
variants that Phase 3 intends to delete anyway. Closing this frees the second of the three
queue slots the security fix needs.

Same caveat as #35: closing suppresses **4.3.3** only. Dependabot will re-raise on Tailwind
**4.3.4+**, so expect this PR to come back and plan to close it again until Phase 2/3 owns
the migration. **[reasoned]**

---

## 3. Is there a batch that can be merged together safely?

**No. There is no safe batch, and there cannot be one.**

Two independent reasons:

1. **Only one PR is even a candidate.** #35 and #38 are red with real incompatibilities.
   #34 is red on a doctrine question. #36 is green but sets the Node types ahead of every
   supported runtime. That leaves **#37 alone**, and #37 itself needs an `engines` change
   first.
2. **Lockfile PRs are inherently serial.** All five edit `package-lock.json`, and #36 and
   #37 edit overlapping regions of it — `@@ -25,7 @@` and `@@ -23,7 @@` in the root
   `packages[""]` devDependencies block — and the *same* `package.json` hunk, `@@ -40,7 @@`.
   **[reproduced — hunk headers read from both diffs]** GitHub reports `MERGEABLE` for each
   PR **against `main` independently**, never pairwise. Merging any one of them makes every
   other one's lockfile stale and **invalidates its green CI run as evidence**. All five are
   already based on commits behind `main` (`edc29db7` / `3ebf86d1` vs `0ed78e36`), so this
   is not hypothetical.

**The only safe procedure is one at a time:** merge one, let Dependabot rebase the rest,
then **re-read the status column** — not the exit code — on each rebased PR before touching
the next.

---

## 4. Does anything here block pivot Phase 1?

**No. Nothing in #34–#38 blocks Phase 1.** **[reasoned]**

Phase 1 is *"Electron wrapper, single process, zero contract change"* — a `BrowserWindow`
loading the existing SPA, roughly 40 lines in `electron/main/index.ts`, with all tests green
and `verify` untouched. None of these five PRs touches the runtime dependency tree
(`react`, `react-dom`, `@radix-ui/*`, `react-resizable-panels` are all unchanged in every
diff), and the production audit passes on all five. **[reproduced]**

Three things that follow from this triage and *do* sit on the critical path:

- **#38 blocks Phase 2 and Phase 3**, in the sense that merging it would break their design.
  Leaving it open blocks nothing; **merging it** would. Close it.
- **#36 should be decided *by* Phase 1**, not before it — Phase 1 is what pins Electron and
  therefore what determines the correct `@types/node` line.
- **The vitest/vite criticals should be scheduled before Phase 6.** They are not in this
  queue and cannot enter it while the queue is full. This is the one item here with a hard
  ordering constraint against the pivot, and it is the reason the two "close" recommendations
  above matter beyond tidiness.

---

## 5. What I could not determine

- **Whether `gh pr checks` returns non-zero on a purely *pending* PR.** No PR had a pending
  leg during this triage, so the HANDOFF §11 trap could not be re-measured. The rule was
  applied regardless — every status above is read from the status column.
- **Whether the `eslint-plugin-react-refresh` 0.5.x behaviour is a deliberate tightening or
  an upstream regression.** The changelog's stated intent (better distinguishing
  `Object.keys(Record)` from HOCs) points to regression, and I found no matching upstream
  issue — but I could not confirm one exists or that the maintainer agrees. If it is
  deliberate, the config dilution becomes unavoidable and the recommendation for #34 changes
  from "hold" to "hold pending a doctrine decision."
- **The exact `--force` failure mode for TypeScript 7 + typescript-eslint.** The
  `TypeError: … reading 'Cjs'` crash is [reported] from a single web source and was **not**
  reproduced — reproducing it would require an install, which is forbidden in this tree. It
  does not change the recommendation: the ERESOLVE at `npm ci` is [reported] from four CI
  logs and is sufficient on its own.
- **Whether `@vitejs/plugin-react` needs to move with `vite` 8.** Stated above as [reasoned]
  from its peer relationship; not verified. It matters only for sizing the security
  migration, not for any recommendation here.
- **The precise Electron version Phase 1 will pin,** and therefore the correct `@types/node`
  major. No pin exists anywhere in the repo or the plan yet.
