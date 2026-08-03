# Desktop build, code signing, and every environment variable involved

**Status:** the packaging lane exists. `electron-builder.yml`,
`npm run verify:desktop` and `.github/workflows/desktop.yml` are Phase 9 of
`docs/plans/native-host-pivot.md`, and they are what reads the names below.
**Nothing has been signed and no certificate has been sought.** The one build this
document has been checked against produced an unsigned Windows installer with none
of these variables set, which is the working default section 1 promises, and
`Get-AuthenticodeSignature` was used to confirm the artifact was unsigned rather
than the absence of a warning in the build log being taken for it.

**The runtime still reads none of these names.** `electron/main/index.ts` and
`electron/main/updater.ts` read no environment variable at all; `app.isPackaged`
is a property of the application's own layout and is not one. Every name here is
read by the *build*.

This file exists because ADR-0002 clause 6 forbids "an environment assumption
that is not declared and defaulted", and because `.gitignore` records the
starting position plainly: *nothing in this repository reads an environment
variable, so there is nothing to configure and no `.env.example` to un-ignore.*
The desktop build is the first thing to change that. The clause does not forbid
reading one — it forbids reading one that is undeclared or that has no working
default. So this document is the declaration, and the column that makes it
compliant is the last one.

---

## 1. The working default is an unsigned local build

**Every variable below is optional, and setting none of them produces an
installable, working, unsigned artifact.** That is not a degraded mode kept alive
out of politeness; it is the mode a contributor uses, the mode CI uses on a pull
request, and the mode this table is defaulted against. Signing is what a
*release* adds.

Two things follow, and both are load-bearing:

- A contributor who has never spoken to the maintainer can build the desktop
  application. If signing were required to build, the acceptance test in ADR-0002
  would have acquired a precondition that no clone can satisfy, and the sentence
  in README's Getting Started would have quietly stopped being true.
- An unsigned build is **visibly** unsigned. On Windows, SmartScreen shows the
  unrecognized-application dialog; on macOS, Gatekeeper refuses a
  double-click and the application has to be opened deliberately from the
  context menu. Neither is a defect to be worked around locally, and neither
  should be worked around by lowering a system setting — the whole point of
  section 4 is that these dialogs are the signal being measured.

---

## 2. The variables

| Name | What it is for | Working default when unset |
|---|---|---|
| `CSC_LINK` | The Windows code-signing certificate, as a repository-relative path to a `.pfx`/`.p12` file, a `file:` URL, or the certificate's base64 content. `electron-builder` reads it to sign the NSIS installer and the executable inside it. On macOS the same name carries the Developer ID certificate. | **Unset.** No certificate is loaded and the artifact is produced unsigned. The build succeeds. |
| `CSC_KEY_PASSWORD` | The passphrase protecting the certificate `CSC_LINK` names. Meaningless on its own. | **Unset.** Only read when `CSC_LINK` is set; with both unset the signing step does not run. |
| `APPLE_ID` | The Apple account identifier used to submit the macOS artifact to Apple's notary service after signing. | **Unset.** Notarization is skipped. A signed-but-unnotarized build still installs; a first launch requires the deliberate open-anyway path. |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password for `APPLE_ID`. Never an account password, and never a value that belongs in a tracked file — which is why this document names it and does not carry it. | **Unset.** Notarization is skipped, as above. All three Apple names are read together or not at all. |
| `APPLE_TEAM_ID` | The Apple developer team the notarization submission is attributed to. Required when the account belongs to more than one team, which is the case the failure mode is worst in — an unset team on a multi-team account fails at submission, after the build has already spent its time. | **Unset.** Notarization is skipped. |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | **Inert on Electron 43 — this row is kept as a correction, not as an instruction.** It was written expecting a `postinstall` hook to read it. The published package declares `"scripts": {}` and ships an `install-electron` bin instead, so nothing in the installed tree reads this variable and `npm ci` downloads no binary whether it is set or not. Verified by grepping `node_modules` and by `npm rebuild electron --foreground-scripts`, which reported success and restored nothing. | **Unset, and setting it does nothing.** The binary is fetched by `npm run dev:desktop`, which runs `install-electron` first; that script exits immediately when `dist/` already exists. A root `postinstall` was deliberately rejected — with no working opt-out it would impose ~120 MB on the Linux `verify` leg, which has no desktop lane. |

**A seventh name the tool reads whether or not you set it.** On macOS,
`electron-builder` will look for a signing identity in the login keychain unless
`CSC_IDENTITY_AUTO_DISCOVERY` is `false`. That means a developer Mac with any
Developer ID certificate installed can produce a signed build without anyone
having set `CSC_LINK`, and a machine without one produces an unsigned build from
the same command — the same command, two results, decided by the machine. That is
the exact shape of dependency ADR-0002 exists to forbid, so the discovery is
switched off explicitly and `CSC_LINK` is the only route in.

> **CORRECTION, found while implementing Phase 9.** This paragraph used to say
> that *the packaging configuration* should set the discovery off. It cannot:
> `CSC_IDENTITY_AUTO_DISCOVERY` is read from `process.env` by
> `app-builder-lib/out/util/flags.js` and has no `electron-builder.yml` key at
> all. So `.github/workflows/desktop.yml` sets it in the `env` block of the
> packaging step, and `electron-builder.yml` cannot. The obligation is unchanged
> and the place it is discharged has moved; a **local** signed build on a Mac has
> to set it in the shell that invokes the build, which is now the honest
> instruction rather than a promise the config was going to keep.

**Seven more names `electron-builder` reads, none of which this project sets.**
They are recorded because clause 6 of ADR-0002 is about *undeclared* environment
assumptions, and a name the build tool will act on if it finds it is an
assumption whether or not this project chose it.
`APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are the App Store
Connect API alternative to `APPLE_ID`; `APPLE_KEYCHAIN` and
`APPLE_KEYCHAIN_PROFILE` are the stored-credential alternative. `notarizeIfProvided`
in `app-builder-lib` tries them in that order and skips notarization with a
warning when it finds none, which is exactly the working default the three
`APPLE_*` rows above describe. **Setting a partial set of any group is the one way
to make the build fail rather than skip** — the tool throws when it finds one
member of a group and not the others, deliberately, because a half-configured
notarization is a release that silently ships un-notarized.
`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are Windows-specific overrides for
`CSC_LINK` and `CSC_KEY_PASSWORD`, consulted first on Windows and unset here.

**None of these belong in a tracked file.** `.gitignore` already ignores `.env`
and `.env.*`, and it says in as many words that those patterns are a guard
against a secret file arriving later rather than a hint that one is expected.
That remains true: the release workflow supplies these from its own secret store,
and a local signed build supplies them in the shell that invokes the build.

---

## 3. The live signing risk — unverified, and to be checked rather than believed

Since **26 March 2026**, Azure Trusted Signing — renamed **Azure Artifact
Signing** — has been issuing certificates from two new intermediate certificate
authorities, and executables signed through them are **reportedly** being flagged
by SmartScreen as unrecognized.

**This project has not observed that and does not assert it.** It is presented
here as a risk to check because the cost of being wrong in either direction is
asymmetric: assuming it is false and shipping means every early download shows
the dialog signing was bought to remove, and assuming it is true without checking
means abandoning a signing path that may be fine.

Three responses, none of which depends on the report being accurate:

1. **Keep the signing provider swappable.** The provider is a configuration
   value in the packaging config, not a shape the build is written around, so
   moving between Azure and a traditional OV/EV certificate is an edit rather
   than a migration.
2. **Keep a traditional OV/EV path viable.** That means the packaging config
   accepts a certificate through `CSC_LINK` — which is what the table above
   already describes — rather than only through a cloud signing integration.
3. **Measure it, on the artifact, on a clean machine.** Section 4.

**A caveat that applies even in the good case, and that no provider fixes:** a
new signing identity accrues SmartScreen reputation slowly, by download volume
over time. Early releases can show the unrecognized-application dialog with a
perfectly valid certificate from a perfectly healthy authority. So the
observation in section 4 is a data point about a specific build, not a verdict on
the certificate, and it has to be repeated across the first several releases
before a trend means anything.

---

## 4. Release-checklist steps this document requires

These are manual because nothing automated can see them. They belong to the
release, not to `verify`, and not to the desktop packaging lane either — a build
that produces an artifact has not observed what a user sees when they run it.

- [ ] **Windows, clean VM, SmartScreen at defaults.** Download the signed
      installer over HTTPS in a browser on a Windows 11 virtual machine that has
      never seen a build of this application and has had no SmartScreen setting
      changed. Run it. **Record whether the unrecognized-application dialog
      appears**, and record it either way — a clean run is the evidence that
      matters later, and it only exists if it was written down when it happened.
      A download over any path that bypasses the browser's own mark-of-the-web
      handling does not count, because it does not reproduce what a user does.
- [ ] **macOS, clean machine, Gatekeeper at defaults.** Download, double-click,
      and confirm the application opens without the context-menu override. That
      is the check that notarization actually completed, as distinct from the
      build having claimed to submit it.
- [ ] **Signature present on the artifact itself**, verified with the platform's
      own tool rather than by the absence of a warning in the build log.
- [ ] **Auto-update from the previous release.** Install the previous signed
      build, let it check the feed, and confirm it updates. The updater and the
      installer must be signed by the same identity, so this step is also the one
      that catches an identity change nobody meant to make.

---

## 5. Why this file is Markdown and not a script

Every other rule in this repository that can be checked mechanically is checked
mechanically — that is ADR-0002's opening argument, and `scripts/check-portability.mjs`
is the argument made good. This one cannot be, and it is worth saying why rather
than leaving the asymmetry to be noticed.

A checker can verify that a name appearing in a build configuration also appears
in a table here, and this file used to say that was worth adding once the
packaging configuration existed. It now exists, and the check turns out to have
nothing to read: **`electron-builder.yml` names no environment variable at all.**
Every one of these is read by `electron-builder` itself, from its own source, so
a scan of tracked configuration would find zero names and report a clean result
forever — which is worse than no check, because a vacuous pass looks like
evidence. The names that *are* written down in this repository are in the `env`
block of `.github/workflows/desktop.yml`, and a checker over that file would
verify one workflow against this table and would not see a local build at all.
Recorded as a rejected check with its reason rather than left as an unkept
promise.

What no checker can verify is the column that makes the declaration compliant:
whether the default is *working*. Determining that means
running the build with the variable unset and seeing whether an artifact comes
out, on a machine with the platform SDK present, which is the packaging lane and
not a lint. And the SmartScreen observation in section 4 is a human looking at a
dialog on a machine no CI runner resembles.

So the honest shape is a declaration with a checkable half and an unautomatable
half, marked as such — the same admission ADR-0001 Amendment G had to make about
security claims and their tests, and for the same reason: a rule that pretends to
be enforced is worse than one that says which half of it is not.
