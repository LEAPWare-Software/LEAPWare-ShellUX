# ADR 0002 — No Local-Environment Dependencies in Tracked Files

- **Status:** Accepted
- **Date:** 2026-07-30
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Enforced by:** `scripts/check-portability.mjs`, run by `npm run check:portability`,
  included in `npm run verify`, and a required step of the `verify` job on all
  three legs of `.github/workflows/ci.yml`

> **This ADR is checkable, and it is checked.** ADR-0001 Amendment G had to admit
> that its rule — no security claim without a named test — is a review-time
> convention that no script enforces. That admission is honest and it stays.
> This decision is a different kind of rule: every clause of it can be decided by
> reading the tracked files, so leaving it to review would be a choice, not a
> limitation. A build that does not fail is a rule nobody has to follow.

---

## Context

This project is developed on more than one laptop, across Windows, macOS and
Linux, and it is intended to be cloneable by someone who has never spoken to the
author. Both of those depend on the same property: **the repository is complete.**
Everything a build needs is either in the tree or declared in it.

That property is easy to hold and easy to lose. Nobody sets out to commit a path
that only exists on their own machine. It happens because the machine you are on
answers a question the repository should have answered — a script reaches for a
tool that happens to be installed, a config points at a directory that happens to
exist, a filename differs in case from its import and the local filesystem does
not care. Each of these works perfectly on the machine where it was written. All
of them fail somewhere else, and they fail confusingly, because the error surfaces
far from the assumption.

An audit of this repository at commit `294c9e0` found the tree already clean of
every one of these: no machine-specific path in any tracked file, all 81 relative
imports case-exact, no case-colliding tracked paths, all blobs LF with no
byte-order mark, all npm scripts portable, and no environment variable read
anywhere. **This ADR is therefore not a remediation. It is the decision to keep a
property the project currently has**, at the point where it is cheapest to keep —
which is before it is lost, not after somebody's second laptop finds out.

The forces acting on the decision:

1. **The failure is asymmetric.** A local-environment dependency costs its author
   nothing and costs the next person a debugging session on an unfamiliar tree.
   The author is also the least likely person to notice it.
2. **Convention decays and gates do not.** ADR-0001 Amendment G records seven
   consecutive review rounds finding the same class of defect. The mechanism was
   never what was wrong; relying on someone remembering was.
3. **Whatever enforces this must itself be portable.** A checker written in
   PowerShell or in a shell script would be the exact defect it is looking for.
4. **The rule has to be decidable.** A clause that cannot be checked mechanically
   belongs in review, and should say so rather than pretending.

---

## Decision

### 1. The mandate

**No tracked file may contain any of the following.**

- An absolute path — including one anchored to a Windows drive letter, and
  including a UNC path naming a specific host.
- A path through a per-user home directory, or a per-user application-data
  directory.
- A reference to any developer's local directory layout, by any route: a login
  name, a machine name, or a per-user environment variable standing in for a home
  directory.
- A machine-specific temporary or scratch directory.
- A hardcoded hostname or IP address, or a port assumption that is not a
  documented default. There are two documented sets, both in
  `scripts/check-portability.mjs`: `DOCUMENTED_PORTS`, which holds the Vite dev
  server's own default and is also recorded in README.md, and
  `DOCUMENTED_ENDPOINTS`, which holds the desktop update feed's host. See
  **Amendment A**, which added the second one and states why a declaration is not
  an allowlist entry.
- An environment assumption that is not declared and defaulted. Nothing in `src/`
  reads an environment variable today, and a first reader would need a declared
  name and a working default in the same change.
- A platform-only script, build command, or path separator.
- A filename that collides case-insensitively with another tracked file. Two such
  paths cannot both survive a clone onto a case-insensitive filesystem; one
  silently overwrites the other.
- A committed line ending that contradicts `.gitattributes`, or a UTF-8
  byte-order mark. `.gitattributes` mandates LF everywhere except Windows batch
  files, which are marked `eol=crlf` because cmd.exe mis-parses an LF-only batch
  file.

### 2. The acceptance test

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

That sentence is the definition of done for every change in this repository, not
only for changes that look like build configuration. It is written into README.md
as the Getting Started section, so the same instruction serves a new reader and
serves as the test.

Two things it deliberately does require, because they are declared rather than
assumed: a Node version satisfying the `engines` floor in `package.json` — made a
hard install failure by `engine-strict` in the tracked `.npmrc`, so a laptop below
the floor is told immediately rather than three steps later — and network access,
which `npm ci` needs in any case and `npm run audit:prod` needs to reach the
advisory database.

### 3. The enforcement

`scripts/check-portability.mjs` decides every clause of the mandate above.

It is a plain Node script with no dependencies. Node is the one tool the
acceptance test already guarantees on every laptop, so the checker adds no
prerequisite of its own — and a PowerShell or shell implementation would violate
the mandate it enforces.

It enumerates tracked files with `git ls-files` and scans only those, so an
untracked local file cannot fail somebody else's build and cannot hide a violation
either.

Two implementation choices are load-bearing and worth recording:

**Case-exactness is decided against the git index, not the filesystem.** The index
records the byte-exact name, so the answer is the same on a case-insensitive and a
case-sensitive filesystem. Asking the filesystem instead would make the check pass
on the machine where the mistake was made and fail only on Linux, which is
precisely the failure mode it exists to prevent.

**Precision is preferred to suppression.** Two known-legitimate strings in this
repository match the naive form of these rules. Neither is allowlisted:

- The package name shares a prefix with a developer login, so the login rule
  matches only on word boundaries and never inside a longer identifier.
- A test fixture uses a single-label URL as rejected-input sample data, so the
  hostname rule reports only hosts containing a dot — a single-label authority is
  never a reachable public endpoint.
- The checker's own `env` shebang — which it reported on its first run, correctly,
  since the rule had not yet been told the difference. The POSIX-standard portable
  shebang resolves an interpreter through PATH, so it is accepted on the first line
  and a shebang hardcoding an interpreter's install location is still reported.
- **A path segment inside a URL is not a directory**, so `temp-or-scratch-path`
  does not report one. Added by Amendment A.5, and argued there rather than here
  because it is the one case in this list found by a dependency rather than by
  reading the tree.

A sharper pattern is worth more than an exemption, because an exemption stops
checking a file and a sharper pattern does not.

An allowlist exists for what precision cannot reach. It is a declarative table at
the top of the checker; each entry names exact paths, names rule ids explicitly,
and carries a written reason. There is deliberately **no wildcard**: a rule added
later starts out enforced everywhere, so an exemption has to be argued for on
purpose rather than inherited silently. There are two entries, and both are
narrow — the checker's own rule table, for the two rules whose patterns are plain
English words, and the lockfile, for the registry and funding URLs npm writes
into it.

The checker is wired in three places, on purpose: an npm script, the `verify`
chain, and a CI step on every matrix leg. The middle one is what makes it part of
the acceptance test rather than a thing CI does.

### 4. macOS becomes evidence instead of inference

Before this decision, cross-platform support was inferred from the
platform-specific optional dependencies in `package-lock.json` — the lockfile
carries entries for darwin-arm64, darwin-x64, linux-x64 and win32, all with `os`,
`cpu` and `integrity`. That is evidence that a resolver *could* install on macOS.
It is not evidence that anything runs there.

`.github/workflows/ci.yml` is therefore a matrix over `ubuntu-latest`,
`macos-latest` and `windows-latest`, with `fail-fast` off so a platform-specific
failure reports which platforms disagree instead of cancelling the answer. Each
leg catches something the others cannot; the reasoning is recorded in the workflow
beside the matrix.

---

## Consequences

**What this buys.** The acceptance test is now a build step rather than an
aspiration, and macOS support is observed rather than assumed. A violation is
reported at the point of authorship with a file, a line and the offending text,
by a check that runs in about the time it takes to read this sentence.

**What it costs.**

- **CI minutes.** Three legs instead of one. On a public repository this is free;
  on a private one GitHub bills Linux at 1x, Windows at 2x and macOS at 10x, so
  the honest figure is roughly thirteen times a single Linux leg, not three. The
  cost is accepted, and reduced where it can be reduced without losing evidence:
  both dependency audits run on Linux only, and the coverage artifact uploads from
  one leg only.
- **`npm run verify` needs the network.** It ends in a production-dependency
  audit, which queries the advisory database. `npm ci` needs the network anyway,
  so this adds no new class of dependency, but it does mean `verify` is not an
  offline operation and that is stated rather than discovered.
- **A false positive is possible, and the response to one is constrained.** The
  fix is to sharpen the rule or to add an allowlist entry with a reason. It is
  never to weaken the acceptance test.

**What this decision does not cover, stated plainly rather than implied.**

- **A login mentioned outside a path shape is only caught on the machine that
  would introduce it.** The path-shaped rules catch a committed home-directory
  path whoever wrote it and wherever the check runs. The bare-identifier case — a
  machine name, a login in prose — needs the name to be known, and the checker
  learns it from the login of whoever is running the check. It is deliberately not
  hardcoded: naming a developer in a tracked file in order to forbid that name is
  the problem, not the fix. So this clause is enforced on developer laptops and
  not on CI, where the login belongs to a build agent. The checker documents the
  mechanism and provides a list for making a name repository-wide if a leak ever
  has to be kept out, with the cost of doing so stated.
- **A hardcoded host or address in a Markdown file is not reported.** A URL in
  prose is a citation, not a network dependency of the build. The rule is scoped
  to code and configuration, which is where such a literal would actually be
  contacted.
- **UNC detection targets literal, unescaped paths** — the form that appears in
  configuration, YAML and prose. A UNC path written with escaped separators inside
  a source-code string literal is not matched by that rule, though its drive-letter
  and home-directory equivalents are matched by theirs.
- **This ADR says nothing about security.** It is portability and process only. No
  claim in ADR-0001, in its amendments, or in the security posture section of
  README.md is changed, narrowed or widened by it.

**Reversibility.** High. The rule is one script, one npm script entry, one line of
`verify` and one CI step. Nothing in `src/` depends on any of it.

---

## Alternatives considered

**A written rule with no checker.** Rejected. This is what ADR-0001 Amendment G
had to settle for, and only because a security claim's relationship to its test is
a judgement a script cannot make. Every clause here is decidable by reading the
tracked files, so accepting a convention would be choosing the weaker instrument
with no reason to.

**A pre-commit hook.** Rejected as the primary mechanism. A hook lives in
`.git/hooks`, which is not tracked and does not travel with a clone — it would
itself be a local-environment dependency, and installing it would be local setup
the acceptance test forbids. It would also be per-developer, so the one laptop
that skipped installation is the one that commits the violation. A hook remains
available as a local convenience on top of the gate; it cannot be the gate.

**A third-party linter or a `pnpm`/`turbo`-style toolchain check.** Rejected. It
would add a dependency to enforce a rule about not depending on things, and would
still not check the specific clauses that matter here — case collisions among
tracked paths, and import case against the index.

**Scanning the whole working tree instead of tracked files.** Rejected. It would
fail on a developer's untracked scratch files, which are nobody else's problem,
and a check that fires on things the author is allowed to have is a check people
learn to skip.

**Adding a `@/` path alias so documentation examples resolve.** Rejected, and
recorded here because the alternative was live. An alias would have to be declared
in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts` — three files with
nothing forcing them to agree, where a mismatch means the build and the tests
resolve differently. No source file needs one: all imports in `src/` are relative
and all of them are case-exact. And the documentation example that prompted the
question is a test file in an extension author's *own* repository, where a
host-private alias would not be configured at all. The example was made relative
instead; see the testing section of DEVELOPER.md.

**A daily blocking audit on every push.** Rejected, and the reasoning is recorded
in `.github/workflows/audit-dependencies.yml`. An advisory database that updates
daily and a lockfile that does not means the audit result can change with no
commit, so a per-push blocking audit turns `main` red for a defect nobody
introduced. The audit is instead blocking when the dependency graph changes — the
only kind of commit that can introduce a vulnerable dependency — and blocking
weekly on a timer, which is what notices drift without blaming a commit.

---

## Amendment A — desktop packaging, signing, and the update feed

- **Status:** Accepted
- **Date:** 2026-08-02
- **Scope:** Adds to the Decision above. It supersedes nothing, and in particular
  it does not touch the acceptance test in section 2.

Phase 9 of `docs/plans/native-host-pivot.md` produces an installer, signs it when
a certificate is supplied, and updates it from a feed. ADR-0004 clause 8 named
four collisions with this decision **in advance**, and the point of naming them in
advance was that they would be fixed in the change that caused them rather than
discovered by it. All four are settled here.

### A.1 `DOCUMENTED_ENDPOINTS` — a declaration, not an exemption

The update feed's URL is a literal host in `electron-builder.yml`, which the
`hardcoded-hostname` rule fails on sight. Two fixes were available and only one of
them is compatible with section 3's "precision is preferred to suppression".

An **ALLOWLIST entry** would switch the rule off for that path, so a second host
arriving in the same file later would never be seen. A **declaration** names one
host and leaves every other host in every file still reported. The second is what
was built: `DOCUMENTED_ENDPOINTS` in `scripts/check-portability.mjs`, one row,
carrying the reason the host exists and the fact that it is not yet provisioned.
It is deliberately the same shape as `DOCUMENTED_PORTS`, which had held exactly one
row since this ADR was written.

**It matches on exact host equality**, and that is the one implementation detail
worth recording. The RFC-reserved list beside it matches with `endsWith`, correctly,
because every name under `example.com` is reserved. An endpoint is not a suffix:
`endsWith` would have accepted a host that merely *begins* with the declared one
and continues into a domain somebody else can register. Both directions are pinned
in `scripts/__tests__/check-portability.test.mjs`.

**Why the feed URL exists at all**, since a reader will otherwise ask why the rule
was not simply obeyed: this repository is private on a free plan, and
`electron-updater`'s GitHub provider against a private repository requires a token
inside the shipped client. The full argument, including the two alternatives, is
ADR-0004 clause 7.

### A.2 `platform-only-invocation` — the prose and the pattern, in one change

ADR-0004 clause 8 recorded that the rule's regex matched shells and batch
extensions and would therefore not catch `electron-builder --win nsis`, while the
mandate's "platform-only script, build command, or path separator" clause plainly
forbade it. Relying on that gap would have been the "written rule with no checker"
this ADR's own Alternatives section rejects, so the pattern now also matches a
build command that pins its output platform with a flag.

**The portable form is to name no platform.** `electron-builder` with no platform
flag builds for the host it is running on, so `npm run verify:desktop` is one
command on every operating system and `.github/workflows/desktop.yml` gets its two
platforms from a `runs-on` matrix — which is the line that genuinely knows which
machine is present. No script or workflow in this repository names a platform in a
command, and the checker now enforces that rather than describing it.

`platform-only-path-separator` needed no change at all. `electron-builder` accepts
forward slashes on every platform, so the rule is obeyed by writing them.

### A.3 Clause 6 — every environment name the desktop build reads

`docs/signing.md` is the declaration, it is tracked, and it now covers every name
`electron-builder` reads rather than only the five a release supplies. **Setting
none of them produces an installable, working, unsigned artifact** — that is the
working default the clause requires, and it is the mode `npm run verify:desktop`
ran in when this amendment was written.

One correction was found in the process and is recorded there rather than here:
`CSC_IDENTITY_AUTO_DISCOVERY` cannot be set from the packaging configuration, only
from the environment, so the workflow sets it and the configuration cannot.

### A.4 The acceptance test does not change, and a second one is added

> **A fresh clone on a different operating system runs `npm ci && npm run verify`
> with no local setup and no edits.**

Word for word, and `verify` gains no packaging stage. The justification is the one
already written at `playwright.config.ts` for the browser lane: the Playwright
browser download is outside `npm ci` and outside `package-lock.json`, so the lane
that needs it sits outside `verify`. Electron's binary and a code-signing
certificate are the identical argument one step larger.

A second sentence is added, and it is deliberately subordinate:

> **A packaging acceptance test:** on Windows or macOS, `npm ci && npm run
> verify:desktop` produces an installable artifact. This is **not** a
> precondition for contributing; `verify` alone is.

### A.5 `temp-or-scratch-path` was sharpened, and the choice is the same one

Adding `electron-builder` to the tree put two new packages in `package-lock.json`
that are *named* `tmp` and `temp`, so npm wrote registry tarball URLs into the
lockfile carrying each of those names as a path segment — the exact shape the rule
looks for — and it fired on both.

**This ADR's own prose was the second thing it caught.** The paragraph above
originally quoted the two offending segments literally, and the rule reported the
file explaining it. Unlike `hardcoded-hostname` and `hardcoded-ip-address`, this
rule is not skipped in Markdown, and widening it to accommodate a document about
itself would be loosening a gate to make a sentence easier to write. The sentence
was rewritten instead.

The lockfile already carries an ALLOWLIST entry, for `hardcoded-hostname`, so
adding `temp-or-scratch-path` to it was one edit away. **It was refused for a
specific reason and not on principle:** an exemption switches the rule off for the
whole file, and a lockfile *can* carry a genuine local path — a `file:` reference
to a directory on the author's disk is precisely the dependency this checker exists
to catch, and it is the one thing that exemption would have hidden.

So the rule was sharpened instead. A match inside a URL is not reported, because a
URL path segment is not a directory on anybody's disk. Nothing is given away by
that: a URL reaching somewhere it should not is `hardcoded-hostname`'s finding, on
the same line, under a rule with its own declared table. The match is not dropped,
it is handed to the rule that can judge it. Both directions are pinned in
`scripts/__tests__/check-portability.test.mjs` — a bare temporary path still fails,
and so does one being *assembled* beside a URL, which is the case the sharpening
must not swallow.

Section 3's list of precision-over-suppression cases now has four entries, and the
allowlist still has two.

### A.6 A new obligation, stated as a rule because it has already been broken once

**A build output directory is added to `.gitignore` and to `SKIPPED_DIRECTORIES`
in `scripts/check-citations.mjs` in the same change that creates it.** There are
now three of them — `dist/` (Vite), `dist-electron/` (`tsc`) and `release/`
(electron-builder) — and the third exists because the plan's original instruction
to point the packager at `dist/` was wrong: `vite build` empties that directory.
The citation checker walks the working tree rather than the git index, and
`release/win-unpacked` measured **419 MB** on the first real build, so a directory
that reaches only the first list costs every later run of the gate.
