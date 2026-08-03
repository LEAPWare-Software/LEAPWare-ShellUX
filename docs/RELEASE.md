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
| macOS dmg + zip | **Configured, never built.** It cannot be built from Windows; the `macos-latest` leg of `.github/workflows/desktop.yml` is where it is first exercised |
| Notarization | **Configured by omission** — runs when the Apple credentials are present, skips with a warning when they are not. Never executed |
| The update feed | **Wired end to end, pointing at a host that does not exist.** The packaged application reads `app-update.yml`, contacts the feed, and reports `net::ERR_NAME_NOT_RESOLVED`. Every part of that path is real except the bucket |
| The palette commands | **Observed in the packaged application.** "Check for updates — last check failed" appears in the palette of a packaged build, which is the end-to-end evidence that the main process, the preload bridge and the command registry are connected |

---

## 1. Once, before the first release

- [ ] **Decide where updates come from. There is no feed configured, deliberately.**

      > **The previous placeholder was an invented host and it has been deleted.**
      > `electron-builder.yml` pointed at `updates.leapware.dev`, which looks like
      > this project's domain and is not owned by it. With `provider: generic` that
      > single URL is the sole authority for both the manifest and the installer it
      > names, and nothing here is signed — so a shipped build would have asked a
      > stranger's server what to download and then run it. It never shipped. The
      > `publish` block is now absent, `DOCUMENTED_ENDPOINTS` is empty, and the
      > hostname rule is fully on, so it cannot come back quietly.

      Two routes, and the first is much cheaper than it looks:

      **(a) Make the repository public and use `provider: github`.** The GitHub
      provider was rejected on one fact: this repository is private, so release
      assets need authentication, which would mean a token inside the shipped
      client. **On a public repository those assets are plain public URLs** — no
      host to own, no DNS record, no bucket, no static site to keep alive. The feed
      becomes GitHub Releases, which the release workflow is already producing
      artifacts for. This is also the same decision that unblocks branch protection
      (HANDOFF §5) and private vulnerability reporting (HANDOFF §6.2). One choice,
      three blockers.

      **(b) Own a static HTTPS host and use `provider: generic`.** Any object store
      or static host serving one directory. No compute, no reader authentication, no
      API — electron-updater fetches `latest.yml`, then the installer named in it.
      Keeps the source closed. Costs a host somebody has to prove they control, and
      a DNS record.

      Whichever is chosen, **the host must be one this organisation demonstrably
      owns.** A name that merely resolves proves somebody owns it, not that you do —
      which is exactly the inference that produced the defect above.
- [ ] **Replace the placeholder host in exactly three places, and no more.**
      1. `electron-builder.yml`'s `publish.url` — the only place the *build* reads
         it, and the only place a running application's feed comes from.
      2. The row in `DOCUMENTED_ENDPOINTS` in `scripts/check-portability.mjs` —
         ADR-0002's declaration. Until it is updated, `npm run check:portability`
         fails on the new host.
      3. The `packaging build commands and the declared update feed` fixture in
         `scripts/__tests__/check-portability.test.mjs`, which asserts that the
         declared host passes and a lookalike does not. Until it is updated,
         `npm run test:scripts` fails.

      Two of those three are gates failing on purpose, and that is the point: the
      feed host cannot be changed quietly. If a **fourth** place needs changing,
      something has copied the URL and that copy is the defect — nothing in `src/`,
      nothing in `electron/` and nothing in any workflow contains it.
- [ ] **Decide the repository's visibility on its own merits.** Three tracked
      blockers share one root cause — branch protection returns `403` (HANDOFF §5),
      private vulnerability reporting is unavailable (HANDOFF §6.2), and the GitHub
      update provider needs a shipped token. Making the repository public fixes all
      three; paying for a plan fixes the first two. The static feed means this
      decision is no longer *forced* by the updater, which is exactly why it should
      be taken deliberately rather than by default.
- [ ] **Obtain a code-signing identity**, and read `docs/signing.md` §3 first. The
      packaging configuration contains no signing configuration at all, so the
      provider is whatever `CSC_LINK` points at and switching providers is a change
      of secret, not a change of build.
- [ ] **Store the secrets** the `env` block of `.github/workflows/desktop.yml`
      already names: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Every one of them is optional
      and the lane produces an unsigned artifact without them.
- [ ] **Add an application icon.** The build currently logs `default Electron icon
      is used`, which means the first release would ship with Electron's own logo.

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

- [ ] Tag `vX.Y.Z` and push it. `.github/workflows/desktop.yml` runs on
      `windows-latest` and `macos-latest`, signs if the secrets are present, and
      **publishes nothing** — `--publish never` is not negotiable in that lane.
- [ ] Download both artifacts from the workflow run.

### 2.3 Verify before publishing, not after

- [ ] **Signature present on the artifact itself**, checked with the platform's own
      tool. The absence of a warning in a build log is not a signature;
      `electron-builder` logs `signing with signtool.exe` on Windows even when there
      is no certificate and nothing is signed. Verified this way once already, and
      that is how the "unsigned" row in section 0 is known.
- [ ] **The macOS zip is present alongside the dmg.** electron-updater updates a
      macOS application from the zip. A dmg-only release installs fine and can never
      update itself, and nothing about it looks wrong until the release after it.
- [ ] **`latest.yml` and `latest-mac.yml` are present**, and the `version` in each
      is the version just tagged.

### 2.4 Publish

- [ ] Upload the installers **and** the `latest*.yml` manifests **and** the
      `.blockmap` files to the feed. The blockmap is what makes a differential
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
