# HANDOFF — LEAPWare ShellUX

Last updated **2026-08-15**, after the constant-freeze and error-code-trust landing on
branch `ci-runs-full-verify`. The audit content below still dates from 2026-08-01 except
where a section says otherwise. Read this before touching anything. Correct anything you
find stale, but do not delete a finding without checking it.

---

## 0. Keeping this document true

**This file is updated and merged after every landing — not at the end of a session.**
It is a crash-recovery measure. A previous session crashed and lost its entire context,
and this document is the only thing that survives that.

The rules:

- **Landing a change without updating this file is an incomplete change**, in exactly
  the sense the quality doctrine treats documentation as part of the change rather than
  a follow-up sweep.
- Anything not yet merged goes in **§1 Currently in flight**, with: what it is, which
  branch or agent owns it, what state it reached, and what is left. That section is
  **rewritten every time something lands**, and it is the first thing a resuming session
  should read.
- **The counts here go stale within hours.** Issue numbers, test counts, SHAs and
  milestone totals all move while agents file concurrently. A resuming session should
  **re-derive them** — `git fetch --all --prune`, `gh issue list`, `gh pr list`, the
  milestone endpoint — rather than trusting them. **The numbers in this document are a
  starting point, not a source of truth.**
- **Line numbers rot faster than counts, and this file has already been burned by one.**
  Added 2026-08-13. §6.2 cited `SHELL_UX_ERROR_CODES` at `types.ts:770`; adding a
  docblock above it in the same session moved it to **`:848`**, and `HYDRATION_LIMITS`
  moved from `HydrationEngine.ts:211` to **`:219`** the same way. Both numbers in this
  file were wrong within one session of being written, without anybody touching the
  constant itself. **Re-derive every location in this document by searching for the
  symbol, never by jumping to the line.** A line number here is an orientation aid and
  is not evidence — which is exactly the standard §0 already applies to counts, extended
  to the thing that decays faster.

---

## 1. Currently in flight

Rewritten **2026-08-15**, amended **2026-08-16** with "The `SHELL_ICONS` freeze" below —
the one item in flight that is not yet committed. The section below this one is the
2026-08-01 state and has not been re-verified since; treat every SHA, count and issue
number in this file as stale until you re-derive it (§0).

### The constant-freeze and error-code-trust landing — branch `ci-runs-full-verify` — **COMMITTED AND PUSHED, NOT MERGED**

**State reached: written, green on `check:portability`, `check:citations`, `lint`,
`typecheck` and the targeted vitest runs, and committed. Pushed to `origin`. Not merged,
no PR open, and `npm run verify` not run to a clean exit in one invocation.** The change
is two commits on `ci-runs-full-verify`:

- `a51c639` — `ci: run the full verify chain on every leg, not a hand-copied subset`
- `72c264a` — `feat(core): freeze host constants at runtime, move the error-code trust
  decision out of reach, add build config and a root fault boundary`

When this was written, `origin/ci-runs-full-verify` was at `72c264a`, the working tree
was clean, and `main` — local and remote — contained neither commit. **Those SHAs are
perishable in exactly the sense §0 means**: re-derive them with `git log --oneline`
rather than trusting them, and confirm the tree with `git status --porcelain`.

**Two waves of code landed, and the second is the one a reader will get wrong.**

*Wave 1 — the freeze trio, which is §6.2 and §8 rows 6 and 7 below, now done:*

- `src/core/types.ts` — `SHELL_UX_ERROR_CODES` is `Object.freeze(new Set(...))`.
- `src/core/services/HydrationEngine.ts` — `HYDRATION_LIMITS` is `Object.freeze({...})`
  and the `as const` is gone. **The literal types are preserved.** Measured 2026-08-13,
  non-vacuously: `const n: 65536 = HYDRATION_LIMITS.MAX_RAW_LENGTH` compiles, and the
  same line against `99999` errors `TS2322: Type '65536' is not assignable to type
  '99999'` — so the property's type is the literal, not `number`. `Object.freeze` has an
  overload returning `Readonly<T>` that keeps literal types for an all-primitive object.
  What was given up is *deep* readonly, which for a flat table of numbers is nothing.
  **Do not write that the types were widened; they were not.**
- `src/core/__tests__/hostConstants.test.ts` — the hand-maintained list of six names is
  replaced by a walk over the export namespaces of `RegistryContext.tsx`, `types.ts` and
  `HydrationEngine.ts`. **Ten** constants were gated by this landing, and
  `FREEZE_EXEMPTIONS` is empty. The module list is still hand-maintained, at module
  granularity. **Superseded on 2026-08-16 by the `SHELL_ICONS` fix below: four modules,
  thirteen exports, exemption map still empty.** Re-derive the count from the it.each
  titles rather than trusting either number (§0).
- `vite.config.ts` — `base: './'`, `build.sourcemap: true`, `build.target: 'es2022'`.
- `src/App.tsx` — the provider tree is wrapped in
  `<FaultBoundary boundaryLabel="The shell" extensionId={null}>` as the outermost
  element, with a new test file `src/__tests__/AppRootBoundary.test.tsx`.
- `src/dev/DevShell.tsx` — the same wrap, for the same reason, because
  `dev.html` → `src/dev/main.dev.tsx` → `DevShell` is a **second entry point** that
  `App.tsx`'s boundary cannot reach. **No test imports `DevShell`**, so this wrap is
  unproven by the suite; see the closed entry in §6.
- `src/__tests__/IntegrationSuite.test.tsx` — docblocks only. The `Harness`
  docblock now says it composes the provider ORDER and not the root boundary, so
  nothing asserted through it is read as evidence about that boundary.

*Wave 2 — the trust-check hardening. Read this before editing any prose about error
codes:*

- `src/core/types.ts` — the module-private table `SHELL_UX_ERROR_CODE_MEMBERS` carries
  `__proto__: null`, and a new export `isShellUXErrorCode(code: unknown)` reads it with
  `=== true`.
- `src/core/RegistryContext.tsx` — `toShellUXError` calls `isShellUXErrorCode`. It no
  longer interrogates the exported set at all.
- New test file `src/core/__tests__/errorCodeTrust.test.ts`.
- `src/core/__tests__/registryNormalization.test.tsx` — a new end-to-end test,
  "refuses an attacker-chosen code smuggled into the exported code set", which
  `add`s the code onto the exported set, asserts the widening really took, drives
  `register`, and repairs the set in a `finally`. Plus four assertions swapped off
  `SHELL_UX_ERROR_CODES.has` onto `isShellUXErrorCode`.

**The exact guarantee, worded the way it must stay worded.** *Unconditional, an
integrity control:* the `code` on a `ShellUXError` returned by `register` is always one
of the host's own, against any caller however hostile. The decision is
`isShellUXErrorCode`, reading a module-private, frozen, null-prototype table no importer
can reach — immune to widening the exported code set, to poisoning the `Set` prototype's
lookup method, and to `Object.prototype` pollution. **About `SHELL_UX_ERROR_CODES` say
exactly this and no more:** it is an enumerable list, it is **not** the trust decision,
and nothing production-side interrogates it. Its lookup method **cannot be replaced**;
its **membership can still be changed** by any importer. Never write "immutable" or
"cannot be changed" about it. **For every other frozen `Set` — `HOTKEY_KEYS`,
`RESERVED_IDS`, `PANE_IDS` — the old rule still binds: "cannot be replaced" ONLY.** The
stronger claim is licensed for the predicate, never for a set. **The threat-model limit,
which must be stated wherever the guarantee is:** this defends against plug-in code
running *after* the host module graph evaluates. An attacker executing before `types.ts`
evaluates can replace `Object.freeze` itself, and nothing in the module can defend
against that.

Two things never to write about any of it: that `Object.freeze` protects a `Set`'s
**contents**, and that an ES module import **copies** a value. Imports are live bindings.

**Documentation landed with it, on 2026-08-13**, which is the rest of what this section
covers: `SECURITY.md`, `README.md`'s host-constants bullet, ADR-0001 Decision 5 and its
`Record<X, true>` exemplar paragraph, the source docblocks listed above, and five
follow-ups filed in
`.github/ISSUES_MANIFEST.md`.

**What remains, in order:**

1. `npm run verify` has **not** been run to a clean exit in one invocation. Targeted
   checks were run and are green, and `verify:ci` — the first eight stages — was run
   green after the commits, with `audit:prod` run green separately earlier; but all nine
   stages in a single invocation has never happened, and that is the gate that matters.
   (Recorded from the landing session; not re-run when this was written.)
2. Open a PR and merge to `main`. The branch is pushed and complete; nothing about
   staging remains.
3. No issue numbers assigned to the five follow-ups; they exist only as manifest
   entries.
4. ~~`SHELL_ICONS` (follow-up 1) is the one with a reproduced attack behind it and is the
   first thing to pick up.~~ **DONE 2026-08-16** — picked up and closed; see "The
   `SHELL_ICONS` freeze" immediately below. The remaining four follow-ups are untouched.

**Review outcome.** Five adversarial rounds ran over this landing before it was
committed. Round five was clean — no Blocker, High or Medium. Findings by round
(Blocker/High/Medium): 3/1/3, 0/1/2, 1/1/2, 1/0/3, 0/0/0. Every finding after round one
was in prose rather than in code, and **this file produced findings in three separate
rounds** — a false reproduction tag, a false premise, an instruction that could not be
executed, a rotted line number and a wrong count. **The standing lesson: the prose in
this document is its own repeated defect source, because prose is rewritten faster than
it is counted.** Count before writing a number here, and prefer deleting a claim to
restating one.

#### Decisions taken, and what was rejected

The rejected half is the load-bearing half: it is what stops a decision being
re-litigated by the next session that has the same first idea.

| Decision | Rejected, and why |
|---|---|
| **Harden the trust check in code.** `toShellUXError` now calls `isShellUXErrorCode`. | **Amending `SECURITY.md` down to a narrower claim.** That was available and cheaper — the file said the control was unconditional, the code did not deliver it, and weakening the prose would have made the pair true. The owner chose to make the **code** match the claim rather than the claim match the code. Do not re-open this by proposing the prose edit again. |
| **File the `SHELL_ICONS` finding; do not fix it.** *(Superseded 2026-08-16: the owner asked for it, and it is fixed — freeze, gate and render-site tests, exactly as this row specified. Kept because the second rejection below is still the standing rule for the next such finding.)* | Two rejections, not one. **Fixing it in this landing** — rejected as a components change riding on a core change, in a diff nobody could review as one thing. **Freezing the `Map` while leaving the gate's module list alone** — rejected as the worse half: it closes this instance and leaves the gate structurally blind to the next, which is exactly how `HYDRATION_LIMITS` shipped. The fix is freeze **and** gate **and** a test at the render site. |
| **`base: './'` in `vite.config.ts`.** | **A hardcoded host.** Not a style preference: `npm run check:portability` fails the build on a hardcoded network host in a tracked non-Markdown file, and `vite.config.ts` is one. The relative base is the only option that passes the gate this repository already enforces. |
| **Root `FaultBoundary` in `src/App.tsx`, outermost.** | **Putting it in `src/main.tsx`.** `main.tsx` needs a real `#root` element and is rendered by no test in the suite, so a boundary there would be **untestable** — a top-level error boundary nobody can prove catches anything is the defect it is meant to fix, in a new place. In `App.tsx` it is exercised by `src/__tests__/AppRootBoundary.test.tsx`. |
| **Keep `SHELL_UX_ERROR_CODES` exported.** | **Deleting it.** Removal would have required editing ADR-0001 and `HANDOFF.md` prose that the code agent could not own end to end in the same change, and a half-removed export cited by stale prose is worse than a kept one. Kept safe by a mechanical scan gate instead of by intention: nothing production-side may interrogate it, enforced as a source scan over every non-test module under `src/`. **The scan is on the IDENTIFIER, not on `.has`** — a `.has`-only scan was reviewed and rejected on 2026-08-13, because aliasing to a local, a computed member access, spreading into an array and `Array.from` all walk past it and every one of them is exactly as forgeable, `add` still working on a frozen `Set`. There is **no allowlist and exactly one exemption**: the declaration's own line in `src/core/types.ts`, matched on its exact text so nothing can be interrogated through it, and asserted to be the only forgiven site by "is exempted at its own declaration line and at no other site". **Consequence for writers:** prose *inside `src/`* that needs to discuss this export must refer to it without naming it, or the gate fails. |

### The `SHELL_ICONS` freeze — branch `ci-runs-full-verify` — **WRITTEN AND VERIFIED, UNCOMMITTED**

Added **2026-08-16**. This is the fix for follow-up 1 in `.github/ISSUES_MANIFEST.md`,
the one with a reproduced attack behind it, and the owner named it the precondition for
making this repository public. **State reached: written, red-then-green demonstrated,
`npm run verify:ci` run to a clean exit. Nothing is staged or committed** — the working
tree carries it and a separate agent owns landing it.

Nine files, and no others: `src/components/ui/shellIcons.tsx`,
`src/core/__tests__/hostConstants.test.ts`,
`src/components/__tests__/ShellLayoutIcons.test.tsx`,
`src/components/__tests__/RibbonToolbar.test.tsx`, `README.md`, `SECURITY.md`,
`docs/adr/0001-ioc-registry-architecture.md`, `.github/ISSUES_MANIFEST.md` and this file.
`package.json` and `.github/workflows/ci.yml` were **not** touched, by instruction.

What it does, all three parts in one change as the manifest specified:

- `SHELL_ICONS` is `Object.freeze(new Map(...))`. `FALLBACK_ICON` and `OVERFLOW_ICON` are
  frozen too, and the reason is worth keeping: **React freezes a `ReactElement` only in
  its `__DEV__` branch**, so both were already frozen under Vitest and would NOT have
  been in the production bundle. Without the explicit calls the gate would have passed
  for a reason the build does not preserve. **No `FREEZE_EXEMPTIONS` entry was needed —
  that map is still empty**, so the prose in several files saying so is still true.
- `GATED_MODULES` gains `components/ui/shellIcons`, a fourth module. The walk went from
  ten exports to thirteen; the anti-vacuity floor names all three. The shadow test's
  member list gained `get`.
- Both render sites are pinned: "refuses an own get on the icon table, so the collapsed
  track still draws host geometry" in
  `src/components/__tests__/ShellLayoutIcons.test.tsx`, and "refuses an own get on the
  icon table, so the ribbon still draws host geometry" in
  `src/components/__tests__/RibbonToolbar.test.tsx`.

**The red was observed, not assumed.** With `Object.freeze` removed from the declaration,
four assertions failed across three files, and two of them failed on rendered output: the
collapsed rail drew `[ 'M0 0h16v16H0z' ]` where the `box` glyph belonged and the ribbon
drew the same where `save` belonged — attacker geometry inside host chrome. Restored, all
73 tests in those three files pass.

**The wording rule, unchanged and still binding.** `Object.freeze` on a `Map` does not
stop `.set()`, `.delete()` or `.clear()` — `Map` state is in internal slots. What it buys
is that `get` **cannot be replaced**. Never write "immutable" or "cannot be changed"
about `SHELL_ICONS`; the same rule the `Set`s have carried since 2026-08-13. It is
demonstrated on a throwaway by "does not claim more than a frozen Map delivers".

**What this does not close:** the module list is still hand-maintained — four entries now
— so a new module exporting an allowlist is still ungated until someone adds a line. That
is the structural residual, and it no longer has a live instance behind it.

### Quality-first working agreement — PR **#71**, `quality-first-agreement` — **OPEN, CI green as of 2026-08-01**

- Commit `c82bfe1`. All three `Verify` legs pass. **Ready to merge.**
- Creates **`docs/adr/0003-quality-over-velocity.md`** and repo-root **`CLAUDE.md`**;
  edits `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md`. Filed issue **#58**.
- **One checkbox is deliberately unticked** — "parallel work is disjoint" — with the
  reason written beside it, because disjointness could not be verified from inside the
  branch. That is the doctrine working, not a defect in the PR.
- **Until this merges, the quality doctrine lives only in §9 of this file.** Neither file
  exists on `origin/main` — re-checked.

### Route the working demo to `/` — **not started, no issue, highest value-to-effort**

See §6.3. `src/dev/DevShell.tsx` is now committed but wired to `dev.html`, so
`npm run dev` still renders an empty shell. **The CPO's top recommendation is half done.**

---

## 1a. Recently landed

### Browser test lane — PR **#70**, merged as **`3ebf86d`**

Commit `da7d89e`; branch `browser-test-lane` preserved. **17 files, +1,389 / −4.**
**[reproduced — commit inspected]**

- Adds `playwright.config.ts` (`testDir: './e2e'`, 2 workers, chromium),
  `e2e/shell.ts` plus five specs — `ribbon-overflow`, `pane-dividers`, `shell-layout`,
  `hotkeys`, `focus-visibility` — `.github/workflows/browser.yml`, `dev.html`,
  `src/dev/DevShell.tsx`, `src/dev/main.dev.tsx`. Modifies `package.json`,
  `package-lock.json`, `tsconfig.json`, `.gitignore`, `README.md`, `CONTRIBUTING.md`.
- **24 browser tests** (8 + 5 + 5 + 4 + 2). **[reproduced — counted]** All CI legs green.
- **`verify` is unchanged and the lane sits deliberately outside it**, so the
  `npm ci && npm run verify` fresh-clone promise stays literally true. **[reproduced]**
  `@playwright/test` is a devDependency.
- `e2e/` is isolated from vitest — vitest's `include` is `src/**` only — and from the
  no-listener scan. **[reproduced — confirmed, not assumed]**
- **`check:citations` now reaches `e2e/`.** Corpus grew from 32 to **37 test files** and
  by nine prose files. **[reproduced — re-measured]** The author verified it bites by
  corrupting a cited title and watching it fail.

**This is the first thing in the repository that can see a defect jsdom cannot.** Both
regressions it targets were proven to bite by breaking them and reverting: removing the
Radix portal turned 4/4 overflow cases red (`visible.width` 1px against `own.width` 34px),
and disabling the resize handle turned 4/5 divider cases red.

> **Record the limit the author volunteered.** A third deliberate break — `w-0` plus
> zeroed `hitAreaMargins` — left **all five divider tests passing**. So those tests prove
> *that a drag occurred*, not that the hit area is any particular size. It is written up
> in PR #70's Limits section. Do not cite them as evidence about hit-target sizing.

---

## 1b. Working-tree discipline

The shared working tree has been held by different agents on different branches through
the session. **One working tree, one git writer.** A commit already landed on the wrong
branch once because this was violated. Use `git worktree add` for anything concurrent;
this update was written in a throwaway worktree for exactly that reason.

---

## 2. Where we are

LEAPWare ShellUX is a pluggable desktop UI shell host. All five originally planned work
items (ISSUE-001 through ISSUE-005) are built and merged. A full audit on 2026-08-01
found the result **is not production-ready**; the next phase is remediation, tracked in
the milestone **Phase 2 — Production Readiness**.

---

## 3. Repository state

Verified 2026-08-01 after `git fetch --all --prune`.

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `3ebf86d` | Head. Merge of PR #70. |
| local `main` | `e504fd3` | **STALE — well behind `origin/main`.** |
| `origin/browser-test-lane` | `da7d89e` | **Merged** via PR #70. Branch preserved. |
| `origin/quality-first-agreement` | `c82bfe1` | **PR #71 open, CI green — see §1.** |
| `origin/phase-1-hotkeys` | `a1df19d` | Merged content; branch not deleted. |
| `origin/phase-2-shell` | `b80cad0` | Merged via PR #33. |
| `origin/docs-security-sweep` | `4509c38` | Merged via PR #56. **Was fast-forwarded to `868fe88` in a local tree by an agent outside its remit — see §11.** |
| 5 `dependabot/*` remotes | — | PRs #34–#38, all open. #35 and #38 cross a major. **#34, #35 and #38 are currently RED on CI** — triage before merging any of them. |

> **FIRST ACTION for a new session:** `git checkout main && git pull --ff-only`.
> Local `main` at `e504fd3` predates the shell merge — a tree checked out there has **no
> `src/components/`** at all. Several confusing "the file does not exist" reports trace
> back to exactly this.

---

## 4. THE SINGLE MOST IMPORTANT FINDING

The CPO review found the incoherence sitting underneath every other finding:

> **The architecture is priced for a third-party extension ecosystem it has no way to
> serve.**

ADR-0001 requires that extensions come from third parties, shipped without host review —
and then correctly rejects the only delivery mechanism that would make that true. So
deep-freezing, host-owned normalisation and hostile-payload validation are all paid for
by a threat model whose subject **cannot ship**. Meanwhile the actual named consumers —
first-party LEAPWare modules — would be better served by a contract half as defensive.

### The blocking decision

**Are third parties real customers in the next 12 months?**

| Answer | Consequence |
|---|---|
| **No** | Delete the third-party threat model. Halve `DEVELOPER.md`. Stop paying for hostile-payload defence. |
| **Yes** | Versioning and distribution become P0, and the current ADR **cannot stand**. |

**Nothing else should be built until this is answered.** It changes what half the
repository needs to be, and every documentation issue in the tracker inherits its scope
from the answer.

---

## 5. THE ENFORCEMENT GAP

This is not a code finding and no commit fixes it. It is the reason the quality doctrine
in §9 has nowhere to attach.

**Branch protection is impossible on this repository, not merely unconfigured.**
**[reproduced]** — both endpoints return **403**:

| Call | Result |
|---|---|
| `GET /repos/.../branches/main/protection` | 403 — "Upgrade to GitHub Pro or make this repository public to enable this feature." |
| `GET /repos/.../rulesets` | 403 — same message |

The repository is **private**, **organisation-owned**, on the **free plan**
(`private: true`, `plan: null`). Consequences, all confirmed:

- **No status check has ever been required.** The green CI legs are advisory.
- **No review has ever been required.** Every merged PR — #6, #33, #56, #69 — has empty
  `reviewDecision` and `reviews: []`. **[reproduced]**
- **PR #33 was +25,796 / −675 across 65 files, authored and merged by the same account,
  with zero reviews.** **[reproduced]**
- The PR template's "paste the real verify output" checkbox is the **only** thing
  standing behind the four stages CI does not run (§12) — and it is self-attested by the
  author who then merges.

**`CODEOWNERS` is inert twice over.** **[reproduced]** Its entire content is `* @LEAPWare-HQ`,
which is the sole author of every PR, and GitHub never requests review from a PR's own
author. Code-owner review also requires branch protection, which is 403.

**The fix is a plan change or making the repository public. It is not code.** Decide it
alongside §4.

---

## 6. Audit findings

Audits so far: architecture, code correctness, security, test quality, production
readiness, repo/CI, deferrals, CPO, plus a second wave covering enforcement and test
integrity. Each finding is tagged **[reproduced]** where confirmed by execution here, or
**[reasoned]** / **[reported]** where it was not re-run.

### 6.1 Data-destroying — Blocker

| Finding | Location | |
|---|---|---|
| Collapsing and re-expanding pane 1 discards the user's layout and persists an **internally inconsistent** record. Measured percentages `40/36/40` sum to 116%. | `ShellLayout.tsx:731` | **[reproduced]** |
| `hasRestoredLayout` is a false sentinel inferred from object identity, so **any** persisted write discards the pixel-intent table permanently. At 1920px viewport the nav pane opens 38% wrong. | `ShellLayout.tsx:733-736` | **[reproduced]** |

### 6.2 Security

**All of §6.2's freeze findings are CLOSED as of 2026-08-13, on branch
`ci-runs-full-verify` (§1) — committed there, not merged.** The originals are struck
through rather than deleted, because the history is the reason the fix is shaped the way
it is.

- **~~`SHELL_UX_ERROR_CODES` (`types.ts:770`) is not frozen.~~ CLOSED, and the freeze was
  not the half that mattered.** The original finding — shadowing its lookup method lets a
  plug-in choose the error code `register()` returns, including masquerading as `REVOKED`,
  falsifying a claim `SECURITY.md` labels an *unconditional* integrity control — was
  **[reproduced]** and was real. The set is now frozen, and **freezing it was necessary
  and was not sufficient**: freezing closes own-property shadowing of the lookup method
  and leaves `add` working, because a `Set` keeps its membership in internal slots rather
  than in properties. A plug-in could still have widened the very collection the host was
  consulting. **No amount of freezing that set closes that**, so the decision was moved
  out of it: `isShellUXErrorCode` in `types.ts` reads a module-private, frozen,
  null-prototype table no importer can name. See §1 for the wording that must be used
  about it, which is narrower than "the set is now safe" and is not the same claim.
  The constant is now at **`types.ts:848`** — see §0 on line numbers.
- **~~`HYDRATION_LIMITS` (`HydrationEngine.ts:211`) is `as const`, not frozen.~~ CLOSED.**
  **[reproduced]**, and it was the exact defect issue #10 closed for `REGISTRY_LIMITS`,
  reintroduced. Now `Object.freeze`, at **`HydrationEngine.ts:219`**. The literal types
  survive the change; only *deep* readonly was given up, which for a flat table of
  numbers costs nothing.
- **~~Replace the hand-maintained freeze list.~~ CLOSED, and the diagnosis was right.**
  `hostConstants.test.ts` now walks the export namespace of each covered module instead
  of naming constants, so exports are gated with an empty exemption map, and a
  constant added to a covered module is gated without anyone acting. **What is left, and
  is a real hole rather than a rounding error:** the list of *modules* is still
  hand-maintained — **four** as of 2026-08-16 — so a new module exporting an allowlist is
  ungated until somebody adds it. `SHELL_ICONS` was the live instance of exactly that;
  it was **closed on 2026-08-16** by freezing it, adding
  `components/ui/shellIcons` as the fourth gated module and pinning the shadow attack at
  both render sites, and the finding is kept with its closure note in
  `.github/ISSUES_MANIFEST.md`. The hole itself is structural and still open — it simply
  has no known instance now.
- **CI never audits the dev tree.** `audit:prod` is `npm audit --omit=dev`, and both
  audit workflows run only that script. Two critical CVEs in `vitest` (CVSS 9.8,
  arbitrary file read/execute) are therefore **structurally invisible** to CI.
  **[reproduced — workflow files inspected]**
- **There is no working way to report a vulnerability. Blocker.** **[reproduced]**
  `SECURITY.md:267-269` instructs reporters to use the Security tab's "Report a
  vulnerability". Private vulnerability reporting is a **public-repository feature**:
  `security_and_analysis` is `null` and `GET /security-advisories` returns **404**.
  `.github/ISSUE_TEMPLATE/config.yml` deliberately carries no `contact_links` — to
  satisfy the `hardcoded-hostname` portability rule — and documents that choice at
  length. `SECURITY.md:275` then falls back to "say so through the private channel you
  *do* have", **which it never names anywhere**. The instruction is circular and there is
  no route in. Same root cause as §5: the repository is private on a free plan.

### 6.3 Production readiness

- **`npm run dev` still renders an empty shell. The CPO's top recommendation is only half
  done.** **[reproduced]** `src/dev/DevShell.tsx` landed with PR #70, but it is wired to
  `dev.html` → `src/dev/main.dev.tsx`. `npm run dev` is bare `vite`, which serves
  `index.html` → `src/main.tsx` → `App`, and `App.tsx` says in its own docblock that
  nothing is registered there. The recommendation was to make the working demo the
  **default at `/`**. **Still open, still the highest value-to-effort item in the
  repository, and it now has no issue.** Do not read PR #70 as having solved it.
- **No runtime plug-in delivery exists at all.** Nothing on `window`, no manifest fetch,
  no dynamic import. The model is compile-time only — deploying today means deploying an
  empty frame. **[reproduced]**
- **~~No top-level error boundary.~~ CLOSED 2026-08-13, not merged (§1) — for BOTH entry
  points, which is the scope this entry originally got wrong.** There are two:
  `index.html` → `src/main.tsx` → `src/App.tsx`, and `dev.html` → `src/dev/main.dev.tsx`
  → `src/dev/DevShell.tsx`. Each now wraps its own provider tree in
  `<FaultBoundary boundaryLabel="The shell" extensionId={null}>` as its outermost
  element, because a React boundary catches only its own subtree and `App.tsx`'s covers
  nothing in the dev tree. **The evidence is not symmetric, and do not read it as though
  it were:** `src/__tests__/AppRootBoundary.test.tsx` covers the `App.tsx` boundary; **no
  test covers the `DevShell.tsx` one** — nothing in the vitest suite imports `DevShell`,
  and `src/dev/**` is outside the coverage gate's include list. Wiring it was still right:
  `dev.html` is the only surface a human can run today, Playwright drives it, and §8 item
  3 proposes routing it to `/`, which would make it production. **Note the follow-up it
  exposed**, filed in `.github/ISSUES_MANIFEST.md`:
  `FaultBoundary`'s exhausted-retry copy says "Switch extension" unconditionally, which is
  wrong wherever `extensionId` is null. That is **pre-existing, not caused by the root
  boundary** — `ShellLayout` already passed `null` whenever no extension is active, which
  is the shell's default state.
- **~~`dist/index.html` uses absolute asset paths with no `base`.~~ CLOSED 2026-08-13,
  not merged.** `vite.config.ts` sets `base: './'`. A hardcoded host was rejected —
  `check:portability` fails the build on one in a tracked non-Markdown file.
- **Sourcemaps: half closed.** `vite.config.ts` sets `build.sourcemap: true`, and the JS
  map is complete — 75 `sources` and 75 `sourcesContent` entries, first-party `src/`
  modules included. **No CSS map is emitted**: no `.css.map` file and no
  `sourceMappingURL` in the built CSS. **Observed, not diagnosed** — filed as an open
  question in `.github/ISSUES_MANIFEST.md`, not as a defect. No observability and no
  deploy story remain open. **[reasoned]**
- **Browser target: declared in the build, still undeclared as a policy.**
  `vite.config.ts` now sets `build.target: 'es2022'`. That does **not** close the
  `Object.hasOwn` finding, and the distinction is the point: `Object.hasOwn` is a runtime
  **library** API, not syntax, so a `target` neither downlevels nor polyfills it. Floor
  implied — Safari 15.4+, Chrome 93+, Firefox 92+ — and nothing in the repository declares
  a supported range. Filed in `.github/ISSUES_MANIFEST.md`. **[reasoned, not measured on
  any real browser; the browser lane is Chromium only and cannot see it]**

### 6.4 Correctness

- `DatabasePlugin` declares `icon` keys and never uses them, so issue #19's "C A C"
  collapsed-rail bug is **still live in the extension** while the host fix and its
  documentation both say it is closed. **[reproduced]**
- `describeHotkey` has **zero production callers**, yet two documents claim it is the
  ribbon tooltip. Consequence: **no sighted user can discover that any keyboard shortcut
  exists.** **[reproduced]**
- `ShellStateStore.subscribe` does not validate its argument, while the banner above it
  claims every member does. One `undefined` callback wedges every subsequent write.
  **[reproduced]**
- `DEVELOPER.md:1849` tells extension authors that a containment guarantee does not exist
  when it does — and contradicts itself about 500 lines earlier. **[reproduced]**

### 6.5 Test integrity

**The coverage number is real but narrower than it reads, and the mutation result is
genuinely good. Both halves matter.**

- The 100% gate is measured over roughly **72% of tracked source** — the audit measured
  9,733 of 13,484 lines. The mechanism is **[reproduced]**: `vitest.config.ts` scopes
  coverage `include` to `src/core/**`, `src/components/**` and `src/hooks/**` only.
  Everything else is outside the gate — `src/mocks/**` (**1,909 lines, measured**),
  `src/App.tsx` + `src/main.tsx` (**55 lines, measured**), and both gate scripts
  (`check-citations.mjs` 918 + `check-portability.mjs` 869 = **1,787 lines, measured**).
  The audit's three component figures reproduce exactly; the 9,733/13,484 ratio itself
  is **[reported]** and was not re-derived.
- **Say the good half too:** inside that 72%, mutation testing killed **18 of 19** valid
  mutants, and the one survivor is an *equivalent* mutant — unreachable behind a
  `DUPLICATE_HOTKEY` invariant. **The logic is genuinely well tested.** **[reported]**
- **What is uncovered is the presentation layer — which is exactly where both
  data-destroying defects in §6.1 lived.** That is the finding, not the percentage.

**Two confirmed vacuous tests.** Both re-verified here by mutation:

| Test | Mutation applied | Result |
|---|---|---|
| `ShellLayout.test.tsx:476` — the collapse-during-divider-drag case | Deleted all three `fireEvent.pointer*` lines | **39/39 still pass.** The assertions only check track width, separator count and pane sum, none of which the drag touches. **[reproduced]** |
| `IntegrationSuite.test.tsx:973` — the badge-timer case | Emptied the `setInterval` body at `DatabasePlugin.tsx:645` | **Still passes.** Both assertions are shape-only regexes, and one reads the value captured *before* the clock advanced. **[reproduced]** |

`IntegrationSuite.test.tsx:1300` fires the identical pointer sequence as the first one
and **correctly titles it as impossible in this jsdom**. Two files, same mechanism,
opposite claims. Whichever is right, they cannot both be.

### 6.6 `check-citations` has a hole that makes it partly ornamental

**[reproduced]** — measured with the checker's own exported functions.

`patternFor` compiles a parameterised title to a regex. **When the placeholder is the
final token, the regex degenerates to a prefix match**: a title of the form
`rejects <placeholder>` compiles to a pattern matching any title beginning with those
words.

Measured against the current suite (31 test files, 981 title entries, 1,704 concrete
titles):

| Parameterised title | Concrete titles it also matches |
|---|---|
| the `rejects` one | 40 |
| the `accepts` one | 23 |
| the `discards` one | 8 |

**17 currently-cited titles are shadowed by a trailing-placeholder pattern — rename any
of them and the gate stays green.** (The audit reported 18; my independent count is 17.
The one-title difference is not worth chasing; the mechanism and the order of magnitude
agree, and the fix is the same either way.)

**But this is a loaded gun, not a live wound.** Also measured: of 357 distinct cited
titles, **348 resolve exactly** and **0 resolve only via a regex**. Nothing today depends
on the hole. Fix it before that stops being true. The checker's own test aimed at this
risk **cannot exhibit it**, because its fixture has a long literal tail.

### 6.7 Product

- `VirtualizedList` — 1,441 lines, **zero consumers**, not even the 280-row inventory
  mock. **[reproduced]**
- Roughly **4,700 lines of meta-tooling** that checks the repository about itself, versus
  **0 lines** persisting the user's place in their work. **[reasoned — approximate]**
- The shell restores how wide you dragged the dividers, and forgets which folder you were
  in. The persisted `extensions` scope is **permanently empty**, because no `IShellAPI`
  member persists anything into it. **[reproduced]**

### 6.8 Silent debts with no owner

- ADR §5 (lazy loading) is flagged "decision only" and **no work item names it anywhere**.
- Six of nine `PINS A KNOWN LIMIT` entries say "no issue filed", verbatim.
- The `unregister` ownership model is said to need "its own issue and threat model" in
  **four** separate places. No such issue exists.

### 6.9 Corrections to earlier findings — do not act on the originals

- **The `shellApi.test.ts` order-dependence claim does not reproduce.** Reported by an
  early audit; since tested independently, most recently on **2026-08-13 at six explicit
  seeds** (`--sequence.shuffle --sequence.seed=1..6`, that file alone).
  **109/109 passed every time.**
  **Downgraded to: reported, not reproduced — do not act without a failing seed.**
  Issue #64 already records that the reported order-dependence does not reproduce; keep
  it that way. **[reproduced — the non-reproduction, that is]**

  **CORRECTED 2026-08-13. This entry used to say `--sequence.shuffle` reorders *files*,
  not cases, and concluded from that premise that only one case order had ever been
  measured. The premise is false and the conclusion built on it is withdrawn.** Measured:
  one file run at seed 11 and at seed 22 under `--reporter=verbose` emitted its cases in
  two different orders — `hostConstants.test.ts` led with "does not claim more than a
  frozen Set delivers" at one seed and with an `EMPTY_SCOPED_STATE` case at the other.
  The flag shuffles **cases within a file as well as files**, so each seed is a genuinely
  different case order and six seeds are six of them.

  **The narrow conclusion that survives, which is the one to keep:** the manifest's claim
  **has lost its evidence without anything replacing it**. It is still not *disproven* —
  no finite number of seeds proves order-independence, and the failing order the original
  audit reported may simply not be among the ones drawn. What is gone is the separate,
  weaker excuse that nobody had ever varied case order. Six seeds have now, and the file
  was green under all six. Do not act without a failing seed, and do not re-derive the
  files-only premise: it was checked and it is wrong.

  **This is the best worked example the project has produced — read it before trusting
  any single run.** The claim passed through three states: (1) repeated as fact from the
  manifest; (2) apparently *confirmed* — a junctioned `node_modules` produced 104 failures
  that looked exactly like the predicted order-dependence; (3) contradicted by a clean run
  (31 files, 1,079 tests, green under shuffle — and again on 2026-08-13 at 33 files and
  1,094 tests; **both counts are perishable, re-derive them**). **Stopping at state two would have written
  a false claim into the file every future session reads, backed by evidence that was an
  artifact of the author's own setup.** Corroboration that arrives from a broken
  environment is not corroboration.

---

## 7. Issue tracker state

Counts verified 2026-08-01. **See §0 — re-derive these, do not trust them.**

- Milestone 1 — **Phase 2 — Production Readiness**: **35 open**, 0 closed.
- **46 issues open in total.** So **11 open issues — #58 through #68 — are NOT attached
  to the milestone.** They were filed after it was created. **Sweep them on.**
- 14 issues closed. 5 PRs open, all Dependabot dev-dependency bumps (#34–#38).

| Group | Issues |
|---|---|
| **BLOCKER** | **#39 — nobody has ever run the app.** Plus **three items with no issue at all**: routing the demo to `/` (§6.3), the §5 enforcement gap, and §6.2 vulnerability reporting. **File all three.** |
| RESEARCH / DECISION | #68 (versioning mechanisms conflict), #67 (theming), #65 (build a real first-party module) |
| CORRECTNESS | #10, #16, #17, #20, #21, #22, #23, #24, #25, #26, #64 |
| CONTRACT | #28, #29, #30, #31, #32, #57, #66 |
| TESTING | #40, #42, #59, #60, #61, #62, #63 |
| DOCS | #4, #27, #41, #43, #44, #45, #46, #47, #48, #49, #50, #51, #52, #53, #54, #55 |
| TOOLING / CI | #58 (CI does not run all of `verify`), #62 |
| DEFERRED | #29 and #31 carry prior-art analysis whose scope depends entirely on §4 |

Grouping is editorial, assigned from issue titles. The tracker's only labels are
`bug` / `enhancement` / `documentation` / `question`, so **this taxonomy exists nowhere
but this file.** Creating the labels would be cheap and would make it survive.

---

## 8. Recommended sequence

Cheap and high-value first; and the decisions gate everything downstream.

| # | Work | Why here |
|---|---|---|
| 1 | **Answer §4: are third parties real customers in the next 12 months?** | It decides whether roughly half the open documentation and contract issues are worth doing at all. Doing them first risks polishing work the answer deletes. |
| 2 | **Answer §5: pay for the plan tier that allows branch protection, or make the repository public?** | Until one of those, no doctrine in §9 can be *enforced* — only asked for. It also unblocks §6.2, which shares the root cause. |
| 3 | **Route the working demo to `/`** — file an issue first | Roughly a one-line change to what `npm run dev` serves. Until then nobody can run the product, nothing can be validated by a human, and #39 — the sole tracked Blocker — cannot even be started. **PR #70 landed the component but not the routing.** |
| 4 | **Merge PR #71** (`quality-first-agreement`) | Already green. It is what §9 should point at instead of restating, and everything after this benefits from having the doctrine written down. |
| 5 | **The two layout defects** (`ShellLayout.tsx:731`, `:733-736`) | The only findings that destroy user data. Both reproduced. Both small. **The browser lane can now see them.** |
| 6 | ~~**The two `Object.freeze` lines**~~ | **DONE 2026-08-13, not merged (§1).** It turned out to be more than two lines each: freezing the error-code set was necessary and not sufficient, and the trust decision moved into `isShellUXErrorCode`. The exports-walking test landed with it. |
| 7 | ~~**Root error boundary**~~ | **DONE 2026-08-13, not merged (§1).** In `src/App.tsx`, not `main.tsx` — see the rejected alternatives in §1. |
| 8 | Fix the two vacuous tests and the `patternFor` hole | §6.5 and §6.6. Do it before the hole is load-bearing. |
| 9 | Triage the three red Dependabot PRs | #34, #35, #38 are red. #35 and #38 cross a major. |
| 10 | Everything else, by milestone priority | — |

---

## 9. The quality doctrine

**As of `3ebf86d`, `docs/adr/0003-quality-over-velocity.md` and the repo-root `CLAUDE.md`
do not exist on `origin/main`.** They are the content of **PR #71**, which is open and
green. **Once it merges, replace this section with a pointer to those two files.**

Until then, the doctrine to apply:

> **Review precedes merge. Never follows it.**

The review loop:

1. Severity rubric: **Blocker / High / Medium / Low**.
2. Terminate on a **clean round** — not on zero findings.
3. A **different reviewer every round**.
4. Findings **must trend down** round over round.
5. Cap at **three non-converging rounds**; escalate rather than loop.

Read this next to §5: today none of it is enforceable by the platform. It holds only
because people choose to hold it.

---

## 10. The scrum-master role for the next session

One session owns delivery. Concretely, that role:

- **Owns the milestone.** Keeps issues attached, keeps the grouping current, closes what
  is genuinely done.
- **Owns this file.** Updates §1 on every landing — see §0.
- **Runs the review loop** in §9, and enforces the different-reviewer rule.
- **Assigns severity by the rubric**, not by whoever filed it loudest.
- **Has explicit authority to refuse a merge**, including their own agents' work. In the
  absence of branch protection (§5) this authority is the *only* gate that exists.
- **Reports progress against the milestone, not against activity.** "Six issues closed of
  35" is a report. "Four agents dispatched" is not.

---

## 11. Traps — things that have already cost time

| Trap | What it costs |
|---|---|
| **jsdom has no layout engine.** No `PointerEvent`, no `ResizeObserver`, no `scrollIntoView`; `getBoundingClientRect` returns 0×0. | **Two shipped defects passed fully green suites** because of this. A green suite is not evidence about geometry. |
| **A green test is not a test.** Two confirmed vacuous cases in §6.5. Before trusting one, delete the line it is supposedly about and watch it fail. | Two tests bought nothing for months. |
| **`Object.freeze` on a `Set` does not stop `.add()`.** | Freezing the wrong container reads as a control and is not one. |
| **The linking parser matches a closing keyword inside a sentence saying the opposite.** | It auto-closed an issue here. Keep every closing keyword away from every issue reference unless you mean it. |
| **Two agents doing git operations in one working tree** | Put a commit on the wrong branch. **One working tree, one git writer.** Use `git worktree add`. |
| **`check-citations` trailing-placeholder prefix match** | See §6.6. A short citation can resolve *vacuously*. Green does not mean cited. |
| **`ISSUE-00N` (manifest) versus `#N` (GitHub) collide** | A phantom `ISSUE-006` is cited 31 times across 12 files with no manifest section defining it. Tracked as #53. |
| **`gh pr checks` returns NON-ZERO while checks are still pending** — not 0. Measured here: exit **1** on a PR with pending legs, and exit **1** on a PR with failed legs. An audit reported exit 8 for the pure-pending case; I could not isolate it. | Either way the rule holds: **a non-zero exit does not mean failed — it may mean pending.** Any script treating non-zero as failure will misread a run in progress. Read the status column, not the exit code. |
| **A branch was moved by an agent outside its remit.** A `git merge origin/main` ran while another agent held the shared tree on `docs-security-sweep`, fast-forwarding it `4509c38` → `868fe88`. | Non-destructive, already-merged content, and left in place. But it reinforces the rule: **one working tree, one git writer.** |
| **Transient probe edits alarmed two auditors.** An agent deliberately broke `ShellLayout.tsx` to prove the tests bite; two concurrent auditors read the working tree and filed it as a live defect. | Wasted two audits. **Announce a probe window before deliberately breaking a shared file — or do it in a worktree.** This update's mutation probes were all run in a throwaway worktree for that reason. |
| **Memory exhaustion on this 8GB machine** | `test:coverage` was OOM-killed twice under concurrent load. **Limit concurrency.** |
| **The machine is in a degraded state as of this writing.** ~620 MB free across ~572 processes, with orphaned `vitest` and `vite-node` processes from earlier agents still resident. `verify` died twice on resource exhaustion — exit 127 `fork: Resource temporarily unavailable`, and `-1073740791`. Playwright workers died with `spawn UNKNOWN`. | **Recommend a restart before the next session.** And the standing rule: structural-looking failures should be suspected as environmental **first**. |
| **A partial `npm install` produces *fake* failures.** A truncated `ajv` file and a missing `lib.es2022.d.ts` surfaced as bogus lint crashes and **13 phantom TypeScript errors**. A junctioned `node_modules` separately produced **104 failures** that mimicked a real predicted defect. | A new maintainer would reasonably file those as defects — and one audit nearly wrote the junction artifact into this file as a confirmed finding (§6.9). **Suspect the environment before the code when failures look structural.** Reinstall, then re-run, before believing them. |
| **A NAMED agent has no `Edit`, `Write` or `Bash`. A NAMELESS subagent has the full toolset.** Added 2026-08-13. Naming a dispatched agent — making it addressable as a teammate — is what strips the write tools, not any other setting. | **Two entire sessions of zero-write dispatches**, each looking like the worker had silently refused the task. See the correction immediately below this table: the previous session diagnosed this WRONGLY and the wrong diagnosis is what cost the second session. |
| **`check:citations` resolves titles ACROSS LINE BREAKS.** Added 2026-08-13. A cited title wrapped over two lines in Markdown is one citation to the checker and two unrelated lines to `grep`. | A line-bounded `grep` **under-reports** — it silently misses every wrapped citation, so a sweep reads as complete when it is not. **Two citation sites were missed this way on 2026-08-13.** Search with a multiline-aware tool, or normalise whitespace first; do not trust a `grep -c` of citation sites. |
| **`check:citations` shells out to `git ls-files` internally.** Added 2026-08-13. | Git activity appearing in a log during a documentation check is **not** evidence that an agent is staging something. One near-intervention on that basis. Read what the git invocation actually was before concluding a worker broke its remit. |
| **`ci-runs-full-verify`'s upstream is `origin/main`, not `origin/ci-runs-full-verify`.** Added 2026-08-15, and **live**. The branch was pushed with an explicit refspec and `-u` was deliberately not passed, so `branch.ci-runs-full-verify.merge` is `refs/heads/main`. Confirmed with `git rev-parse --abbrev-ref ci-runs-full-verify@{upstream}`. | **A bare `git push` or `git pull` on this branch targets `main`.** The fix is one line — `git branch -u origin/ci-runs-full-verify` — and it **had not been applied when this was written**. Re-check the upstream before running either command bare. |
| **Coverage does not see what you probably think it sees.** Added 2026-08-13. `src/core/**/__tests__/**` is excluded, and `src/App.tsx` and `src/main.tsx` sit outside **every** coverage `include` glob. | A change to `App.tsx` — the root `FaultBoundary`, for one — moves the coverage number **not at all**, in either direction. Green coverage after touching those files is not evidence the change is exercised; name the test instead. |

**CORRECTION, recorded explicitly because the wrong version cost a session.** A previous
session diagnosed the missing write tools as *"Remote Control strips tools from every
agent"*. **That is false**, and it is the more expensive kind of false: it says the
capability is unavailable, so the next session stops looking for the working
configuration. The tools are not stripped from every agent. **A nameless subagent gets
the full toolset; giving the agent a name is what removes `Edit`, `Write` and `Bash`.**
The wrong diagnosis does not appear in this file — it was recorded in the previous
session's own notes — so there is nothing here to strike through, and it is written out
in full here so that a resuming session that meets it elsewhere knows it is superseded.

---

## 12. How to verify anything

`npm run verify` chains **nine** stages, in order:

`check:portability` → `check:citations` → `lint` → `typecheck` → `test:coverage` →
`test:integration` → `test:scripts` → `build` → `audit:prod`

**It takes roughly 12–13 minutes**, dominated by `test:coverage` (~351s) and
`test:integration` (~199s) — **and those two overlap**, because `IntegrationSuite.test.tsx`
runs in both. **[reported]** Worth knowing, because "run verify before every commit" is
the doctrine and its cost should be stated rather than discovered.

There is now a **second, separate lane**: `npm run test:browser` runs 24 Playwright tests
against a real Chromium, on its own `browser.yml` workflow. It is **deliberately not part
of `verify`** — see §1a. Run it when touching layout, the ribbon, dividers, hotkeys or
focus, because it is the only thing here that can see what jsdom cannot.

> **STALE AS OF 2026-08-13 — the table below describes `3ebf86d`, and
> `ci-runs-full-verify` no longer matches it.** A **separate, unrelated** change landed
> on that branch as `a51c639` (§1): `package.json` now defines
> `verify:ci` as the first eight stages and `verify` as `verify:ci && audit:prod`, and
> `.github/workflows/ci.yml` runs the single step `npm run verify:ci` on all three
> operating systems. Once that reaches `main`, `check:citations`, `test:integration` and
> `test:scripts` stop being unguarded and issue #58 is closable. **That change was not
> verified by the documentation work that wrote this note** — it was read, not run — and
> the table below is left standing rather than edited so that nobody inherits a
> second-hand claim as a measurement. Re-derive from `package.json` and `ci.yml`.

**CI does not run all of `verify`.** Inspected at `3ebf86d`:

| Stage | On CI? |
|---|---|
| `check:portability` | yes (`ci.yml`) |
| `check:citations` | **no leg** |
| `lint` | yes |
| `typecheck` | yes |
| `test:coverage` | yes |
| `test:integration` | **no leg** |
| `test:scripts` | **no leg** |
| `build` | yes |
| `audit:prod` | yes, but only in `audit-dependencies.yml` / `audit-schedule.yml`, and only with `--omit=dev` |

`README.md` claims `verify` is exactly what CI applies. It is not — five of nine.
Tracked as #58. Read this next to §5: the four unguarded stages are backed only by an
author's self-attestation on a PR nobody is required to review.

Two checks gate every commit and are easy to trip:

- **`check:portability`** — no absolute paths, no drive letters, no home or scratch
  directories, LF endings only, no BOM, no hardcoded network host in a tracked
  non-Markdown file.
- **`check:citations`** — never quote a test title you have not confirmed exists. It only
  inspects quoted strings that follow a citation marker, and see §6.6 for what it will
  miss even then. Since PR #70 its corpus includes `e2e/`.
