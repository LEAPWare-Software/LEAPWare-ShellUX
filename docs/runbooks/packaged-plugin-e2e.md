# Packaged plugin end to end — ADR-0006 step 10

**Never run.** The script and this runbook were written on 2026-09-25 in a cloud
sandbox that cannot package or launch Electron (`docs/cloud/runbook.md`, "Not doable
in the cloud"). It needs a desktop: the Windows VM, or any machine that can build and
open the packaged app. Until someone runs it and records the result below, step 10 is
**open**, and nothing here is evidence that the packaged app does anything.

The acceptance line (ADR-0006, implementation sequence, row 10): *Install → appears
→ disable → gone → a crashing plugin shows* crashed *and the shell survives.*

---

## 0. What is real today, stated first

| Thing | State |
|---|---|
| `e2e-packaged/plugin-lifecycle.spec.ts` | **Written, type-checked, listed; never run.** `tsc` checks it inside `npm run verify`, and `playwright test --list` loads it, but no case has ever launched an app |
| `npm run test:packaged` (`scripts/packaged-e2e.mjs`) | **Its refusals are tested, and so is a `--list` pass.** *Tests:* `scripts/__tests__/packaged-e2e.test.mjs` — "refuses to start without a path to the packaged executable, and prints the usage", "the config refuses to load when started without the wrapper, and names the command to run", "through the wrapper, --list loads the spec and names every checkpoint, launching nothing" |
| Its two early failures | **Observed in the sandbox, Linux, 2026-09-25.** With `dist-plugins/` moved aside, case 1 failed with "could not read …/dist-plugins/hello-example.lwplugin (ENOENT …). Run `npm run plugins:build` in this checkout first.", the rest skipped or did not run, and no `user-data/` directory was created — the app was never launched. With `package.json` handed over as the "executable", `_electron.launch` failed with `spawn …/package.json EACCES`, and Playwright's call log showed the launch line `--no-sandbox --inspect=0 --remote-debugging-port=0 --user-data-dir=…/test-results-packaged/user-data`. Neither is a run against an app |
| Checkpoint 1, install | **Written.** Through main's real installer, called from host chrome's bridge. The native picker is stubbed (section 3) |
| Checkpoint 2, appears | **Half written.** The store's listing and the `/plugins/` route. There is no plugin manager to appear in (step 9): `test.fixme` |
| Checkpoint 3, disable and gone | **Half written.** The same two places. The UI half is `test.fixme` (steps 6 and 9) |
| Checkpoint 4, crashed | **Cannot be written yet.** No surface loader runs plugin code, nothing records `crashed`, nothing shows it (steps 6 and 9): `test.fixme` |
| Checkpoint 5, the shell survives | **Written, narrowed.** Host chrome outlives a *killed extension renderer*, with no plugin in it. Not "a crashing plugin" — step 6 is what puts a plugin there |

So a green run today proves checkpoints 1 and 5's narrowed form, and the store-and-route
half of 2 and 3. It does **not** close step 10. Step 10 closes when all seven cases run
green with no `fixme` left, which needs steps 6 and 9 first.

---

## 1. What you need

- A machine that can open a window. Windows is the one platform the packaged app has
  been built and launched on (`docs/RELEASE.md` §0). macOS is configured and never
  built; Linux has no target in `electron-builder.yml`.
- This repository at the commit under test, `npm ci` done with npm 11.16.0.
- **The app and the plugin from the same checkout.** The spec validates the `.lwplugin`
  against this checkout's contract version before it launches anything.

## 2. Run it

```bash
npm run verify:desktop        # build, build:desktop, package:desktop
npm run plugins:build         # writes dist-plugins/hello-example.lwplugin
npm run test:packaged -- "release/win-unpacked/LEAPWare ShellUX.exe"
```

The path is the one required argument, and it has no default. It is the unpacked
executable, not the installer. On Windows `scripts/csp-smoke.mjs` documents the path
above. On macOS it is the binary inside the bundle —
`release/mac-<arch>/LEAPWare ShellUX.app/Contents/MacOS/LEAPWare ShellUX` is
electron-builder's layout, not something anyone has observed for this project. Anything
after the path goes to `playwright test` unchanged (`--list`, `-g <title>`).

`playwright test -c playwright.packaged.config.ts` on its own refuses to start and names
the command above. That is deliberate: see section 5.

## 3. What it does, and the two things it does not do for real

One app, one worker, cases in order (`serial`). Each case starts from the state the
previous one left.

1. Launches the executable through Playwright's `_electron.launch()`, with
   `--user-data-dir` pointing at `test-results-packaged/user-data/`, and asks the
   running app for `app.getPath('userData')`. **If the answer is not that directory,
   it stops before installing anything.** Whether Electron honours the switch is not
   verified; this check is what stops a wrong answer reaching your real profile. The
   launch itself happens before the question can be asked.
2. **Install.** Replaces `dialog.showOpenDialog` in main with one that answers the
   built package's path, then calls `shelluxHost.plugins.install()` from host chrome.
   Expects the listing `{ status: "enabled" }` with the manifest's id, version, title,
   icon and contract version.
3. **Appears.** `plugins.list()` names it enabled. A `fetch` from the extension surface
   of `/plugins/hello-example/1.0.0/bundle.js` answers 200, and the bytes hash to the
   manifest's `sha512`. A fetch, not an import: no plugin code is evaluated.
4. **Disable, gone.** `plugins.disable()` answers `disabled`, the listing agrees, and
   the same fetch answers 404.
5. **Survives.** Calls Electron's `webContents.forcefullyCrashRenderer()` on the
   extension surface from main, waits for Playwright's `crash` event, waits for main's
   `render-process-gone` branch (`electron/main/paneViews.ts`) to bring it back in a
   new renderer process, then opens the palette in host chrome with Ctrl+K, and lists
   plugins again.

**The two substitutions.** The native file picker, because Playwright cannot drive an
operating-system dialog: everything after it returns a path is the shipped code, and
the picker is not exercised. And the crash, which is Electron's API rather than a
plugin, because no plugin code runs in the packaged app yet. Nothing is added to the
application for either.

**What a pass cannot see.** The plugin manager, and anything a plugin draws: neither
exists yet. The GitHub Release install door (step 11): no release carries a
`.lwplugin`. The updater contacts its feed on launch and fails to resolve it
(`docs/RELEASE.md` §0); that is expected and not asserted.

**What Playwright adds to the launch.** `--inspect=0` and
`--remote-debugging-port=0` on every platform, and on Linux only, `--no-sandbox`
(read in `playwright-core`'s Electron launcher, and seen in the call log in section 0).
So on Windows and macOS the app runs with the switches a user's launch has plus those
two. `_electron.launch()` reaches main through that inspector: `electron-builder.yml`
sets no Electron fuses today, and turning `EnableNodeCliInspectArguments` off would
break this lane before its first case.

## 4. What pass and fail look like

**Pass, today — expected, never seen:** exit code 0, and the list reporter ends with
`4 passed` and `3 skipped` — the three `fixme` cases. A `skipped` count other than 3 means the spec
changed; read it before trusting the run.

**Fail:** exit code 1. The failing case prints its expected and received values, and
the cases after it are skipped (serial). `test-results-packaged/trace.zip` holds a
trace (`npx playwright show-trace test-results-packaged/trace.zip`), and
`test-results-packaged/user-data/plugins/state.json` holds what main recorded. Both
are kept until the next run starts.

**Refused before running:** exit code 2 and a usage line, for a missing or wrong
path. A missing `dist-plugins/hello-example.lwplugin` fails the first case, naming
`npm run plugins:build`, before the app launches.

## 5. Why it is built this way

| Choice | Rejected alternative, and why |
|---|---|
| A sibling config, `playwright.packaged.config.ts` | A project inside `playwright.config.ts`: that file starts two web servers and says of itself that it cannot see the packaged app, which would stop being true |
| The executable path as an argument, through `scripts/packaged-e2e.mjs` | A variable the operator sets: ADR-0002 wants environment inputs declared **and defaulted**, this one has no honest default, ADR-0006 decision 10 takes its directory "from argv, never an environment variable", and an inline assignment is written differently in every shell. Playwright Test takes no arguments of its own, so the wrapper sets one variable on the child it spawns; the config reads it and throws without it |
| `@playwright/test`'s `_electron` | Importing `playwright` directly: it is only a transitive dependency. `@playwright/test` re-exports the same object and is declared |
| A new spec, not `scripts/csp-smoke.mjs` extended | The smoke speaks raw DevTools protocol and has no assertion library; its own banner records it cannot currently retake its measurement since step 7 |
| `test.fixme` for what is not built | Asserting a stand-in — the listing in place of the manager, a renderer kill in place of a plugin crash — under the acceptance line's words would report step 10 green while it is not |

## 6. Record the outcome

Either way, on the `needs-owner` issue this was opened with: the commit, the machine
and OS, the exact command, and the reporter's output pasted whole. A pass moves no plan
box and closes nothing on its own; it is evidence for checkpoints 1 and 5's narrowed
form and half of 2 and 3, and it becomes step 10's evidence only when the `fixme`
cases are gone.
