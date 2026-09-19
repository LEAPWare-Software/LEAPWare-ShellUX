# Traps, and how the gates got here

> Moved here verbatim from `CLAUDE.md` on 2026-09-18, when `CLAUDE.md` was cut to the
> 200-line cap the owner set on 2026-09-17. `CLAUDE.md` keeps a one-line pointer to
> each trap. The text is unchanged.

## How the gates got here

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

### npm 10.9.8 crashed on an earlier lockfile: use 11.16.0

**Added 2026-09-18, corrected the same day.** The first version of this entry said
"npm 10.9.8 crashes on this lockfile", covering both `npm audit fix` and `npm update`.
An audit of the session's claims reproduced it in throwaway worktrees and found that
statement too broad:

| Lockfile | `npm@10.9.8 audit fix` | `npm@10.9.8 update <pkgs>`, fresh install |
|---|---|---|
| before #126 (`148217b`) | **crashes**: `npm error Cannot read properties of null (reading 'edgesOut')` | no crash |
| after #141 (`d74e5d0`) | no crash: "found 0 vulnerabilities" | no crash |

The original `npm update` crash happened in a working tree whose `node_modules` had
been installed by npm 10.9.8; that condition was not isolated, so it is recorded as
observed, not as reproduced. **The rule that survives:** maintain the lockfile with npm
11.16.0, the version `packageManager` declares and the one it was written with. The
reason is the declaration, not a known crash on today's lockfile.

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
