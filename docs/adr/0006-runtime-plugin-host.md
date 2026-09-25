# ADR 0006 — The Runtime Plugin Host

- **Status:** **Accepted** (2026-09-18), on the owner's rulings D-46 (ADR-0001
  Amendment P accepted), D-47 (no plugin signing in 1.0) and D-48 (a fifth
  plugin-manager state). **Nothing here is built.** Accepted means the design is
  decided; every claim about behaviour waits for the test named beside it.
- **Date:** 2026-09-18
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Implements:** D-36 (plugins install, enable and disable at runtime in 1.0), plan
  step 6b in `docs/plans/v1-production.md`. **Holds to** D-23 (first-party plugins
  only), D-33 (1.0 ships unsigned), D-34 (updates from GitHub Releases), D-40 (a
  block `title` and a plugin `icon`).
- **Decides:** #68 (and through it the order of #28 and #32), #91. **Designs** #16,
  #17, #57, #80. Every one of those stays open until the step that builds it lands.
- **Related:** ADR-0001 Amendments E, F, G, K and O; ADR-0004; ADR-0005 (`Proposed`;
  two processes shipped, D-24).

> **Evidence base.** One throwaway spike, `spike/plugin-host/`, run on Electron
> 43.2.0 / Chromium 150.0.7871.129, win32, 2026-09-18. Raw output in
> `spike/plugin-host/results.json`, table in its `README.md`. Everything else here
> is a reading of the tree at `e00ea93`. Where a sentence rests on neither, it says
> so.

---

## Before anything else: this ADR builds a thing Amendment E's trigger names

ADR-0001 Amendment E, *THE TRIGGER*:

> **This decision is VOID the day code the deployer did not read and compile from
> source they chose can reach the page.** Concretely, any one of these fires it: an
> extension registry or a plug-in marketplace; **a runtime remote loader of any
> kind**; a hosted, multi-tenant deployment.

A runtime plugin host is a runtime loader. Installing from a GitHub Release URL is a
*remote* one. Read literally, step 6b fires the trigger, and the trigger's
consequence is that real per-extension separation becomes mandatory, with its own
threat model, before any code — the Option B that Amendment E priced at the view
contract and the keyboard model.

**This ADR does not quietly decide that the trigger has not fired.** It argues that
the trigger's *condition* — the bolded sentence — is not met while D-23 holds. The
owner accepted that argument as ADR-0001 **Amendment P** (D-46), which lands in the
same change as this ADR. The argument:

1. **The code comes from the same party as the host.** Every plugin 1.0 can load is
   built by LEAPWare, in LEAPWare's CI, from LEAPWare's source. That is the same
   party, the same source control and the same release channel as the host binary.
2. **The updater already runs remote code from that channel with a weaker check.**
   D-34 makes GitHub Releases the update feed, and records that update integrity
   "rests on the `sha512` in `latest.yml` … a **guardrail**, not an integrity
   control: whoever controls the GitHub account controls what every client
   installs". A plugin from the same organisation's releases adds **no new trusted
   party**. It adds a second door for the same one.
3. **A local install grants nothing a local user lacks.** Installing a `.lwplugin`
   file is an act by someone already running code as that Windows user. The install
   is per-user (`electron-builder.yml`: `perMachine: false`), so by default the host's
   own `app.asar` sits in a directory that same user can write.

**What the argument does not cover, stated so it is not read wider.** Nothing
*mechanically* makes a package first-party. 1.0 is unsigned (D-33), so an operator
can install a `.lwplugin` anyone built. The argument holds only as long as the
people who install plugins are LEAPWare operators installing LEAPWare packages —
which is D-23 as a fact about the deployment, not a property of the code. The
amendment names the conditions that re-fire the trigger: a publisher outside the
LEAPWare GitHub organisation, a catalogue or marketplace, D-23 reversing, or a hosted
deployment. When any of them happens, the next document is the Option B threat model
Amendment E requires, before the change ships.

---

## Context

### What exists

- **Plugins are compiled in.** `src/paneview/PaneViewShell.tsx` registers
  `MailPlugin` and `DatabasePlugin` from `src/mocks/` in the **production** extension
  surface, `paneview.html`, because an empty surface would prove nothing about the
  process split. `src/examples/HelloExtension.tsx` is registered only by its own test.
- **Two renderers, one window** (ADR-0001 Amendment O). Host chrome is one
  `WebContentsView`; the extension surface — panes 2 and 3, one document — is the
  other. Both carry `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` (`electron/main/paneViews.ts`), and **both are served
  over one scheme and one origin**, `shellux://renderer`
  (`electron/main/index.ts`, decision 3).
- **The blueprint already splits at the process edge.** `src/core/ipc/manifest.ts`
  builds an `ExtensionManifest` — ids, labels, the nav tree, command metadata, `when`
  — from a blueprint, field by field, and leaves views and closures behind. Host
  chrome can draw a plugin's nav and commands without running its code.
- **There is no Content-Security-Policy.** Measured by grep over `*.html`, `*.ts`,
  `*.tsx`, `*.cts`, `*.yml` and `*.md` outside `node_modules` and `dist`, for
  `Content-Security-Policy`, `csp` and `onHeadersReceived`: zero hits. Spike case E
  shows Electron printing its "Insecure Content-Security-Policy" warning against
  exactly this state.
  > **2026-09-18, step 1 landed — this bullet is a measurement of the tree before
  > it.** Every response from the scheme now carries a policy, built in
  > `electron/main/rendererCsp.ts`. *Tests:* `electron/__tests__/rendererCsp.test.ts`
  > — "every HTML response the scheme serves carries the policy". What the policy
  > is, and the measurements behind its `style-src`, are in decision 5's note.
- **`main` cannot import `src/`.** Amendment O decision 6: `electron/tsconfig.json`
  is `NodeNext`, `src/` imports are extensionless, and every relative import fails
  `TS2835`. Anything main and the renderer must agree on has to live where both can
  reach it, or be written once on main's side.
- **`electron/**` is tested but not coverage-gated** (Amendment O decision 6).

### What a separately built plugin needs that a compiled-in one got free

A compiled-in plugin shares the host's React, `useChannelPayload`, `TOKEN_CLASS`,
`RowMetric` and `LEDGER_CONTEXT_KEY` because the bundler de-duplicated them. A plugin
built on its own gets **its own copy of each**, and a second React breaks every hook
it calls. Those five are the whole of what the two mocks import from outside
themselves at runtime; their `../core/types` imports are `import type` and erase, and
`HelloExtension` imports types only (measured by grepping their `import` lines). The
shared set is therefore not a design preference; it is the minimum the migration
needs.

---

## Decision

### 1. The package: one `.lwplugin` file, holding a manifest and ONE bundle

A `.lwplugin` is a single UTF-8 JSON document, at most 8 MiB:

```json
{
  "format": "lwplugin/1",
  "manifest": {
    "id": "mail",
    "version": "1.0.0",
    "hostApiVersion": "1.0.0",
    "title": "Mail",
    "icon": "mail",
    "entry": "bundle.js",
    "sha512": "<base64 SHA-512 of the entry's bytes>"
  },
  "bundle": "<base64 of the entry's bytes>"
}
```

| Field | Rule | Why |
|---|---|---|
| `id` | `EXTENSION_ID_PATTERN`, not in `RESERVED_IDS`; **must equal the bundle's blueprint `id`** at register, or the plugin is refused | The plugin manager and the registry must name the same thing. A mismatch is a packaging error and is loud |
| `version` | Strict semver `MAJOR.MINOR.PATCH`, no range, no prerelease in 1.0 | It keys the install directory and the served URL, so it can no longer be the opaque string #28 describes |
| `hostApiVersion` | Strict semver; the SDK version the bundle was **built against**, written by the build, never by hand | Decision 3 |
| `title` | Bounded display text, as the registry bounds `name`. The **block title** of D-40 | What the plugin manager, the rail and the palette group heading show. DESIGN.md: "show the plugin's manifest title … and show nothing where the manifest gives nothing human" |
| `icon` | Optional. A **key** into `SHELL_ICONS` (`src/components/ui/shellIcons.tsx`), never markup, a URL or a data URI | Below |
| `entry` | Fixed to `bundle.js` in `lwplugin/1` | One file; see "one bundle" below |
| `sha512` | Base64 SHA-512 of the entry's bytes | Decision 4 |

**The icon is a key because of where it is drawn.** Title and icon render in **host
chrome**, which runs no plugin code. A plugin-supplied SVG, URL or data URI would put
plugin-authored markup into the one renderer that has none. A key into a `Map` the
host owns means the chrome draws only glyphs the host shipped; an unknown key draws
the host fallback and no key keeps the monogram, the three outcomes Amendment K
decision 7 keeps apart. *Tests:*
`src/components/__tests__/ShellLayoutIcons.test.tsx` — "falls back to the host glyph
for an icon key the host does not publish", "does not resolve a prototype-shaped node
icon key to anything inherited", "keeps the monogram for a node that declares no
icon". Those pin the node-icon path; the manifest-icon path reuses the same lookup and
its own case is written in step 3.

**One bundle, not a file tree.** The plugin build emits a single ES module
(`output.codeSplitting: false` — rolldown's replacement for Rollup's
`inlineDynamicImports`:
`node_modules/rolldown/dist/shared/define-config-DjHYbH6S.d.mts:772` marks
`inlineDynamicImports` `@deprecated Please use codeSplitting: false instead`;
`scripts/build-plugins.mjs` step 7 is where this is actually built). One file
means one hash, one served path and no archive paths to validate. The cost,
accepted: no code-splitting inside a plugin, so a plugin cannot lazy-load its
own panes. #29's lazy loading stays undelivered and is named as a 1.0 limit.

**No `capabilities` field.** Every plugin runs in one document (decision 6). A
permission one plugin declares cannot be enforced against a sibling in the same
realm, so a capability list would be a declaration the host cannot hold anyone to —
a guardrail presented as a control, which Amendment E exists to stop. Anything
restricted is restricted for the whole surface, by the CSP (decision 5), and is a
deployment-wide decision.

**Rejected:**

| Alternative | Why not |
|---|---|
| A `.zip` / `.tar` package | Needs a production dependency to parse (Node has no unzip), and brings the archive-path-traversal class with it. A JSON container has one field that is code |
| A per-file `sha512` map, allowing chunks | Buys lazy panes for a first-party set of three plugins, at the cost of a path map to validate and N hashes to check at every serve. Revisit with #29 |
| A declarative contribution block in the manifest (nav tree, commands) | #29's full declaration/implementation split. `ExtensionManifest` already gives host chrome the declarative half **after** registration, and a disabled plugin needs only title, icon and version to be listed. Duplicating the tree into the manifest makes two sources of truth for it |
| `icon` as SVG or URL | Plugin markup in host chrome, above |

### 2. Where plugins live, and where they come from

```
<app.getPath('userData')>/plugins/
  state.json                         main-owned: id → { version, enabled, sha512, crash record }
  <id>/<version>/plugin.json         the manifest, as installed
  <id>/<version>/bundle.js           the entry, as installed
```

Per user, under `userData`, as the plan fixes. `state.json` is written only by main.

**Install sources, in 1.0:**

1. **A local `.lwplugin` file,** chosen through `dialog.showOpenDialog` **opened by
   main**. The renderer asks main to open the picker; it never supplies a path, so no
   renderer-controlled string reaches `fs`.
2. **A GitHub Release asset URL,** restricted to
   `https://github.com/LEAPWare-Software/<repo>/releases/download/<tag>/<name>.lwplugin`,
   fetched by main. The organisation allowlist is how D-23 appears at this door. It
   is **entry-point validation**: real at this door, and it says nothing about who
   controls the organisation — D-34's reasoning, unchanged. It is the last step of
   the sequence. The owner ruled against signing for 1.0 (D-47), so this door ships
   with the allowlist and the manifest `sha512` only.

Install writes to a temporary directory, validates everything in decision 4, then
renames into `<id>/<version>/` — so a half-written plugin is never listed. An
already-installed `<id>` at a different version is an **update**: the new version is
installed beside the old, `state.json` switches, the extension surface reloads
(decision 7), and the old directory is deleted after the reload succeeds.

**Rejected:** a machine-wide directory (needs elevation, and D-33's per-user install
has none); bundling plugins into `app.asar` (that is compile-time loading with extra
steps, and the thing D-36 removes); an in-renderer drag-and-drop install (it hands
main a renderer-supplied path).

> **2026-09-19, step 4 landed — the store as built.** `electron/main/plugins/pluginStore.ts`,
> rooted at `<userData>/plugins/` by `electron/main/index.ts`. `state.json` is
> `{ "format": "shellux-plugin-state/1", "plugins": { <id>: { version, enabled,
> sha512, fault } } }`, where `fault` is `null` or `{ state: "files-changed" |
> "crashed", reason, at }` — D-48 keeps "files changed" apart from a crash, so
> the "crash record" above is a fault record with its state named. It is read
> with `JSON.parse` and validated. One that reads but fails is renamed to
> `state.json.corrupt-<time>`, reported to the diagnostics log, and the store
> starts empty — its plugins unlisted until reinstalled, their directories left
> on disk. A reinstall then records a plugin afresh: one the user had disabled
> comes back enabled, and its fault record is lost. One that cannot be read at
> all refuses the operation. Every write is
> flushed before the rename that publishes it. `plugin.json` is `serializeManifest` of the
> validated manifest, never the package's bytes — the step-3 invariant.
> Transient `.staging-*` and `.retired-*` directories start with `.`, which no
> id can. An incompatible package **is installed**, listed as incompatible with
> its reason, and never served or enabled. A same-version install is the
> Reinstall of decision 11 and clears the fault. **One departure:** an update
> deletes the old directory as soon as `state.json` has switched, not after a
> reload — nothing reloads before step 6, which moves it. The picker is
> `dialog.showOpenDialog`, opened by main behind `shellux:plugins:install`,
> which takes no argument. *Tests:* `electron/__tests__/pluginScheme.test.ts` —
> "lays out userData/plugins as ADR-0006 decision 2 fixes, and records the
> plugin in state.json", "writes plugin.json from the validated manifest
> re-serialised, never the package's raw bytes", "installs an update beside the
> old version, switches state.json, then deletes the old directory", "a
> reinstall of the same version clears the files-changed state";
> `electron/__tests__/pluginIpc.test.ts` — "installs from the path main's
> picker returns, and takes no path from the renderer";
> `electron/__tests__/pluginScheme.test.ts` — "sets aside a state.json that is
> not UTF-8 JSON, reports it, and starts empty", "flushes state.json to disk
> before renaming it into place". **Not built:** the GitHub URL source (step
> 11), and any sweep of a `.staging-*` or `.retired-*` directory left by a
> crash mid-install, or of a directory a set-aside `state.json` orphaned.

### 3. The versioned contract: one number, checked before the bundle is ever served — #68 decided

**#68's question is answered with both halves, bound to one version so there are not
two sources of truth.**

- **#32's half, as a runtime module rather than an npm package.** The host exposes
  **one** SDK barrel, `src/sdk/index.ts`, served as `/shared/sdk.js`, beside
  `/shared/react.js` and `/shared/react-jsx-runtime.js`. It is the only host module a
  plugin may import. Its version **is** `hostApiVersion`. No npm publication and no
  `@alpha`/`@beta` tiers in 1.0: D-23 says there is no third party to publish to, and
  a tier system for three first-party plugins is ceremony.
- **#28's half, at install and at every boot.** Main compares the manifest's
  `hostApiVersion` against the host's before the bundle is ever served. A plugin
  whose check fails never reaches the extension surface — OSGi's "never leaves
  `INSTALLED`", which #28 asks for.

The rule, in #28's OSGi register, because a plugin is both a **consumer** of
`IShellAPI` and a **provider** of `LEAPExtensionBlueprint`:

| Host `hostApiVersion` vs plugin's | State |
|---|---|
| Major differs | **incompatible** — "built for host contract 2, this shell offers 1" |
| Same major, plugin minor **>** host minor | **incompatible** — "needs contract 1.4, this shell offers 1.2" |
| Same major, plugin minor **≤** host minor | loads |

Major moves when a plugin must change to keep working: a required blueprint member, a
narrowed allowlist (Amendment I's `escape`), a removed `IShellAPI` member. Minor moves
on anything additive, including every **optional** blueprint member — which is why
decision 8's lifecycle hooks are optional.

**What enforces the bump** — the objection #68 says is unanswered. A committed
baseline, `src/sdk/api-surface.json`, records the SDK's version and a machine-derived
description of the contract: the SDK's exported names, the blueprint's required and
optional keys, `HOTKEY_KEYS`, `EXTENSION_ID_PATTERN`'s source, `RESERVED_IDS` and
`REGISTRY_LIMITS`. A test recomputes it and fails when it differs and the version did
not move by at least what the difference requires: anything removed or narrowed, or a
new required key, needs a major; anything added needs a minor. That is the
`bnd baseline` mechanism #28 cites, reduced to one file. It is written in step 2.
**Its limit, stated now:** it sees names, keys and allowlists. A behavioural narrowing
with no shape — a validator that starts refusing a value it used to accept — is
invisible to it, and still depends on review.

> **2026-09-19, step 2 landed — what the baseline records, as built.**
> `HOST_API_VERSION` is `'1.0'`, exported by `src/sdk/index.ts`. The rule is
> `src/sdk/apiSurface.ts`; `src/sdk/api-surface.json` is its baseline. Three parts
> beyond this decision's list are recorded. `IShellAPI`'s members, split required
> and optional — the host provides that interface, so a required member made
> optional is a major and the reverse a minor, the blueprint's rule reversed.
> `HOTKEY_MODIFIER_REQUIRED_KEYS`, a denylist, so an entry added is a narrowing.
> And the shared modules: the names `/shared/react.js` and
> `/shared/react-jsx-runtime.js` export, read from their module namespaces, under
> the same add/remove rule, plus React's major — a React major change is a host
> major. The version moves one step only: `M.m` to `M+1.0` or `M.m+1`; `1.3 → 2.3`
> and `1.0 → 7.0` are refused. `REGISTRY_LIMITS` compares by
> value: a bound added or lowered is a major, removed or raised a minor.
> `EXTENSION_ID_PATTERN` changing at all is a major, since two patterns cannot be
> compared for "accepts less" by their text. The limit is wider than stated
> above: the description is **top-level only** — a new required key on `Command`
> or `NavigationNode`, or a changed parameter type on an `IShellAPI` member, is
> invisible — and it records `commands` and `ribbonActions` as two optional keys,
> not as "exactly one of". Keys come from the checker's `getPropertiesOfType`,
> which for a union reports only the keys **every** member carries: a key only
> one branch declares would be absent from the description, and adding or
> removing it would move nothing. Neither type has such a key today. It is a **guardrail**: a baseline edited by hand to
> match defeats it, and review of that file's diff is what catches that.
> *Tests:* `src/sdk/__tests__/apiSurface.test.ts` — "fails when the contract
> changes and the version does not move", "records the contract as it stands,
> version included". Main cannot import `src/` (Amendment O decision 6), so how
> step 3's check in main reads `HOST_API_VERSION` is step 3's to decide.
>
> **2026-09-19, step 3 landed — how main reads `HOST_API_VERSION`, and the rule as
> built.** Main carries its own copy: `electron/main/plugins/hostContract.ts`
> writes out `HOST_API_VERSION`, `EXTENSION_ID_PATTERN`, `RESERVED_IDS` and
> `MAX_TEXT_LENGTH`, and a test holds all four to `src/sdk/api-surface.json` and
> the version to the SDK's own export. Two routes were rejected. Importing the
> baseline JSON into main puts a file outside `electron/tsconfig.json`'s
> `rootDir` into its program and its emit, and `src/` is not shipped beside
> `dist-electron/`, so the packaged app would have nothing to read at run time.
> A build-time generated constant still has to be committed, because
> `typecheck` runs on a fresh clone before any build; that is this mirror plus a
> generator to keep in step, and the drift test is what makes either honest. The
> mirror is a **guardrail**: edits to both sides together pass it. The manifest's
> `hostApiVersion` is `major.minor`, the form `HOST_API_VERSION` has had since
> step 2, not decision 1's `1.0.0`; a three-part value is refused, so the build
> writes the SDK's constant as it is. A major that differs is incompatible in
> **both** directions. The rule decides a state, not an install; what the store
> does with an incompatible package is step 4's. *Tests:*
> `electron/__tests__/pluginPackage.test.ts` — "marks a plugin incompatible when
> its major differs", "marks a plugin incompatible when it needs a newer minor
> than the host offers", "mirrors the SDK baseline's version, id pattern,
> reserved ids and text bound".

**Rejected:**

| Alternative | Why not |
|---|---|
| #28 alone: a requirement range on the blueprint, checked at `register` | Checked in the renderer, after the plugin's module has already been evaluated. Main can refuse before a byte is served, and should |
| #32 alone: npm semver, no runtime check | Nothing is published to npm (D-23), and an operator installs a *file*, not a dependency tree. There is no resolver to do the static check |
| #68's proposed sequencing ("#32 now, #28 when two versions exist") | Its premise — one host version in the field — ends with the first auto-update after a plugin is installed. D-34 ships the updater in 1.0, so both halves are needed at 1.0 |
| A version range in the manifest | Ranges are what OSGi needs for a resolver choosing between many providers. There is one host; the plugin states what it was built against, and the rule above derives the range |

### 4. The `sha512` check is ENTRY-POINT VALIDATION, and nothing more

Main checks the entry's bytes against the manifest's `sha512` **at install** (the
package is refused) and **again at every serve** of the entry from `userData`, against
the hash recorded in `state.json` at install (the plugin is marked crashed with "the
installed files no longer match what was installed", and is not served).

What it catches: a truncated or corrupted download, a manifest from one build packed
with a bundle from another, a file changed on disk after install by anything that
did not also rewrite `state.json`.

**What it is not, in Amendment E's vocabulary.** It is not an integrity control. The
manifest and the bundle arrive together, so whoever can alter one can recompute the
other; and `state.json` sits in the same user-writable directory as the files it
describes. **Against a hostile local user, or anyone who can build a `.lwplugin`, it
enforces nothing.** It is real at the two doors it guards — install and serve — and
says nothing about the files between them.

The tests that must pin it, written in steps 3 and 4 and named here so the claim
above has an owner: in `electron/__tests__/pluginPackage.test.ts`, "refuses a package
whose bundle does not match its manifest sha512" and "accepts a package whose bundle
and manifest were altered together, because the hash travels with the bundle" — the
second is an honest-pinning test in `reflection.test.tsx`'s register, asserting the
limit as expected behaviour. In `electron/__tests__/pluginScheme.test.ts`, "refuses to
serve an entry changed on disk after install". **Until those exist, this section is a
design statement and no document may cite the check as a property of the shell.**

> **2026-09-19, step 3 — the install half is pinned; the serve half is not.**
> `electron/main/plugins/pluginPackage.ts` refuses a package whose bundle does
> not hash to its manifest `sha512`, and accepts one whose bundle and hash were
> replaced together. *Tests:* `electron/__tests__/pluginPackage.test.ts` —
> "refuses a package whose bundle does not match its manifest sha512", "accepts
> a package whose bundle and manifest were altered together, because the hash
> travels with the bundle". Nothing installs yet, so neither is a property of
> the shell until step 4 calls the validator at install; the serve-time rehash
> and its test are step 4's. The manifest-icon case decision 1 defers to this
> step: `src/components/ui/resolveShellIcon.ts` is now the one lookup the rail,
> the palette and a manifest icon share. *Tests:*
> `electron/__tests__/pluginPackage.test.ts` — "resolves a manifest icon key the
> host does not publish to the host fallback glyph, and keeps no icon when the
> manifest gives none". Host chrome does not draw a manifest icon until step 9.
>
> **2026-09-19, step 4 — the serve half is pinned.** The store calls the
> validator at install, and `PluginStore.entryFor` rehashes the entry at every
> serve against the `sha512` in `state.json`, serving the same bytes it hashed.
> A mismatch, a missing entry, or a `plugin.json` that no longer validates or
> names another id, version or hash refuses the serve (a 404) and records
> D-48's `files-changed` state with decision 11's words; restoring the bytes
> does not clear it, a reinstall does. It is **entry-point validation**, and
> the limit is asserted, not only stated: rewrite the bundle, `plugin.json` and
> `state.json` together and it serves. *Tests:*
> `electron/__tests__/pluginScheme.test.ts` — "refuses to serve an entry changed
> on disk after install", "serves a bundle whose file and state.json record were
> rewritten together, because state.json is as writable as the bundle". Both
> doors now exist in code; no plugin reaches a renderer before step 6.
> **A stated limit:** every serve reads and hashes the entry on main's thread,
> with no cache and no rate limit, so the extension surface can make main do
> that work — up to 8 MiB a request — as often as it asks. A cache keyed on
> mtime and size was rejected: it would pass a same-size edit that kept its
> mtime, and the read it cannot save is most of the cost.

**Rejected for 1.0 (owner, D-47):** signing packages (Ed25519 via `node:crypto`, key
in CI). It is the one mechanism here that would make D-23 checkable at the URL door,
and it is cheap in code; what it costs is key custody, which was the owner's decision.
It is the recorded alternative for after 1.0. Import-map `integrity` or SRI in the renderer — it
verifies in the process where plugin code runs, which can be subverted by the code it
verifies.

### 5. Loading: the existing scheme, a reserved path, a CSP, and a build-time rewrite

**Served from the same scheme and origin, under `/plugins/`.** The handler in
`electron/main/index.ts` gains one route. `shellux://renderer/plugins/<id>/<version>/bundle.js`
is looked up in `state.json` — **constructed, not filtered**, the posture
`src/core/ipc/manifest.ts` takes: the route serves the entry of an installed, enabled,
compatible plugin by lookup, and every other path under `/plugins/` is a 404 without
ever being joined to a directory. Everything else the handler serves is unchanged.

> **2026-09-19, step 4 — the route as built.** `electron/main/plugins/pluginRoute.ts`,
> reached through `createRendererHandler`'s `servePlugin` option, so its
> responses carry the policy like every other. A request whose decoded,
> lower-cased path is `/plugins` or under `/plugins/` goes to the route and
> never to the file fetcher (`/PLUGINS/` and `/plug%69ns/` included). The route
> matches the raw pathname against `/plugins/<id>/<version>/bundle.js`, holds
> both parts to the id and version patterns, and asks the store. *Tests:*
> `electron/__tests__/pluginScheme.test.ts` — "serves only the entry of an
> installed, enabled, compatible plugin", "answers 404 for every other path
> under /plugins/, and never reads dist for one". Not measured: Chromium
> importing a module from this route in the packaged app — no loader exists yet.

**Why not a second scheme — measured, not preferred.** Spike case B: a second
privileged scheme without `corsEnabled` is refused by CORS outright. Case C: with
`corsEnabled`, an `Access-Control-Allow-Origin` header and a CSP source for it, it
loads. Case A: the same bundle under `/plugins/` on the existing origin loads with
`script-src 'self'` and nothing else. The second scheme costs three moving parts and
buys nothing, because a module's code runs in the realm of the document that imported
it, whatever URL it came from. A separate origin for the *bytes* is not a separate
anything for the *code*.

**A CSP, where today there is none.** Every HTML response from the scheme carries:

```
default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; connect-src 'self'
```

plus whatever `style-src` the running application is **measured** to need in step 1 —
not asserted here; Radix and ECharts set styles through the CSSOM, which `style-src`
does not govern, but that is a reading and step 1 replaces it with a measurement. Case
D is the spike's evidence that the policy is enforced against a script source it does
not list. `connect-src 'self'` means **no plugin reaches the network in 1.0**; opening
an origin is a deployment-wide CSP change, which is the honest shape of a permission in
one document. The dev server (`npm run dev`, `dev.html`) sets no CSP and is not
covered; stated, not fixed.

> **2026-09-18, step 1 — the measured `style-src`.** The policy shipped is the six
> directives above plus `style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'`.
> `'unsafe-inline'` is **measured necessary, for styles only**, and the reading above
> ("Radix and ECharts set styles through the CSSOM") was half wrong:
>
> - With `style-src 'self'`, the packaged app raised one `style-src-elem` violation
>   when the palette opened. Attributed by reading the bundle, not by the report
>   (which carries no sample): Radix Dialog's scroll lock inserts a `<style>` element
>   whose text carries a measured scrollbar width, so no hash can name it.
> - An ECharts axis tooltip writes HTML with `style="…"` attributes. The packaged
>   extension surface registers the Mail and Database fixtures
>   (`src/paneview/PaneViewShell.tsx`) though nothing in the packaged app activates
>   them; the smoke activates both, hovers the Database chart until its tooltip
>   shows, and drags a divider. Under `style-src 'self'` that raised 21
>   `style-src-attr` and 1 `style-src-elem` violation on the extension surface. In
>   a standalone probe against ECharts' own build: 13 `style-src-attr` for one tooltip, 13
>   with only `style-src-elem` relaxed, 0 with `style-src 'self' 'unsafe-inline'`.
> - With the shipped policy, the same driven run recorded **0 violations on each
>   surface**, and both positive controls — an inline `<script>`, a `data:` image —
>   were refused on both, each raising exactly one entry in each of the smoke's three
>   counters.
>
> Runs: `scripts/csp-smoke.mjs` and `scripts/csp-echarts-probe.mjs`; output committed
> in `docs/measurements/csp-2026-09-18.json`. Neither is in `npm run verify`: the
> smoke needs a packaged app. Not measured: row selection, commands, the drawer, a
> theme switch, or macOS or Linux.

**Shared modules by build-time rewrite, not an import map.** The plugin build marks
`react`, `react/jsx-runtime` and `@shellux/sdk` external and rewrites them to
`/shared/react.js`, `/shared/react-jsx-runtime.js` and `/shared/sdk.js`. Spike case G:
a bundle rewritten this way loads under plain `script-src 'self'` and receives the
same module instance the host exports. Case F: an inline import map is blocked by that
same CSP unless its SHA-256 is in the policy, and that hash would have to be
regenerated on every change to the map — a build-coupled invariant with no reason to
exist.

**What the spike did NOT show.** Its "React" was a sentinel object. It measured that
host and plugin receive **one module instance**, which is the precondition for hooks
working, not the property. That Vite emits `/shared/react.js` as a stable entry sharing
its chunk with `paneview.html`'s entry — so the instance the host renders with is the
one the plugin imports — is step 2's browser-lane case to write.

> **2026-09-19, step 2 — the case, as written.** `vite.config.ts` lists
> `src/sdk/shared/react.ts`, `src/sdk/shared/react-jsx-runtime.ts` and
> `src/sdk/index.ts` as build inputs beside the two documents, emitted unhashed as
> `dist/shared/react.js`, `react-jsx-runtime.js` and `sdk.js`; in the measured
> build `shared/react.js` and both documents' entries import one
> `assets/react-*.js` chunk. The
> dev server answers the same three URLs from source. The browser lane compares
> the `ReactCurrentDispatcher` a module importing `/shared/react.js` receives
> with the `currentDispatcherRef` React DOM hands the devtools hook on
> `paneview.html` — on the build under `vite preview` with this policy, and on
> the dev server. *Tests:* `e2e/shared-modules.spec.ts` — "a module importing
> /shared/react.js receives the React instance the extension surface renders
> with". With `src/sdk/shared/react.ts` pointed at a copied second React, the
> build case fails on that comparison.
>
> **The packaged app, measured.** `scripts/csp-smoke.mjs` now also imports the
> three modules in the packaged extension surface over the `shellux:` scheme,
> after driving the fixtures and before reading the violation counts. One run
> (Windows, Electron 43.2.0, `docs/measurements/shared-modules-2026-09-19.json`):
> all three resolved, `HOST_API_VERSION` `1.0`, one renderer whose
> `currentDispatcherRef` is `/shared/react.js`'s dispatcher, `jsx` made a React
> element, and 0 CSP violations on each surface with both positive controls
> registering. The smoke's `ok` now requires all of it. The imports are
> evaluated code, not a plugin's static import. **Not measured:** a plugin
> component actually rendering — no plugin loads before step 6 — and macOS or
> Linux.
>
> **The baseline changed shape without a version bump** in review (`shellApi`
> split into required and optional; `sharedModules` added). Accepted: `1.0` has
> never been released, so no plugin was built against the earlier description.
>
> **A cost, measured:** with five inputs sharing chunks, the build splits more.
> `<link rel="modulepreload">` tags went from 1 to 4 in `dist/index.html` and
> from 1 to 5 in `dist/paneview.html` (`vite build` at `de252c9` and after); the
> total emitted JavaScript is about the same size. Load time was not measured.

**Renderer switches are unchanged.** `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false` stay on both views, as ADR-0004 decision 4 fixes them.

### 6. Where plugin code runs, and what that does NOT buy

**Every enabled plugin runs in the extension surface: one renderer process, one
document, one realm, one React root.** D-36 names this "crash containment, not
isolation", and that is the ceiling of every claim this ADR makes about it.

- **There is no boundary between plugins.** Amendment E's finding applies unchanged
  inside the extension surface: a plugin can reach the activation controller by
  reflection, take a sibling's handle, and act through it. *Tests:*
  `src/core/__tests__/reflection.test.tsx` — "reaches the host ActivationController by
  reflection anyway, and steals a sibling handle". Runtime loading adds no mechanism
  that changes this, and none is claimed.
- **What the process split does separate** is host chrome from plugin code. In the
  packaged application host chrome registers no extension (`src/App.tsx`), and under
  this design it renders plugin *data* only — titles, icons, labels, nav trees,
  command metadata — carried as an `ExtensionManifest` built field by field, from
  which a smuggled function is refused. *Tests:*
  `src/core/ipc/__tests__/manifest.test.ts` — "refuses a component reference smuggled
  onto a navigation node, and names where it was". **The manifest does not cross
  today**: `PaneViewShell.tsx` records that consuming it is the next piece of the
  seam, and the plugin manager depends on it. This is a statement about where code
  runs, not a boundary claim, and ADR-0005 remains `Proposed`.
- **Management calls are sender-checked in main.** Install, enable, disable, remove and
  restart are accepted only when the IPC sender is host chrome's `webContents`; both
  views load one preload, so the functions exist in both and the extension surface's
  calls are refused. This is **entry-point validation** at the IPC door. Test to be
  written in step 4, in `electron/__tests__/pluginIpc.test.ts`: "refuses a management
  call whose sender is the extension surface". It says nothing about the filesystem,
  which is decision 4's door.

> **2026-09-19, step 4 — the sender check as built.** `electron/main/plugins/pluginIpc.ts`
> registers five `ipcMain.handle` channels — `shellux:plugins:list`, `:install`,
> `:enable`, `:disable`, `:remove` — and each compares `event.sender` with
> host chrome's live `webContents` (`paneWindow.contentsOf('chrome')`) before
> anything runs; no window, a destroyed view or the extension surface is
> refused, and no picker opens. Restart is not a channel yet: it clears a crash
> record and reloads the surface, both step 6's. The preload exposes the five
> as `shelluxHost.plugins` in both views. **Entry-point validation**, as above:
> it holds at this door only. *Tests:* `electron/__tests__/pluginIpc.test.ts` —
> "refuses a management call whose sender is the extension surface", "refuses
> every sender when host chrome has no live webContents". Not shown: that
> Electron reports the calling view as `event.sender`, which is Electron's
> contract, exercised only in the running application.

### 7. Enable, disable, restart and remove, in the running surface

Main sends the extension surface the list of loadable plugins — id, version, URL — and
nothing else. The surface `import()`s each, validates the default export through the
real `register`, and reports each outcome.

| Operator action | Effect | Reload? |
|---|---|---|
| Enable | Main adds the plugin to the list; the surface imports and registers it | No |
| Disable | The surface `unregister`s it — revocation is synchronous (*Tests:* `src/core/__tests__/capability.test.tsx` — "revocation on unregister is synchronous"); host chrome drops its nav and commands | No |
| Restart (after a crash) | Clears the crash record; **reloads the extension surface** | Yes |
| Update | Decision 2; **reloads** | Yes |
| Remove | Disable, delete the directory, drop from `state.json` | No |

**Why restart and update reload, and disable does not.** An ES module cannot be
unloaded or re-evaluated in the realm that imported it; a second `import()` of the
same URL returns the cached instance. Disabling removes everything the host holds of a
plugin — record, handle, views — but **the module's code stays in memory until the
next reload**, and a timer it started and never cleared keeps running and throws
`REVOKED` on its next call through the dead handle. That is stated as a 1.0 limit and
is exactly what the conformance kit's lifecycle check exists to catch (decision 10).
A cache-busting re-import was rejected: it leaks every prior instance and leaves their
timers running beside the new one.

### 8. The contract changes: #17, #16, #80, and #91 decided

All are **additive** — optional blueprint members or new `IShellAPI` members — so they
are one **minor** bump under decision 3, and no existing blueprint breaks.

**#17 — lifecycle hooks, an optional `lifecycle` member on the blueprint:**

| Hook | Fires | Contract |
|---|---|---|
| `onActivate(shell)` | When the extension takes the foreground (`activate`) | Receives the live scoped handle. A throw is contained: the activation fails for this plugin only, which is marked crashed with the error in words. This makes ISSUE-005's "one module throwing during activation while the other is healthy" constructible for the first time |
| `onDeactivate()` | When it loses the foreground to another extension or to `blur` | The handle stays live — foreground loss is not revocation |
| `onRelease()` | Immediately **before** revocation, on `release` or `unregister` (so on disable and remove) | Synchronous. Revocation runs in a `finally`: a throwing or misbehaving `onRelease` cannot keep its handle alive |

**No `onRegister`.** A hook at registration would need a handle at registration, and
Amendment C's model is that activation mints the handle. A never-activated plugin
therefore still cannot publish an opening badge count — #17's point 1, kept as a named
1.0 limit rather than bought by changing when handles exist.

**#16 — `IShellAPI.setNavigationTree(nodes)`.** Re-normalises the **whole** tree
through the same validator `register` uses, bounds included, and swaps the host-owned
record atomically; the updated `ExtensionManifest` crosses to host chrome on the
transport. It keeps #16's three properties: every node is validated when it arrives,
the plugin never holds the stored record, and the bounds hold after the mutation. The
standing test that must keep passing: *Tests:*
`src/core/__tests__/registryNormalization.test.tsx` — "is unaffected by the plugin
mutating its own blueprint afterwards". Per-node `addNode`/`removeNode`/`renameNode`
was rejected as more surface for the same result. `setBadgeCount` survives beside it:
badges change on timers, trees do not, and re-validating a whole tree per badge tick is
the wrong cost.

**#80 — `IShellAPI.clearBadge(nodeId)`**, which deletes the entry rather than writing
zero, and **scope purge on `unregister`**: a plugin's badge and context-key scopes are
deleted when its record is. A plugin's own facade can only name its own scope, so
through the documented channel the number of scopes is bounded by the number of
registered plugins. **That is collision-resistance, not a bound on the store**:
`useShellStore()` is public and names any scope, which is #80's scope-count half, and a
store-level `MAX_SCOPES` is the step-5 entry-point validation for it.

> **2026-09-19, step 5 landed — the three changes as built, and where they differ
> from the text above.** `HOST_API_VERSION` moved **1.0 → 1.1**, one minor step,
> and the baseline was re-recorded: blueprint optional key `lifecycle`, `IShellAPI`
> members `clearBadge` and `setNavigationTree`, SDK type `ExtensionLifecycle`, all
> additive; `electron/main/plugins/hostContract.ts` mirrors the new number.
>
> *#17.* `lifecycle` is read once at `register` into a frozen host-owned copy; each
> hook must be a function or absent. `onActivate` fires only when the foreground
> actually moves to the extension, **after** the foreground is published (so a
> context key it writes survives the handover's clear). A throw returns
> `ok: false` with a new code, `LIFECYCLE_HOOK_THREW`, runs `onRelease`, revokes
> the handle and drops the foreground; "marked crashed" is step 6's, and reaches
> it through a new `ShellHostProvider` prop, `onLifecycleFault`, which
> `onDeactivate` and `onRelease` throws also report to. `onRelease` on the
> **unregister** path needs the handle alive, and the handle dies the moment the
> registry drops the record, so the registry gained `onBeforeUnregister`, which
> the provider subscribes to from a layout effect and which runs inside
> `unregister` before the delete. **Named gap:** an unregister made before that
> subscription exists — a descendant's layout effect in the first commit — gets
> the old sweep's revocation without `onRelease` or the purge. *Tests:*
> `src/core/__tests__/lifecycle.test.tsx` — "calls onRelease before revocation,
> and revokes even when it throws", "a throwing onActivate leaves a healthy
> sibling fully usable", "still replaces a stale entry when activate runs before
> the provider subscribed".
>
> *#16 — the record is NOT swapped, and this is the difference from the text
> above.* Record identity is the liveness token (`isLive` in
> `src/core/ActivationContext.tsx`; `capability.test.tsx` — "re-registering an id
> does not resurrect the previous handle"), so swapping the record would revoke
> the caller's own handle. The replacement tree is instead normalised
> by `normalizeNavigationTree` — the function `register` now calls too — and held
> deep-frozen by the shell store under the extension's scope, which pane 1 renders
> in place of the declared tree. #16's three properties hold; the registry's
> record keeps the declared tree. Consequence: host chrome learns of a new tree
> through the replicated store (a new `set-navigation-tree` operation), not
> through an updated `ExtensionManifest` — no manifest crosses yet (decision 6),
> and the manifest built from the record would be stale, which step 6 must read
> the store for. *Tests:* `src/core/__tests__/navigationTree.test.tsx` —
> "setNavigationTree re-normalises the whole tree at the door".
>
> *#80.* `clearBadge` deletes the entry. The purge runs inside `unregister`,
> whether or not the extension was ever activated, over badges, metrics, context
> keys and the replacement tree. The store-level bound is
> `STORE_LIMITS.MAX_SCOPES` = 1024 in `src/core/ShellAPI.ts`, deliberately **not**
> in `REGISTRY_LIMITS`: that object is the recorded contract and bounds what a
> blueprint declares, and a bound added there is a major under decision 3. The
> judgement — which review should check — is that this is not a contract
> narrowing, because a plug-in's own facade names only its own scope and reaches
> the bound only as one of more than 1023 extensions registered and writing at
> once. It is entry-point validation, spendable by anything holding the public
> store (`SECURITY.md`). *Tests:* `src/core/__tests__/lifecycle.test.tsx` —
> "unregister purges the scope's badges and context keys";
> `src/core/__tests__/navigationTree.test.tsx` — "refuses a scope beyond
> MAX_SCOPES through the public store, and frees one on purge", "clearBadge
> deletes the entry rather than writing zero".
>
> **2026-09-19, step 5 review fixes.**
>
> *Why the scope bound stays a minor.* It is observable through an extension's
> own handle: the first write of the 1025th extension to hold state is refused
> with `PAYLOAD_TOO_LARGE` by `setBadgeCount`, `setNavMetric`, `setContextKey`
> (1.0 members) and `setNavigationTree`, now documented on each. That is a new
> error path on existing members, and decision 3's rule has **no row for error
> codes** — `apiSurface.ts` compares names, keys, allowlists and
> `REGISTRY_LIMITS`, so the baseline did not and would not catch this; review
> did. It stays 1.1 on a judgement: reaching it through the documented channel
> needs more than 1023 extensions registered and writing at once, against three
> first-party plugins under D-23. *Tests:*
> `src/core/__tests__/navigationTree.test.tsx` — "refuses a new scope through an
> extension's own handle once 1024 are held".
>
> *Re-entry is refused, not deferred.* While any lifecycle hook runs, the
> controller's `activate` returns `LIFECYCLE_REENTRY` and `blur`/`release` throw
> it; a deferred call would be answered with a result it did not get.
> `registry.unregister` is not refused (it is not the controller, and a plug-in
> unregistering itself is ordinary), so `activate` re-checks liveness after
> `onDeactivate` and after `onActivate` and returns `REVOKED` instead of `ok` for
> an extension a hook unregistered. *Tests:* `src/core/__tests__/lifecycle.test.tsx`
> — "refuses an activate made from inside onDeactivate, and the outer handover
> completes", "does not report ok for an extension whose onActivate unregistered
> it", "does not publish an extension that the outgoing onDeactivate
> unregistered".
>
> *Async hooks are reported, not awaited.* Hooks stay typed `=> void`, which an
> `async` function satisfies; a returned object with a callable `then` gets a
> rejection handler that reports through `onLifecycleFault`. A late rejection
> changes no activation result and delays no revocation. *Tests:*
> `src/core/__tests__/lifecycle.test.tsx` — "reports an async hook's rejection
> through the fault path, without awaiting it".
>
> *The pre-subscription gap, narrowed and its remainder stated.* The sweep now
> purges the scope of a stale live entry whose id is no longer registered.
> What remains: such an extension gets no `onRelease`; a scope written only
> through the public store for an extension never activated is not purged, stays
> held and counts toward `MAX_SCOPES`; and when the id is registered again in the
> same commit, the new registration inherits the old scope's badges, metrics,
> context keys and tree. *Tests:* `src/core/__tests__/lifecycle.test.tsx` —
> "purges late, in the sweep, for an unregister made before the provider
> subscribed", "leaves the scope to a same-id re-registration made before the
> provider subscribed, which inherits it".

**#91 — decided as a 1.0 limit, not fixed.** `VirtualizedList` is **not** in the SDK
barrel, so no packaged plugin can import it, and it has zero production consumers
today. #91's defect — a list that cannot be told the host cleared selection — cannot
reach a plugin in 1.0. The rule for the day it is exported: a controlled
`selectedIndex` prop lands first, in the same change.

### 9. Crash handling is CRASH CONTAINMENT, in two tiers

**Tier 1 — attributable faults, contained in the surface.** Import failure, module
evaluation throwing, `register` refusing the blueprint, a manifest/blueprint id
mismatch, a lifecycle hook throwing, and a render error caught by the pane's
`FaultBoundary`. The surface knows exactly which plugin, unregisters it, and reports
it; the plugin is **crashed** with its reason. The rest of the surface keeps running.
ADR-0001 section 6's limits apply unchanged: an error in an event handler, a timer or
an unhandled rejection is not caught by a boundary and is not attributed.

**Tier 2 — renderer loss, attributed by inference.** When the extension renderer dies,
every plugin's in-memory state goes with it — they share one process. Host chrome, the
rail, pane 1 and the palette survive, as Amendment O observed. Main cannot know which
plugin killed the process. It **attributes the loss to the plugin that was foreground
at the time**, and the plugin manager says "the extension view stopped while *Mail*
was active", not "Mail crashed". After a **second** loss attributed to the same plugin
inside 60 seconds, that plugin is marked crashed and left out of the list, and the
surface reloads without it. That bounds the unconditional reload loop
`electron/main/paneViews.ts` documents today.

**A fault report can be forged.** The report travels from the extension surface, where
every plugin runs; nothing in that realm can prove which plugin sent it. A plugin can
report a sibling as crashed. That is Amendment E stated for this door, and it is a
**guardrail** — it makes honest faults visible, and enforces nothing. Test to be
written in step 6, in the honest-pinning register: "accepts a fault report naming any
plugin, because nothing in the renderer can prove which plugin sent it".

**Rejected:** one renderer per plugin. It is the only design in which one plugin's
crash does not take its siblings' state, and it is most of the way to Amendment E's
Option B. It is not needed for crash containment of host chrome, which the existing
split already gives; it multiplies the focus steal Amendment O decision 2 arbitrates
by the number of plugins; and whether the project pays for Option B is the trigger
ruling above, not something this ADR should decide by the side door.

### 10. The conformance kit (#57): `npm run plugin:check <dir>`

`<dir>` is a plugin's build output. The kit runs **the same validator module main's
installer runs** — one copy, for Amendment K decision 7's reason that two copies of a
rule drift — and takes its directory from `argv`, never an environment variable
(ADR-0002).

| Check | Fails when |
|---|---|
| Package | The manifest breaks any rule in decision 1, or `sha512` does not match |
| Contract version | Decision 3's rule refuses it against this checkout's SDK |
| Imports | The bundle's static imports name anything but the three `/shared/` modules, or it contains a dynamic `import()` |
| Registration | The default export fails `validateBlueprint`, `register`'s own pure validation core (see the "as built" note below for why the check calls this and not `register` itself), or its `id` differs from the manifest |
| Lifecycle | Driven through activate → deactivate → release against a real revocable handle with fake timers: a hook throws, or **any call reaches the handle after release**, which is how a leaked interval shows up |
| Render | Either pane view throws on first render with an empty context, or an `isVisible` throws on an empty context |

**Not in scope, stated so a green kit is not read wider (rule 4):** layout, painted
pixels, focus order, pointer behaviour, contrast — all invisible to jsdom, and owed to
the browser lane; whether a plugin is well-behaved towards its siblings, which nothing
in one realm can decide; and anything about the network, which the CSP settles for
everyone. CI runs it against all three migrated plugins.

> **2026-09-24, step 8 landed — the conformance kit, as built.**
> `scripts/plugin-check.mjs` is one plain Node CLI, `runChecks` running the six
> rows above in order and stopping at the first failure. Two mechanics this
> section's table does not name: Registration loads the built bundle as a
> real ES module through a Vite SSR server built for this one run
> (`createCheckServer`), with `/shared/react.js`, `/shared/react-jsx-runtime.js`
> and `/shared/sdk.js` resolved to the real modules `src/sdk/sharedModules.ts`
> names — the same three specifiers decision 5's rewrite produces — so the
> module graph is real, not stubbed; and Lifecycle runs against a home-grown
> `createFakeClock`, not `vi.useFakeTimers()`, because this CLI is not a
> Vitest worker and has no such runtime to borrow one from — its own banner
> states it is a deliberately narrower tool, not a claim of parity. Check 4
> hands the loaded bundle's default export to `RegistryContext.tsx`'s
> exported `validateBlueprint`, not the full `register` — `register` is bound
> to the live React registry and cannot be called standalone outside it, the
> same class of narrowing this callout uses for `createFakeClock`.
>
> Thirteen real defects surfaced while building and hardening this kit, each
> fixed rather than filed (rule 7), each naming its own failure mode (rule
> 10):
> - `scripts/build-plugins.mjs` emitted a `bundle.js` with no export
>   statement at all for a plugin whose only export is unused by anything
>   re-imported into it — Rollup's default tree-shaking for a non-library
>   build does not preserve an unused entry export. Fixed by
>   `preserveEntrySignatures: 'strict'`; see step 7's own callout above.
> - `createFakeClock`'s `advance()` re-armed a due interval at
>   `now + delay`; for a zero, omitted, or negative delay (`schedule()`'s
>   `safeDelay` clamps all three to `0`), that left `dueAt === now`, so the
>   `for (;;)` loop inside `advance()` picked the same timer forever — a bad
>   plugin turning into a hung CI job, since the step that runs
>   `plugin:check` carries no `timeout-minutes`. Fixed by clamping the
>   refire to `now + Math.max(delay, 1)`, so `dueAt` strictly increases.
> - A plugin whose `onActivate` deferred STARTING a leak by one microtask
>   (`somePromise.then(() => setInterval(...))`) was still mid-flight when
>   `checkLifecycle`'s `finally` restored the real timers, so that
>   `setInterval` landed on them instead of the fake clock — a false PASS
>   followed by an uncaught `REVOKED` crash once the real interval later hit
>   the revoked handle. Fixed by awaiting one real event-loop tick
>   (`flushMicrotasks`, via the real, unpatched `setImmediate`) after each of
>   `onActivate`/`onDeactivate`/`onRelease`, so a deferred registration lands
>   on the fake clock instead. Stated as an open limit, not closed by this
>   fix: a leak whose start instead awaits real I/O still outlives that one
>   tick.
> - The post-`revoke()` leak scan advanced a FIXED `120_000`ms of virtual
>   time, so a leaked interval or timeout with a longer delay
>   (`setInterval(fn, 200_000)`, never cleared) never had its `dueAt` fall
>   inside that fixed window — a false PASS for a genuinely leaking plugin.
>   Fixed by giving `createFakeClock` a `longestPendingDelay()` accessor and
>   sizing the post-revoke advance to
>   `Math.max(120_000, clock.longestPendingDelay() + 1)`, the plugin's own
>   longest still-pending delay rather than a guessed ceiling; free to do
>   since this is virtual time, not real waiting.
> - The lifecycle hooks are typed `=> void`, which an `async` function
>   satisfies (`ActivationContext.tsx`'s `callHook` docblock says so
>   explicitly, and attaches its own rejection handler for exactly this
>   reason). `checkLifecycle` called each hook bare; an `async` hook that
>   rejects does not throw synchronously from a bare call, so its rejection
>   went unattached — an unhandled rejection under this CLI's default
>   `--unhandled-rejections=throw`, crashing the process with a raw stack
>   instead of a clean `lifecycle` FAIL. Fixed by awaiting
>   `Promise.resolve(hookCall)` inside the same `try`/`catch` at all three
>   call sites, converging a synchronous throw and an asynchronous rejection
>   onto the one FAIL path. This check is deliberately stricter than the live
>   host on two points, not one: any hook's async rejection (just described),
>   and a SYNCHRONOUS throw from `onDeactivate` or `onRelease` specifically —
>   the live host's `runHook` (`ActivationContext.tsx`) catches a synchronous
>   throw from either of those two hooks and reports it through `reportFault`
>   without failing deactivation or release, but this check fails on it
>   regardless of which of the three hooks threw. Both are named as decisions
>   on the script's own banner, not left as unexplained discrepancies.
> - A hook can also reject INTERNALLY, never returning the rejection at all —
>   `onActivate(shell) { Promise.reject(new Error('boom')); }`, fired and
>   forgotten. Awaiting the hook's return value (the fix just above) only ever
>   sees what that return value carries; this settles on its own,
>   asynchronously, as an unhandled rejection Node detects on no stack this
>   check is on — which crashed the whole process the same way, except
>   OUTSIDE `checkLifecycle`'s own `finally`, which skipped `runChecks`'
>   temp-directory cleanup too (a real, measured leak: a
>   `dist-plugins/plugin-check-*` scratch directory left on disk after a
>   crashed run). Fixed by a `process.on('unhandledRejection', ...)` installed
>   for `checkLifecycle`'s own duration, checked after every
>   `flushMicrotasks()` call.
> - The post-`revoke()` leak scan itself was missing the same
>   `await flushMicrotasks(); if (internalRejectionFail() !== null) { ... }`
>   guard the other three phases had just gained from the fix above — a leaked
>   timer that rejects internally without ever touching `shell` (so the
>   `calls`-based leak check can't see it) created its rejection synchronously
>   inside `advance()`, with no `await` before the `unhandledRejection`
>   listener was torn down in `finally`, so Node's notification arrived too
>   late to be caught — a false PASS, then a genuinely unhandled crash later.
>   Fixed by adding the missing `await flushMicrotasks()` in that same
>   position.
> - The two pre-release `clock.advance(30_000)` calls (after `onActivate`,
>   after `onDeactivate`) were bare, unlike the post-revoke advance, which was
>   deliberately wrapped. A leaked timer whose callback threw a plain
>   synchronous error unrelated to a revoked `shell` propagated straight out
>   of `checkLifecycle`, `runChecks` and `main()`, crashing the CLI instead of
>   reporting a clean `FAIL [lifecycle]`. Fixed by wrapping both calls in
>   their own `try`/`catch`, each naming which pre-release window the throw
>   happened in.
> - The post-revoke `catch {}` guarding that same advance was unconditional,
>   swallowing any synchronous throw rather than only the expected `REVOKED`
>   error a leaked call reaching the wrapped `shell` produces — so a leaked
>   timer throwing some OTHER error after release, without ever calling
>   `shell`, was silently discarded into a false PASS. Fixed by narrowing the
>   catch to `error instanceof runtime.ShellUXError && error.code === 'REVOKED'`;
>   anything else is now reported as a `lifecycle` FAIL.
> - The internal-rejection tracking two defects above added used
>   `internalRejection === undefined` as its own "nothing has surfaced yet"
>   sentinel, but `undefined` is itself a legal rejection reason
>   (`Promise.reject()`, `Promise.reject(undefined)`), and a `??=` assignment
>   "writing" `undefined` over `undefined` is a no-op — so a plugin that
>   fire-and-forgot exactly that rejection value left `internalRejection` at
>   `undefined` forever, and `internalRejectionFail()` kept returning `null`:
>   a false PASS for the one rejection value none of the existing fixtures
>   tried. Fixed by tracking presence with a separate boolean,
>   `hasInternalRejection`, rather than comparing the captured value itself
>   to the sentinel.
> - `checkRender` installed no `unhandledRejection` guard at all, unlike
>   `checkLifecycle`. A pane view's own effect firing an unattached rejection
>   after mount settles asynchronously on React's own scheduler, after
>   `flushSync` and this check have already returned `{ ok: true }` — a
>   definitive `PASS` prints, then the process crashes. The same shape as the
>   two `checkLifecycle` defects just above, unclosed in `checkRender`. Fixed
>   by giving it the same guard and `flushMicrotasks()` cadence.
> - No lifecycle hook call had a timeout, so a hook whose promise never
>   settles at all — no throw, no resolve, no reject — hung the CLI
>   indefinitely with no output, and no chance for `runChecks`' own cleanup
>   `finally` to run. This check's choice to `await` each hook (a stricter
>   divergence from the live host's own contract, "async hooks are reported,
>   not awaited") is what creates the hang risk; the live host itself would
>   never have blocked on it. Fixed by racing each hook against a 5-second
>   REAL timer, captured before `createFakeClock().install()` can shadow
>   `globalThis.setTimeout` with the virtual one.
> - The zero-delay refire clamp above only covered `setInterval`; a
>   recursive zero-delay `setTimeout` (`const tick = () => { setTimeout(tick,
>   0); }; setTimeout(tick, 0);`, an ordinary idiom) hit the identical
>   infinite loop through a different path — each recursive call creates a
>   FRESH timer via `schedule()`, not a refire of an existing one, so the
>   clamp never ran for it. Worse than the original: this loop never yields
>   to the event loop at all, so it was unkillable by `SIGTERM` in testing,
>   and locally there is no `timeout-minutes` backstop at all. Fixed by
>   moving the floor into `schedule()` itself, so every newly scheduled
>   timer's due time is floored regardless of kind or how it was created.
>
> *Tests:* `scripts/__tests__/plugin-check.test.mjs` runs the CLI end to end
> against one hand-assembled, hash-matching `.lwplugin` fixture per row —
> one passing every check, and one planted-bad fixture per failure named in
> the table above and in the defects just listed, plus the fake clock's
> own pure-function cases (`createFakeClock`'s exported `advance`, refire and
> cancellation behaviour) exercised directly, without a subprocess.
> `.github/workflows/ci.yml` runs `npm run plugins:build` then
> `npm run plugin:check` against each of the three migrated plugins' real
> output, on all three operating systems.

### 11. The plugin manager — the gate-4 screen, and one delta

DESIGN.md's *Plugin manager*: a host view (a pane-1 entry and a palette command)
listing identity glyph, title, version, contract version and an enabled switch; install
and remove are quiet buttons; removal confirms inline, not in a modal.

| State | Source | Shown | Actions |
|---|---|---|---|
| **enabled** | `state.json` | switch on | disable, remove |
| **disabled** | `state.json` | switch off | enable, remove |
| **incompatible** | decision 3, at install or boot | warning status, reason in words ("built for host contract 2, this shell offers 1") | remove |
| **crashed** | decision 9 | danger status, the error in plain language | **Restart**, remove |
| **files changed** | decision 4's serve-time mismatch | danger status: "the installed files no longer match this plugin's manifest" | **Reinstall**, remove |

**The fifth state (owner, D-48).** A serve-time hash mismatch is not a crash: Restart
cannot fix it, because the files are wrong, not the process. It is its own state and
offers **Reinstall**. The approved gate-4 screens (D-45) show four states; the fifth
is drawn, and `DESIGN.md` gains it, in the change that builds the plugin manager.

The manager lives in host chrome, so it renders only data — decision 6.

### 12. Migrating the two mocks and HelloExtension

`src/mocks/MailPlugin.tsx`, `src/mocks/DatabasePlugin.tsx` and
`src/examples/HelloExtension.tsx` move to `plugins/mail/`, `plugins/database/`,
`plugins/hello/`, each importing the host only through `@shellux/sdk`. `npm run
plugins:build` emits a `.lwplugin` per plugin. `FIXTURE_EXTENSIONS` is deleted from
`PaneViewShell.tsx`, and the packaged application installs none: the release attaches
the three `.lwplugin` files as assets, and the end-to-end lane installs them.

`dev.html` keeps importing the plugins' **source** for the browser dev loop, where a
build per edit would be friction; it is `apply: 'serve'` and never reaches a packaged
bundle. The plugins' own tests move with them.

> **2026-09-24, step 7 landed — the move and the build, as built.** `src/mocks/`
> and `src/examples/` no longer exist. `plugins/mail/src/MailPlugin.tsx`,
> `plugins/database/src/DatabasePlugin.tsx` and `plugins/hello/src/HelloExtension.tsx`
> import `RowMetric`, `TOKEN_CLASS`, `useChannelPayload`, `LEDGER_CONTEXT_KEY` and
> every type they name through the bare specifier `@shellux/sdk` alone — never a
> relative path into `src/core/`. `vite.config.ts` and `vitest.config.ts` resolve
> that specifier to `src/sdk/index.ts` (a `resolve.alias`, for the dev server and
> for tests); `scripts/build-plugins.mjs` does the opposite for a real build,
> marking it (with `react` and `react/jsx-runtime`) EXTERNAL and rewriting it to
> `/shared/sdk.js`, decision 5's build-time rewrite, unchanged. `npm run
> plugins:build` reads each plugin's own `plugins/<name>/plugin.json` — `id`,
> `version`, `title`, an optional `icon`, and which source file to bundle — bundles
> it with Vite/Rollup into one `bundle.js` (`output.codeSplitting: false` — the
> option that replaced `inlineDynamicImports`; decision 1 above cites the rolldown
> source that confirms it), hashes it, and writes `dist-plugins/<id>.lwplugin` in
> decision 1's exact shape. Verified against the real validator, not a copy of
> it: every one of the three parses and hash-checks under
> `electron/main/plugins/pluginPackage.ts`'s
> own `parsePluginPackage`, and each reports `compatibility: { state:
> "compatible" }` against this tree's `HOST_API_VERSION`. `FIXTURE_EXTENSIONS` is
> deleted from `src/paneview/PaneViewShell.tsx`; the extension surface registers
> nothing until a later step's surface loader reads `state.json`. `src/dev/
> DevShell.tsx` is the one PRODUCTION module under `src/` that still imports
> the three plugins, from their source, by a relative path OUT of `src/dev/`
> into `plugins/*/src/` — reached only from `dev.html`, which is not a build
> input. Two test files also import plugin source the same way, for their own
> assertions: `src/__tests__/IntegrationSuite.test.tsx` and
> `src/components/__tests__/ShellLayoutIcons.test.tsx`.
> *Tests:* `src/__tests__/pluginImportGraph.test.ts` — "reaches no module under
> src/mocks or src/examples, which ADR-0006 step 7 deleted", walking the real
> import graph from `paneview.html`'s own entry point, in
> `crossDocumentIdref.test.ts`'s manner. The plugins' own tests moved with them:
> `plugins/hello/__tests__/HelloExtension.test.tsx` is unchanged but for its
> imports. `src/examples/__tests__/developerGuideStub.test.ts` did not move with
> `HelloExtension` — it was never about it, reading `DEVELOPER.md` against
> `src/core/ShellAPI.ts` — and now lives at `src/__tests__/developerGuideStub.test.ts`.
> **Not built in this step, stated so it is not read wider:** the surface loader
> that would read `state.json` and `import()` an installed plugin in the packaged
> extension surface (step 6); `plugin:check` (step 8); attaching the three
> `.lwplugin` files to a GitHub Release, or installing them in the end-to-end lane
> (step 10/11) — none of that is reachable from this sandbox, which cannot launch
> a packaged Electron app or publish a release.

---

## Implementation sequence

Each step lands on its own, passes `npm run verify`, and adds the tests named. No step
cites a test before that step writes it.

| # | Change | Tests it adds |
|---|---|---|
| 0 | **Owner ruling** on the drafted ADR-0001 amendment; this ADR to `Accepted` | — |
| 1 | CSP on every HTML response from the scheme; `style-src` measured on the packaged app | `electron/__tests__/rendererCsp.test.ts`: "every HTML response the scheme serves carries the policy"; a packaged-app smoke recording zero CSP violations across both surfaces |
| 2 | `src/sdk/index.ts` barrel, `/shared/*` entries, `api-surface.json` baseline | `src/sdk/__tests__/apiSurface.test.ts`: "fails when the contract changes and the version does not move"; browser lane: "a module importing /shared/react.js receives the React instance the extension surface renders with" |
| 3 | Package and manifest validator, `hostApiVersion` rule, `electron/main/plugins/**` added to the coverage `include` (widening, not narrowing) | `pluginPackage.test.ts`: decision 4's two cases; "marks a plugin incompatible when its major differs"; "marks a plugin incompatible when it needs a newer minor than the host offers"; the manifest-icon fallback case |
| 4 | Plugin store in main: `userData` layout, main-opened picker, `state.json`, `/plugins/` route, serve-time rehash, sender-checked IPC | `pluginScheme.test.ts`: "serves only the entry of an installed, enabled, compatible plugin", "refuses to serve an entry changed on disk after install"; `pluginIpc.test.ts`: "refuses a management call whose sender is the extension surface" |
| 5 | #17 hooks, #16 `setNavigationTree`, #80 `clearBadge` and scope purge; one minor SDK bump | "calls onRelease before revocation, and revokes even when it throws"; "a throwing onActivate leaves a healthy sibling fully usable"; "setNavigationTree re-normalises the whole tree at the door"; "unregister purges the scope's badges and context keys" |
| 6 | Surface loader, tier-1 fault reports, tier-2 attribution and the crash-loop breaker | "attributes a renderer loss to the foreground plugin, and says it is attributed"; "stops reloading a plugin into its own crash after the second loss inside sixty seconds"; decision 9's honest-pinning case |
| 7 | Move the three plugins to `plugins/*`, `plugins:build`, delete `FIXTURE_EXTENSIONS` | An import-graph scan, in `crossDocumentIdref.test.ts`'s manner: "no module reachable from paneview.html imports src/mocks or src/examples" |
| 8 | `plugin:check` and its CI job | Planted-bad plugins, one per check row in decision 10, each failing for its own reason |
| 9 | Plugin manager in host chrome, per the approved gate-4 wireframe | Browser lane: all five states drawn (D-48), inline remove confirmation, keyboard reachable from the palette (D-37) |
| 10 | Packaged-app end to end | Install → appears → disable → gone → a crashing plugin shows *crashed* and the shell survives — the plan's own acceptance line |
| 11 | GitHub Release URL source, organisation allowlist | "refuses a URL outside the LEAPWare-Software organisation"; unsigned by D-47 |

---

## Consequences

- **Positive.** The shipped application loads no plugin code at compile time.
  Operators install, enable, disable and remove without a rebuild, which is D-36.
- **Positive.** #68 has a ruling with a mechanism behind the version bump, which is the
  part #68 said nobody had supplied — narrowed to what a surface diff can see.
- **Positive.** The shell gains a CSP it has never had, for reasons that stand without
  plugins.
- **Negative — accepted.** No boundary between plugins, and runtime loading makes that
  matter more than it did. Held only by D-23 and the trigger ruling.
- **Negative — accepted.** One renderer loss takes every plugin's in-memory state.
  Attribution of that loss is an inference and the UI says so.
- **Negative — accepted.** A disabled plugin's code stays in memory until the next
  reload. No lazy panes inside a plugin. No network for plugins. No `onRegister`.
- **Negative — accepted.** `sha512` catches accidents, not adversaries, and 1.0 has no
  mechanism that makes a package first-party.
- **Neutral.** The SDK barrel is the "publishable contract" #32 asked for in every
  respect except publication.

## What this ADR did NOT do

- It did not build anything. ADR-0001 Amendment P, which its central argument depends
  on, lands in the same change (D-46).
- It did not measure real React hooks across the shared-module boundary, the CSP
  against the real application, or anything about packaged paths. The spike served
  strings from memory.
- It closes no issue. #68 and #91 are decided here and stay open until their decision
  rows are recorded and the step that builds each lands.
