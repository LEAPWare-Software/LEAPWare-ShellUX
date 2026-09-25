# Changelog

All notable changes to LEAPWare-ShellUX are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from its first release.

**Nothing has been released.** `package.json` declares `0.1.0` and marks the
package `private`; there is no tag, no published artefact and no comparison link
to offer, so everything below sits under Unreleased. Entries are derived from the
commit history rather than written from memory, and each names the commit it came
from so a reader can check it.

## [Unreleased]

### Added

- **`npm run plugin:check <path>` — the conformance kit, and its CI job**
  (ADR-0006 decision 10 / step 8, #57). `scripts/build-plugins.mjs`'s own
  docblock had said since step 7 that checking a built `.lwplugin` against the
  real validator was "a separate, manual step" with no automation; this closes
  that gap. It is a plain Node CLI (`scripts/plugin-check.mjs`) that takes its
  target from `process.argv[2]` only — never an environment variable
  (ADR-0002) — accepting either a `.lwplugin` file directly or a directory
  holding exactly one, and runs six checks in ADR-0006's own order, stopping at
  the first failure: **Package** and **Contract version**, both by calling
  `electron/main/plugins/pluginPackage.ts`'s real `readPluginPackage` (the
  exact module the main-process installer uses, not a second copy of its
  rules); **Imports**, by parsing the bundle with the TypeScript compiler —
  the same technique `src/__tests__/pluginImportGraph.test.ts` uses — for any
  static import outside the three `/shared/` modules or any dynamic
  `import()`; **Registration**, by loading the bundle as a real ES module
  (`/shared/*` resolved to the real `react`, `react/jsx-runtime` and
  `src/sdk/index.ts` through a Vite SSR server) and handing its default export
  to `RegistryContext.tsx`'s own exported `validateBlueprint`; **Lifecycle**,
  by driving activate → deactivate → release against a real
  `createRevocableShellAPI` handle under a small purpose-built fake clock
  (`createFakeClock`, documented in the script as deliberately narrower than
  `vi.useFakeTimers()`, which needs a Vitest worker this CLI does not run
  under); and **Render**, by mounting each pane view with `react-dom/client`'s
  `createRoot` into a `jsdom` container against a real live shell and an empty
  context, plus every command's `isVisible` against the same context. *Tests:*
  `scripts/__tests__/plugin-check.test.mjs` — "passes every check for a
  well-formed plugin (package, contract-version, imports, registration,
  lifecycle, render)", "Check 1 (Package) — refuses a bundle whose sha512 does
  not match its manifest", "Check 2 (Contract version) — refuses a plugin
  built for a newer major than this checkout offers", "Check 3 (Imports) —
  refuses a bundle that statically imports something other than a /shared/
  module", "Check 4 (Registration) — refuses a default export whose id
  differs from the manifest", "Check 5 (Lifecycle) — refuses a plugin whose
  onRelease does not clear a running interval", "Check 5 (Lifecycle) —
  refuses a plugin whose onActivate throws", "Check 6 (Render) — refuses a
  plugin whose pane view throws on first render with an empty context", and
  "Check 6 (Render) — refuses a plugin whose command isVisible throws on an
  empty context". `.github/workflows/ci.yml` now runs `npm run plugins:build`
  then `npm run plugin:check` against each of the three migrated plugins'
  built output, on all three operating systems. **Not in scope, stated so a
  green kit is not read wider:** layout, painted pixels, focus order, pointer
  behaviour and contrast (owed to the browser lane); whether a plugin is
  well-behaved towards its siblings; and anything about the network.

- **Fixed: six review findings on `scripts/plugin-check.mjs`'s Lifecycle
  check (#221), all reachable from `createFakeClock`/`checkLifecycle`, plus
  two more the same review rounds raised alongside them, before the
  conformance kit's first merge.**
  1. `createFakeClock`'s `advance(ms)` re-armed a due interval at
     `dueAt = now + earliest.delay`; for a **zero-delay** interval
     (`setInterval(fn, 0)`, an omitted delay, or a negative delay — `schedule()`'s
     `safeDelay` clamps all three the same way) that left `dueAt === now`, still
     `<= deadline`, so `advance()`'s `for (;;)` picked the same timer again with
     `now` unmoved and never returned — a plain bad plugin turning into a hung
     CI job, since the step that runs `plugin:check` carries no
     `timeout-minutes`. Fixed by clamping the refire to
     `now + Math.max(earliest.delay, 1)`, so `dueAt` strictly increases every
     time. *Tests:* `scripts/__tests__/plugin-check.test.mjs` — "Check 5
     (Lifecycle) — refuses a plugin whose onActivate never clears a
     zero-delay interval", "Check 5 (Lifecycle) — refuses a plugin whose
     onActivate never clears an omitted-delay interval", and "Check 5
     (Lifecycle) — refuses a plugin whose onActivate never clears a
     negative-delay interval".
  2. A plugin whose `onActivate` deferred STARTING its leak by one microtask
     (`somePromise.then(() => setInterval(...))`, an ordinary pattern) was
     still mid-flight when `checkLifecycle`'s `finally` ran `clock.restore()`
     — calling `lifecycle.onActivate?.(shell)` does not itself drain the
     microtask queue — so that `setInterval` landed on the REAL timers,
     invisible to every check, and the CLI printed a false PASS followed by an
     uncaught `REVOKED` crash once the real interval fired against the
     already-revoked handle. Fixed by awaiting one real event-loop tick
     (`flushMicrotasks`, via the real, unpatched `setImmediate`) after each of
     `onActivate`/`onDeactivate`/`onRelease`, so a leak started from a
     microtask chain of any depth lands on the fake clock as a synchronous one
     does. The script's own banner now also states plainly what this does NOT
     close: a leak whose start instead awaits real I/O outlives one tick and
     is still outside it. *Test:* `scripts/__tests__/plugin-check.test.mjs` —
     "Check 5 (Lifecycle) — refuses a plugin whose onActivate starts an
     uncleared interval from a microtask".
  3. The lifecycle hooks are typed `=> void`, which an `async` function
     satisfies (`ActivationContext.tsx`'s `callHook` docblock says so
     explicitly, and attaches its own rejection handler for exactly this
     reason). `checkLifecycle` called each hook bare
     (`lifecycle.onActivate?.(shell)`, and likewise for `onDeactivate` and
     `onRelease`); an `async` hook that rejects does not throw synchronously
     from a bare call, so its rejection went unattached — an unhandled
     rejection under this CLI's default `--unhandled-rejections=throw`,
     crashing the whole process with a raw stack instead of a clean
     `lifecycle` FAIL. Fixed by awaiting `Promise.resolve(hookCall)` inside
     the same `try`/`catch` at all three call sites, converging a
     synchronous throw and an asynchronous rejection onto the one FAIL path.
     This makes the check deliberately stricter than the live host on two
     points, not one: any hook's async rejection (this fix), and — named
     alongside it once a later review pass pointed out the banner undercounted
     its own divergence — a SYNCHRONOUS throw from `onDeactivate` or
     `onRelease`, which the live host's `runHook` catches and reports through
     `reportFault` without failing deactivation or release, but which this
     check still fails on (only a synchronous `onActivate` throw is fatal on
     the live host, matching this check). The script's own banner names both
     as decisions, not discrepancies. *Tests:*
     `scripts/__tests__/plugin-check.test.mjs` — "Check 5 (Lifecycle) —
     refuses a plugin whose onActivate rejects asynchronously", "Check 5
     (Lifecycle) — refuses a plugin whose onDeactivate rejects
     asynchronously", and "Check 5 (Lifecycle) — refuses a plugin whose
     onRelease rejects asynchronously".
  4. `wrapWithCallLog`'s docblock used the word "structural", which
     `CLAUDE.md`'s vocabulary section bans unconditionally from repo prose;
     reworded to "the same shape a plug-in reads through" without changing the
     claim.
  5. The post-`revoke()` leak scan advanced a FIXED `120_000`ms of virtual
     time. A leaked interval or timeout with a longer delay
     (`setInterval(fn, 200_000)`, never cleared) never had its `dueAt` fall
     inside that fixed window, so its callback never fired and the scan saw
     nothing — a false PASS for a genuinely leaking plugin. Fixed, not merely
     documented as a limit: `createFakeClock` gained `longestPendingDelay()`,
     and `checkLifecycle` now advances
     `Math.max(120_000, clock.longestPendingDelay() + 1)` — sized to the
     plugin's own longest still-pending delay, not a guessed ceiling. This is
     virtual time, not real waiting, so the change costs nothing regardless of
     how long a plugin's own delay is. *Test:*
     `scripts/__tests__/plugin-check.test.mjs` — "Check 5 (Lifecycle) —
     refuses a plugin whose leaked interval outlives the old fixed 120s scan
     window".
  6. A hook can reject INTERNALLY, never returning the rejection at all —
     `onActivate(shell) { Promise.reject(new Error('boom')); }`, fired and
     forgotten, no `return`, no `await`. Awaiting `Promise.resolve(hookCall)`
     (fix 3 above) only ever sees what the hook's own RETURN VALUE carries;
     this settles on its own, asynchronously, as an unhandled rejection Node
     detects on no stack this check is on. Left unhandled, this crashed the
     whole CLI process the same way fix 3's RETURNED-rejection case did,
     except OUTSIDE `checkLifecycle`'s own `finally`, which skipped
     `runChecks`' temp-directory cleanup too — a real, measured leak: a
     `dist-plugins/plugin-check-*` scratch directory was still on disk after a
     crashed run. Fixed by a `process.on('unhandledRejection', ...)` installed
     for `checkLifecycle`'s own duration, checked after every
     `flushMicrotasks()` call — the same cadence a RETURNED rejection is
     already caught at. *Test:* `scripts/__tests__/plugin-check.test.mjs` —
     "Check 5 (Lifecycle) — refuses a plugin whose onActivate rejects
     internally without returning the rejection, and leaves no scratch
     directory behind", which asserts both the clean FAIL and that the
     scratch directory does not outlive the run.
  7. **The post-`revoke()` leak scan — the one phase that exists specifically
     to catch a leak surviving release — was the only one of the four
     lifecycle phases that did NOT `await flushMicrotasks()` before its own
     `internalRejectionFail()` check**, unlike the check after
     `onActivate`/`onDeactivate`/`onRelease` (fix 6 above). A plugin that
     leaks a `setInterval` whose callback rejects internally, and never
     touches `shell` from inside it, defeated both of this check's leak
     defences at once: the `calls.find((call) => call.phase === 'released')`
     scan found nothing (nothing ever called `shell`), and the internal
     rejection — created synchronously inside the `clock.advance(...)` call
     right above — settled as a genuinely unhandled rejection only once
     Node's own microtask checkpoint ran, which the missing `await` gave no
     chance to happen before `process.off('unhandledRejection', ...)` ran in
     this function's `finally`. Confirmed by hand before the fix:
     `checkLifecycle` returned `{ ok: true }` — `plugin-check: PASS` printed
     to stdout — and the rejection then reached the process for real, with no
     listener attached, crashing the CLI after it had already reported
     success. Fixed by adding the same `await flushMicrotasks();` the other
     three phases already use, in the matching position. *Test:*
     `scripts/__tests__/plugin-check.test.mjs` — "Check 5 (Lifecycle) —
     refuses a plugin whose post-release leak rejects internally without
     touching shell".

  `docs/adr/0006-runtime-plugin-host.md` section 10 gained a
  "step 8 landed — the conformance kit, as built" callout (matching steps 2,
  4 and 7's own callouts in that file) naming every defect above as the doc
  of record, alongside what step 8 actually built beyond decision 10's
  original text (the Vite SSR loader for Registration, `createFakeClock` for
  Lifecycle, and the `validateBlueprint`-vs-`register` narrowing).
  `.github/workflows/ci.yml`'s `verify` job gained `timeout-minutes: 20`,
  matching the convention every other workflow in this repo already follows
  (`auto-queue.yml`, `claims.yml`, `pr-evidence.yml`) and closing the gap
  this same PR's own fixes above had, until now, only named as a hazard
  rather than closed at the job level: nothing bounded this job if a future
  regression caused the same class of hang. `scripts/build-plugins.mjs`'s own
  docblock stopped saying checking a built `.lwplugin` against the real
  validator "has not landed yet" — it names `scripts/plugin-check.mjs` and
  the CI step that now runs it, since this PR is exactly the change that
  landed it.

- **Fixed: `npm run plugins:build` emitted a `bundle.js` with NO export
  statement at all**, for any plugin whose source declares a named export and
  nothing in the bundle re-imports it — which is every one of the three
  first-party plugins, since the entry module IS the plugin's manifest.
  Rollup's default tree-shaking for a non-library client build does not
  preserve an unused entry export, discovered while building `plugin:check`'s
  Registration check: `import()`ing a built `hello-example.lwplugin` bundle
  gave a module with no `default` (and no named export at all), so ADR-0006
  §7's "the surface `import()`s each, validates the default export through
  the real `register`" could never have worked once step 6 lands. The failure
  mode was a missing `preserveEntrySignatures: 'strict'` in
  `scripts/build-plugins.mjs`'s `rollupOptions`; `plugins/hello/src/HelloExtension.tsx`,
  `plugins/mail/src/MailPlugin.tsx` and `plugins/database/src/DatabasePlugin.tsx`
  each gained an additive `export default` of the same manifest object their
  existing named export already carries, so no existing importer changed.
  *Test:* `scripts/__tests__/build-plugins.test.mjs` — "preserves the entry
  module default export in the built bundle via preserveEntrySignatures
  strict" — which runs the real `npm run plugins:build` CLI and asserts the
  built `hello-example.lwplugin` bundle's own text ends with an export
  clause naming `default`; verified by hand to fail with
  `preserveEntrySignatures: 'strict'` temporarily removed. Narrower than it
  might read: this runs `build-plugins.mjs` as a subprocess and checks its
  output, not by importing it — `build-plugins.mjs`'s own docblock still
  correctly says no test anywhere IMPORTS it, a different, narrower claim
  this test does not change. (Originally landed disclosed as verified
  manually, not by an automated test — the PR body's `plugins:build` +
  `plugin:check` transcript; this test replaces that disclosure with a
  citable one.)

- **The three first-party plugins move to `plugins/*`, and `npm run plugins:build`
  emits a `.lwplugin` per plugin** (ADR-0006 step 7). `src/mocks/MailPlugin.tsx`,
  `src/mocks/DatabasePlugin.tsx` and `src/examples/HelloExtension.tsx` are now
  `plugins/mail/src/MailPlugin.tsx`, `plugins/database/src/DatabasePlugin.tsx` and
  `plugins/hello/src/HelloExtension.tsx`; `src/mocks/` and `src/examples/` no
  longer exist. Each imports the host only through the bare specifier
  `@shellux/sdk` — never a relative path into `src/core/` — which `vite.config.ts`
  and `vitest.config.ts` now resolve (a `resolve.alias`) to `src/sdk/index.ts` for
  the dev server and for tests; a real build does the opposite, in
  `scripts/build-plugins.mjs`, which marks `react`, `react/jsx-runtime` and
  `@shellux/sdk` EXTERNAL and rewrites them to `/shared/react.js`,
  `/shared/react-jsx-runtime.js` and `/shared/sdk.js` — ADR-0006 decision 5's
  build-time rewrite, applied to a plugin build for the first time. `npm run
  plugins:build` reads each `plugins/<name>/plugin.json` (`id`, `version`,
  `title`, an optional `icon`, and the source entry), bundles it with
  Vite/Rollup into one `bundle.js` (`output.codeSplitting: false`, one file, no
  chunks — decision 1's "one bundle, not a file tree"), hashes it and writes
  `dist-plugins/<id>.lwplugin` in decision 1's exact shape:
  `{ format: "lwplugin/1", manifest, bundle: <base64> }`. Verified against the
  real validator, not a copy of it: `npm run plugins:build`, then a throwaway
  `vitest` case calling `electron/main/plugins/pluginPackage.ts`'s own
  `parsePluginPackage` directly on each of the three built files — full output
  (manifest, bundle byte length, `compatibility: { state: "compatible" }`
  against this tree's `HOST_API_VERSION`, `1.1`) pasted into this change's PR
  body, because nothing in `npm run verify` calls `plugins:build` yet.
  `FIXTURE_EXTENSIONS` is deleted from
  `src/paneview/PaneViewShell.tsx`: the packaged extension surface registers no
  plugin of its own now, and installs none of the three by default. `src/dev/
  DevShell.tsx` still registers `MailPlugin` and `DatabasePlugin`, importing
  their **source** directly (`plugins/mail/src/`, `plugins/database/src/`) for
  the browser dev loop `dev.html` drives — a build per edit would be friction,
  and `dev.html` is not a build input (`vite.config.ts`). The plugins' own tests
  moved with them: `plugins/hello/__tests__/HelloExtension.test.tsx` is
  unchanged but for its imports. `src/examples/__tests__/developerGuideStub.test.ts`
  did **not** move with `HelloExtension` — it reads `DEVELOPER.md` against
  `src/core/ShellAPI.ts` and was never about the example — and now lives at
  `src/__tests__/developerGuideStub.test.ts`. `IntegrationSuite.test.tsx`,
  `ShellLayoutIcons.test.tsx` and `noRawColor.test.ts` were updated to the new
  paths; `noRawColor.test.ts`'s `KNOWN_MODULES` no longer names the two mocks,
  since a scan rooted at `src/` cannot see code that moved out of it. *Tests:*
  `src/__tests__/pluginImportGraph.test.ts` — "reaches no module under
  src/mocks or src/examples, which ADR-0006 step 7 deleted", "walks a real
  graph from paneview.html's own entry, so an empty scan cannot pass
  vacuously", "reports a path under either deleted directory, so the check
  above can fail" — the Implementation-sequence row 7 test, written in
  `crossDocumentIdref.test.ts`'s manner. **What this change did NOT do:** the
  surface loader that would read `state.json` and `import()` an installed
  plugin into the running extension surface (ADR-0006 step 6) has not landed,
  so nothing loads a plugin in the packaged application yet; `plugin:check`
  (step 8) does not exist, and `plugins:build` has no `--verify` flag of its own
  — the `parsePluginPackage` run described above is a narrower, hand-run
  substitute, not that conformance kit; and attaching
  the three `.lwplugin` files to a GitHub Release, or installing them in the
  end-to-end lane (step 10/11), is unattempted and unreachable from this
  sandbox, which cannot launch a packaged Electron app or publish a release.

- **`npm run status` falls back to a local `prove-claims` run when the reference run's
  artifact cannot be downloaded** (`scripts/status.mjs`, docs/cloud/runbook.md lane C item
  0e). In this project's cloud sandbox `gh run download <id> --name claims-results` always
  fails — an outbound proxy blocks it — and until now that made `loadRunContext` throw,
  which `main()` caught and degraded **every** row to `UNPROVEN`, even though the
  reference run's identity, conclusion, sha and ancestry had all been read successfully;
  only the artifact download had failed. Now, when the reference run concluded `success`
  but the download or the read-back of its artifact fails, `loadRunContext` reproduces
  the reference run's rows locally with `node scripts/claims/prove-claims.mjs --mode push
  --out <tmpfile>` — this is where `npm run status` stops being a passive read of
  runs-API state: it runs every configured repo/github row's real check command,
  mutation-probes each repo row in a scratch worktree, and fetches the live ruleset from
  the GitHub API for the S-ruleset comparison, the same commands `prove-claims --mode
  push` always runs, now triggered as a side effect of checking status. The reference
  run itself may have run as `push`, `schedule` or
  `workflow_dispatch` (`claims.yml` sets `MODE: ${{ github.event_name }}`), but
  `isChangeMode()` treats all three identically for row selection and budget, and `push`
  sidesteps an extra `GITHUB_REF` requirement `workflow_dispatch` alone carries — given the
  same 30-minute `MAIN_BUDGET_MS` any of the three gets in CI rather than the 5-minute
  default meant for an ordinary subprocess call, read back in the artifact's own
  `{ results: [...] }` shape) and `renderRow` labels a row
  resolved that way `MEASURED LOCALLY <id>`, never `PASSING <id> run <id>`, because no CI
  run vouches for it — though it does not say whether the row ran under the same
  `unshare --net` restriction its CI counterpart would have (docs/proof-of-completion.md
  §3.6 documents this open caveat). Because that subprocess call can itself run for up to
  those same 30 minutes with its output captured rather than streamed, `loadRunContext`
  logs one line naming the reference run and the wait before starting it, so the fallback
  never looks like a hang. *Tests:* scripts/__tests__/status.test.mjs — "logs that it is
  starting the local reproduction, and that it can take up to 30 minutes, before running
  it". Staleness and the ancestor-of-`origin/main` check are skipped for those rows, since
  both judge whether an *old CI run* is still trustworthy and neither question has an
  answer for a number computed just now against the working tree; `rowHash` matching and
  the `FAILING` branch are unchanged either way. *Tests:* scripts/__tests__/status.test.mjs
  — "skips staleness and the ancestor check for a locally-measured row, even against a
  stale reference run whose head is not known to be an ancestor". If the local reproduction
  also fails (nonzero exit, or a result file that will not parse), `loadRunContext` throws
  naming both failures and every row degrades to the existing `UNPROVEN`-with-reason
  behaviour (§3.6 step 4's no-reference-run rule), rather than crashing `npm run status`.
  *Tests:* scripts/__tests__/status.test.mjs — "falls back to a local run of prove-claims
  --mode push when the reference run artifact cannot be downloaded, and renders the row
  MEASURED LOCALLY"; scripts/__tests__/status.test.mjs — "falls back to a local run of
  prove-claims when gh run download succeeds but the artifact it wrote cannot be parsed";
  scripts/__tests__/status.test.mjs — "gives the local prove-claims run the same 30-minute
  budget a push-mode main run gets in CI, not the 5-minute default meant for ordinary
  subprocess calls"; scripts/__tests__/status.test.mjs — "throws an error naming both
  failures when the artifact download and the local reproduction both fail";
  scripts/__tests__/status.test.mjs — "names the parse failure rather than the download when
  gh run download succeeds but its artifact cannot be parsed and the local reproduction also
  fails"; scripts/__tests__/status.test.mjs — "prints one warning naming both failures and
  exits 0 when the artifact download and the local reproduction both fail";
  scripts/__tests__/status.test.mjs — "renders UNPROVEN when there is no reference run, or
  the row is absent from it".

- **The cloud runbook and the `lw-*` agent roles** (`docs/cloud/runbook.md`,
  `.claude/agents/lw-architect.md` and its four siblings; D-52, commits `a092b91`,
  `1991344`, `5e0d59a`, `e2a1646`). The protocol unattended cloud routines follow while
  the owner travels: three conductor lanes with disjoint file ownership (rule 6), a
  watchdog, a reviewer routine that is never a subagent of the author (rule 1), and the
  boundaries a routine stops at — anything only the owner can do, the clean Windows VM,
  BuildCraft, and anything needing a packaged Electron launch. The GitHub access it
  records was measured from a cloud session on 2026-09-19 rather than recalled (rule 9):
  GraphQL is blocked by the proxy there, so `gh pr create`, `gh pr merge`, `gh pr list`,
  `gh pr edit` and `gh issue comment` fail and the GitHub MCP tools or REST are used
  instead; a REST comment on #187 returned 201; pushing a new branch works, REST ref
  deletion is 403, and `git push --delete` prints `unexpected disconnect` and exits 1
  while deleting the ref anyway, so a routine reads `git ls-remote` rather than that exit
  code. The browser lane cannot run in the cloud VM — Playwright 1.63 wants a chromium
  build the proxy will not let it download — so the `Browser tests (chromium)` CI check is
  the browser evidence there, and the config is not to be bent to suit the VM (ADR-0002).
  Issue #187 is the shared ledger, because a routine starts each run with no memory. An owner command carries an `OWNER:` prefix and no Claude footer, because
  routines post under the owner's own login and the login alone therefore identifies
  nobody. This is a process document: it constrains routines, and it asserts nothing
  about the product's behaviour.
- **The gate-4 v4 screens, recorded in the repository** (`docs/design/gate4/`, commit
  `759af49`): the canvas source, nine artboards as HTML and PNG
  (`ls docs/design/gate4/screens/*.dc.html | wc -l` → 9), and a README. The nine PNGs are
  2,323,134 bytes (`stat -c '%s' docs/design/gate4/png/*.png | awk '{s+=$1} END {print s}'`),
  which every clone now carries and no review can diff. **Gate 4's approval was recorded
  twice, in opposite directions**, and this change settles neither side of it:
  `docs/plans/v1-production.md:139` ticks C-24 citing D-45 and `docs/DECISIONS.md` D-45
  records an owner approval dated 2026-09-18, while the runbook records that the owner
  did not recognise D-45 on 2026-09-19. The conflict was filed as #189, where an
  `OWNER: gate 4 approved` comment was posted at 2026-09-19T13:23Z asking for a new
  decision row to supersede D-45 and for C-24 to cite it. **That ledger work is not in
  this change**: no decision row is written, C-24's citation is untouched, and so nothing
  yet builds "per the approved gate-4 wireframe" — ADR-0006 step 9 and wave 4 wait for the
  row, which is the order the answer itself sets out. **The counts also disagree and this
  change does not reconcile them:** D-45 approves "the six gate-4 screens" on 2026-09-18,
  while this record is the v4 set of **nine** numbered pages published 2026-09-19, adding
  the resolved critique and the D-48 plugin state; the nine are not six screens plus three
  state sheets, since `canvas.json` numbers all nine as pages. D-45 may therefore be about
  an earlier artefact rather than a mislaid approval of this one, and #189's answer repeats
  the ambiguity by reading "the six gate-4 screens (v4, `docs/design/gate4/`)". The
  decision row, when someone writes it, should name the screens it approves.
- **Cloud lanes can merge** (`.github/workflows/auto-queue.yml`, docs/cloud/runbook.md lane C item 0a). Cloud routines cannot enable auto-merge through their proxy. This workflow runs in GitHub Actions after the required `PR evidence` check succeeds. It adds a pull request to the merge queue only when all of these hold:
  - the pull request is open and not a draft;
  - it carries a `lane-*` label;
  - the body says `Verdict: MERGE`;
  - the **newest** `Reviewer: shellux-cloud-reviewer` comment at the exact head is from `LEAPWare-HQ` and says `Verdict: MERGE`. A later rejection wins, and a comment from any other account is ignored, because the repository is public.

  The enqueue is pinned to that head commit. The workflow also fires on a late reviewer comment and on a lane label, and it always runs the default branch's code. The queue then re-runs every required check. It is a guardrail: every routine posts under the owner's login, so the comment proves a review exists at that head, not which routine wrote it. *Tests:* "ignores a forged review comment from any other account", "lets a later rejection at the same head win over an earlier MERGE", "refuses a head that moved since the triggering run", "calls gh pr merge --squash --auto pinned to the head only when ready". **Not proven yet:** that a merge-queue entry made by the workflow's own token gets its checks run. The first live cloud PR proves it or refutes it. — **Proven, 2026-09-19, and this sentence is left standing rather than deleted so the question and its answer sit together:** the `Auto-queue` run at `2026-09-19T16:30:23Z` logged `auto-queue: #190 queued at 9ee3f218`, and the queue branch `gh-readonly-queue/main/pr-190-39bf3502` then ran CI, Browser, Claims and PR evidence, all four `success` (`gh api repos/{owner}/{repo}/actions/runs?event=merge_group`). #188 merged the same way at 15:36:23Z. **Still not asserted by any test**, here or anywhere in this repository: what the merge queue does with an entry is GitHub's behaviour, and only that measurement backs it.

- **Gate 4's approval is recorded on #189 and is NOT yet in the ledger, because the
  answer does not say which screens it covers** (the question was #189; register row C-24
  is unchanged by this change). D-45 recorded an owner approval of "the six gate-4
  screens" on 2026-09-18 which the owner did not recognise on 2026-09-19. A gate sign-off
  and the reversal of an owner decision row are both owner-only, so no routine settled it
  either way: the conflict was filed as #189. The owner answered there on 2026-09-19 and
  approved gate 4 — and the answer names *six* screens while
  `docs/design/gate4/screens/canvas.json` numbers *nine* pages, published a day after
  D-45 with the resolved critique and the D-48 state added, and not six screens plus
  three state sheets. That discrepancy was raised on #189 at 14:24Z with three ways to
  resolve it and is unanswered. **So this change writes no decision row, leaves C-24 and
  D-45 exactly as they stand on `main`, and leaves ADR-0006 step 9 and redesign wave 4
  blocked** — the answer's own ordering puts the row before the unblocking, and a row
  that cannot name the screens it approves is not a row worth citing. An earlier draft of
  this change added D-53 and re-cited C-24 to it; that was removed here rather than
  landed, because it would have released blocked design work on a scope nobody has
  settled. `docs/cloud/runbook.md` lane C item 5 owns finishing it: settle the count on
  #189, then write the row naming the screens, then C-24 cites it, then the unblocking.

- **Six proof rows for work already built** (C-38 to C-43). The ruleset as code and
  its applier and settings doc, not classic branch protection; the three GitHub security
  settings, read back as enabled (private vulnerability reporting re-proven on every
  run; secret scanning and Dependabot security updates dated, because CI's read-only
  token cannot see them); #74 and #103 closed; the full-tree audit job; and the
  plugin bundle's sha512, refused at install and re-checked on every serve, each half
  pinned by a named test. Each row's check was probed red, and a review tightened two
  that could pass on an honest mistake (a wrong ruleset target, an applier that never
  calls `gh api`, or a commented-out audit step now fail; a deliberate fake can still
  pass them, so they are guardrails). Three plan items mixed true facts with unmet
  ones; each is split, so the true part is ticked and four remainders stay open as
  their own items: the D-27 reversal write-up, SECURITY.md's reorder, the README's move to
  `docs/`, and pasted API evidence on #74 and #103. The ruleset item's claim that it
  matches sessionkeeper's shape was dropped, because no check can decide it.

- **Plugin lifecycle hooks, a runtime navigation tree, and badge clearing** (ADR-0006
  step 5; addresses #17, #16 and #80). Host contract **1.1**: a minor bump, since every
  addition is optional or new. An extension may declare `lifecycle` hooks
  (`onActivate`, `onDeactivate`, `onRelease`); `onRelease` runs before the handle is
  revoked, a throwing hook fails only its own extension's activation (error containment,
  not a boundary between plugins), an async hook's rejection is reported, and an
  `activate` made from inside a hook is refused with `LIFECYCLE_REENTRY`.
  `IShellAPI.setNavigationTree` re-normalises the whole tree through the registration
  validator, and `IShellAPI.clearBadge` removes a runtime badge. Unregistering an
  extension purges its store scope (one named gap: an unregister made before the
  provider subscribes, followed by a same-id re-registration, leaves the scope to the
  newcomer; the ADR-0006 step-5 note pins it); the store holds at most 1024 scopes, and a write that
  needs a 1025th throws `PAYLOAD_TOO_LARGE`, now documented on each method that can
  throw it. The mocked-`IShellAPI` stub in `DEVELOPER.md` lists all sixteen members.
  Failure mode: no plugin code ran around activation, and store scopes outlived their
  registrations, so a later extension could read a predecessor's badge. *Tests:*
  "calls onRelease before revocation, and revokes even when it throws", "a throwing
  onActivate leaves a healthy sibling fully usable", "unregister purges the scope's
  badges and context keys", "refuses an activate made from inside onDeactivate, and the
  outer handover completes", "refuses an activate made from inside a hook's returned
  then", "reports an async hook's rejection through the fault path, without awaiting
  it", "setNavigationTree re-normalises the whole tree at the door", "clearBadge deletes
  the entry rather than writing zero", "refuses a new scope through an extension's own
  handle once 1024 are held". **Not done:** pane 1 rendering a replaced tree is checked
  in jsdom only, not in a browser (no shipped extension calls it yet); which document
  owns a plugin's hooks is left to step 6 (#183).

### Fixed

- **D-27 ("no branch protection, and no spend to get it") is struck through as
  superseded**, in `docs/DECISIONS.md` — plan step 1's last unticked bullet. Its premise
  was that both branch-protection endpoints 403 on a private free-plan repository; that
  is no longer true, because D-34 took the repository public and, per D-50 and plan step
  0c row C-37, a ruleset (23685990, seven required contexts) is already applied — so the
  row was left standing after the fact it stated stopped holding. Struck to the same
  `~~claim~~ **Superseded by D-34, 2026-09-18.**` pattern already used on D-09, D-11 and
  D-12; only the Decision-column cell changed, the row's original rationale stays as
  historical record. **What made it possible:** nothing re-checked a superseded-by
  relationship once its precondition (D-34) landed; a decision row is written once and
  never revisited unless a later change happens to touch it. New proof row C-44
  (`scripts/claims/checks/decisions-d27-strike.mjs`) checks D-27's cell is struck and
  names D-34, guards that D-09/D-11/D-12 stay struck, and that D-31 through D-35 exist;
  its probe un-strikes D-27 and is exercised, along with every other repo row's probe,
  by the register's own generic per-row test, instantiated for C-44 as the register
  stands committed. *Tests:* `scripts/__tests__/claims-prove.test.mjs`.

- **`verify` could not run the register's C-08 row in CI, and the failure looked like a
  real mismatch.** `.github/workflows/ci.yml` took `actions/checkout`'s default depth-1
  clone. C-08's check compares the archived §2–§12 HANDOFF body against the pre-recast
  original by reading `git show 5b3a6ff~1:HANDOFF.md`, and a depth-1 clone does not carry
  that commit, so `test:scripts` failed on all three runners while passing on every full
  clone — including `claims.yml`, which already took `fetch-depth: 0` for its own reason.
  Reproduced with `git clone --depth 1` before the fix. The checkout now takes full
  history. **What made it possible:** the check conflated "I compared them and they
  differ" with "I could not compare them" — both printed `0` — so the message named a
  mismatch in a tree where nothing had changed, and no environment difference was
  visible. The unreadable case now prints `unreadable:no-5b3a6ff-in-history`, which is
  still red but says which of the two happened, and two cases pin both branches.
  *Tests:* "prints 1 on this tree, where the pre-recast commit is readable",
  "names the unreadable history instead of reporting a mismatch".

- **Proof audit: three false claims corrected (C-09, C-25, C-32), eleven checks
  tightened (C-07, C-10, C-12, C-14, C-18, C-23, C-29, C-30, C-33, C-41, C-42).** C-09
  claimed the "jsdom is blind" body had moved to `docs/traps.md`; it had not, and the
  claim is split so only the true "Traps" half is ticked. C-25 claimed every open issue
  was milestoned; #172 was not, and the row is now a live GitHub search-API check
  instead of dated evidence. C-32 embedded a built-increment count that went stale the
  moment W3-1 landed. Of the tightened checks: C-14's CODEOWNERS check read the first
  matching line, not GitHub's own last-match rule; C-10's caps-lint check passed on a
  gutted test file; C-12's code-of-conduct check missed a stale "GitHub Issues, once
  published" route now that the repository is public; C-18's ADR-0006 check covered 3
  of its 9 clauses; C-07's D-50 check matched only the decision id, not its content;
  C-33's pane-refit check could not detect a `.skip(`/`.fixme(`/`.only(`; C-23's
  DESIGN.md colour check did not bind a hex to its named token and missed 3/8-digit hex
  and `rgb()`/`hsl()`/`oklch()`; C-29's redefinition scan matched inside comments and
  missed `const`/`class` forms; C-41 did not catch a job-level `if:`; C-42 grepped a
  test title instead of running the test. Each tightened check was probed red on the
  defect it now catches, then green after the fix. `docs/claims.json` and
  `scripts/claims/checks/*` carry the detail.

- **`SECURITY.md` said private vulnerability reporting did not exist here.** It was
  true while the repository was private; after it went public the form was enabled
  (`{"enabled":true}`, read 2026-09-19) and the file was not updated. It now names the
  form beside the email address, and the old note is in the past tense.

- **Wave-3 state primitives** (W3-1, `docs/design/WAVE3-PLAN.md` R6 and R7). A
  `Button` (primary and quiet: hover, a pressed state one step past hover, a two-tone
  focus-visible ring, disabled in disabled ink at full opacity, and a loading state that
  keeps its idle width and does not submit its form) and a `Banner` in four statuses
  (a wash, a mark and a bold first line, no border on any side). `TOKEN_CLASS` gains
  every role the rest of wave 3 needs, so no later increment edits it. Nothing in the
  shell renders them yet: they are shown by a dev-only fixture, `states.html`, which is
  not a build input. Six browser tests pin the painted result (eight cases, since the
  ring test runs once per theme), each mutation-probed red:
  "paints pressed one step past hover, on a quiet and on a primary button", "draws a
  disabled button in disabled ink at full opacity", "draws every banner as a wash with
  no border on any side", "clears 4.5:1 for every banner's words on its own wash, in
  every theme", "keeps a loading button at its idle width, with its bar inside its own
  box", and "paints no ring on a mouse click and the two-tone ring on a Tab, in the …
  theme". The contrast
  gate's unpainted-background check now counts a background as painted only when a
  module the shipped pages reach uses it (`design/lib/painters.mjs`, with node tests),
  so a token painted only by the fixture is not counted as shipped (a guardrail; its
  limits are listed in `design/lib/painters.mjs`).

- **The plugin store** (ADR-0006 step 4). Main installs a `.lwplugin` chosen through its
  own file picker (the renderer never supplies a path) into
  `<userData>/plugins/<id>/<version>/`, staging, validating and renaming so a
  half-written plugin is never listed, and records it in a `state.json` that only main
  writes and fsyncs. A `state.json` that fails validation is set aside as
  `state.json.corrupt-<time>` and reported, not fatal. `/plugins/<id>/<version>/bundle.js`
  is served, with the CSP, only for an installed, enabled, compatible plugin whose file
  still matches its recorded hash, rehashed at every serve; a mismatch refuses the serve
  and records D-48's "files changed" state. Management calls (list, install, enable,
  disable, remove) are refused unless they come from host chrome's view: entry-point
  validation. *Tests:* "serves only the entry of an installed, enabled, compatible
  plugin"; "refuses to serve an entry changed on disk after install"; "refuses a
  management call whose sender is the extension surface". **Not done:** no surface loads
  a plugin yet (step 6) and no UI calls these channels (step 9); the rehash runs on
  main's thread at every serve, with no cache or rate limit; `.staging-*`, `.retired-*`
  and directories orphaned by a set-aside `state.json` are not swept.

- **The proof-of-completion protocol is complete and in force** (plan step 0c, 5 of 5,
  row C-37). After PR B (#179) merged, the ruleset was applied and read back: ruleset
  23685990 requires seven contexts, "Prove claims" and "PR evidence" among them, each
  pinned to the GitHub Actions app, and `compare-ruleset.mjs` reports no drift. The one
  main run between the merge and the apply reported the drift and filed #180, exactly
  as the settings doc predicted; the next run passed. The read-back also settled a
  question the doc had left open: GitHub returns `integration_id` even to an
  unauthenticated call, so the daily comparison would catch a dropped pin.

- **The proof-of-completion checks become required** (rollout step 4, PR B).
  `.github/rulesets/main.json` adds "Prove claims" and "PR evidence" to the required
  status checks, and pins all seven required contexts to the GitHub Actions app
  (`integration_id: 15368`), so a status posted through the Statuses API under the same
  name no longer satisfies them: a guardrail GitHub enforces. *Test:* "every
  required_status_checks entry in the real main.json carries integration_id 15368
  (rollout step 4)". The ruleset is applied and read back after this merges, as
  `docs/maintainers/repository-settings.md` sets out, with a break-glass procedure for
  a gate bug that would otherwise block every merge. Register row C-28 no longer
  asserts the checks are unrequired: the register caught its own change. **Not done
  here:** the apply and the read-back (plan step 0c item 5 is ticked after them).

- **An operator install guide and the 1.0 known limits** (plan step 7).
  `docs/INSTALL.md` covers the per-user install, the SmartScreen path for an unsigned
  build, where the diagnostics log lives, how updates will arrive (the feed is not live
  yet, and the guide says so), and uninstalling; the README links it. `DEVELOPER.md`
  gains "Known limits at 1.0", naming #91, #65, #55, #61, #66 and #60 with what each
  means for a plugin author, and promising no 1.1 fix. README and PRODUCT already
  stated accessibility honestly (keyboard gate for 1.0, screen readers not done, #60)
  and are unchanged.

- **The `.lwplugin` validator and the `hostApiVersion` rule** (ADR-0006 step 3).
  `electron/main/plugins/` reads a package (one JSON document of at most 8 MiB, read
  through one file handle, non-blocking where the platform supports it, into a read
  buffer of at most the limit plus one byte,
  a non-regular file refused before any read), validates its manifest (unknown keys,
  control and bidi characters and blank titles refused; untrusted values echoed at
  most 64 characters, quoted), checks the bundle against the manifest `sha512`, and
  marks a plugin incompatible on a different major or a newer minor. The hash check is
  **entry-point validation** against a damaged or mismatched package: a bundle and hash
  replaced together are accepted, and a test pins that limit. Main mirrors
  `HOST_API_VERSION` and a drift test holds it to the SDK baseline.
  `electron/main/plugins/**` joins the 100% coverage gate. *Tests:* "refuses a package
  whose bundle does not match its manifest sha512"; "accepts a package whose bundle and
  manifest were altered together, because the hash travels with the bundle"; "marks a
  plugin incompatible when its major differs"; "marks a plugin incompatible when it
  needs a newer minor than the host offers". **Not done:** nothing installs yet (step
  4), so the check is not yet a property of the shell; the registry's own text check
  has the gap this one closes, filed as #172; the real-FIFO test runs on the Linux and
  macOS CI legs only.

- **Proof-of-completion rollout step 3 is complete** (plan step 0c item 4, row C-31).
  Three consecutive green main runs; a forced failing row on `main` filed issue #174
  through the issue job; a forced crash failed its run, commented on #174, and turned
  every one of the 28 run-proven rows to FAILING RUN in `npm run status`; one clean run
  brought all 28 back to PASSING. Run ids and the status readings are in
  `docs/claims-evidence/rollout-step3-2026-09-19.md`; C-31 re-reads every run's
  conclusion. What remains is PR B: making both checks required.

- **A way to force a failure on main, for proof-of-completion rollout step 3.**
  `claims.yml` takes a `workflow_dispatch` with an `inject` choice: `failing-row`
  records one synthetic failed row beside every real row (the issue job files), and
  `crash` stops the prover before it writes results (the run fails, `npm run status`
  renders FAILING RUN, the issue job files). The prover refuses any injection on a
  pull request, the merge queue, a push or the schedule, and any dispatch from a ref
  other than `main`; a dispatch run is named "Prove claims (dispatch)", so it can never
  create, skip or satisfy the required "Prove claims" check. A `workflow_dispatch` run on
  `main` now counts as a reference run for `npm run status`. All of this is a guardrail.
  *Tests:* "refuses an injection on pull_request, merge_group, push and schedule, and a
  dispatch from any ref but main", and the test in `required-checks.test.mjs` that pins
  the dispatch run's name. **Not done:** no
  dispatch has run yet; that is step 3 itself, after this lands.

- **Proof-of-completion rollout step 2 is complete** (plan step 0c item 3, row C-30).
  Thirteen cases, each as designed: eleven throwaway PRs (#157 to #168, not #160) each
  broke one rule and failed for exactly that reason, a failing body re-ran the gate on
  `edited` and passed, and two groups went through the merge queue with both jobs
  green, the last (#169 and #170) as a two-entry group. The run ids are in
  `docs/claims-evidence/rollout-step2-2026-09-19.md`, and row C-30 re-reads each run's
  conclusion from GitHub on every main run, so the record cannot silently drift.

- **The plugin SDK and the shared modules** (ADR-0006 step 2). `src/sdk/index.ts`
  (`HOST_API_VERSION` 1.0) is the one host module a plugin may import, served as
  `/shared/sdk.js` beside `/shared/react.js` and `/shared/react-jsx-runtime.js`, built in
  the same build as both documents so a plugin shares the extension surface's React.
  `src/sdk/api-surface.json` records the contract (SDK exports, blueprint and `IShellAPI`
  keys with required and optional kept apart, the hotkey allowlist and denylists, the reserved ids and the id pattern, registry
  limits, the shared modules' export names and React's major), and a test fails when it
  changes without the bump the change requires, one step at a time. That test is a
  guardrail: a hand-edited baseline defeats it, and a behavioural narrowing with no
  change of shape is invisible to it. *Tests:* "fails when the contract changes and the
  version does not move"; "a module importing /shared/react.js receives the React
  instance the extension surface renders with" (dev server and built preview). The
  packaged app was checked too: all three modules resolve over `shellux:`, React is one
  instance, and the CSP records 0 violations
  (`docs/measurements/shared-modules-2026-09-19.json`). **Not done:** no plugin loads
  yet (ADR-0006 step 6); only Windows was measured; the modules were imported by code in
  the page, not by a plugin bundle's static import.
- **The proof-of-completion protocol, PR A** (D-50, plan step 0c). `docs/claims.json`
  holds 27 rows proving every ticked item in `docs/plans/v1-production.md`; the box
  linter (`scripts/claims/lint-boxes.mjs`) fails a tick without a row whose `box` equals
  the item, a wrong heading count, or an ambiguous task item; the prover
  (`scripts/claims/prove-claims.mjs`) runs each row's allowlisted read-only checks and
  probes (a mutation that must turn the row red); the evidence gate
  (`scripts/claims/pr-evidence.mjs`) checks a PR body's Evidence, Not done and Review
  record against its head SHA; `npm run status` renders each tick from the newest main
  run and never prints "proven". Two workflows (`claims.yml`, `pr-evidence.yml`) run
  them; **neither is a required check yet** (rollout step 4). Adversarial review of the
  first version found two ticks weaker than their rows, a stale milestone claim and an
  allowlist bypass by abbreviated git options; all were fixed before this landed, which
  is the protocol catching its own first case. **Not done:** no rollout step has run on
  GitHub; the `unshare` network restriction, the issue job and a timed-out run are
  unmeasured on a runner.
- **A Content-Security-Policy on every response the packaged renderer's scheme serves**
  (ADR-0006 step 1). `default-src 'self'; script-src 'self'; object-src 'none';
  base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self'; font-src 'self'`, on documents, assets, 403 and 404
  alike. Scripts run from `'self'` only, with no `'unsafe-eval'` and no network origin.
  The style exception is measured, not assumed: under `style-src 'self'` the packaged app
  raised 21 `style-src-attr` and 1 `style-src-elem` violations with the Mail and Database
  fixtures driven (tooltip and divider drag included), and 1 in host chrome with the
  palette open; with the shipped policy it raised 0 on each surface, while both
  positive controls (an inline script and a `data:` image) were refused on every
  counter (`scripts/csp-smoke.mjs`, `docs/measurements/csp-2026-09-18.json`). *Tests:*
  `electron/__tests__/rendererCsp.test.ts` — "every HTML response the scheme serves
  carries the policy", "puts the policy on a script and a stylesheet too", "puts the policy on
  the 403 and 404 responses too, and warns for each". **What made
  the gap possible:** the scheme handler lived in a module that starts the app when it
  loads, so no test could reach it; it now lives in `electron/main/rendererCsp.ts`.
  **Not done:** `'unsafe-inline'` lets injected CSS apply (anything it loads is still
  limited to `'self'`); only Windows was measured; the dev server sends no policy. The
  smoke found that the packaged extension surface does ship the two mock plugins, which
  `electron/main/index.ts` decision 4 says it does not; filed as #153.

- **The proof-of-completion protocol, as a design** (D-50,
  `docs/proof-of-completion.md`). "Done" is to be recorded only as a ticked plan item
  citing a register row whose check passes; every row is re-run on main and daily; a
  PR carries evidence, "Not done" and a review record bound to its head SHA; and
  `npm run status` renders each tick from the latest main run, never "proven". Audited
  in twelve adversarial rounds until one found no Blocker. **Nothing is built yet:**
  plan step 0c tracks the build. Its threat model is the honest mistake; it states
  plainly that a writer can defeat any in-repository gate until BuildCraft R4.
- **A crash now leaves a report someone can read, and the bundle declares its target**
  (GitHub #86, #85; Electron half). `electron/main/diagnosticsLog.ts` writes a rotating
  log (1 MiB, two backups) under `app.getPath('logs')`; main records
  `uncaughtException`, `unhandledRejection` and `render-process-gone`; both renderers
  forward `error` and `unhandledrejection` through one new preload member. Each string
  field is capped at 16 KiB, so one oversized report cannot outgrow the rotation bound
  (found in review). The `source` a renderer reports is self-declared, not derived from
  the sender, so attribution between the two renderers is a guardrail. Nothing
  leaves the machine: no endpoint exists. Vite now emits sourcemaps and
  `build.target: 'chrome150'`, the Chromium measured in the installed Electron 43.2.0.
  Sourcemaps are kept out of the asar, **third-party ones included**: the first version
  excluded only the project's own, and a packaged build still held 129 maps from
  production dependencies. Re-measured at landing: `npx asar list` on a fresh
  `verify:desktop` build lists 2,001 entries and 0 `.map` files. **Not done:** the maps
  are not yet attached to a release (plan step 8); the packaged app was launched (it
  starts, five processes) but no screenshot of its window was captured at landing;
  the Safari half of #85 is moot for an Electron-only target and is not addressed.

- **ADR-0006, the runtime plugin host, Accepted; ADR-0001 Amendment P.** The design
  for step 6b: package format, per-user plugin store, a custom-scheme loader into the
  extension surface, lifecycle hooks, the contract version rule, the conformance kit
  and the plugin manager. Accepted on the owner's rulings of 2026-09-18: D-46 (a new
  ADR-0001 **Amendment P**: first-party runtime loading does not meet Amendment E's
  trigger, and four named events re-fire it), D-47 (no plugin signing in 1.0; the
  manifest `sha512` is **entry-point validation**) and D-48 (a fifth plugin-manager
  state, *files changed*, offering Reinstall). A throwaway spike under
  `spike/plugin-host/` settles how a bundle loads; its raw output is committed.
  **Nothing is built:** every behavioural claim in the ADR names a test that does not
  exist yet, and says so. #68 and #91 are decided in the ADR and stay open until their
  decision rows are recorded.

- **Claude GitHub Actions, guarded for a public repo (D-49).**
  `.github/workflows/claude.yml` runs Claude on an `@claude` mention (issue
  comment, PR review comment, PR review, or issue body/title), gated to
  `author_association` of `OWNER`, `MEMBER` or `COLLABORATOR` — the repo went
  public, and without that gate any GitHub user could spend the owner's
  Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`, a repo secret) and inject
  prompts into a run holding repo-scoped tokens.
  `.github/workflows/claude-code-review.yml` runs the `code-review` plugin
  against every non-draft PR, skipping Dependabot PRs and fork PRs
  (`github.actor != 'dependabot[bot]'` and the head repo must equal this
  repo) because neither gets the secret and the job would otherwise fail red
  on every occurrence; a per-PR `concurrency` group with
  `cancel-in-progress: true` stops a push storm from queuing duplicate
  reviews. The review plugin already reads the repo's own `CLAUDE.md` files
  and checks compliance against them (`plugins/code-review/commands/code-review.md`
  in `anthropics/claude-code`, steps 2 and 4) — verified from the plugin
  source rather than duplicated in the prompt. Both workflows run on the
  owner's own subscription-backed token, not a shared org token.
  `scripts/check-portability.mjs` gained one narrowly-scoped `ALLOWLIST`
  entry (`hardcoded-hostname` only, these two files only) for the
  `github.com` / `code.claude.com` references the action's own
  configuration and doc comments name — GitHub Actions runner endpoints, not
  hosts this codebase or its shipped product contacts. **Observed, not assumed:**
  on its own PR the review job reported SUCCESS while the action skipped
  ("Skipping action due to workflow validation", run 35408458019), so a green
  check from it is not evidence of a review and it is never a required check.
  Whether it reviews is proven only by the first PR after this merges. The
  action is pinned to commit `4036a18` (tag v1); the plugin marketplace URL
  cannot be pinned by that input and stays a moving third-party reference.
- **The mission, and the documents that carry it.** The owner set the mission on
  2026-09-18: a best-in-class UI/UX shell that hosts application plugins (D-31).
  `README.md` is recast around it, in the order `leapware-sessionkeeper` uses for a
  public repository. `DESIGN.md` is design gate 3, written with impeccable from the
  generated tokens ("The Operator's Instrument"), with its sidecar in
  `.impeccable/design.json`. `docs/plans/v1-production.md` is the plan and the bar
  "best in class" is measured by. `docs/sdlc.md` is the lifecycle ShellUX runs by
  convention until LEAPWare BuildCraft can enforce it (D-39), with the readiness bar
  the 1.0 tag waits for. `docs/DECISIONS.md` records D-31 to D-41, and D-42 to D-45
  as open owner calls. **Not done:** gate 4 (the screens) awaits owner approval, and
  nothing in `src/` implements `DESIGN.md` yet.
- **A test that holds the context files to their caps**
  (`scripts/__tests__/context-caps.test.mjs`, inside `test:scripts` and so inside
  `verify`): `HANDOFF.md` at most 3000 bytes, `CLAUDE.md` at most 200 lines, the
  caps the owner set on 2026-09-17. Both halves were mutation-probed: a 3001-byte
  `HANDOFF.md` and a 201-line `CLAUDE.md` each fail it. **What made it necessary:**
  a cap nothing measured. On 2026-09-18 the two files were 70,219 bytes and 334 lines.

- **The process split: one `BaseWindow`, two `WebContentsView`s, and a host-owned
  focus ring (plan §3.2, §5, Phase 7).** The shell is no longer one renderer.
  `electron/main/paneViews.ts` creates host chrome and an extension surface,
  owns both rectangles through the only `setBounds` calls in the application, and
  puts Mica on the window with **opaque** views — discharging the obligation
  Phase 1 wrote down in the commit where it would be got wrong.
  `paneview.html` and `src/paneview/` are the extension surface's document, which
  holds panes 2 and 3 **in one document** so their ARIA relationships and focus
  order work.
  - **Two views, not three, and the reasoning is asymmetry rather than
    confidence.** `docs/adr/0005-pane-topology.md` is still `Proposed` and its
    deciding arm still needs a human with NVDA. Two-process is the option that is
    safe under either outcome: a clean arm B makes three *available* as an
    additive change, and a bad one means two is already what shipped. Building
    three first would have been the bet that cannot be unwound. Recorded in
    ADR-0001 Amendment O.
  - **Focus arbitration, because the spike measured that startup was
    non-deterministic.** Five identical launches of the unarbitrated two-view
    build put focus on the last-added view four times and on the first once — so
    *which pane the user was typing into after startup was undefined*.
    electron/electron#42339 reproduces on Electron 43.2.0, and two things the
    issue does not say decide the design: the steal is **not** synchronous with
    `addChildView` (so a host that re-asserts on the next line re-asserts too
    early), and **the losing renderer is never told** (so only main can see it).
    `electron/main/focusRing.ts` asserts on load completion, against an injected
    seam — because a single launch of a *broken* ring passes 80% of the time, and
    "launch it and look" is therefore not a test.
  - **Crash containment, observed rather than claimed.** Killing the extension
    renderer produced *"the extension view stopped (reason: crashed, exit code:
    -1); reloading it"*; the rail, pane 1, the context bar and the palette stayed
    up, the view came back, and the focus ring caught the reload-time steal.
  - **`before-input-event` is used for exactly one thing**, and
    `electron/__tests__/noElectronListener.test.ts` says so with a count. It
    carries no DOM target and no `defaultPrevented`, so the suppression rules in
    `src/core/hotkeyDispatch.ts` cannot run there; the renderer keeps them
    unchanged and main's handler is an escape hatch for a wedged renderer.
  - **`electron/**` was never covered by the listener scan, and now is.**
    `src/__tests__/noEventListener.test.ts` resolves its root from its own
    location, so the native host was outside it *by construction*. The new scan is
    deliberately not a copy — `addEventListener` appears zero times in a main
    process and always would, so a copied scan would pass vacuously. It counts
    every `on`/`once`/`off` registration per module, exact in both directions.

- **A desktop packaging lane that produces a real installer, and auto-update from
  a static feed (plan §6, Phase 9).** `electron-builder.yml` — a file rather than
  a `build` key in `package.json`, because JSON cannot carry the argument for each
  decision and this repository argues every one of them beside the line that takes
  it. NSIS on Windows, dmg **and** zip on macOS (the zip because electron-updater
  updates a macOS application from it and a dmg-only release cannot update
  itself), hardened runtime on, and `notarize` deliberately absent so that
  notarization runs when the Apple credentials are present and skips with a
  warning when they are not — which is exactly the "working default when unset"
  column `docs/signing.md` promises.
  - **Observed, not merely configured.** `npm run verify:desktop` on Windows
    produced `leapware-shellux-0.1.0-win-x64.exe` (110 MB), `latest.yml` and a
    blockmap. The packaged application was launched, and its palette offers
    *"Check for updates — last check failed"* — the update state having travelled
    from `electron-updater` through the main process, an IPC channel, the preload
    bridge, a hook and the Phase 4 command registry. The failure is correct: the
    feed host is not provisioned, and the running application reports
    `net::ERR_NAME_NOT_RESOLVED`.
  - **`electron-updater` against the `generic` provider, never `github`.** This
    repository is private on a free plan, and the GitHub provider would require a
    token inside the shipped client, which anyone can extract from an asar in
    seconds. The feed URL is written in exactly one tracked file; electron-builder
    bakes it into `app-update.yml` inside the package, so `electron/main/updater.ts`
    contains no URL and the renderer has no way to name a feed at all.
  - **The surface is a palette command and never a modal.** `checkForUpdates`
    rather than `checkForUpdatesAndNotify`; both commands declare
    `surfaces: ['palette']`. "Check for updates" is offered for every status
    except a development run — **including `error`**, which is when a user most
    wants to press it again, and which is also the only positive evidence that the
    preload bridge loaded at all.
  - `.github/workflows/desktop.yml` on **tags and `workflow_dispatch` only**, on
    `windows-latest` and `macos-latest`, always `--publish never`. Not on every
    pull request: Windows bills at 2x and macOS at 10x, and there is no Linux leg
    to average them down.
  - `docs/RELEASE.md` — the checklist, including the clean-VM SmartScreen
    observation, an actual old-build-updates-itself test, and a section stating
    what is observed versus what is only configured.
- **The preload stopped being empty, and changed extension to do it.**
  `electron/preload/index.cts` compiles to `index.cjs`, because a sandboxed
  preload is loaded into a CommonJS realm and this package declares
  `"type": "module"`. It is the one file in the repository whose **extension is a
  constraint rather than a convention**; `verbatimModuleSyntax` enforces it by
  rejecting ESM syntax in a CommonJS file, and `eslint.config.js` learned `cts` in
  the same change so the file could not escape the lint stage.

- **Graphical visualization in all three panes — three tiers, three different
  problems (plan §3.3).** Panes 2 and 3 are opposite performance problems and no
  single library wins both, so they do not share one.
  - **Tier 0, panes 1 and 2 — no library.** `src/components/ui/RowMetric.tsx`
    composes the existing `MetricGlyph` — the same 32×12 `viewBox`, the same
    memoised `d` string, the same `stroke="currentColor"` — and adds a value and
    a delta. A chart *instance* per row is a construct and a destroy on every
    scroll tick of a virtualized list; a memoised path string has none. Both
    verification remotes now draw one per pane-2 row: `MailPlugin` a sparkline
    of thread activity, `DatabasePlugin` a bar of stock against reorder level.
  - **Tier 1, pane 3 — Apache ECharts 6.1.0 (Apache-2.0), canvas renderer,
    tree-shaken.** `src/components/chart/Chart.tsx` is the ONE wrapper; the one
    file in `src/` that names the library is `src/core/chart/echartsRenderer.ts`,
    reached through the `ChartRenderer` seam in `src/core/chart/ChartRenderer.ts`
    — the same shape as `HydrationEngine`'s `ShellStorage` and `src/core/ipc/`'s
    `PortLike`. **Tier 2 (uPlot) is not in this change.**
- **`normalizeChartSpec` (`src/core/chart/chartSpec.ts`), which makes "never
  encode meaning by colour alone" a compiler property.** A series input has no
  `color` member to write, and the normalised series carries `colorIndex`, `dash`
  AND `marker` as required fields assigned in one statement, so a series with a
  colour and no second channel is not representable. A `color` arriving through
  `publishPayload` — where the compiler was never in the loop — is rejected on
  sight with `INVALID_FIELD`. The series bound is **twelve**, because the colour,
  dash and marker rotations have periods 12, 3 and 4, so a thirteenth series
  would repeat the first in all three channels at once.
- **The pane-3 block ledger.** `src/components/ledger/BlockLedger.tsx` renders a
  vertically scrolling stack of addressable blocks — chart, table, form, text,
  agent — each with a stable id that IS its payload channel, and each with a
  Grafana-style inspector revealing the channel, the kind, the host-assigned
  `revision` and the raw payload without navigating away. The `form` arm renders
  real labelled inputs: pane 3 is a canvas and an input surface at once.
  - **The index rides on a context key and the content on the payload channel.**
    `src/core/ledger/ledgerIndex.ts` reads a comma-separated block list from the
    reserved `ledger` context key. A list of addresses is exactly the cheap
    primitive fact a context key is for; a chart's data is not.
  - Both verification remotes publish blocks, so the ledger has real consumers.
- **A text alternative for every chart.** `ChartDataTable` renders the same
  `ChartSpec` the canvas was built from as a real table — the actual numbers, plus
  the dash and marker of each series — `sr-only` beside the canvas and visibly in
  the inspector. One implementation, two placements.

### Changed

- **`ShellLayout.tsx` is split before wave 3 edits it** (plan step 5, part of #95).
  The pane-size helpers (`paneSizing.ts`), the navigation (`ShellNavigation.tsx`), the
  panes (`ExtensionPane.tsx`), the resize handle (`ShellResizeHandle.tsx`) and the
  palette hook (`useHostPalette.ts`) now live in their own modules; the file goes from
  1,916 to 1,368 lines. No behaviour change: the moved code is byte-identical apart from
  `export`, import and comment lines (checked by the reviewer against the old file), all
  1,770 existing tests and the 57 browser tests pass unchanged, and the pane-size helpers
  gain 11 direct unit tests (`src/components/__tests__/paneSizing.test.ts`). **What made
  it possible:** one 1,916-line file mixed the sizing arithmetic, the navigation rows and
  the persistence logic, and it is where both data-destroying defects were found. **Not
  done:** the persistence-hook extraction #95 argues for; #95 stays open.

- **A claim about npm 10.9.8 was too broad, and is corrected everywhere it was made**
  (`CLAUDE.md`, `HANDOFF.md`, `README.md`, `docs/getting-started.md`,
  `docs/traps.md`, and this file). It said npm 10.9.8 "crashes on this lockfile".
  Reproduced in throwaway worktrees: `npm@10.9.8 audit fix` crashes on the pre-#126
  lockfile (`148217b`) and does not on `d74e5d0`; `npm update` crashes on neither from
  a fresh install. **What made it possible:** a crash observed once, in a tree whose
  `node_modules` npm 10 had installed, was written down as a lasting property of the
  lockfile without a reproduction. It was caught by a per-claim audit the owner asked
  for.
- **The licence is Apache-2.0** (decision D-42), replacing MIT: `LICENSE` carries the
  Apache 2.0 text, a `NOTICE` is added, and `package.json` and the README say so.
- **Eight owner rulings recorded** in `docs/DECISIONS.md`, D-42 to D-48: the licence;
  going public once this scaffolding lands; no BuildCraft pilot (the agent had added
  one unasked; it is removed from the plan and `docs/sdlc.md`); the six gate-4
  screens approved; ADR-0001 Amendment P accepted; no plugin signing in 1.0; a fifth
  plugin-manager state for files that no longer match their manifest. Plan step 0 is
  complete: every Dependabot pull request opened through 2026-09-18 is merged or
  declined, each checked `CLOSED` or `MERGED`.
- **Public-release scaffolding, without going public** (plan step 3; the licence,
  D-42, and the visibility flip, D-43, stay with the owner). `.github/rulesets/main.json`
  models `leapware-sessionkeeper`'s ruleset: deletion and force-push blocked, pull
  request required with zero approvals (one human developer), squash only, no bypass
  actors, the five CI job names as required checks, and a merge queue, for which
  `ci.yml` and `browser.yml` gain `merge_group:`. `scripts/apply-rulesets.mjs`
  creates or updates it by name through `gh api`, with `--dry-run`; 18 tests, no
  network. `docs/maintainers/repository-settings.md` says what each rule enforces and
  that applying it is the owner's step (it 403s while the repository is private).
  Also `CODE_OF_CONDUCT.md` (its enforcement contact was a personal-looking address,
  never updated when D-03 named `leapware@outlook.com`; it now points at
  `SECURITY.md`), `.editorconfig`, a `feature.yml` issue template, and `CODEOWNERS`,
  which named `@LEAPWare-HQ`, an owner that does not match this repository's
  organisation. **Not done:** the history secret scan could not use gitleaks (no npm
  distribution exists); a grep of all 105 commits for key, token, PEM, `.env` and
  host patterns found nothing, which is a narrower check than gitleaks.
- **D-28's pin now lives where Dependabot reads it.** `.github/dependabot.yml`
  ignores `eslint-plugin-react-refresh` at `>=0.5.0`. The minor-and-patch group had
  been carrying the 0.5 bump into every weekly pull request, which D-28 pins against
  and which fails `lint` under `--max-warnings 0`; #125 and then #127 went red on it.
  **What made it possible:** the pin was recorded only in `docs/DECISIONS.md`, a file
  the bot does not read. Same day, Step 0's other Dependabot calls: #117 (globals 17)
  merged green; #118 (jsdom 30, a Node-floor raise plus about 30 assertion changes)
  and #119 (eslint 10, no peer range in eslint-plugin-react-hooks) declined with
  reasons on the pull requests; #120 declined as a layout-engine migration.
- **`README.md`'s long sections moved, verbatim, into `docs/`**: `getting-started.md`,
  `overview.md`, `performance.md`, `accessibility.md` (with the 1.0 keyboard-gate
  position, D-37, stated first), `testing.md` and `security-posture.md`. The old
  Project Status, Documentation and Contributing sections are archived in
  `docs/history/readme-status-2026-08.md`. Relative links were corrected for each new
  location, and every reference to a moved section was repointed: `SECURITY.md`,
  `CONTRIBUTING.md`, `DEVELOPER.md`, two issue templates, `.github/ISSUES_MANIFEST.md`,
  ADR-0001 (as a dated superseding note) and four code comments. Measured afterwards with a
  one-off Node script that resolved every `](path)` link in `git ls-files "*.md"`
  against the filesystem: 0 unresolved across 39 files. Nothing in the repository
  checks this on every change (GitHub #54); `check:portability` skips `.md`.
- **`HANDOFF.md` cut to the transition only** (2,137 bytes); the previous file is
  archived verbatim in `docs/history/handoff-archive-2026-08.md`, and a line in the
  new file says that the "HANDOFF §N" citations across the repository refer there.
  **`CLAUDE.md` cut to 199 lines**: the traps and the gates' history moved verbatim to
  `docs/traps.md`, with a one-line pointer per trap left behind.
- **`PRODUCT.md` states the mission first**, and three passages today's decisions
  made stale are corrected: the commercial question is decided (D-23), the title
  freeze is lifted (D-36, D-40), and 1.0's accessibility bar is the keyboard gate
  (D-37).
- **ADR-0002 gained Amendment A, and the checker gained three rules' worth of
  teeth.** ADR-0004 clause 8 named four collisions between the desktop lane and
  the no-local-environment-dependencies mandate *in advance*; all four are settled
  in the change that caused them.
  - **`DOCUMENTED_ENDPOINTS`**, a one-row declaration table beside the existing
    `DOCUMENTED_PORTS`, holding the update feed's host with a written reason. **Not
    an ALLOWLIST entry**: an allowlist switches the rule off for a path, so a
    second host arriving in the same file later is never seen; a declaration names
    one host and leaves every other host still reported. It matches on **exact
    host equality**, because the reserved-suffix list beside it uses `endsWith`
    correctly — every name under `example.com` is reserved — while an endpoint is
    not a suffix and `endsWith` would have accepted a host that merely begins with
    the declared one and continues into a domain somebody else can register.
  - **`platform-only-invocation` now catches what its prose always forbade.** The
    rule matched shells and batch extensions, so `electron-builder --win nsis`
    matched nothing — a build command that pins its output to one platform, which
    the mandate plainly forbids. Pattern and prose are fixed together, because
    relying on the gap is the "written rule with no checker" ADR-0002's own
    Alternatives section rejects. **The portable form is to name no platform:**
    `electron-builder` with no flag builds for the machine it is on, so
    `npm run verify:desktop` is one command everywhere and `desktop.yml` gets its
    platforms from a `runs-on` matrix.
  - **`temp-or-scratch-path` no longer reports a path segment inside a URL.**
    `electron-builder` brought in two packages *named* `tmp` and `temp`, so npm
    wrote registry tarball URLs into the lockfile carrying each of those names as
    a path segment — which is the exact shape the rule looks for.
    Sharpened rather than allowlisted, and the reason is specific: the lockfile
    already has an ALLOWLIST entry for hostnames, and adding this rule to it would
    have switched the rule off for a file that **can** carry a genuine local path
    — a `file:` reference to a directory on the author's disk is exactly what this
    checker exists to catch. A URL reaching somewhere it should not is
    `hardcoded-hostname`'s finding on the same line, so the match is reassigned
    rather than dropped.
  - Both directions of all three rules are pinned in
    `scripts/__tests__/check-portability.test.mjs`: a lookalike host that begins
    with the declared one must still fail, a build command that names no platform
    must not, and a temporary path being *assembled* beside a URL must still fail.
  - **`release/` is the third build output directory**, and it landed in
    `.gitignore` and in `SKIPPED_DIRECTORIES` in `scripts/check-citations.mjs` in
    the same change. The plan's original instruction to point the packager at
    `dist/` was wrong — `vite build` empties it. The citation checker walks the
    working tree rather than the git index, and `release/win-unpacked` measured
    **419 MB**.
  - **The acceptance test is unchanged, word for word.** `verify` gains no
    packaging stage, on the justification already written at `playwright.config.ts`
    for the browser lane: a download outside `npm ci` and outside the lockfile
    belongs outside `verify`, and an Electron binary plus a signing certificate is
    the same argument one step larger. `verify:desktop` is separate and
    subordinate.
- **`docs/signing.md` corrected itself in two places while being implemented.**
  `CSC_IDENTITY_AUTO_DISCOVERY` **cannot** be set from the packaging
  configuration — it is read from `process.env` and has no config key — so
  `desktop.yml` sets it and the config cannot; and the checker that file promised
  "when the packaging configuration exists" is now recorded as **rejected with a
  reason**, because `electron-builder.yml` names no environment variable at all
  and such a check would pass vacuously forever. Seven further names the tool
  reads (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`, `WIN_CSC_LINK`,
  `WIN_CSC_KEY_PASSWORD`) are now declared.
- **Measured bundle delta, because README's performance section forbids quoting
  unverified numbers as characteristics.** ECharts is the first runtime dependency
  beyond Radix and React. `npm run build`, before and after, on the same machine:

  | Artefact | Before | After | Delta |
  |---|---|---|---|
  | `dist/assets/index-*.js` | 331.39 kB | 893.05 kB | **+561.66 kB** |
  | …gzipped | 105.76 kB | 295.09 kB | **+189.33 kB** |
  | `dist/assets/index-*.css` | 20.95 kB | 21.41 kB | +0.46 kB |
  | …gzipped | 5.08 kB | 5.20 kB | +0.12 kB |

  That is a **169% increase in raw JavaScript** for a tree-shaken build pulling in
  three chart types and five components. It is stated rather than softened: the
  shell is a desktop host loading from disk, not a page over a network, and the
  same figure would be a different decision for a web deployment. `npm audit
  --omit=dev` still reports **0 vulnerabilities**; four packages were added.
- **A theme change disposes and re-initialises every chart in the document
  (risk R7).** ECharts registers a theme at `init` and has no setter for it, so a
  chart instance's lifetime is exactly a palette's lifetime — expressed in the
  code as a parameter of `ChartRenderer.create` rather than as a comment. The
  option is preserved and re-applied inside the same effect, so there is no blank
  frame; what is NOT preserved is anything the user did to the instance — a zoom,
  a pan, a legend item toggled off. A DATA change costs one `setOption` and no
  teardown, and the two are separate effects so the cheap path cannot silently
  become the expensive one.

### Fixed

- **Two claims in the step 7 docs were wrong** (found by the Claude review on #178,
  after it merged). `DEVELOPER.md`'s #91 row said the inventory mock works around the
  missing selection prop; `VirtualizedList` has no consumer at all, as the project's own
  records say. The portability allowlist entry for `docs/INSTALL.md` cited ADR-0006 for
  the symbolic log path, which it never mentions. Both corrected.

- **A window resize no longer overwrites the saved pane layout** (GitHub #23, plan
  step 5). The panes re-fit to the live width from the layout the user chose, with
  every pane inside its minimum and maximum and summing to 100 above about 700px;
  widening again brings the chosen layout back, and at any width where every minimum
  fits, a reload opens a saved layout on what a live resize to that width shows. A layout corrected when the shell opens narrow, or
  rebuilt by the library when pane 1 collapses and expands, is not saved as a choice,
  and re-expansion shows the chosen layout. An untouched shell keeps its 240px
  navigation width wherever the other panes' minimums allow (it gives way below that,
  pane 1 first). **What made it possible:** the library's own
  re-clamp on a narrower window reached `onResize` looking exactly like a drag, so it
  was saved; review then found two more routes to the same save (opening narrow, and
  the re-expansion rebuild), each now pinned by a test. *Tests:* `e2e/pane-refit.spec.ts`,
  `src/components/__tests__/ShellLayoutRefit.test.tsx` (the unit cases are arithmetic
  over stubbed widths, as their describe says). **Not done:** #23 stays open for the
  owner to see in the packaged app (rule 5); below about 700px the library still
  renormalises. `docs/design/WAVE3-PLAN.md` adds the wave-3 plan (increments W3-1 to
  W3-8); none of them is built.

- **The Claude review job ran but could post nothing** (D-49). On #145 (run
  35410730035) it took 10 turns, was denied 14 tool calls and reported SUCCESS with no
  comment: `claude-code-review.yml` allowed only the inline-comment tool and gave the
  job `pull-requests: read`. It now allows exactly the tools the `code-review`
  plugin's command declares, plus `Read`, `Grep` and `Glob`, and holds
  `pull-requests: write`. **What made it possible:** a green check was read as a
  review, and nobody opened the run's log. **Not proven here:** a PR that changes
  this workflow is skipped by the action, so whether the review comments is proven
  by the next PR.
- **The Claude review job still posted nothing on #148** (run 35412804663: 10 turns,
  10 permission denials). **Inferred, not observed:** the run log reports only the
  denial count, not which tools were denied. The plugin's command launches review
  subagents, and the subagent tool was not allowed, so that is the likely cause. The
  workflow now also allows `Task` and `Agent` (the tool's old and new names). **What
  made it possible:** the previous fix copied the command's declared `allowed-tools`,
  which do not list the subagent tool that the command's own steps use. **Not proven here**, for the same
  reason as before: the action skips a PR that changes its own workflow.
- **The Claude review job is a direct prompt, not the `code-review` plugin.** After the
  subagent fix it still posted nothing on #150 (run 35415153661: 7 turns, 1 denial).
  The plugin can stop early by design or be denied a tool, and the run log does not say
  which, so three SUCCESS runs gave no signal either way. The prompt now reviews against
  `CLAUDE.md` and ADR-0003 and must always end with one `Claude review:` summary
  comment. The plugin marketplace URL, which could not be pinned, is gone. **What made
  it possible:** a job that can succeed silently was treated as a reviewer. **Proven on
  the next PR** (#152, run 35416928233): it posted a summary and two inline findings, both
  valid and fixed there.
- **Chart titles overprinted the plot and ignored the theme; the chart contrast rows
  were measured on a background nothing painted** (GitHub #112, #113; #111 addressed).
  The title is no longer drawn into the ECharts canvas: the `<figcaption>` is the
  visible heading, in `--text-primary`, and the canvas host paints `--surface-sunken`,
  the plot well the twelve series were validated on. `design/check-contrast.mjs` gains
  an UNPAINTED failure (a contrast row whose background nothing in `src/` paints) and a
  STALE EXEMPTION failure, and now runs inside `npm run tokens:check`, so in `verify`
  and in CI on three operating systems; until this change no script invoked it.
  **What made it possible:** text rasterised into a canvas had no instrument pointed
  at it (jsdom paints nothing; the contrast gate read declared pairs, never what is
  painted), and the gate checked that a background token existed, never that it was
  used. **Not done:** the Database chart is clipped to about 44px of its 160px canvas
  at the default viewport. That predates this change, and this change makes it about
  14px worse; it is filed with measurements as #146. The canvas font family is still
  ECharts' default, and legend text is still 12px.
- **Two links in `DEVELOPER.md` pointed outside the repository**
  (`../src/examples/HelloExtension.tsx` and its test, from a file at the root). Found
  by the link sweep this change ran; nothing checks inter-document links (GitHub #54).

- **The production audit had been red for six weeks and nobody saw it.** The
  scheduled audit failed on every Monday from 2026-08-10 to 2026-09-14 on a high
  advisory against `js-yaml` 4.0.0–4.3.1 (GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh),
  reached through `electron-updater` — the package that will parse the update
  feed's `latest.yml`, so the advisory sat on exactly the path a public release
  exercises. The lockfile now resolves `js-yaml` 4.3.2. **What made it possible:**
  a failed scheduled run notifies no one, and the dev tree was audited by nothing,
  so the same week-on-week blindness also hid four high advisories in the dev tree
  (`@xmldom/xmldom`, `brace-expansion`, `fast-uri`, `nanoid`) and three moderate
  ones in `vitest`. All seven are resolved in-range; `vitest` and
  `@vitest/coverage-v8` move `^4.1.10` → `^4.1.11`, the one range change. **What
  closes the mechanism:** `npm run audit:all` audits the whole tree as its own job
  ("Audit all dependencies") in `audit-dependencies.yml` and in the scheduled audit,
  and a failing scheduled run now files — or comments on — an issue titled
  "Scheduled dependency audit is failing". Measured: `npm audit --omit=dev` and
  `npm audit`, both "found 0 vulnerabilities", run with npm 11.16.0. **Not done:**
  `audit:all` is not a `verify` stage, and the issue-filing step has not yet been
  seen to fire, because it only runs on a scheduled failure. **Found on the way:**
  `npm audit fix` crashed under npm 10.9.8 with `Cannot read properties of null
  (reading 'edgesOut')` against the lockfile of that time; npm 11.16.0, the version
  `packageManager` declares, did not. **Corrected later the same day:** the crash
  reproduces on the pre-#126 lockfile (`148217b`) and not on the current one, and an
  `npm update` crash also reported here did not reproduce on a fresh install. See
  `docs/traps.md`.

- **The omnibox was never docked, and the word "docked" was already in this file
  describing it (GitHub issue #110).** `PaneWrapper`'s body was a flex ITEM of a
  `flex-row` and was not itself a column, so a child using `flex-1` to fill
  vertically had no column parent to fill against and sized to its content; the
  composer, being the last child of the scroll container, came to rest wherever
  the ledger stopped — measured at y≈408 in an 860px pane, above roughly 450px
  of empty pane. **Two changes, and they fix different halves.** The body is now
  `flex flex-col`, so children can fill it; and `PaneWrapper` grows a `footer`
  slot outside the scroll container, symmetric with `header`, which is where
  pane 3's composer now lives. `OmniboxComposer` stopped drawing its own
  `border-t p-1` because the slot draws them.
  - **Found by looking at the running application. 1,739 tests were green
    through it,** which is rule 4 in `CLAUDE.md` and the reason `e2e/` exists.
  - **The two halves needed two browser assertions, and a mutation probe is what
    proved it.** Reverting `flex flex-col` left the docked-footer case green —
    the footer docks off the section's column and asks nothing of the body's.
    `e2e/shell-layout.spec.ts` now carries "gives pane 3 a detail stack that
    reaches the bottom of the scroll container rather than stopping at its
    content" as well, and that one goes red under the same revert. The vitest
    side asserts a class string and says so in its own title.

- **The two content panes opened at sizes summing to 83 and warned on every
  load (GitHub issue #114).** `react-resizable-panels` requires one group's
  panels to sum to 100. When navigation collapses, pane 1 becomes a fixed 48px
  `div` rendered outside `shell-panes`, so the group holds panes 2 and 3 alone —
  but the pane-1 share was still being subtracted from pane 3's remainder. At a
  measured 1440px that is 25 and 58.33333333333334, which the library
  renormalised while warning `Invalid layout total size`, and pane 2 opened
  about a fifth wider than `PANE_PX` asks for. The predicate is now
  `paneOneIsInGroup = showChrome && !isNavCollapsed`, which is the question the
  arithmetic was always asking. No new arithmetic: the same rebase the restored
  path already applied, applied to the predicate that decides it.
  - **Observable in jsdom, unusually for this redesign's defects.**
    `measureGroup` reads a width jsdom reports as 0, `percentOf` falls through to
    `PANE_FALLBACK_PERCENT`, and the library still does the arithmetic and still
    warns — 26 and 56, summing to 82, at that fallback. Both totals are real; the
    number moves with the group width and the defect does not.
  - The existing case "survives a collapse toggled while a divider drag is in
    flight" **expected the defect** at stubbed 1000px geometry: 47.4 and 52.6,
    renormalised up from 36 and 40. It now expects 36 and 64, which is pane 2 at
    exactly its 360px intent.

- **`sr-only` does not work on a `<table>`, and the shell was shipping one.** CSS
  table sizing says a table's used width is never below its min-content width, so
  the `width: 1px` in `sr-only` is ignored; being absolutely positioned with no
  positioned ancestor, the "hidden" chart data table escaped every
  `overflow: hidden` in the pane and made the whole page scroll sideways at 320px.
  `ChartDataTable` now wraps its table in a `div` and the caller's classes go
  there. Caught by `e2e/shell-layout.spec.ts`, in the browser lane, because jsdom
  lays nothing out and could not have seen it.

- **The command registry and its four surfaces — the ribbon is deleted.**
  `src/core/commands/CommandRegistry.ts` holds one collection and four projections
  — `listForSurface`, `listByCategory`, `recents` and `suggestedFor` — and every
  one of them filters through the same `isVisible`/`when` guards. The surfaces are
  `src/components/command/`: `ContextBar.tsx` (32px, replacing the ribbon at about
  a third of the vertical cost), `CommandPalette.tsx` (Cmd-K, **browsable on an
  empty query**), `FloatingToolbar.tsx` (selection-triggered, pane 3 only) and
  `OmniboxComposer.tsx` (**not** docked when this was written, though this entry
  said it was — see the #110 entry at the top of this section, which is the
  change that made the word true).
  `commandListItem.tsx` is the one row all four render, and the one place a plug-in
  string reaches the DOM. See ADR-0001 Amendment N.
- **`Command`, generalising `RibbonAction`.** Four optional fields — `when`,
  `category`, `surfaces`, `priority` — and nothing removed. `RibbonAction` stays as
  a deprecated alias of `Command`, so nothing an extension has written breaks.
  `LEAPExtensionBlueprint` gains `commands` beside `ribbonActions`; **declaring
  both is rejected** rather than merged.
- **A host chord table.** Cmd-K / Ctrl-K opens the palette, and it is consulted
  before the extension chord table, so an extension declaring `Ctrl+K` never
  receives the keystroke while the host wants it. Host chrome is not
  plug-in-declarable: `HostCommand` has no `hotkey` field and the palette glyph is
  absent from `SHELL_ICONS`.
- **A fourth `HydrationEngine` slot, `recentCommandIds`.** Host-minted, namespaced
  keys, bounded at 16, and read tolerantly so a record written before the slot
  existed still restores. `SCHEMA_VERSION` does not move.

### Changed

- **Behavioural regression to expect, stated in advance.** The 32px context bar
  shows at most four contextual commands inline where the ribbon showed the same
  four — the count is unchanged — but the bar is a third of the height, so a
  command that used to be visible at a glance in a taller row is now one keystroke
  (Cmd-K) or one click (the overflow menu) away. That is the trade the plan asks
  for and somebody will file it as a bug.
- **`src/core/ribbonAction.ts` is now `src/core/command.ts`**, with `isVisible`,
  `execute` and `report` unchanged. The rename is the whole of the change: six
  routes to a plug-in handler now share the two guards that two routes used to.


- **The inversion-of-control extension contract** — `src/core/types.ts`
  (`LEAPExtensionBlueprint`, `IShellAPI`, `RibbonContext`, `ShellUXError` and its
  code enum), `src/core/RegistryContext.tsx` (validation, normalisation, the
  registry provider) and `src/core/ShellAPI.ts` (the deep-frozen per-extension API
  and the shell state store). The host owns lifecycle and layout and holds no
  business logic; extensions are supplied to it and never imported by it.
  (`0a6596b`)
- **Reactive shell state.** The store gained `subscribe`, and `useShellContext` is
  built on `useSyncExternalStore`, so a write through one pane's handle reaches
  another. `patchContext` compares per field and skips both the allocation and the
  notification when nothing moved. (`294c9e0`)
- **The activation lifecycle** — `src/core/ActivationContext.tsx`. Foreground and
  liveness as two orthogonal states, a revocable per-extension `IShellAPI` minted
  against a host-owned record, and `ExtensionHostBoundary` with the
  `useActivation` / `useExtensionActivation` split that gives a plug-in subtree
  read-only facts instead of the host capability. (`294c9e0`)
- **Plug-in-registered keyboard shortcuts.** An optional structured `Hotkey` field
  on `RibbonAction`, `src/core/hotkeys.ts` (`hotkeyToken`, `describeHotkey`,
  `matchesHotkey` — pure, no DOM, no listener), the `HOTKEY_KEYS` host allowlist,
  and the `DUPLICATE_HOTKEY` error code. Structured rather than a string, so there
  is no parser at the trust boundary. Chords are scoped to the foreground
  extension, so two extensions may declare the same chord. Declared and validated
  only; nothing dispatched one yet at this point. (`7fb0649`, ADR-0001 Amendment H)
- **The three-pane resizable shell** — `ShellLayout.tsx`, `PaneWrapper.tsx` and
  `RibbonToolbar.tsx`. A 240px navigation tree that collapses to a 48px icon
  track, a 360px list pane, and a flexing third pane with its own header, scroll
  container and trailing drawer. The ribbon renders host actions on the left and
  plug-in contextual actions on the right, filtered through `isVisible`, with
  labels rendered as text nodes only. (`118aaac`)
- **Local persistence** — `src/core/services/HydrationEngine.ts` and
  `src/hooks/useLocalStorageState.ts`. Versioned, validated, debounced, discarding
  rather than migrating an unrecognised schema version, and degrading silently to
  memory when storage is unavailable. Landed wired to nothing. (`118aaac`)
- **Fault containment and a row virtualizer.** `FaultBoundary` stores the thrown
  value and reads nothing off it inside React's error path; the fallback renders no
  plug-in component and no plug-in markup; retry remounts rather than re-renders,
  is user-initiated, and stops after three consecutive failures. Ribbon, pane 1,
  pane 2 and pane 3 each get their own containment. `VirtualizedList` windows on
  declared row heights and never measures the DOM, with the window arithmetic in a
  separate pure module, `virtualWindow.ts`. (`cd52bbf`)
- **Hotkey dispatch.** Exactly one keydown listener, on `window`, in the bubble
  phase, attached by `ShellLayout` and removed on unmount with the identical
  function reference. Chords fire only for the foreground extension, and are gated
  by the same `isVisible` and `isDisabled` predicates as the ribbon button that
  carries them, so a chord is never a wider route to an action than the button
  already is. `aria-keyshortcuts` is advertised on chord-bearing actions in the UI
  Events key-value spelling. (`752ee83`, ADR-0001 Amendment J)
- **Live badges.** `useBadgeCount` is a `useSyncExternalStore` selector over the
  badge map, and the navigation tree prefers a store badge over the blueprint's
  static value, in the expanded tree and in the collapsed icon track alike.
  (`752ee83`)
- **Toolchain and CI.** Vite, React 18, TypeScript in strict mode, Tailwind and
  Vitest/jsdom; `.gitattributes` normalising to LF; a CI workflow running lint,
  typecheck, coverage, build and a production-only audit; a 100% coverage gate over
  `src/core/**` that exits non-zero below the threshold. (`cf84f18`)
- **Declared environment facts, so a wrong toolchain fails at install rather than
  later** — `engines.node`, `.nvmrc` read by CI through `node-version-file`,
  `.npmrc` with `engine-strict`, and `packageManager`. (`e504fd3`)
- **`scripts/check-portability.mjs`**, the mechanical half of ADR-0002: rules over
  `git ls-files` covering absolute paths, drive letters, home directories,
  case-insensitive filename collisions, CRLF, byte-order marks and import casing.
  Wired into `npm run verify` and into CI. (`e504fd3`)
- **`scripts/check-citations.mjs`**, the mechanical half of ADR-0001 Amendment G:
  it parses prose for cited test titles and fails on one that resolves to no test
  in the suite. It checks that a citation which **is** present resolves; it cannot
  tell that a security claim carries no citation at all, and says so. (`118aaac`)
- **Documentation** — the issue manifest, `README.md`, `DEVELOPER.md`, ADR-0001
  (the IoC registry architecture) and ADR-0002 (no local-environment
  dependencies), plus `CONTRIBUTING.md`. (`959e3ee`, `e504fd3`)
- **Two verification mocks under `src/mocks/`** that exercise the public contract
  the way a third party would. They produced eight contract-gap findings. (`118aaac`)

### Changed

- **THE SHELL LOOKS HEAVIER, AND THAT IS THE FIX RATHER THAN A BUG.** Every pane
  edge, the ribbon's bottom edge, the overflow menu's border, every slot divider
  and the fault surface's boundary are now `--border-default`, which resolves to
  `#7e8085` in the light theme. They were `border-neutral-200`, `#e5e5e5`. That is
  **1.26:1 against the pane it bounds, replaced by 3.95:1** — roughly three times
  the ink, visible at a glance, and the reason it is announced here in advance is
  that it will otherwise be filed as a rendering regression.

  It is a WCAG 2.2 §1.4.11 correction: a control's visual boundary must clear 3:1,
  and a 1.26:1 hairline is not a boundary anyone with low vision can find. **There
  is no version of this that is invisible.** 3:1 on white alone would have landed
  at exactly `#949494`; the token is darker than that because the manifest
  measures it against every surface it is actually drawn on, and the binding
  constraint is `--surface-sunken` at 3.47:1 rather than the pane.

  Two smaller changes ride along, both in the same direction. `--text-muted` moves
  from `#737373` to `#5c5f64`, 4.74:1 to 6.41:1 on white — bought so that muted
  text clears 4.5:1 on **all eight** surfaces rather than only on the pane, which
  is what removes the hand-written dark-theme patch that used to sit beside every
  muted string. And the selected-row indicator is now carried by a 2px
  `--border-selected` rule and a semibold label, with the fill demoted to a hint
  and the 1px outline demoted to `--border-subtle`; no fill reaches 3:1 on white
  without reading as a different control entirely.

  Decorative rules are deliberately **not** dragged along: the `--border-subtle`
  tier exists to keep the weight off separation that is not a control boundary,
  and in-pane section rules use it. The numbers are measured rather than asserted
  — `design/check-contrast.mjs` over 165 declared pairs in three themes, and now
  `npm run tokens:check` over the shipped stylesheet as well.
- **Every colour in the shell is a design token, and all 51 `dark:` variants are
  gone.** 118 raw colour literals across seven modules — 114 Tailwind palette
  classes plus four `theme(colors.neutral.*)` spellings inside arbitrary shadow
  values, which no colour search in this repository had ever found — became
  `var(--token)` utilities driven by `src/styles/tokens.generated.css`.

  **The `dark:` variants were deleted rather than made testable, and that is the
  answer to the "exercised by nothing whatsoever" finding.** When a colour is a
  token whose *value* swaps on `[data-theme]`, `dark:border-neutral-800` beside
  `border-border-default` is an override of something that already changed. The
  untested surface is removed instead of tested. `darkMode` stays configured as
  `['selector', '[data-theme="dark"]']` for the genuinely appearance-conditional
  cases that will arrive with per-document theme injection; the allowlist in
  `src/__tests__/noRawColor.test.ts` is **empty**, and the one known future member
  — the shadow tier, which is black at fixed alphas in every theme and elevates
  nothing on a near-black pane — is named there with the note that the fix belongs
  in `design/` rather than in a hand-written variant.

  **What this weakens, stated rather than buried:** the 43 `toHaveClass`
  assertions that pinned colours now assert against a `TOKEN_CLASS` record the
  components import, so they can no longer catch a component pointed at the wrong
  token. `scripts/check-tokens.mjs` measures the values and `e2e/theme.spec.ts`
  measures the compiled stylesheet; the full account is in
  `src/core/theme/tokenClasses.ts`.
- **Tailwind's `content` glob no longer matches test files.** The scanner is a
  regular expression over raw text with no idea what a file is for, so every
  planted-violation fixture and every density-scan control string was compiling
  into the shipped stylesheet — measured, not suspected: seven `.dark\:` rules
  survived in the built CSS after the last `dark:` utility had been deleted from
  the shell. A component cannot depend on a class only a test spells, so nothing
  real is lost.
- **`getExtension(id)` no longer returns the caller's object.** Validation and
  normalisation became one pass, and what is stored is a fresh host-owned record.
  A breaking change to the registry's read contract, made deliberately; the correct
  comparison for an extension author is on `id`. (`0a6596b`, ADR-0001 Amendment A)
- **`onExecute` gained a second parameter**, the `IShellAPI` handle. Before this a
  ribbon action provably could not change anything. Source-compatible for every
  implementer, and still a contract change. (`294c9e0`, ADR-0001 Amendment C)
- **Badge state is keyed by `${extensionId}:${nodeId}`** rather than by the bare
  node id, and the scope is supplied by the host at mint time rather than taken as
  a parameter. (`294c9e0`)
- **Liveness is re-checked at call time and keyed on the mint-time record.** The
  post-commit sweep is kept for bookkeeping and is no longer what stands between a
  forgotten extension and the store. (`294c9e0`, ADR-0001 Amendment D)
- **Provider teardown no longer revokes anything.** Liveness ends by exactly two
  events: `release(id)`, and being unregistered. Two implementations of teardown
  revocation were removed rather than repaired. (`294c9e0`, ADR-0001 Amendment F)
- **The dependency audit moved off the per-push path** onto a lockfile-scoped
  workflow plus a weekly scheduled run, so advisory drift cannot redden an
  unrelated commit. (`e504fd3`)
- **Lint runs at `--max-warnings 0`**, with the `react-refresh` exception narrowed
  to five named exports in `eslint.config.js` rather than suppressed inline. The
  repository holds zero inline suppressions. (`e504fd3`)
- **CI runs on Ubuntu, macOS and Windows**, so cross-platform support is observed
  rather than inferred from the lockfile's optional binaries. (`e504fd3`)
- **The no-listener invariant was narrowed twice rather than deleted** — once for
  the virtualizer's key handling, once for the hotkey dispatcher — each time to an
  exact allowlist asserted in both directions, and each time with the lost static
  guarantee replaced by a stronger runtime one. (`cd52bbf`, `752ee83`)
- **The coverage gate widened** from `src/core/**` to include `src/components/**`
  and `src/hooks/**`, and held at 100% on statements, branches, functions and
  lines. (`118aaac`)
- **The shared ribbon action guards — report, `isVisible`, execute — moved into
  `src/core/ribbonAction.ts`**, so the ribbon and the dispatcher cannot drift.
  Those semantics are security-relevant, and two copies of them would drift
  silently. (`752ee83`)

### Fixed

- **The density scan silently stopped measuring anything it could not parse.**
  `typeSizeOffenders` returned "clean" for any arbitrary type size it failed to
  read as a length, so `text-[var(--type-body)]` sailed through contributing
  nothing while `paddingOffenders` beside it treated the same ambiguity as a
  violation. Tokenising font size before fixing this would have replaced a
  measured type scale with values the scan waves through, and every run would
  have stayed green. Now only Tailwind's explicit `color:`-style data-type hint
  earns an exemption — that is *proof* the value is not a length — and anything
  else the scan cannot convert is reported, matching padding. Padding and font
  size remain deliberately untokenised for this reason, so the scan survives
  byte for byte.
- **A registration hijack through a multi-read id getter.** A value the plug-in can
  still reach is a value the plug-in can still edit, so reading each field once was
  necessary and not sufficient; the host now owns the stored record. Single-read
  access was measured through a logging `Proxy` rather than inferred. (`0a6596b`,
  `a1df19d`)
- **A bounds check that bounded nothing.** A `Proxy` could report an honest
  `length` while it was measured and a larger one afterwards; collections are now
  rebuilt at exactly the bounds-checked length. (`0a6596b`)
- **`validateBlueprint` leaked a raw `TypeError`** when a revoked `Proxy` reached
  any of five unguarded `Array.isArray` sites. (`294c9e0`)
- **The shell state store object was never frozen.** A plug-in view could swap
  `setSelectedItem` through the public `useShellStore()` and swallow another
  extension's writes. (`294c9e0`, ADR-0001 Amendment F)
- **`patchContext` accepted what `setSelectedItem` refused** — an object with a
  getter in `selectedItemId`, an illegal pane id, an unregistered extension id. It
  is now validated field by field against a table pinned to `keyof RibbonContext`,
  applies all-or-nothing, normalises `undefined` to `null` instead of writing a
  value the declared type forbids, and uses `Object.hasOwn` rather than `in`, which
  had been walking the prototype chain. (`294c9e0`)
- **Handle resurrection across `unregister` then `register` under the same id.**
  Id presence was the wrong question; the liveness predicate now compares record
  identity. The same defect also made re-activation after a re-registration return
  the stale entry. (`294c9e0`)
- **A StrictMode path that permanently revoked live handles** — broken in
  development and correct in production, which is the worst shape a bug has.
  (`294c9e0`)
- **An unbounded notify cascade** became a depth-capped `REENTRANT_NOTIFY` raised
  at the offending write, instead of a `RangeError` from a blown stack, with the
  depth counter restored in a `finally`. (`294c9e0`)
- **A cross-extension state leak on foreground handover.** `publishForeground`
  patched only `activeExtensionId`, so a newly activated extension inherited the
  previous one's `selectedItemId` and `activeNavNodeId`. Both are now cleared on a
  real handover and left alone on a redundant republish. (`118aaac`)
- **The ribbon overflow menu was clipped out of existence** by two
  `overflow-hidden` ancestors, so every action past the fourth was unreachable by
  pointer — and six tests asserted it worked, passing vacuously because jsdom has
  no layout engine. The menu is now a portalled Radix dropdown. (`118aaac`)
- **Eight WCAG 2.2 AA blockers**, all of them: the clipped overflow menu above,
  reflow at 320px, dark-mode text contrast from 4.18:1 to 7.85:1, selected-item and
  divider non-text contrast, 24px target sizes, focus returning to the trigger
  after the menu closes, and `aria-disabled` in place of native `disabled` so a
  disabled action stays in the tab order. (`118aaac`)
- **A fault boundary that did not contain the row it was wrapping.** Handing the
  result of `renderRow(item, index)` to a boundary runs extension code *above* it,
  so a throwing row still took the whole list down. The call now happens inside a
  child component below the boundary. (`cd52bbf`)
- **The no-listener claim was pinned to a test covering one module**, so a listener
  added anywhere else would have left it green. Replaced with a scan over every
  non-test module under `src/`, parsed with the TypeScript compiler so prose about
  the absence is not mistaken for the thing itself, and verified by planting a
  listener and watching the suite go red. (`9e80280`)
- **Documentation that was wrong in both directions**: `@throws` declarations
  across `ShellAPI.ts` and `types.ts`, a hotkeys banner claiming four keyboard-event
  fields where the code reads five, an issue manifest carrying no row for
  `src/core/hotkeys.ts`, and a describe block named for badge *isolation* where the
  architecture only delivers badge collision-resistance. (`a1df19d`)
- **Housekeeping with real consequences**: `.claude/settings.local.json` was
  ignored only by a global gitignore that does not travel with a clone;
  `JSX.Element` was resolving through a transitive global and would break on a
  React 19 types bump; two `.gitignore` negations pointed at files that do not
  exist; remaining eager `useRef(new Map())` initialisers became lazy; and
  `release(id)` guards a non-string by returning `false` rather than throwing,
  matching `activate`'s report-do-not-throw contract. (`e504fd3`, `a1df19d`)

### Security

- **`escape` removed from the hotkey allowlist, and `enter` made
  modifier-required.** `HOTKEY_KEYS` admitted both as bare, unmodified chords,
  because the guard refused a bare chord only when the key name was a single
  character. Enter activates the focused control and submits a form in every
  browser and every assistive technology, which is the same reason `space` was
  already excluded — two keys with one failure mode sat on opposite sides of the
  list. `escape` has a second, concrete collision: it is the shell's dismissal key
  and dismisses the dialog dependency this project ships, so an extension holding
  bare `escape` and an open dialog would be in a fight neither side declared. A
  modifier-gated Escape was considered and refused as dead surface, since the
  modified forms are all claimed by the operating system. The allowlist goes from
  61 keys to 60. Done before any dispatcher existed, because once chords fire this
  is a breaking change for every extension that declared one, and the cost only
  rises. (GitHub issue #8, `118aaac`, ADR-0001 Amendment I)
- **The portability checker followed symbolic links and could read files outside
  the repository.** A tracked path that is, or that reaches through, a link is now
  reported by a structural `symlinked-path` rule and is deliberately not read —
  reading it would scan, and could clear, content no clone contains. Detection is
  by the mode git records in the index *and* by `lstat` on every path prefix in the
  working tree, because those are two independent questions and both have to be
  asked; `lstat` also makes a Windows junction detectable with no
  platform-specific code. The checker goes from 19 rules to 20 and gains its first
  tests. (GitHub issue #11, `118aaac`)
- **The same checker confirmed only the last segment of a path's spelling**, so on
  a case-insensitive filesystem it could advise adding a mis-cased path to the
  index — recording the very case collision it exists to prevent, on a developer's
  machine and never in CI. It now walks from the repository root one segment at a
  time, which also closed a separate hole where a specifier could address a path
  outside the repository. (`9e80280`)
- **Roughly sixty documentation claims asserting security the code did not
  deliver were corrected.** These were documentation defects, not runtime ones —
  in every round the code was sound and a conclusion had been written one step
  wider than the premise licensing it. Ten review rounds, eight of which
  reproduced a real defect. The between-extension boundary is **not** enforceable
  in-page: React fiber reflection reaches the host controller from any element on
  the page, verified in the production bundle, and `ExtensionHostBoundary` is
  retained as a guardrail against honest mistakes and documented as nothing more.
  ADR-0001 Amendments E, F and G record the decision, the trigger that voids it,
  and the rule that no security claim may appear in prose without naming the test
  that exercises it. (`294c9e0`)
- **The single-read discipline at the hotkey registration sites was left
  unlicensed** when the hotkey work landed — the claim stood in prose with no test
  asserting it, which is exactly what Amendment G forbids. Nine tests now measure
  it through a logging `Proxy`. (GitHub issue #7, `a1df19d`)
