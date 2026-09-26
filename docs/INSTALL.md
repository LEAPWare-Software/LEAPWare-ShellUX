# Installing LEAPWare ShellUX

For LEAPWare operators installing the packaged Windows application. If you are
building or contributing to the project instead, see
[`docs/readme-body.md`](readme-body.md#getting-started).

**Nothing has been released yet.** `package.json` is at `0.1.0`, there is no
tag, and there is no installer to download (see [`RELEASE.md`](RELEASE.md)).
This document describes what installing, verifying and updating the build
will look like once one exists, so it is ready rather than written after the
fact. Nothing below has been observed against a real release; where a step
depends on something unbuilt, that is said plainly.

---

## 1. Getting the installer

Once a release exists it will be a Windows NSIS installer, `.exe`, attached to
a GitHub Release on this repository (`provider: github`, decision D-34) —
plan step 8 wires the publish step up. **This is not live yet.** Until then,
there is nothing to download.

## 2. Installing — per-user, no administrator needed

The installer is configured `perMachine: false` in `electron-builder.yml`, so
it installs into your own user profile and never needs an administrator
prompt — which also means an update can replace the application without one.
Run the installer, choose (or accept) the install directory when asked — this
is **not** a silent one-click installer (`oneClick: false`) — and finish. A
desktop shortcut and a Start Menu entry are created.

## 3. The unsigned-build warning (SmartScreen)

**1.0 ships unsigned** (decision D-33): Windows code signing (Azure Trusted
Signing) is a deferred purchase, not yet made. Downloading and running an
unsigned executable in a browser on Windows 11 will show Microsoft
Defender SmartScreen's "Windows protected your PC" dialog. This is expected
and is not a sign that the build is compromised — it is what any unsigned
Windows executable does.

To proceed:

1. On the SmartScreen dialog, click **More info**.
2. Click **Run anyway**.

If you do not see the "More info" link, your organization's SmartScreen
policy may block the executable outright rather than warning about it; that
is a Windows/IT-policy setting outside this application, not a property of
the installer.

This is documented candidly rather than worked around, per D-25/D-33: the
signing vendor is decided (Azure Trusted Signing) and the purchase is
deferred past 1.0. It is a **guardrail an operator can pass with 2 clicks**,
not a security control the application removes.

## 4. Where the diagnostics log lives

The packaged application writes its own crash and error log to one rotating
file, and makes no network call of any kind to report anything (GitHub #86;
no telemetry endpoint exists or is declared).

```
%APPDATA%\leapware-shellux\logs\diagnostics.log
```

This is `app.getPath('logs')` for this application, as read directly from
`electron/main/diagnosticsLog.ts` and `electron/main/index.ts`. It resolves
under `%APPDATA%\leapware-shellux` rather than under the display name
"LEAPWare ShellUX" because Electron names the per-user data directory from
`package.json`'s `name` field (`leapware-shellux`), not from
`electron-builder.yml`'s `productName`, and the packaged build ships the same
`package.json` unchanged (`files:` in `electron-builder.yml`).

The file is capped at 1 MiB and rotates to `diagnostics.log.1` and
`diagnostics.log.2`, oldest dropped — up to roughly 3 MiB on disk at any
time. Each line is one JSON entry: a timestamp, which process it came from
(`main`, `renderer-chrome` or `renderer-extension`), and the error's message
and stack, each capped at 16 KiB. If you are reporting a problem, attach the
relevant lines from this file.

## 5. How updates arrive

**The update feed is configured, but nothing has been published to it yet.**
`electron-builder.yml` now has `publish: { provider: github, owner:
LEAPWare-Software, repo: LEAPWare-ShellUX }` (plan step 8, item 2) — a
placeholder host that this organization did not own was found and
deliberately removed first (see `docs/RELEASE.md` §1) before this route was
wired up. Because no GitHub Release has ever been published on this
repository (plan step 9 is what proves that path end to end, and has not run
yet), a packaged build's real update check still fails today, the same way it
did before this route existed — the command palette shows **"Check for
updates — last check failed"** — but the failure reason has changed from "no
feed configured" to "the feed exists and has no releases on it." Once the
first release ships, this is how updates will work:

- The application checks for an update on launch and every 6 hours
  (`electron/main/updater.ts`), through **electron-updater** against **GitHub
  Releases** on this public repository (decision D-34) — no separate server
  to trust.
- An available update downloads automatically in the background.
- The command palette shows the state as it changes: checking, an update
  available, downloading, and finally **"Restart to update"**. Nothing
  interrupts you with a dialog; invoking the command is the only prompt.
- Choosing **Restart to update** closes the application and installs the
  downloaded version.
- Update integrity rests on the installer's `sha512` checksum, delivered over
  HTTPS from the same GitHub Release — a **guardrail**, not an integrity
  control: whoever controls the GitHub account controls what every client is
  offered (decision D-34, recorded there as a known and accepted risk of the
  unsigned, public-release path).

## 6. Uninstalling

Use Windows' own **Settings → Apps → Installed apps**, find **LEAPWare
ShellUX**, and choose **Uninstall**. Because the install is per-user
(§2), no administrator permission is required to remove it either. The NSIS
uninstaller removes the desktop shortcut and Start Menu entry it created; it
does not remove your per-user application data (`%APPDATA%\leapware-shellux`,
including the diagnostics log above) — delete that folder yourself if you
want a completely clean removal.

---

## See also

| Question | Read |
|---|---|
| What is actually built versus configured-but-unbuilt | [`RELEASE.md`](RELEASE.md) §0 |
| The full release checklist, and why the update feed was briefly a security defect | [`RELEASE.md`](RELEASE.md) §1 |
| Why the app ships unsigned, and the signing vendor already chosen | `docs/DECISIONS.md`, D-25 and D-33 |
| Why updates come from GitHub Releases rather than a private host | `docs/DECISIONS.md`, D-34 |
| What the shell does, for someone using it rather than installing it | [`docs/overview.md`](overview.md) |
