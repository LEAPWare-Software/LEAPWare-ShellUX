# SDLC: how work moves through ShellUX, under LEAPWare BuildCraft

**The SDLC is led by LEAPWare BuildCraft** (`LEAPWare-Software/LEAPWare-BuildCraft`),
per decision D-39. BuildCraft is itself still being built, so this file does two
jobs: it states the lifecycle ShellUX follows **by convention** today, and it keeps
the **adoption ratchet** that retires each convention the day BuildCraft ships the
gate that enforces it.

Read the vocabulary rule first. Until a row in the ratchet table below says
**enforcing**, the matching practice is a **convention**: it is honoured because the
people and agents working here choose to honour it, and nothing refuses a change
that ignores it. A convention is at most a **guardrail** in the sense `CLAUDE.md`
defines. Nothing in this file may be quoted as "built under BuildCraft" beyond the
rows marked enforcing.

---

## 1. What BuildCraft has decided, and what it has not

Measured 2026-09-18 against BuildCraft `main`:

| Part | State |
|---|---|
| Stage order: design, qa, review, security, delivery, release, operations | **Decided** (`docs/requirements/mission.md`) |
| Role rule D3: a qa, review or security actor may not have authored any earlier stage of the same deliverable | **Decided** |
| Stage, role, proof and hygiene gates | `PROPOSED`. None ships |
| The shipped rule | One: `lwb_version`, a no-op that never denies |
| A consumer-side record format (reviews, proofs) | **Not defined.** BuildCraft's own `reviews/` directory is its internal store, not a contract for consumers |
| Reviewer identity bound to what was reviewed (D5) | **Open.** BuildCraft PR #13, "bind reviews to commits", is the direction |
| Release | v0.1.0, no tag |

ShellUX adopts only the two decided rows. It does not invent the undecided ones.

---

## 2. The stage map

Every step in [`plans/v1-production.md`](plans/v1-production.md) passes through
these stages in order. ShellUX's existing machinery is what each stage runs today.

| Stage | What it means here | What runs it today |
|---|---|---|
| **design** | The change is described before it is built: a plan step, an ADR, or design gates 3 and 4 for UI | Plan file, `docs/adr/`, `DESIGN.md`, the gate-4 screens, `docs/DECISIONS.md` for any owner call |
| **qa** | The change is shown to work, with evidence | `npm run verify` (exit code read directly, never through a pipe), `npm run test:browser` for anything geometric, visual, focus-ordered or pointer-driven, and mutation probes on new guards |
| **review** | Someone who did not author it tries to break it before merge | An adversarial review by an `lw-verifier` agent that authored nothing in the change, recorded on the pull request |
| **security** | The change is checked against the vocabulary rules and the threat model | Review of every security-relevant sentence against ADR-0001 Amendment G; `audit:prod` and `audit:all`; a secret scan before anything goes public |
| **delivery** | The change lands on `main` | A pull request, CI green on every leg, the review record present, `HANDOFF.md` and `CHANGELOG.md` updated in the same landing |
| **release** | A version is cut | `docs/RELEASE.md` §2, and for 1.0 the BuildCraft enforcing pass in plan step 9b |
| **operations** | The released app is observed | The log file and crash reporting from plan step 7; the scheduled audit, which files an issue when it fails |

---

## 3. Role separation (D3), by agent routing

D3 is honoured by **who does the work**, not by a gate:

- The author of a change never reviews it. Reviews go to an `lw-verifier` agent
  dispatched fresh for that change.
- The author of a change never runs its security stage. When one agent can do both,
  a second is dispatched.
- **What this does not deliver:** this repository has one human developer, so D3 is
  met by distinct agents, not distinct people. Whether that satisfies D3 is BuildCraft
  question D5, left for BuildCraft to answer.

---

## 4. The review record

Until BuildCraft defines a consumer format, a review is a pull-request comment with
these fields. They are chosen so that BuildCraft can check them later without the
record being rewritten.

| Field | Content |
|---|---|
| Reviewer | The agent type and model, and a statement that it authored nothing in the change |
| Role and stage | `review` or `security` |
| Commit reviewed | **The SHA**. A review of a branch tip that later moves does not cover the new commits |
| Verdict | MERGE, MERGE AFTER FIXES, or DO NOT MERGE |
| Findings | Severity (Blocker, High, Medium, Low), location, and how each was resolved |
| Not verified | What the reviewer did not check, stated |

PR #115 and PR #126 carry the first two records in this form, except that #115's
omits the SHA, which this table added afterwards.

---

## 5. The adoption ratchet

One row per BuildCraft rule. A row moves right only on evidence: a tagged
BuildCraft release, installed here, seen to refuse a change that breaks it.

| BuildCraft rule | BuildCraft state | Installed in ShellUX | Enforcing here | The convention it retires |
|---|---|---|---|---|
| `lwb_version` | exists, no-op | no: nothing is installed before a gate enforces something (D-44) | never: it denies nothing | none |
| Stage order | `PROPOSED` | no | no | §2's stage map |
| Role rule D3 | `PROPOSED` | no | no | §3's agent routing |
| Proof gates | `PROPOSED` | no | no | Pasted `verify` output in PR bodies (rule 2) |
| Review records bound to a SHA | open (D5) | no | no | §4's review record |

---

## 6. The readiness bar for 1.0 (D-39)

**v1.0.0 is not tagged until all seven hold**, each checked against a tagged
BuildCraft release rather than its documentation:

| # | Criterion | 2026-09-18 |
|---|---|---|
| R1 | A tagged, installable BuildCraft release | not met: v0.1.0, no tag |
| R2 | Stage gates enforcing the stage order on a consumer repository | not met: `PROPOSED` |
| R3 | Role rule D3 enforcing | not met: `PROPOSED` |
| R4 | Review records bound to a commit SHA, with reviewer identity verifiable (D5) | not met: D5 open |
| R5 | Proof gates: a stage cannot pass without its recorded evidence | not met: `PROPOSED` |
| R6 | Gates configurable per repository, with nothing hard-coded to BuildCraft's own tree | not met: its scripts read its own paths |
| R7 | A documented consumer adoption path: install, configuration, record format | not met |

When the bar is met, work already landed under convention is not re-reviewed merge
by merge. The release candidate, meaning the whole diff to that point, runs
BuildCraft's full stage sequence once, enforcing, with review, security and release
done by actors who authored none of it.
