# Debate record — D-54 — issue #183, plugin lifecycle-hook ownership

Per `docs/cloud/runbook.md` §1 step 8: CTO proposes, QA attacks, up to 3 rebuttal
rounds, each round sees the full previous exchange. Conducted 2026-09-19, lane A,
cloud conductor session `session_01TmgTzwDBnWNu7obqXCgv2B`. CTO role: `lw-architect`
(opus). QA role: `lw-verifier` (opus), a separate dispatch that did not write the
proposal. Verbatim below, exactly as each dispatch returned it.

---

## Round 1 — CTO proposal

## PROPOSAL — issue #183: which document owns a plugin's lifecycle hooks

Role: CTO proposer (`lw-architect`, opus), per `docs/cloud/runbook.md` §1 step 8.1. Nothing was written or edited; this is analysis only. Every file:line below was read at the current checkout of `/home/user/LEAPWare-ShellUX`.

---

### 1. The question, stated precisely

`ShellHostProvider` calls a plugin's `lifecycle` hooks off the blueprint record held by **its own document's registry**:

- `src/core/ActivationContext.tsx:693` — `const declared = entry.active.blueprint.lifecycle?.[hook];` (the `onDeactivate`/`onRelease` path, `runHook`, 691–704)
- `src/core/ActivationContext.tsx:881` — `const onActivate = taking ? blueprint.lifecycle?.onActivate : undefined;`

There is one `ShellHostProvider` per document (`src/App.tsx:370` for host chrome; `src/paneview/PaneViewShell.tsx:208` for the extension surface), each with its own `ExtensionRegistryProvider` above it, and the two registries are in different processes and cannot see each other. Both documents also drive activation independently: host chrome's pane-1 click calls `activation.activate(extension.id)` (`src/components/layout/ShellLayout.tsx:1164`) and restores the persisted foreground (`:949`), while the extension surface mirrors the replicated `activeExtensionId` by calling its own `activate`/`blur` (`src/paneview/PaneViewShell.tsx:168–189`).

So: **if the same blueprint (with `lifecycle`) is registered in both documents' registries, every hook runs twice — once per provider — and neither provider can know the other ran it.** The question ADR-0006 step 6 must answer is *which registry owns a plugin's lifecycle*, and how that ownership is enforced and pinned rather than merely intended.

Latency confirmed as the issue states: host chrome registers nothing (`src/App.tsx:318` — "Nothing is registered here", and the body at `:362–376` renders `{children}` + `ShellLayout` with no registrar), and the only production registrar is `Registrar` in `src/paneview/PaneViewShell.tsx:105–127` over `FIXTURE_EXTENSIONS` (`:98–101`, `MailPlugin` + `DatabasePlugin`), neither of which declares `lifecycle`.

---

### 2. Options considered

**Option A — registration owns lifecycle: a document registers a plugin only if that document runs it (the issue's suggested answer, restated to be checkable).**
The rule is *not* "only the extension surface registers" — that phrasing breaks the dev/browser lane, where `src/dev/DevShell.tsx` registers both mocks into a single `surface: 'full'` document (`DevShell.tsx:59–90`) and hooks must fire there. The rule that holds everywhere is: **hooks fire in the registry that holds the blueprint; exactly one registry holds a given plugin's blueprint at a time.** In the packaged two-document topology that registry is the extension surface's, because that is where plugin code is imported.

**Option B — both documents register; a mode flag decides who may hold hooks.**
E.g. thread `ShellLayout`'s `surface` ('full' | 'chrome' | 'extension', `ShellLayout.tsx:566–567`) into `ShellHostProvider` and have it strip or ignore `lifecycle` when `surface === 'chrome'`. Genuine, and it is the option that survives a future in which host chrome *does* register plugins for their nav/commands.

**Option C — a runtime guard that refuses double registration.**
Cannot be done inside one document's registry: the two registries are in separate realms. The only shared medium is the replicated store, so this becomes "a lifecycle-owner claim written as a store operation, first claimant wins".

**Option D — dedupe at the `ActivationController` level (by capability/handle).**
Each provider mints its own handle per activation (`entry.active.shell`, used at `ActivationContext.tsx:883–885`), so there is nothing shared to dedupe against; this collapses into C (a cross-document claim) or into A (whoever holds the record wins).

**Option E — decide nothing; document the double-fire as a 1.0 limit.**

---

### 3. Recommendation: Option A, with the enforcement stated in the three-word vocabulary

**Decision text I propose for `docs/DECISIONS.md`:**

> A plugin's `lifecycle` hooks are owned by the registry that holds its blueprint. A document registers a plugin only if that document runs the plugin's code. In the packaged two-document topology that is the extension surface; host chrome receives plugin **data** only and registers nothing. `ShellHostProvider` is unchanged.

**Why A, from the code:**

1. **It is the only option that needs no new mechanism, because the transport already cannot carry a hook.** `splitBlueprint` builds the manifest field by field — `src/core/ipc/manifest.ts:232–238` names exactly `id`, `name`, `version`, `navigationTree`, `commands` — so `lifecycle` is **absent by construction**, the same way `manifestCommand` (`:191–206`) omits `isVisible`/`onExecute` ("absent by CONSTRUCTION. There is no delete here and there is nothing to forget to delete"). Even if a field were added by mistake, `assertSerializable` (`:154–168`) throws `INVALID_FIELD` on `typeof value === 'function'`, naming the dotted path. So a hook cannot reach host chrome through the designed door. That refusal is **entry-point validation** at the manifest door, and it says nothing about any other door.
2. **Host chrome's design constraint is already written down and already true.** `src/App.tsx:318` and ADR-0006 decision 6 ("In the packaged application host chrome registers no extension (`src/App.tsx`) … it renders plugin *data* only"). Option A ratifies the shape the code already has; B and C add a mode or a protocol message to support a configuration nothing wants.
3. **A holds in the single-document lanes too.** Under `dev.html`/`e2e/`, one document registers the plugins and runs them; "the registry that holds it owns it" gives exactly one hook call. A rule keyed on the surface name (B) has to special-case `'full'`, and the case it special-cases is the one the browser lane actually exercises — i.e. the rule would be least tested where it is most active.
4. **C is unsound on its own terms and I would reject it even if A were unavailable.** Replication is asynchronous and lossy-by-design at the seam (`PortLike` "drops rather than queues", `AuthoritativeStore.connect`, `src/core/ipc/AuthoritativeStore.ts:144–150`), so two registrations in the same tick race; worse, the store is public — `useShellStore()` is exported and names any scope (ADR-0006 decision 8's own `MAX_SCOPES` note), so a claim record would be **collision-resistance, not confinement**, and a plugin could take or drop a sibling's claim. It would buy a guardrail while adding a protocol message and a race.

**What enforcement A actually earns, word by word (this is the part I expect QA to press):**

- Against a **plugin**: it cannot get its hooks into host chrome's registry, because the only channel to host chrome is the manifest, which omits `lifecycle` by construction and refuses functions at the door — **entry-point validation** (`manifest.ts:154–168`, `:232–238`). Not an integrity control: it says nothing about any other door, and ADR-0001 Amendment E still holds inside the extension surface (a plugin can reach the controller by reflection — `src/core/__tests__/reflection.test.tsx`, "reaches the host ActivationController by reflection anyway, and steals a sibling handle"), so within *that* document a plugin can already make another plugin's hooks run. Option A does not change that and does not claim to.
- Against an **honest host-side mistake** (someone adds a registrar to `src/App.tsx`, or step 9's plugin manager "helpfully" registers what it lists): **guardrail** only. The host is compiled from source the deployer chose; nothing structural stops host code from constructing a blueprint with `lifecycle` and registering it. What A gives is that the mistake is loud, via the two tests below plus the import-graph scan. I am explicitly **not** claiming an integrity control here, and the word *structural* does not apply.

---

### 4. How this shapes ADR-0006 step 6 (the surface loader), concretely

Decision 7 has main send the surface "the list of loadable plugins — id, version, URL", and the surface `import()` each and validate the default export through the real `register`. Under Option A, step 6 lands these five things:

1. **The loader module is reachable only from `src/paneview/main.paneview.tsx`.** It must not be imported from `src/main.tsx`'s graph. This is checkable today by the machinery `src/__tests__/crossDocumentIdref.test.ts` already has: it walks the relative-import graph from each document entry point (`:36–43`, and "walks a real graph from each entry point, so an empty scan cannot pass vacuously", `:253`) rather than trusting directory names. Step 7's planned scan ("no module reachable from paneview.html imports src/mocks or src/examples") is the same tool pointed the other way; step 6 should add the mirror assertion: **no module reachable from `index.html` imports the plugin loader**. Build-time, source-level — a **guardrail**, and a good one, because it fails on the commit that adds the import.
2. **Nothing is added to the manifest.** `lifecycle` stays out of `ExtensionManifest` (`manifest.ts:110`, `:232–238`); the plugin manager renders `state.json` + manifest data, never a blueprint.
3. **`ShellHostProvider` is not given a surface/mode prop.** Its only new-ish seam stays `onLifecycleFault` (`ActivationContext.tsx:326–336`), which is exactly the wire step 6 needs to mark a plugin crashed (ADR-0006 decision 9, tier 1).
4. **Host chrome's foreground call is unaffected and must stay unaffected.** `ShellLayout.tsx:1164`/`:949` call host chrome's own controller; with an empty registry that publishes `activeExtensionId` and fires no hook, and the surface's mirror (`PaneViewShell.tsx:168–189`) is the one activation that reaches plugin code. Step 6 must not "fix" the double-drive by moving activation into the surface — the replicated-state design is ADR-0001 Amendment O's and D-36's.
5. **Step 6 must add a tree reader to the facade, which is the issue's L5 note and it is accurate.** `AuthoritativeStore` (`src/core/ipc/AuthoritativeStore.ts:121–151`) exposes `getContext`, `subscribe`, `getBadgeCount`, `getNavMetric`, `dispatch`, `connect` — and **no** `getNavigationTree`, while the replacement tree does replicate (`src/core/ipc/protocol.ts:134`, applied at `:190`; written at `src/core/ipc/ReplicaStore.ts:519`). So host chrome cannot read a runtime tree yet. That is a step-6 facade addition, not a lifecycle question, and it should be tracked as its own line item in the step-6 PR rather than folded into this decision row.

**The tests I propose, per the issue's own ask:**

- **T1 (the counting test, honest-pinning, Vitest).** In `src/core/__tests__/lifecycle.test.tsx`, a second harness beside `mountHost` (`:37–54`): two `ExtensionRegistryProvider` + `ShellHostProvider` pairs in one render, each fed a replica over a fake port pair from `src/core/ipc/__tests__/fakePort.ts` (`createPortPair`, `:76`; `createQueuedPortPair`, `:129`) against one `createAuthoritativeStore`, as `replicaStore.test.ts` already does. Register the same `lifecycle`-bearing blueprint in **both** registries, move the foreground once, then unregister. Title, naming what it measures rather than what we wish were true: **"a blueprint registered in two providers gets every hook called once per provider, which is why exactly one document may register it"**. Counts must be 2/2/2. Its probe: change it to register in one registry only and the counts fall to 1/1/1.
- **T2 (the invariant, build-time).** The import-graph assertion in 4.1: **"no module reachable from index.html imports the plugin loader"** in `crossDocumentIdref.test.ts`'s manner. Probe: add the import on a scratch commit, watch it go red.

**Stated limits of T1, which I will not let the PR body overstate (CLAUDE.md rule 4):** two providers in one jsdom document are **not** two documents. One realm, one React, one `document`, one `localStorage`, and the fake port is not Electron's IPC. T1 measures the hook-count arithmetic and the ownership rule; it measures nothing about the process split. The real two-document configuration (host chrome + `paneview.html`) has **no** browser-lane coverage today — `e2e/` holds one `paneview` reference, in `e2e/shared-modules.spec.ts`, and `src/dev/DevShell.tsx` (the surface `e2e/` drives) is one document — and per the runbook the Electron path cannot run in the cloud VM. So the double-fire is pinned in jsdom and by source scan, and is **not verified in a browser**.

---

### 5. What I rejected, and why

- **Option B (mode flag on `ShellHostProvider`).** Rejected: it adds a second code path through `runHook`/`activate` that production would exercise in only one of its three configurations, and the configuration it would *not* exercise ('full') is the one the browser lane drives. It also buys a capability nobody has asked for — host chrome holding blueprints — while ADR-0006 decision 6 and `src/App.tsx:318` say host chrome renders data only. If that changes (a future where host chrome needs a real blueprint for nav), B is the right revision of this row, and I would want the row to say so rather than pretend the question is closed forever.
- **Option C (cross-document claim in the replicated store).** Rejected on the race and on the vocabulary: async, lossy at connect, and the store is public, so the claim is collision-resistance, not confinement. More protocol for a weaker result than A.
- **Option D (dedupe by capability/handle).** Rejected: handles are minted per provider per activation, so there is no shared token to dedupe on; it is C wearing different clothes.
- **Option E (document it as a limit).** Rejected because #183 itself says it must be decided *before* step 6: the surface loader is the first code that will register plugins that actually declare `lifecycle`, and a limit written down is not an answer to "which document owns it".
- **Also rejected: one renderer per plugin**, which would dissolve the question. Out of scope by ADR-0006 decision 9's own rejection and by Amendment E's trigger ruling; not something this row may decide by the side door.

---

### 6. What I am not sure of — flagged for the QA attack

1. **Whether `T2`'s scan is cheap to point at "the loader"** before the loader exists. `crossDocumentIdref.test.ts` walks relative imports from the two entry points; the loader will be a module in that graph, so naming it should be a one-line addition — but I did not write or run it, and I have not confirmed the scan exposes a reusable "modules reachable from entry X" export rather than keeping it private to the file.
2. **Whether a two-provider render in one jsdom document actually settles cleanly** with `createQueuedPortPair` + `act` in the shape `lifecycle.test.tsx` uses (`renderHook` + `act`). `replicaStore.test.ts` drives replicas without React; I have not built the combined harness, so "T1 is straightforward" is a judgement, not a measurement.
3. **The pre-subscription gap interacts with this and I have not traced it across two providers.** ADR-0006 decision 8's step-5 notes record that an `unregister` made before the provider's `onBeforeUnregister` subscription (`ActivationContext.tsx:1024`) gets no `onRelease`, with a stated remainder. With two providers the two subscriptions land in two independent commit orders, so a plugin registered in both could plausibly get `onRelease` from one provider and not the other. That is an argument *for* Option A, not against it, but T1 should include the unregister leg for that reason and I have not proven the asymmetry exists.
4. **Whether `restart` (decision 7, reload) can produce a stale hook call across the seam.** Restart reloads the extension surface; host chrome's document survives with its own provider and its persisted `activeExtensionId`. Under A that provider holds no plugin record, so it fires nothing — but this is reasoning about a path that has no code yet (restart "is not a channel yet", ADR-0006 decision 6's step-4 note), and I have not verified it.
5. **The decision's scope.** I am proposing the ownership rule and its enforcement, *not* the L5 facade change (§4.5). If the conductor wants one row covering both, the `getNavigationTree` half needs its own evidence and probably its own debate — it is a new public member on main's authoritative facade.

---

## Round 1 — QA attack

## VERDICT: OBJECT

The **recommendation (Option A) is the right answer**; the **evidence and enforcement story around it is not**, and the decision row as drafted would ship exactly the overclaim class that produced ADR-0001 Amendments E/F/G. There is also a cheaper option that converts an unenforced convention into a real validated door, which the proposal did not consider. Four defects, three CONFIRMED.

### Citation audit (I opened every one)

Correct and say what is claimed: `ActivationContext.tsx:693`, `:881`, `:326-336`; `PaneViewShell.tsx:98-101`, `:105-127`, `:168-189`, `:208`; `App.tsx:370`; `ShellLayout.tsx:1164`, `:949`; `manifest.ts:154-168`, `:232-238`; `AuthoritativeStore.ts:121-151`. Independently confirmed the defect is latent: no production blueprint declares `lifecycle` (grep of `src/mocks/MailPlugin.tsx`, `src/mocks/DatabasePlugin.tsx` — no match).

One weak citation: `src/App.tsx:318` is a **docblock sentence** ("Nothing is registered here"), cited as evidence for a behavioural claim. The claim is independently true from `src/App.tsx:362-375` (no `Registrar` in the tree), but citing prose as evidence is the pattern rule 2 exists against.

---

### CONFIRMED — D1. Reasoning pillar (1) rests on a transport that does not exist, and the ADR being amended says so

`splitBlueprint` has exactly two references in the entire tree — its own definition and its own test:

```
src/core/ipc/manifest.ts:231:export function splitBlueprint(...)
src/core/ipc/__tests__/manifest.test.ts: (9 call sites)
```

Zero production callers. `ExtensionManifest` likewise appears only inside `manifest.ts`. And ADR-0006 decision 6 states it outright:

- `docs/adr/0006-runtime-plugin-host.md:567-570` — "**The manifest does not cross today**"
- `docs/adr/0006-runtime-plugin-host.md:692` — "no manifest crosses yet (decision 6)"

**Failure scenario.** Step 6's loader, or any future host-side feature, registers a plugin the way the only registration path in the tree does today: `import { MailPlugin } from '../mocks/MailPlugin'` (`src/paneview/PaneViewShell.tsx:9-10`) then `registry.register(blueprint)` (`:117`) — a live object, no serialization, `splitBlueprint` nowhere in the path. `lifecycle` reaches host chrome's registry unrefused, the decision's own rule is violated, and nothing fails anywhere.

The proposal calls this "entry-point validation". CLAUDE.md: *"entry-point validation | Real at the door it guards."* It is real at a door that zero registrations pass through, and says nothing about the door all of them do. Note the contrast with how ADR-0006 §6 earns the same word for the IPC sender check (`:575-580`, `:583-595`) — that door has traffic and a named test.

### CONFIRMED — D2. The claimed guardrail is not exercised by the test offered for it

§3 claims a guardrail against "someone later adds a registrar to `src/App.tsx`". The only enforcement offered is T2: "no module reachable from index.html imports the plugin loader." Different propositions. Today's registration path imports **no loader** — it imports `src/mocks/*` directly. T2 passes unchanged with `Registrar` (`PaneViewShell.tsx:107-127`) copy-pasted into `App.tsx` over `FIXTURE_EXTENSIONS`, which is precisely the honest mistake named.

CLAUDE.md / ADR-0001 Amendment G: *"No security claim goes into a `.md` file or a docblock without naming the test that exercises it."* A `docs/DECISIONS.md` row asserting a guardrail whose named test does not assert it violates Amendment G on its face. Separately, CLAUDE.md requires a guardrail to *"make the honest mistake loud"* — nothing in the proposal makes it loud.

### CONFIRMED — D3. T1 is not buildable as specified, and would not measure the decision

(a) **Type error.** `createAuthoritativeStore` returns `AuthoritativeStore` — `getContext/subscribe/getBadgeCount/getNavMetric/dispatch/connect` (`AuthoritativeStore.ts:120-151`). `ShellHostProvider`'s `store` prop takes a `ShellStateStore` (`ActivationContext.tsx:326`). Two providers cannot share "one `createAuthoritativeStore`". The shape is one authoritative store plus **two** `createReplicaStore(...)` (`ReplicaStore.ts:218`, which does return `ShellStateStore`) over two port pairs.

(b) **The counts are wrong.** `ShellHostProvider` has **no read-direction mirror**. `activeExtensionId` occurs in `ActivationContext.tsx` only as a write (`store.patchContext({ activeExtensionId })`, `:522-527`) and as a context-key read (`:1295-1305`). The component that turns a replicated `activeExtensionId` into a local `activate()` is `ExtensionSurface`, at `src/paneview/PaneViewShell.tsx:172-187` — not in core. So two bare provider pairs sharing replicas, with the foreground "moved once", yields **one** `onActivate`, not two. To reach 2 the test must either call `activate` twice — which measures that two providers are two providers, not anything about the seam — or re-implement the mirroring effect inside the test, which is CLAUDE.md's *"test that supplies its own geometry does arithmetic over invented numbers and must say so in its own name."*

(c) **Even at 2/2/2 it asserts the wrong thing.** It asserts the *rejected* design double-fires. It does not assert the decision holds. Per rule 4b and rule 2 that is not evidence of enforcement; the rule stays a convention nothing checks. The probe ("register in one only → 1/1/1") probes the test, not the rule.

### PLAUSIBLE — D4. The decision text duplicates a standing ADR decision

`docs/adr/0006-runtime-plugin-host.md:566-568` already reads: "In the packaged application host chrome registers no extension (`src/App.tsx`), and under this design it renders plugin *data* only." The proposal's row restates this and adds only the ownership framing. A new D-row duplicating a standing ADR decision creates two places to change it. What #183 needs is the **enforcement** line item, not a second normative sentence.

---

### Cheaper and safer option the CTO did not consider — Option F: refuse `lifecycle` at the door that exists

`ExtensionRegistryProviderProps` is `{ children }` only today (`RegistryContext.tsx:1635-1637`). Add one optional prop, default `false` (e.g. `runsPluginCode`). In `register`, immediately after `normalizeBlueprint` (`RegistryContext.tsx:1678`) — where `record.lifecycle` is already computed, host-owned and frozen (`normalizeLifecycle`, `:978-1003`, called at `:1379-1381`) — return `{ ok: false, error: new ShellUXError('INVALID_FIELD', ..., 'lifecycle') }` when `record.lifecycle !== undefined && !runsPluginCode`. No new error code needed; `INVALID_FIELD` with path `'lifecycle'` fits the existing union (`src/core/types.ts`).

Cost: one prop field, one branch, one Vitest case, plus the prop set true at `PaneViewShell.tsx:206` and `src/dev/DevShell.tsx:83`'s provider.

Why it is strictly better on this project's own vocabulary ladder:

- It is real **entry-point validation** at the door **100%** of registrations pass through. The only two non-test callers of `.register(` in the tree are `PaneViewShell.tsx:117` and `DevShell.tsx:83`. `splitBlueprint` has zero.
- It is **fail-safe by default.** Option A is fail-open: any new registry runs hooks unless a human remembers a docs row. Option F's default is "this registry does not own lifecycle", so the honest mistake is refused and **loud** — both existing registrars already `console.error` a failed result (`PaneViewShell.tsx:118-123`).
- No build-time graph scan, so T2 and open question 1 disappear.
- Testable in **one** jsdom provider, so D3's entire two-provider problem disappears: "a registry that does not run plugin code refuses a lifecycle-bearing blueprint and names the field", probe = flip the prop.

I am **not** claiming Option F is an integrity control. A plugin registered by a registry that sets the prop is untouched, and reflection inside one document is untouched (ADR-0001 Amendment E, `src/core/__tests__/reflection.test.tsx`). It is entry-point validation at `register`, plus a guardrail against the host-side mistake — and unlike the proposal's version, **both** sentences would have a test.

---

### The CTO's flagged uncertainties (§6)

1. **Answered, and worse than asked.** `moduleGraph` (`crossDocumentIdref.test.ts:223`) is module-local; `scanModule` (`:166`) is exported. Adding T2 *inside that file* needs no refactor. But `resolveImport` (`:206-219`) resolves only **relative** specifiers inside `src/` and returns `null` for everything else, and the walk is over static imports. ADR-0006 §7 (`:597-600`) says the surface `import()`s each plugin — a dynamic specifier. **T2 is blind to the mechanism step 6 will actually use.**
2. **Not the blocker you flagged.** The shape does not compile (D3a), and the missing mirror (D3b), not `act`, is what breaks it.
3. Not reproduced — no test could be run (see below).
4. Not reproduced; agreed it reasons about code that does not exist.
5. **CONFIRMED correct.** `AuthoritativeStore` (`:120-151`) has no `getNavigationTree`; `ShellStateStore` does (`ShellAPI.ts:500`, `:1740`). Agreed it is a separate line item — and ADR-0006:690-694 already says step 6 must read the store for the tree.

### What I did NOT check

- **Any test run at all.** `node_modules` is absent in this checkout:
  ```
  $ npx vitest run src/core/__tests__/lifecycle.test.tsx --reporter=basic
  ⎯⎯⎯ Startup Error ⎯⎯⎯
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from
  /home/user/LEAPWare-ShellUX/vitest.config.ts.timestamp-...mjs
  ```
  I did not install, as that is a tree change outside this role's posture. **Every finding above is read-derived; none is test-derived.**
- Whether two `WebContentsView`s land in two OS processes. `electron/main/paneViews.ts:12` says "ONE `BaseWindow`, TWO `WebContentsView`s"; `electron/main/surfaces.ts:6` says "one window, one main process, and two `WebContentsView`s". Neither states a renderer process count. The proposal's "in different processes" is not evidenced by anything I read; "cannot see each other" holds either way, so I did not pursue it.
- Issue #183's own text (no network call); I took the proposal's characterisation.
- `e2e/` and the browser lane — nothing here is geometric, and the proposal correctly labels itself not verified in a browser.
- Coverage impact of Option F's new branch on the 100% gate.

**To get CONCEDE:** keep Option A's rule, but (i) delete or narrow the `splitBlueprint` pillar to "if and when the manifest crosses" and stop calling it entry-point validation today, (ii) replace the untested guardrail with Option F's refusal at `register` and name its test, (iii) drop T1's 2/2/2 or respecify it against the real mirror with an honest title, (iv) fold the row into ADR-0006 decision 6 rather than duplicating it.

---

## Round 2 — CTO revision

## Verdict: CONCEDE on D1–D4, with two corrections to Option F that change its wiring and narrow its claim

I re-read every cited location. QA's reading is accurate everywhere I checked. Two things about Option F are wrong or unstated, and both are load-bearing for the decision text, so I adopt Option F *as corrected* rather than as written.

---

### D1 — CONFIRMED (accepted)

`splitBlueprint` is declared at `/home/user/LEAPWare-ShellUX/src/core/ipc/manifest.ts:231`. Every reference in the tree is either its own definition/docblock or `src/core/ipc/__tests__/manifest.test.ts` (lines 4, 46, 72, 87, 97, 108, 128, 157, 167). Zero production callers. `ExtensionManifest` likewise appears only in `manifest.ts` (110, 132, 134, 232) and that test.

The live path is exactly as QA described: `src/paneview/PaneViewShell.tsx:100-101` freezes `FIXTURE_EXTENSIONS` as live JS objects (imports at `:9-10`) and `:117` passes one straight to `registry.register(blueprint)`. No serialization, no manifest.

And ADR-0006 says so itself at `docs/adr/0006-runtime-plugin-host.md:569` — "**The manifest does not cross today**" — with the same statement repeated at `:692` ("no manifest crosses yet (decision 6)").

**My round-1 pillar was citing a door nothing walks through.** I withdraw it. `assertSerializable` is real validation of a real shape, but it validates a transport that is not in the runtime path, so it cannot be offered as the reason `lifecycle` does not reach host chrome.

### D2 — CONFIRMED (accepted), and worse than QA said — it also defeats *their* T-test

My proposed build-time import-graph scan does not catch the copy-paste. Confirmed by construction: `Registrar` in `PaneViewShell.tsx:107-127` imports no loader; pasting it into `src/App.tsx` adds import edges to `src/mocks/*` only.

But I checked one step further than QA did, and it cuts against Option F too: **neither mock declares `lifecycle`.** `grep -n "lifecycle|onActivate|onDeactivate|onRelease" src/mocks/MailPlugin.tsx src/mocks/DatabasePlugin.tsx` returns nothing; the only hit in that family is `src/examples/HelloExtension.tsx:55`, which says it *does not* declare them. So the exact mistake QA named — pasting the `FIXTURE_EXTENSIONS` loop into `App.tsx` — registers three lifecycle-free blueprints, and Option F's `record.lifecycle !== undefined` refusal lets all of them through unchanged.

This does not rescue my T2; it narrows what any enforcement in #183 may claim. The mistake "host chrome registers the mocks" is **ADR-0006 decision 6's** defect (host chrome rendering plugin *views*), not #183's. #183's harm is narrower and Option F hits it exactly: *a blueprint carrying lifecycle hooks being accepted by a registry that is not the one running plugin code.* I will state that scope explicitly instead of letting the decision row imply the broader catch.

### D3 — CONFIRMED (accepted)

`createAuthoritativeStore` (`src/core/ipc/AuthoritativeStore.ts:181`) returns `AuthoritativeStore` (`:121`), whose surface is `getContext` / `subscribe` / `getBadgeCount` — not `ShellStateStore` (`src/core/ShellAPI.ts:121`), which is what `ShellHostProviderProps.store` takes (`src/core/ActivationContext.tsx:296, 326`). The real topology is one authority plus replicas: `src/App.tsx:233` then `:239` (`createReplicaStore`). My T1 would not have type-checked, and with zero suppressions permitted there is no way to paper over it.

The second half of D3 is the more serious half and I accept it too: the read-direction mirror of `activeExtensionId` lives in `ExtensionSurface` at `src/paneview/PaneViewShell.tsx:166-187` (`const wanted = context.activeExtensionId` → `activation.activate(wanted)` → `bump()`), **not** in `ActivationContext.tsx` — there the flow is write-direction only (`:522-527`, `store.patchContext({ activeExtensionId })`). A bare two-provider Vitest harness would have had to re-implement that mirror to produce the second `onActivate`, i.e. supply its own geometry and assert arithmetic over it. T1 is dropped, not fixed.

### D4 — CONFIRMED (accepted)

`docs/adr/0006-runtime-plugin-host.md:565-572` already carries "In the packaged application host chrome registers no extension (`src/App.tsx`)". A new row restating it adds a second copy of a sentence and no enforcement. Fold.

### QA's weak-citation flag — accepted

`src/App.tsx:318` is prose inside a docblock. The behaviour is the JSX at `:368-375`: `ExtensionRegistryProvider` → `ShellHostProvider` → `{children}` → `ShellLayout`, with `children` defaulting to `undefined` (`:365`). Cite the JSX, or better, cite the test named below.

---

## Correction to Option F: the wiring QA specified is not implementable

QA said "set the prop true at the two real call sites, `PaneViewShell.tsx:206` and `src/dev/DevShell.tsx:83`."

`PaneViewShell.tsx:207` is a provider and takes the prop. **`DevShell` owns no provider.** `src/dev/DevShell.tsx:119-122` is `<App><Registrar /></App>`; the only `ExtensionRegistryProvider` in that document is `src/App.tsx:369`. `DevShell.tsx:83` is the `registry.register(blueprint)` line inside `Registrar`, which has nothing to set the prop on. Its docblock (`:95-102`) says the provider duplication was deliberately deleted, so reinstating a second stack there would undo a fix.

So the prop must be threaded: `AppProps` (`src/App.tsx:337-358`) gains it, `App` forwards it to `:369`, and `DevShell` passes `runsPluginCode` on `<App>`. That has a consequence QA did not name and the decision text must: per `DevShell.tsx:104-110`, **`dev.html` is the document host chrome's `WebContentsView` loads in a development run.** So in a dev run, host chrome's own registry has the flag true. The guarantee is therefore "host chrome refuses lifecycle **in the packaged topology**", not "in every run". That is exactly the kind of sentence ADR-0001 Amendment G exists to force.

Second cost, bounded and worth paying: with default false, every harness that registers `lifecycle` through a bare `ExtensionRegistryProvider` must opt in. `src/core/__tests__/lifecycle.test.tsx:39-41` (`mountHost`) is the main one — 41 `lifecycle` occurrences in that file — plus `capability.test.tsx` and `IntegrationSuite.test.tsx`. Adding `runsPluginCode` to those harnesses is a feature, not a tax: each harness then states in code that it stands in for the extension surface.

---

## Revised recommendation

**Option A's ownership framing stands** (the registry that holds the blueprint owns its lifecycle hooks; in the packaged topology that is only the extension surface) — QA did not attack it, and nothing I read contradicts it. **Option F, corrected, replaces both of my round-1 enforcement pillars.**

### Code change

1. `src/core/RegistryContext.tsx:1635-1637` — `ExtensionRegistryProviderProps` gains `readonly runsPluginCode?: boolean | undefined` (default `false`), destructured at `:1639-1641`.
2. `src/core/RegistryContext.tsx`, inside `register`, immediately after `const { record, id, source } = normalizeBlueprint(blueprint);` at **`:1678`** (not inside `normalizeBlueprint` at `:1265` — that function is provider-agnostic and shared): if `record.lifecycle !== undefined && !runsPluginCode`, return `{ ok: false, error: new ShellUXError('INVALID_FIELD', <message naming that this registry does not run plugin code>, 'lifecycle') }`. `record.lifecycle` is already the host's own frozen copy (`normalizeLifecycle`, `:986-1003`; assigned `:1379-1395`), so the check reads host-owned data and invokes no plugin code — it stays inside the existing `try` (`:1662`) regardless. `runsPluginCode` joins `register`'s `useCallback` dependency list.
3. `src/paneview/PaneViewShell.tsx:207` — `<ExtensionRegistryProvider runsPluginCode>`.
4. `src/App.tsx` — `AppProps` gains `runsPluginCode?: boolean | undefined` (defaulting false, documented as "true only for a document that hosts plugin code"), forwarded to `:369`.
5. `src/dev/DevShell.tsx:120` — `<App runsPluginCode>`.
6. Harness opt-in: `src/core/__tests__/lifecycle.test.tsx:39-41`, and the lifecycle-registering harnesses in `capability.test.tsx` / `IntegrationSuite.test.tsx`.

### Vocabulary (binding on every sentence written about this)

- The refusal at `register()` is **entry-point validation** at the registry door — real at that door, and silent about every other. It is *not* an integrity control: `runsPluginCode` is a prop, and any caller may pass `true`.
- Naming it fail-safe is legitimate *only* as "a new registry defaults to refusing", which is a **guardrail** against the honest mistake — it enforces nothing against deliberate action.
- No use of *isolation*, *sandbox*, *confinement*, *boundary*. ADR-0006 `:685-691` already records that there is no boundary between plugins, and this changes none of it.

### Tests (real names, honest limits)

- `src/core/__tests__/lifecycle.test.tsx` — **"refuses a blueprint declaring lifecycle hooks in a registry that does not run plugin code, and names the field"**. One provider, default props, `expect(result.ok).toBe(false)` and `error.field === 'lifecycle'`. This is the named test the enforcement claim cites.
- `src/core/__tests__/lifecycle.test.tsx` — **"accepts the same blueprint, and calls onActivate, when the provider declares it runs plugin code"**. The other half; without it the first test is compatible with the feature being broken outright.
- `src/__tests__/App.test.tsx` — **"host chrome's provider refuses a lifecycle-declaring registration, which is the copy-paste this guardrail exists for"**. Renders `App` with no `runsPluginCode` and registers through `useRegistry` from a child. This is the test that replaces my dead T2, and it is also the correct citation to put where `App.tsx:318`'s prose sits.

**What these do not verify.** All three are jsdom: they observe a return value, not a pixel, not a process. They do not verify the real two-Electron-document topology — nothing in Vitest does, and per ADR-0006 `:569` the manifest transport they would ride does not cross today. They do not show that the packaged extension surface runs hooks correctly end to end; that needs the browser lane or the native host, and I am **not** claiming an e2e case for this change, because `e2e/` runs one Chromium document and cannot stand up two `WebContentsView`s. So the honest label on the packaged-topology half is "**not verified in a browser or in the native host**" until step 6 makes the manifest cross. And per D2 above, these tests do not catch a lifecycle-*free* copy-paste of `Registrar` into `App.tsx` — that is decision 6's gap, and rule 7 says it gets filed with this evidence before merge, not deferred silently.

### Decision text — folded into ADR-0006 decision 6, per QA's ask

Appended to the "What the process split does separate" bullet (`docs/adr/0006-runtime-plugin-host.md:565-572`), in place of a new `docs/DECISIONS.md` row:

> **Amendment (issue #183) — the enforcement, since the sentence above was previously only a design statement.** Lifecycle hooks belong to whichever registry holds the blueprint, and `ExtensionRegistryProvider` now requires the holder to say so: `runsPluginCode` defaults to `false`, and `register` refuses any blueprint whose normalised `record.lifecycle` is present in a registry that has not declared it, returning `{ ok: false }` with `ShellUXError('INVALID_FIELD', …, 'lifecycle')`. This is **entry-point validation** at the registry door — the one door all registrations pass (`.register(` has exactly two non-test callers: `src/paneview/PaneViewShell.tsx:117` and `src/dev/DevShell.tsx:83`) — and a **guardrail** against the honest mistake, because the default refuses rather than silently running plugin code. It is not an integrity control: `runsPluginCode` is a prop and any caller may pass `true`. The flag is `true` on the extension surface (`PaneViewShell.tsx:207`) and, threaded through `AppProps`, in the dev fixture (`src/dev/DevShell.tsx:120`) — and because `dev.html` is the document host chrome loads in a **development** run (`DevShell.tsx:104-110`), the claim "host chrome refuses lifecycle" is scoped to the **packaged** topology, not to every run. The earlier framing of `splitBlueprint`/`ExtensionManifest` as this enforcement is withdrawn: per this decision's own text the manifest does not cross today, and `splitBlueprint` (`src/core/ipc/manifest.ts:231`) has no production caller. Tests proposed here as titles for the implementer to write: one in `src/core/__tests__/lifecycle.test.tsx` for the refusal case, and one in `src/__tests__/App.test.tsx` for host chrome's own provider [the first shipped verbatim; the second did not — see the editorial note below]. Both run in jsdom and observe a return value only; the packaged two-document behaviour is **not verified in a browser or in the native host** and waits on step 6.

**[Editorial note, added when this record was committed, not part of the CTO's verbatim round-2 text above]:** `src/core/__tests__/registryNormalization.test.tsx`'s test shipped exactly as proposed: refuses a blueprint declaring lifecycle hooks in a registry that does not run plugin code, and names the field. The `App.test.tsx` test's proposed title — quoting the CTO's exact words here for the record, since this is what was actually agreed to at debate time — was *host chrome's provider refuses a lifecycle-declaring registration, which is the copy-paste this guardrail exists for*. `claude[bot]`'s review of PR #195 correctly flagged that title as an overclaim once the code existed to check it against: neither shipped mock (`MailPlugin`, `DatabasePlugin`) declares `lifecycle`, so the actual "copy-paste `Registrar`'s loop into `App.tsx`" mistake this repository's own code contains would NOT be caught by this guardrail — a limit the CTO's round-2 text itself named in passing (D2, "worse than QA said") without carrying it into the proposed title. The test was retitled at implementation and again after review to: **refuses a lifecycle-declaring registration under App's default, host-chrome-shaped configuration, though no shipped fixture attempts one today** — which is what `src/__tests__/App.test.tsx` and the shipped ADR-0006 amendment cite. The quoted proposed title above is intentionally not wrapped in the file's normal citation-quote style, so that `check:citations` does not read this historical proposal as a live claim about a test that, under that exact name, was never shipped.

### What I did not do (rule 8)

Analysis only — no file was written or edited. I ran no tests: I read, as QA did, and I treat their read-derived findings at full weight. I did not check whether `node_modules` is present here or attempt `npm run verify`, so every claim above is source-derived; the implementer owes real `verify` output in the PR body per rule 2. I did not audit `capability.test.tsx`'s or `IntegrationSuite.test.tsx`'s harnesses line by line to confirm the exact edit each needs — I confirmed only that they reference `lifecycle` (1 and 2 occurrences) and register through a provider. I did not design enforcement for decision 6's separate lifecycle-free copy-paste gap; I identified it and it should be filed.

---

## Round 2 — QA final check

## Verdict: CONCEDE

Both CTO corrections are accurate, my round-1 wiring instruction was wrong, and the two assumptions you asked me to attack (`{ ok: false, error }` and `ShellUXError(code, message, field)`) turn out to be real existing conventions, not unverified guesses. I have no new objection that justifies a round 3. Three residual items for the debate log below, none blocking.

### What I verified myself

**Correction (a) — wiring. CTO is right, I was wrong.**
- `/home/user/LEAPWare-ShellUX/src/App.tsx:337-360` — `AppProps` exists and is exactly as described: `surface`, `store`, `children`, all optional, all `readonly … | undefined`. The component signature is `App({…}: AppProps = {})`, so an added optional prop is trivially compatible.
- `src/App.tsx:369` is the only `ExtensionRegistryProvider` in that document tree. `src/dev/DevShell.tsx` is `<App><Registrar /></App>` and owns no provider. My "set the prop at `DevShell.tsx:83`" was pointing at `registry.register(blueprint)` inside the `Registrar` effect, which is a consumer, not a provider. Threading through `AppProps` is the only route.
- The dev-run scope caveat holds and is corroborated outside the docblock: `electron/main/index.ts:142` and `:274` both treat `dev.html` as the document the host view loads in a dev run. So "packaged topology only" is the honest scope, and it is not fixable by derivation — `wireHostChrome()` / `HostSurfaceWiring` (`src/App.tsx:292`) carries only `surface` and `store`, and no derivation could distinguish "dev.html as browser-lane fixture" from "dev.html as host chrome's view," because they are the same document.

**Correction (b) — the mocks. Confirmed.** `src/mocks/MailPlugin.tsx` and `src/mocks/DatabasePlugin.tsx` contain no `lifecycle`, `onActivate`, `onDeactivate` or `onRelease` at all. So Option F genuinely does not catch the D2 copy-paste, and narrowing the claim to "a lifecycle-*bearing* blueprint reaching the wrong registry" is the correct correction, not a dodge. `src/examples/HelloExtension.tsx:55` likewise states it declares no `lifecycle`, so the documented example keeps registering through a default-false registry — no doc breakage.

**The return shape and error signature — both real, neither assumed.**
- `src/core/RegistryContext.tsx:1699-1706` already returns `{ ok: false, error: new ShellUXError('DUPLICATE_ID', …, 'id') }`, and `:1712-1714` returns `{ ok: false, error: toShellUXError(error) }`. The proposed shape is the house convention.
- `ShellUXError(code, message, field)` confirmed at `src/core/RegistryContext.tsx:1364-1368` (`'INVALID_FIELD'`, message, `'views'`).
- `normalizeBlueprint` builds `record` with a conditional spread (`…(lifecycle === undefined ? {} : { lifecycle })`, `:1393`), so the key is genuinely absent when undeclared and `record.lifecycle !== undefined` is a sound discriminator. Insertion point `:1678` is after that call and inside the existing `try`.
- `ExtensionRegistryProviderProps` at `:1635-1637` is `{ readonly children: ReactNode }` — as described.

### Residual caveats to record (not blockers)

1. **Step 6's harness opt-in list is wrong in both directions.** `src/core/__tests__/lifecycle.test.tsx` is the *only* file in the repo that registers a lifecycle-bearing blueprint (it is the sole file containing `onActivate`/`onDeactivate`/`onRelease` at all). `capability.test.tsx:635` and `IntegrationSuite.test.tsx:708` mention lifecycle only in comments and need no opt-in. Conversely, `lifecycle.test.tsx` mounts `ExtensionRegistryProvider` at **five** sites — `:41, :740, :775, :810, :841` — and at least `:740` and `:775` wrap registrations passing `lifecycle: { onRelease }` (`:726, :730, :764`), so "`lifecycle.test.tsx:39-41`" is insufficient. Mechanical, and it fails loudly red, so rule 7 is not at risk — but the change list should say five sites in one file, not three files.

2. **`DevShell`'s own docblock argues against the prop.** `src/dev/DevShell.tsx:104-110` states at length that it "names no surface either" because "a prop here would be a second answer to a question that already has one." `<App runsPluginCode>` is precisely such a prop. Since it cannot be derived (see above), it is the only mechanism available — but under rule 3 that docblock must gain a sentence in the same commit saying why this prop is the exception, or the file will contradict itself.

3. **ADR-0006 over a new `docs/DECISIONS.md` row: I agree with the CTO, with one condition.** `docs/DECISIONS.md` says "an agent may recommend; an agent may not decide anything in the CALLED BY column," and "`OPEN` rows are the only work-stopping items." A new row would therefore have to be either OPEN (work-stopping, wrong for a code change under an ownership framing already settled) or a DECIDED row no agent may author. Meanwhile ADR-0006 decision 6 already owns the correctly-scoped sentence ("In the packaged application host chrome registers no extension (`src/App.tsx`)") *and* the withdrawn claim ("**The manifest does not cross today**") in the same bullet, and the ADR already carries dated step amendments in that section. The fold-in is the right home. Condition: `DECISIONS.md`'s own preamble names "ADR amendments" as one of the paragraph-shaped places decisions used to hide, so if this ever becomes a policy question — may host chrome run plugin code at all — it needs a row then.

No objection. Option F as corrected, folded into ADR-0006 decision 6, with the three named jsdom tests and the explicit packaged-topology-only scope, survives my attack.

---

## Outcome: AGREEMENT after 2 rounds

Recorded as D-54 in `docs/DECISIONS.md`, "Called by: CTO/QA debate (cloud, lane A), under the owner's 2026-09-19 delegation". The enforcement itself is folded into ADR-0006 decision 6 as an amendment (per QA's condition, precedent: existing D-49/D-50/D-51 rows), not duplicated as prose in the ledger row. Residual item 3's condition — a ledger row is owed if this becomes a policy question (may host chrome ever run plugin code) rather than an enforcement detail — is carried forward as a note on the D-54 row itself, since it is a real caveat and not yet a live question. Implementation (the code change, the two harness fixes noted in residual item 1, the `DevShell.tsx` docblock sentence noted in residual item 2, and the three tests) proceeds under `lw-implementer`, to the corrected spec above, in the same PR as this record.
