# Releasing a desktop build

**Nothing has been released.** `package.json` declares `0.1.0`, the package is
marked private, there is no tag, and the update feed host is **not provisioned**.
This document is the checklist that has to be true before the first release is,
and it is written so that the first person to use it can tell what has been
observed from what has only been configured.

Three sections. Section 1 is what must be true once, before any release. Section
2 is the per-release checklist. Section 3 is what the release proves that no
automated lane can — and it is the only section with a hard rule about writing
things down.

---

## 0. What is real today, stated first so the rest reads honestly

| Thing | State |
|---|---|
| Windows NSIS installer | **Built and observed.** `npm run verify:desktop` on Windows produced `release/leapware-shellux-0.1.0-win-x64.exe` |
| The installer's signature | **Unsigned, and verified to be unsigned** with the platform's own tool, not inferred from a quiet build log |
| macOS dmg + zip | **Configured, never built, and out of the release path.** D-26 took macOS out of v1: it cannot be built from Windows, `.github/workflows/desktop.yml`'s `macos-latest` matrix leg is where it is exercised as a CI build only, and `.github/workflows/release.yml` — the lane that creates a GitHub Release — packages and uploads Windows exclusively |
| Notarization | **Configured by omission** — runs when the Apple credentials are present, skips with a warning when they are not. Never executed. Moot for the v1 release path per D-26 above; still exercised by `desktop.yml`'s CI leg |
| The update feed | **Decided and configured, never yet exercised end to end.** D-34 chose `provider: github`: `electron-builder.yml`'s `publish` block names this repository, now public (D-43, verified `gh api repos/LEAPWare-Software/LEAPWare-ShellUX --jq .visibility` → `public`), so `app-update.yml` points a packaged build at this repository's GitHub Releases with no token shipped. No release has been tagged or published yet, so no packaged build has ever actually checked for or received an update — that is Step 9 of `docs/plans/v1-production.md`, not this section |
| Update integrity | **A guardrail, not an integrity control (D-34).** Nothing built here is signed. Once a release is public, `sha512` in `latest.yml` served over HTTPS from this repository's GitHub Releases is what a client checks before installing an update — real against an honest mistake (a corrupted upload, a wrong URL), and enforcing nothing against whoever controls the `LEAPWare-Software` GitHub account, who can publish any binary as the next update. See `SECURITY.md` and §2.3/§2.4 below |
| The palette commands | **Observed in the packaged application.** "Check for updates — last check failed" appears in the palette of a packaged build, which is the end-to-end evidence that the main process, the preload bridge and the command registry are connected |

---

## 1. Once, before the first release

- [x] **Decide where updates come from.** D-34 (`docs/DECISIONS.md`) chose route
      (a) below, and it is done, not merely chosen: `electron-builder.yml` carries
      `publish: { provider: github, owner: LEAPWare-Software, repo:
      LEAPWare-ShellUX }`.

      > **The previous placeholder was an invented host and it has been deleted.**
      > `electron-builder.yml` used to point at `updates.leapware.dev`, which looks
      > like this project's domain and was never owned by it. With `provider:
      > generic` that single URL would have been the sole authority for both the
      > manifest and the installer it names, and nothing here is signed — so a
      > shipped build would have asked a stranger's server what to download and
      > then run it. It never shipped. The `publish` block was deleted rather than
      > pointed at a placeholder, and `DOCUMENTED_ENDPOINTS` in
      > `scripts/check-portability.mjs` was left empty with the hostname rule fully
      > on, so it could not come back quietly.

      Two routes were weighed. **(a), taken:** make the repository public and use
      `provider: github`. The GitHub provider was rejected the first time on one
      fact: this repository was private, so release assets needed authentication,
      which would mean a token inside the shipped client. **On a public repository
      those assets are plain public URLs** — no host to own, no DNS record, no
      bucket, no static site to keep alive. D-43 made the repository public on
      2026-09-18; D-34 named the provider in the same round. This was also the
      decision that unblocked branch protection and private vulnerability
      reporting, now both live (`docs/DECISIONS.md` D-27, D-34; `SECURITY.md`).

      **(b), not taken:** own a static HTTPS host and use `provider: generic`. Any
      object store or static host serving one directory, keeping the source closed
      at the cost of a host somebody has to prove they control and a DNS record.
      Left here as the route to return to if the repository is ever made private
      again — in which case `provider: github` stops being safe and must be
      reverted in the same change, not left in place with a token bolted on.
- [x] **Update exactly the places a feed host would need changing — and note that
      `provider: github` needs none.** The plan for this item assumed a literal
      host, because it was written against route (b). Route (a) was taken instead,
      and `hardcoded-hostname` in `scripts/check-portability.mjs` matches only an
      `https?://` literal: `publish: { provider: github, owner: ..., repo: ... }`
      is two identifiers, not a URL, so it introduces none. Concretely:
      1. `electron-builder.yml`'s `publish` block is the only place the *build*
         reads the provider from, and the only place a running application's feed
         comes from — done, above.
      2. `DOCUMENTED_ENDPOINTS` in `scripts/check-portability.mjs` **stays empty**,
         and its comment now says why: an empty map is not "no feed chosen", it is
         "the chosen feed introduces no hostname literal". A row belongs there only
         if a future change goes back to route (b), for a host this organisation
         can prove it owns.
      3. `scripts/__tests__/check-portability.test.mjs` gained a fixture pinning
         this: a real `provider: github` publish block reports no
         `hardcoded-hostname` finding. *Test:*
         `scripts/__tests__/check-portability.test.mjs` — "reports nothing for an
         electron-builder.yml publish block using the GitHub provider, because
         owner/repo are not a hostname literal".

      **What this means for "both gates must go red, then green", as the plan item
      originally read:** they do not, and forcing them to would mean either
      re-adding a hostname this repository does not need (reopening the finding
      route (b) exists to guard against) or manufacturing a red state with no real
      defect behind it, which rule 4b and rule 2 both rule out. The gates were
      exercised honestly instead: `npm run check:portability` and
      `npm run test:scripts` both ran, both passed, and the new fixture is what
      would go red if a hostname literal were ever added here without being
      declared.
- [x] **Decide the repository's visibility on its own merits.** Done: public,
      2026-09-18 (D-43), on its own merits per that decision's reasoning, and
      confirmed again above.
- [ ] **Obtain a code-signing identity**, and read `docs/signing.md` §3 first. The
      packaging configuration contains no signing configuration at all, so the
      provider is whatever `CSC_LINK` points at and switching providers is a change
      of secret, not a change of build. D-25 names the vendor (Azure Trusted
      Signing) but the purchase itself waits on D-10's spend gate (step 6).
- [ ] **Store the secrets** the `env` blocks of `.github/workflows/desktop.yml` and
      `.github/workflows/release.yml` already name: `CSC_LINK`,
      `CSC_KEY_PASSWORD`, and (for `desktop.yml`'s macOS CI leg only) `APPLE_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Every one of them is optional
      and the lane produces an unsigned artifact without them.
- [ ] **Add an application icon.** The build currently logs `default Electron icon
      is used`, which means the first release would ship with Electron's own logo.
      Needs a packaged Electron build to observe the fixed log line, which is not
      doable in the cloud VM this plan item was worked from — left for the owner or
      a VM session (plan step 8, item 1).

---

## 2. Every release

### 2.1 Before the tag

- [ ] `npm ci && npm run verify` — ten stages, exit 0.
- [ ] `npx playwright test` — the browser lane.
- [ ] `npm run verify:desktop` on the machine you are on, to catch a packaging
      break before a tag spends CI minutes on two billed platforms.
- [ ] **Bump `version` in `package.json` and add a CHANGELOG entry.** The version
      in the artifact name, in `latest.yml`, and in the comparison electron-updater
      makes against a running application are all this one number. An unbumped
      version publishes a release no installed copy will ever offer to install.

### 2.2 The tag

- [ ] Tag `vX.Y.Z` and push it. Two workflows run from the same tag, and neither
      depends on the other:
      - `.github/workflows/desktop.yml` runs on `windows-latest` and
        `macos-latest`, signs if the secrets are present, and **publishes
        nothing** — `--publish never` is not negotiable in that lane. Its macOS
        leg is a CI build only (D-26); nothing it produces reaches a release.
      - `.github/workflows/release.yml` runs `verify`, then packages **Windows
        only** (D-26) and creates a **draft** GitHub Release, uploading the
        installer and `.blockmap` first and `latest.yml` last — see §2.4. It
        never uploads a macOS artifact.
- [ ] Download the Windows artifact from either workflow run, or from the draft
      release `release.yml` created.

### 2.3 Verify before publishing, not after

- [ ] **Signature present on the artifact itself**, checked with the platform's own
      tool. The absence of a warning in a build log is not a signature;
      `electron-builder` logs `signing with signtool.exe` on Windows even when there
      is no certificate and nothing is signed. Verified this way once already, and
      that is how the "unsigned" row in section 0 is known.
- [ ] **The macOS zip is present alongside the dmg — moot while D-26 holds.**
      `release.yml` uploads no macOS artifact, so there is nothing to check here
      for the v1 release path. Kept as a checklist item in case D-26 is ever
      reversed and macOS rejoins release publishing: electron-updater updates a
      macOS application from the zip, and a dmg-only release installs fine and can
      never update itself, with nothing about it looking wrong until the release
      after it.
- [ ] **`latest.yml` is present**, and the `version` in it is the version just
      tagged. (`latest-mac.yml` does not apply while D-26 holds, for the same
      reason as the row above.)

### 2.4 Publish

`release.yml` performs this section's ordering automatically for the Windows
release path — see §2.2 — so the checklist below is what to *verify happened*, not
a set of manual uploads to perform by hand, unless the workflow was bypassed.

- [ ] Upload the installer **and** the `latest.yml` manifest **and** the
      `.blockmap` file to the feed. The blockmap is what makes a differential
      download possible; without it every update is a full download that still
      works, which is why forgetting it is easy.
- [ ] Upload the manifest **last**. It is the file that tells running applications
      an update exists, so a manifest published before its installer is a window in
      which every client tries to download a file that is not there yet.

---

## 3. What only a human on a real machine can observe

These are manual because nothing automated can see them, and they belong to the
release rather than to `verify` or to the packaging lane. **Record the outcome
either way.** A clean run is only evidence if it was written down when it
happened; a checklist that is only filled in when something goes wrong produces a
history in which nothing ever went right.

- [ ] **Windows, clean VM, SmartScreen at defaults.** Download the signed installer
      **over HTTPS in a browser** on a Windows 11 virtual machine that has never
      seen a build of this application and has had no SmartScreen setting changed.
      Run it. **Record whether the unrecognized-application dialog appears.** A
      download by any path that bypasses the browser's mark-of-the-web handling does
      not count, because it does not reproduce what a user does.

      > **Why this one is a step and not an assumption.** Since 26 March 2026, Azure
      > Trusted Signing — renamed Azure Artifact Signing — has *reportedly* been
      > issuing from two new intermediate certificate authorities whose executables
      > are being SmartScreen-flagged as unrecognized. **This project has not
      > observed that and does not assert it.** It is a risk to check, and the cost
      > of guessing is asymmetric in both directions: assume it is false and every
      > early download shows the dialog signing was bought to remove; assume it is
      > true and abandon a signing path that may be perfectly healthy.
      >
      > **And a caveat that applies even in the good case, which no provider fixes:**
      > a new signing identity accrues SmartScreen reputation slowly, by download
      > volume over time. Early releases can show the dialog with a valid
      > certificate from a healthy authority. So one observation is a data point
      > about one build, not a verdict on the certificate, and it means nothing
      > until it has been repeated across the first several releases.

- [ ] **macOS, clean machine, Gatekeeper at defaults.** Download, double-click, and
      confirm the application opens **without** the context-menu override. That is
      the check that notarization actually completed, as distinct from the build
      having claimed to submit it.

- [ ] **An old build updates itself. This is the step the whole feed exists for.**
      Install the *previous* release on a clean machine. Launch it. Open the command
      palette and confirm it offers "Check for updates". Invoke it, wait, and
      confirm the label reaches "Update downloaded" and that "Restart to update"
      appears beside it. Invoke that, and confirm the application relaunches on the
      new version.

      Four things this catches and nothing else does: a feed URL that is right in
      the repository and wrong in the uploaded `app-update.yml`; a manifest whose
      `sha512` does not match the installer beside it; an installer signed by a
      *different* identity from the one already installed, which Windows refuses to
      replace; and the case where the update mechanism works and the palette never
      says so, which is the failure the user actually experiences.

- [ ] **Launch on a real Windows 11 machine and confirm Mica renders** behind the
      chrome with opaque panes. Carried here from the plan's manual-acceptance list
      because a release is the first time anyone runs the artifact rather than the
      checkout.

---

## 4. Known costs, so they are not rediscovered as bugs

- **The installer is about 110 MB and the unpacked application about 419 MB.**
  Electron accounts for most of it.
- **About 56 MB of that is `echarts` packed into the asar for nothing.**
  electron-builder copies every production dependency, and this project's
  production dependencies are almost all *renderer* libraries that Vite has
  already bundled into `dist/assets/`. They are shipped twice. The fix is either
  an explicit exclusion list in `electron-builder.yml`'s `files` — fragile, because
  a renderer dependency added later would silently rejoin the archive — or moving
  renderer libraries to `devDependencies`, which would quietly remove them from
  `npm run audit:prod`'s reach and weaken a security gate to save disk. Neither was
  taken in the change that measured it. **Stated as a measured cost rather than
  softened**, in the same spirit as the ECharts bundle delta in the CHANGELOG.
- **`npm run verify:desktop` downloads the Electron binary and, on Windows, NSIS
  and 7-Zip into a per-user cache on first run.** A machine with no network fails
  at *download*, which is a different failure from a broken configuration and the
  log distinguishes them.
