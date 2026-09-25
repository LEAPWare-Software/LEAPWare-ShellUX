#!/usr/bin/env node
/**
 * ============================================================================
 * `npm run plugin:check <dir>` — THE CONFORMANCE KIT. ADR-0006 DECISION 10 / STEP 8 (#57).
 * ============================================================================
 * `<dir>` is a plugin's BUILD OUTPUT — what `npm run plugins:build`
 * (`scripts/build-plugins.mjs`) writes. Today that build writes one file,
 * `dist-plugins/<id>.lwplugin`, not a directory of files (decision 1: "one
 * bundle, not a file tree" packed into one JSON document). So this script
 * accepts EITHER: a path straight to a `.lwplugin` file, or a directory that
 * contains exactly one `.lwplugin` file, and refuses a directory holding zero
 * or more than one — never guessing which one was meant.
 *
 * The path comes from `process.argv[2]` ONLY. Never an environment variable —
 * ADR-0002: nothing tracked may depend on a machine's local environment, and a
 * conformance gate that silently read `$PLUGIN_DIR` would be exactly that.
 *
 * Six checks, run in the order ADR-0006's table lists them, stopping at the
 * first failure so the report always names ONE check and ONE reason — never a
 * pile of secondary failures caused by the first. Each is implemented by
 * calling the SAME code the host itself runs, not a second copy of the rule
 * (Amendment K decision 7's reasoning: two copies of a rule drift):
 *
 *   1. Package          `electron/main/plugins/pluginPackage.ts`'s
 *                        `readPluginPackage` / `parsePluginPackage` — the exact
 *                        module the main-process installer calls.
 *   2. Contract version  The `compatibility` field that same call already
 *                        computes via `compareHostApiVersion`, surfaced here as
 *                        an explicit pass/fail rather than a silently accepted
 *                        "incompatible" state — see the banner below.
 *   3. Imports           A static parse of the bundle with the TypeScript
 *                        compiler, the same technique
 *                        `src/__tests__/pluginImportGraph.test.ts` uses to walk
 *                        an import graph (itself following
 *                        `crossDocumentIdref.test.ts`'s manner): every static
 *                        import/export-from names one of the three `/shared/`
 *                        specifiers, and no `import()` appears at all.
 *   4. Registration      The bundle is loaded as a real ES module — with
 *                        `/shared/react.js`, `/shared/react-jsx-runtime.js` and
 *                        `/shared/sdk.js` resolved to the REAL modules they
 *                        name in this checkout, the same three
 *                        `src/sdk/sharedModules.ts` maps them to for the dev
 *                        server — and its default export is handed to
 *                        `validateBlueprint`, the exported, host-owned
 *                        validator `RegistryContext.tsx`'s `register` itself
 *                        calls.
 *   5. Lifecycle         Driven activate -> deactivate -> release against a
 *                        REAL revocable handle (`createRevocableShellAPI` from
 *                        `src/core/ShellAPI.ts`, the same function
 *                        `ActivationContext.tsx` mints one from) under a small
 *                        fake clock — see "WHY A HOME-GROWN FAKE CLOCK" below.
 *   6. Render            Each pane view mounted once, with an empty context and
 *                        a real live `IShellAPI`, through `react-dom/client`'s
 *                        `createRoot` into a `jsdom` container — client
 *                        rendering, the only kind this desktop shell ever does
 *                        (see the banner on `checkRender` for why NOT server
 *                        rendering) — plus every declared command's
 *                        `isVisible`, called against the same empty context.
 *
 * ---------------------------------------------------------------------------
 * WHY CHECK 2 EXISTS SEPARATELY FROM CHECK 1, THOUGH ONE CALL COMPUTES BOTH
 * ---------------------------------------------------------------------------
 * `parsePluginPackage` never refuses a version-incompatible package outright —
 * decision 3's rule decides a STATE (`compatible` / `incompatible`), and what an
 * installer does with an incompatible plugin is step 4's business, not the
 * validator's. Left alone, that means a version-incompatible `.lwplugin` would
 * sail through a kit that only asked "did `ok` come back true?" and get marked
 * merely "incompatible" — exactly the silent pass ADR-0006 step 8 says this kit
 * must not produce. So this script treats `compatibility.state === 'incompatible'`
 * as its own named failure, `contract-version`, distinct from `package`: the
 * package parsed and validated fine; it is the CONTRACT that this checkout
 * refuses it against.
 *
 * ---------------------------------------------------------------------------
 * WHY A HOME-GROWN FAKE CLOCK, NOT `vi.useFakeTimers()`
 * ---------------------------------------------------------------------------
 * `vi.useFakeTimers()` is this repository's standardised fake-timer helper
 * (`src/__tests__/IntegrationSuite.test.tsx`,
 * `src/core/services/__tests__/hydrationEngine.test.ts`), and using it here
 * would have been preferred for that reason alone. It is Vitest's own object,
 * built for code running inside a Vitest worker; `plugin:check` is a plain Node
 * CLI `npm run verify`'s `test:coverage` stage does not launch it under, and it
 * has no such worker to run in — `import { vi } from 'vitest'` outside one does
 * not give a usable fake-timers implementation. Rather than pull the whole
 * Vitest runtime into a production CLI to reach one utility, this file
 * implements the narrow slice of "fake timers" the Lifecycle check actually
 * needs — schedule, advance, detect a still-pending interval — as
 * `createFakeClock` below. It is a DELIBERATE, NARROWER tool, not a claim of
 * parity with Vitest's; that limit is stated here rather than left to be
 * discovered.
 *
 * ---------------------------------------------------------------------------
 * NOT IN SCOPE — STATED SO A PASSING KIT IS NOT READ WIDER (CLAUDE.md rule 4)
 * ---------------------------------------------------------------------------
 * Layout, painted pixels, focus order, pointer behaviour, contrast: all
 * invisible to jsdom-and-Node and owed to the browser lane (`e2e/`). Whether a
 * plugin behaves well towards its siblings: nothing in one plugin's own realm
 * can decide that. Anything about the network: the CSP settles that for
 * everyone, not this kit. A green run of this kit is evidence for exactly the
 * six rows above, and no wider a claim than that.
 *
 * Check 5 (Lifecycle) also does not catch every possible deferral: it awaits
 * one real event-loop tick (`flushMicrotasks`, on `checkLifecycle`'s own
 * banner) after each of `onActivate`/`onDeactivate`/`onRelease`, so a leak
 * started from a microtask chain of any depth (`.then().then()…`) lands on
 * the fake clock as if it were synchronous. A leak whose start instead awaits
 * real I/O — a `fetch`, a file read, anything that outlives one tick — is
 * still outside what this tick can catch; that gap is unclosed, not silently
 * assumed away.
 *
 * Check 5 is also, by design, STRICTER than the real host on two points:
 *
 *   1. An `async` hook that rejects (the hooks are typed `=> void`, which an
 *      `async` function satisfies) is `await`ed here and its rejection turned
 *      into an ordinary `lifecycle` FAIL. The live host (`ActivationContext
 *      .tsx`'s `callHook`) does not do this — it is fire-and-forget on a
 *      rejecting hook, reporting the rejection through its own fault path
 *      without ever failing or un-failing the activation already returned.
 *   2. A SYNCHRONOUS throw from `onDeactivate` or `onRelease` fails this
 *      check too, not only one from `onActivate`. The live host's own
 *      wrapping differs by hook: `activate` lets an `onActivate` throw
 *      propagate (fatal to that activation), but `onDeactivate` and
 *      `onRelease` run through `runHook` instead, which catches a
 *      synchronous throw and reports it through `reportFault` — deactivation
 *      and release proceed on the live host even when the plug-in's own hook
 *      throws. This check does not carry that hook-by-hook distinction: any
 *      of the three throwing is a `lifecycle` FAIL.
 *
 * This kit's job is "does this hook misbehave", not "match the live host's
 * leniency", so both departures are deliberate, and arguably better, than
 * matching the host's own behaviour exactly — named here so they read as
 * decisions, not discrepancies.
 * ============================================================================
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { JSDOM } from 'jsdom';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The three specifiers a rewritten plugin bundle may import. Nothing else. */
export const ALLOWED_SHARED_IMPORTS = Object.freeze([
  '/shared/react.js',
  '/shared/react-jsx-runtime.js',
  '/shared/sdk.js',
]);

/** What was thrown, in words, without trusting it — same posture as `ActivationContext.tsx`'s `describeThrown`. */
export function describeThrown(error) {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return `a value of type "${typeof error}" that could not be read`;
  }
}

/**
 * Resolve the caller's argument to one `.lwplugin` file. A file is used as
 * given; a directory must hold EXACTLY one `.lwplugin` file — zero or several
 * is refused rather than guessed at.
 */
export function resolvePackagePath(argPath) {
  if (typeof argPath !== 'string' || argPath.length === 0) {
    throw new Error(
      'plugin-check: usage: npm run plugin:check -- <path to a built .lwplugin file, or the directory holding one>',
    );
  }
  const target = resolve(process.cwd(), argPath);
  let stat;
  try {
    stat = statSync(target);
  } catch {
    throw new Error(`plugin-check: "${argPath}" does not exist.`);
  }
  if (stat.isFile()) {
    return target;
  }
  if (!stat.isDirectory()) {
    throw new Error(`plugin-check: "${argPath}" is neither a file nor a directory.`);
  }
  const candidates = readdirSync(target).filter((name) => name.endsWith('.lwplugin'));
  if (candidates.length === 0) {
    throw new Error(`plugin-check: "${argPath}" holds no .lwplugin file. Run "npm run plugins:build" first.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `plugin-check: "${argPath}" holds ${String(candidates.length)} .lwplugin files (${candidates.join(', ')}); name one file directly.`,
    );
  }
  return join(target, candidates[0]);
}

/**
 * Check 3 — Imports. Parses the bundle's TEXT with the TypeScript compiler,
 * the same walking technique `pluginImportGraph.test.ts` uses (that file's own
 * banner traces it to `crossDocumentIdref.test.ts`): every static
 * import/export-from must name one of `ALLOWED_SHARED_IMPORTS`, and no dynamic
 * `import()` may appear anywhere in the module.
 */
export function checkImports(bundleText) {
  const source = ts.createSourceFile('bundle.js', bundleText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const offenders = [];
  let dynamicImportFound = false;
  const allowed = new Set(ALLOWED_SHARED_IMPORTS);

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (!allowed.has(specifier)) {
        offenders.push(specifier);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      dynamicImportFound = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (dynamicImportFound) {
    return {
      ok: false,
      check: 'imports',
      reason: 'the bundle contains a dynamic import(), which decision 5 forbids: every dependency must be a static import of one of the three /shared/ modules',
    };
  }
  if (offenders.length > 0) {
    return {
      ok: false,
      check: 'imports',
      reason: `the bundle statically imports ${JSON.stringify(offenders[0])}, which is not one of the three /shared/ modules ${JSON.stringify(ALLOWED_SHARED_IMPORTS)}`,
    };
  }
  return { ok: true };
}

/**
 * A deliberately narrow fake clock. See "WHY A HOME-GROWN FAKE CLOCK" above.
 *
 * Installs its own `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` on
 * `globalThis`, tracking every pending timer; `advance(ms)` fires every timer
 * due at or before that many virtual milliseconds from now, re-scheduling an
 * interval rather than deleting it. `restore()` puts the real timers back.
 * Never installed nested — the caller is responsible for pairing every
 * `install()` with a `restore()`, which `checkLifecycle` does in a `finally`.
 */
export function createFakeClock() {
  const real = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function schedule(kind, callback, delay, args) {
    const id = nextId;
    nextId += 1;
    const safeDelay = typeof delay === 'number' && delay >= 0 ? delay : 0;
    timers.set(id, { kind, callback, delay: safeDelay, dueAt: now + safeDelay, args });
    return id;
  }

  function install() {
    globalThis.setTimeout = (callback, delay, ...args) => schedule('timeout', callback, delay, args);
    globalThis.clearTimeout = (id) => {
      timers.delete(id);
    };
    globalThis.setInterval = (callback, delay, ...args) => schedule('interval', callback, delay, args);
    globalThis.clearInterval = (id) => {
      timers.delete(id);
    };
  }

  function restore() {
    globalThis.setTimeout = real.setTimeout;
    globalThis.clearTimeout = real.clearTimeout;
    globalThis.setInterval = real.setInterval;
    globalThis.clearInterval = real.clearInterval;
  }

  /** Fire every timer due within `ms` virtual milliseconds, in due order. */
  function advance(ms) {
    const deadline = now + ms;
    for (;;) {
      let earliestId = null;
      let earliest = null;
      for (const [id, timer] of timers) {
        if (timer.dueAt <= deadline && (earliest === null || timer.dueAt < earliest.dueAt)) {
          earliest = timer;
          earliestId = id;
        }
      }
      if (earliest === null) {
        break;
      }
      now = earliest.dueAt;
      if (earliest.kind === 'timeout') {
        timers.delete(earliestId);
      } else {
        // `Math.max(earliest.delay, 1)`, not `earliest.delay` alone: a
        // zero-delay interval (`setInterval(fn, 0)`, or an omitted delay —
        // `schedule()`'s `safeDelay` clamps a non-number or negative delay to
        // `0` too) would otherwise re-arm at `dueAt === now`, which is still
        // `<= deadline`, and this `for (;;)` would pick the same timer again
        // with `now` unmoved — forever. `plugin:check`'s whole reason to exist
        // is to fail a badly-behaved plugin cleanly; a plugin that does this
        // must come back as a `lifecycle` FAIL, not a hung CI job with no
        // `timeout-minutes` to save it.
        earliest.dueAt = now + Math.max(earliest.delay, 1);
      }
      earliest.callback(...earliest.args);
    }
    now = deadline;
  }

  /**
   * The longest `delay` among timers still pending right now, or `0` if none
   * are. Lets a caller size an `advance()` to reach even a timer whose delay
   * is longer than any fixed budget the caller would otherwise guess — see
   * `checkLifecycle`'s use of this after `revoke()`, and its own banner for
   * why a fixed budget there was a bug, not a design choice.
   */
  function longestPendingDelay() {
    let max = 0;
    for (const timer of timers.values()) {
      if (timer.delay > max) {
        max = timer.delay;
      }
    }
    return max;
  }

  return { install, restore, advance, longestPendingDelay };
}

/** A minimal `document` for `createThemeBridge`'s one `getComputedStyle(root)` call. See its banner: jsdom's empty custom properties fall back to the seed theme rather than throwing. */
function installMinimalDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const saved = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  return () => {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.getComputedStyle = saved.getComputedStyle;
    dom.window.close();
  };
}

/**
 * Wrap a revocable `IShellAPI` so every call is recorded with the phase it
 * happened in. Used by `checkLifecycle` to answer "did any call reach the
 * handle after release" without trusting the throw alone — a leaked interval
 * whose callback calls a shell method AFTER release throws `REVOKED` from
 * inside that interval, uncaught by anyone; what this kit needs is to know
 * that call was attempted at all, which the throw alone does not surface to a
 * caller who is not inside that interval's own stack.
 *
 * **A plain copy, not a `Proxy` over `shell`.** `IShellAPI` instances are
 * deep-frozen (`src/core/types.ts`'s own banner, "integrity control"), so every
 * member is a non-configurable, non-writable data property; a `Proxy`'s `get`
 * trap is required by the language to return that EXACT value for such a
 * property, and returning a wrapping closure instead is a `TypeError` at the
 * first read, not a silent pass-through. A fresh plain object has no such
 * invariant and satisfies the same shape a plug-in reads through —
 * it never needs to BE the original object, only to behave like it.
 */
function wrapWithCallLog(shell, phaseRef, calls) {
  const wrapped = {};
  for (const key of Reflect.ownKeys(shell)) {
    const value = shell[key];
    if (typeof value === 'function') {
      wrapped[key] = (...args) => {
        calls.push({ member: String(key), phase: phaseRef.phase });
        return value.apply(shell, args);
      };
    } else {
      wrapped[key] = value;
    }
  }
  return wrapped;
}

/**
 * The three host modules a REAL `IShellAPI` is minted from, loaded together —
 * `ActivationContext.tsx`'s own imports, in the order it uses them.
 */
async function loadShellRuntime(server) {
  const [shellApi, payloadModule, themeModule, typesModule] = await Promise.all([
    server.ssrLoadModule(resolve(REPO_ROOT, 'src/core/ShellAPI.ts')),
    server.ssrLoadModule(resolve(REPO_ROOT, 'src/core/payload/PayloadChannel.ts')),
    server.ssrLoadModule(resolve(REPO_ROOT, 'src/core/theme/ThemeBridge.ts')),
    // `ShellUXError` itself — `ShellAPI.ts` imports it from here but does not
    // re-export it, and `checkLifecycle`'s post-revoke scan needs the SAME
    // class `assertLive` throws, to tell a genuine `REVOKED` apart from any
    // other error a leaked timer's callback might throw (see the comment on
    // that `catch` block).
    server.ssrLoadModule(resolve(REPO_ROOT, 'src/core/types.ts')),
  ]);
  return {
    createShellStateStore: shellApi.createShellStateStore,
    createRevocableShellAPI: shellApi.createRevocableShellAPI,
    createPayloadChannelStore: payloadModule.createPayloadChannelStore,
    createThemeBridge: themeModule.createThemeBridge,
    ShellUXError: typesModule.ShellUXError,
  };
}

/**
 * Mint one real, live `IShellAPI` for `extensionId` — exactly what
 * `ActivationContext.tsx`'s `activate` does on first activation, minus the
 * registry and the store-notification bookkeeping neither check needs.
 * Requires a `document` global; the caller installs one.
 */
function createLiveShell(runtime, extensionId) {
  const store = runtime.createShellStateStore();
  const payloads = runtime.createPayloadChannelStore();
  const themes = runtime.createThemeBridge(globalThis.document.documentElement);
  let live = true;
  const revocable = runtime.createRevocableShellAPI(store, extensionId, () => live, payloads, themes);
  return {
    shell: revocable.api,
    store,
    revoke: () => {
      live = false;
      revocable.revoke();
    },
  };
}

/**
 * Wait for the real event loop's microtask queue to drain, using the REAL
 * `setImmediate` (never patched by `createFakeClock` — see its own banner:
 * only `setTimeout`/`setInterval`/their `clear*` counterparts are installed).
 * `setImmediate`'s callback runs only after every microtask queued before it
 * has run, including ones a `.then()` callback itself queues, so this drains
 * a promise chain of any depth in one await, not merely one hop of it.
 *
 * WHY THIS EXISTS. `checkLifecycle`'s own body, between one `await` and the
 * next, runs as a single synchronous stretch of JS — calling
 * `lifecycle.onActivate?.(shell)` does not, by itself, hand control back to
 * the microtask queue. A plugin that defers starting a leaking timer by one
 * microtask (`somePromise.then(() => setInterval(...))`, an ordinary
 * pattern) would otherwise still be mid-flight when `clock.restore()` runs in
 * this function's `finally`, so that `setInterval` call would install the
 * REAL timer, not the fake one — silently outside every check below, and
 * outside this whole CLI process's own control once it exits. Awaiting this
 * after each lifecycle call gives such a deferred registration a chance to
 * land on the FAKE clock, exactly where a synchronously-scheduled one does.
 */
function flushMicrotasks() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Check 5 — Lifecycle. `activate` -> `deactivate` -> `release`, against a real
 * `createRevocableShellAPI` handle, with the fake clock advanced between each
 * step so a scheduled timer gets a chance to fire.
 *
 * **A hook can also reject INTERNALLY, never returning the rejection at
 * all** — `onActivate(shell) { Promise.reject(new Error('boom')); }`, fired
 * and forgotten, no `return`, no `await`. Awaiting `Promise.resolve(hookCall)`
 * above only ever sees what the hook's own RETURN VALUE carries; a rejection
 * that never reaches that return value settles on its own, asynchronously,
 * as an unhandled rejection Node detects on no stack this function is on —
 * so nothing in the `try`/`catch` around the hook call ever runs. Left
 * unhandled, that crashes the whole CLI process the same way the
 * already-fixed RETURNED-rejection case did, except OUTSIDE this function's
 * own `finally`, which skips `runChecks`' temp-directory cleanup too (a real,
 * measured leak: a `dist-plugins/plugin-check-*` scratch directory from a
 * crashed run was still on disk after the process exited). A single
 * `process.on('unhandledRejection', ...)` for this function's own duration
 * catches it into `internalRejection` below, checked after every
 * `flushMicrotasks()` — the same cadence a RETURNED rejection is already
 * caught at — and turned into the same clean `lifecycle` FAIL shape, so
 * `runChecks`' `finally` still runs either way.
 */
export async function checkLifecycle(server, blueprint) {
  const runtime = await loadShellRuntime(server);

  const restoreDom = installMinimalDom();
  const clock = createFakeClock();
  clock.install();

  /**
   * `hasInternalRejection` tracks whether one has surfaced at all, separately
   * from `internalRejection`'s own value: `undefined` is a legal rejection
   * reason (`Promise.reject()`, `Promise.reject(undefined)`), so comparing
   * `internalRejection` itself against `undefined` cannot tell "nothing has
   * surfaced yet" apart from "the plugin rejected with `undefined`" — a
   * `??=` assignment "writing" `undefined` over `undefined` is a no-op, so
   * that exact rejection value was silently swallowed into a false PASS.
   * *Tests:* `scripts/__tests__/plugin-check.test.mjs` — "Check 5 (Lifecycle)
   * — refuses a plugin whose onActivate rejects internally with undefined".
   */
  let hasInternalRejection = false;
  let internalRejection;
  const onUnhandledRejection = (reason) => {
    if (!hasInternalRejection) {
      hasInternalRejection = true;
      internalRejection = reason;
    }
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const live = createLiveShell(runtime, blueprint.id);

    const phaseRef = { phase: 'activate' };
    const calls = [];
    const shell = wrapWithCallLog(live.shell, phaseRef, calls);

    const lifecycle = blueprint.lifecycle ?? {};

    /** `null` while nothing has surfaced; else the clean FAIL to return. */
    const internalRejectionFail = () =>
      hasInternalRejection
        ? {
            ok: false,
            check: 'lifecycle',
            reason: `an internal, unattached promise rejection reached the process during a lifecycle hook: ${describeThrown(internalRejection)}`,
          }
        : null;

    try {
      // `await Promise.resolve(...)`, not a bare call: the hooks are typed
      // `=> void`, which an `async` function satisfies (`ActivationContext
      // .tsx`'s `callHook` docblock says so explicitly, and handles it by
      // attaching its own rejection handler). A bare `lifecycle.onActivate?.
      // (shell)` does not throw for an `async` hook that rejects — it
      // returns an already-rejected promise, unattached, which is an
      // unhandled rejection under this CLI's default `--unhandled-rejections
      // =throw` and crashes the whole process with a raw stack instead of
      // this check's own clean FAIL. Wrapping the call in `Promise.resolve`
      // (harmless for a hook that returns nothing) and awaiting it inside
      // this same `try` catches a synchronous throw and an async rejection
      // through the one path.
      await Promise.resolve(lifecycle.onActivate?.(shell));
    } catch (error) {
      return { ok: false, check: 'lifecycle', reason: `lifecycle.onActivate threw: ${describeThrown(error)}` };
    }
    await flushMicrotasks();
    if (internalRejectionFail() !== null) {
      return internalRejectionFail();
    }
    phaseRef.phase = 'active';
    try {
      // A leaked timer whose callback throws a plain, synchronous error —
      // unrelated to touching the (still-live, not yet revoked) `shell` —
      // fires from inside THIS `advance()`, on no stack this kit is
      // otherwise on. Unlike the post-`revoke()` advance below, this is not
      // a leak SIGNAL to swallow: the extension is still legitimately
      // active, nothing has been revoked, and `calls` records nothing here
      // to confirm from. It is just a bug in the plugin's own timer
      // callback, and — same as every other hook-call `try`/`catch` in this
      // function — it belongs in a clean `lifecycle` FAIL, not loose on the
      // process to crash the whole CLI with a raw stack (the `claude[bot]`
      // review finding on PR #221, comment 4100128282).
      clock.advance(30_000);
    } catch (error) {
      return {
        ok: false,
        check: 'lifecycle',
        reason: `a leaked timer's callback threw while the extension was still active, before lifecycle.onDeactivate ran: ${describeThrown(error)}`,
      };
    }

    try {
      await Promise.resolve(lifecycle.onDeactivate?.());
    } catch (error) {
      return { ok: false, check: 'lifecycle', reason: `lifecycle.onDeactivate threw: ${describeThrown(error)}` };
    }
    await flushMicrotasks();
    if (internalRejectionFail() !== null) {
      return internalRejectionFail();
    }
    phaseRef.phase = 'active';
    try {
      // Same gap, same fix, the other pre-release window — see the comment
      // on the `advance()` above.
      clock.advance(30_000);
    } catch (error) {
      return {
        ok: false,
        check: 'lifecycle',
        reason: `a leaked timer's callback threw while the extension was still active, before lifecycle.onRelease ran: ${describeThrown(error)}`,
      };
    }

    try {
      await Promise.resolve(lifecycle.onRelease?.());
    } catch (error) {
      return { ok: false, check: 'lifecycle', reason: `lifecycle.onRelease threw: ${describeThrown(error)}` };
    }
    await flushMicrotasks();
    if (internalRejectionFail() !== null) {
      return internalRejectionFail();
    }

    // Revocation: exactly what ending an extension's liveness does in
    // `ActivationContext.tsx`'s `endLiveness` — the predicate flips, then the
    // handle is revoked.
    live.revoke();
    phaseRef.phase = 'released';
    try {
      // A leaked timer's callback calling a revoked member THROWS `REVOKED`
      // (`ShellAPI.ts`'s `assertLive`) — from inside this `advance()`, on no
      // stack this kit is otherwise on. The call is already recorded in
      // `calls` (pushed before the wrapped function runs the real one), so
      // that throw is itself confirmation of the leak, not a crash to
      // propagate; swallowing it here is what lets the `calls` scan below run
      // at all.
      //
      // **The budget is sized to the plugin's OWN longest pending delay, not
      // a fixed number.** A fixed `advance(120_000)` here used to give a
      // false PASS for a genuinely leaking plugin whose interval or timeout
      // used a longer delay (`setInterval(fn, 200_000)`, never cleared): its
      // `dueAt` would never fall inside that fixed window, so its callback
      // never fired, and the leak scan below saw nothing to find. This is a
      // FAKE clock advancing VIRTUAL time — there is no real waiting, so
      // sizing the budget to whatever is actually still pending
      // (`clock.longestPendingDelay()`) costs nothing and closes the gap for
      // any delay a plugin chooses, not merely delays under some guessed
      // ceiling. `Math.max(120_000, …)` keeps the previous floor for the
      // ordinary case of nothing (or something short) still pending.
      clock.advance(Math.max(120_000, clock.longestPendingDelay() + 1));
    } catch (error) {
      // **Only the expected `REVOKED` `ShellUXError` is swallowed here** — the
      // `claude[bot]` review finding on PR #221, comment 4100128896. The
      // catch above used to be unconditional, so a leaked timer that threw
      // some OTHER, unrelated error after release — one that never touches
      // `shell` at all, so the `calls` scan just below finds nothing either —
      // was discarded here just the same, and `checkLifecycle` fell through
      // to a false `{ ok: true }` PASS for a plugin still misbehaving after
      // release, just not in the specific way this scan checks for. Anything
      // that is not that exact `REVOKED` error is a genuine, unexpected
      // failure and gets reported as a clean FAIL, matching every other
      // hook-call site in this function, rather than swallowed on its say-so.
      if (!(error instanceof runtime.ShellUXError) || error.code !== 'REVOKED') {
        return {
          ok: false,
          check: 'lifecycle',
          reason: `a leaked timer's callback threw an unexpected error after release (not the expected REVOKED from touching the revoked shell): ${describeThrown(error)}`,
        };
      }
    }

    const leaked = calls.find((call) => call.phase === 'released');
    if (leaked !== undefined) {
      return {
        ok: false,
        check: 'lifecycle',
        reason: `a call to shell.${leaked.member} reached the handle after release — a leaked interval or timeout that lifecycle.onRelease did not clear`,
      };
    }
    await flushMicrotasks();
    if (internalRejectionFail() !== null) {
      return internalRejectionFail();
    }
    return { ok: true };
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    clock.restore();
    restoreDom();
  }
}

/**
 * Check 6 — Render. Every pane view rendered once against an empty context
 * and a REAL, live `IShellAPI` — the same shape `ExtensionViewProps` promises
 * and `checkLifecycle` proves the rest of — plus every declared command's
 * `isVisible`, called against that same context.
 *
 * **A real shell, not a stub, and that is load-bearing.** A first render
 * legitimately reads through `shell` — `useChannelPayload` and `useBadgeCount`
 * both do, and both of this repository's own verification plugins call the
 * former from `views.pane2` — so a stand-in that throws for every member
 * would fail every conforming plugin that reads its own state on mount, which
 * is not what this check exists to catch.
 *
 * **Client rendering, not server rendering, and that is load-bearing too.**
 * This shell is an Electron desktop application; nothing in it is ever
 * server-rendered, and `react-dom/server` enforces a rule client rendering
 * does not — `useSyncExternalStore` without a `getServerSnapshot` throws under
 * `renderToStaticMarkup` and does not throw under `createRoot(...).render`
 * (`node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js`'s
 * own message: "Missing getServerSnapshot ... Will revert to client
 * rendering"). `useChannelPayload` (`src/sdk/index.ts`,
 * `src/core/payload/PayloadChannel.ts`) declares no `getServerSnapshot`
 * because the host never asks for one, so rendering this check's fixtures
 * through `react-dom/server` would fail `plugins/mail` and `plugins/database`
 * — real, shipped, conforming plugins — for calling the SDK exactly as
 * documented. This check therefore mounts into a small `jsdom` container with
 * `react-dom/client`'s `createRoot`, flushed synchronously with `flushSync` so
 * a render that throws does so on this call stack rather than inside React's
 * own scheduler, where nothing here could catch it.
 */
export async function checkRender(server, blueprint) {
  const runtime = await loadShellRuntime(server);
  const restoreDom = installMinimalDom();
  try {
    const live = createLiveShell(runtime, blueprint.id);
    const emptyContext = live.store.getContext();

    for (const [paneName, View] of [
      ['pane2', blueprint.views?.pane2],
      ['pane3', blueprint.views?.pane3],
    ]) {
      if (typeof View !== 'function') {
        return { ok: false, check: 'render', reason: `views.${paneName} is not a component` };
      }
      const container = globalThis.document.createElement('div');
      const root = createRoot(container);
      try {
        flushSync(() => {
          root.render(createElement(View, { shell: live.shell, context: emptyContext }));
        });
      } catch (error) {
        return {
          ok: false,
          check: 'render',
          reason: `views.${paneName} threw on first render with an empty context: ${describeThrown(error)}`,
        };
      } finally {
        root.unmount();
      }
    }

    for (const command of blueprint.commands ?? []) {
      try {
        command.isVisible(emptyContext);
      } catch (error) {
        return {
          ok: false,
          check: 'render',
          reason: `command "${command.id}"'s isVisible threw on an empty context: ${describeThrown(error)}`,
        };
      }
    }

    return { ok: true };
  } finally {
    restoreDom();
  }
}

/** Build the Vite SSR server every module-loading check shares for one run. */
async function createCheckServer() {
  let serverRef;
  const sharedModulesPlugin = {
    name: 'plugin-check:shared-modules',
    async resolveId(id) {
      const match = /^\/shared\/([a-z-]+)\.js$/.exec(id);
      if (match === null) {
        return null;
      }
      // Loaded lazily, off the SAME server, so the mapping of `/shared/<name>.js`
      // to a real source file is read from the one place that mapping is
      // defined (`src/sdk/sharedModules.ts`) rather than restated here — the
      // three names it lists are exactly `ALLOWED_SHARED_IMPORTS` above.
      const { sharedModuleSource } = await serverRef.ssrLoadModule(resolve(REPO_ROOT, 'src/sdk/sharedModules.ts'));
      const relativePath = sharedModuleSource(match[1]);
      return relativePath === undefined ? null : resolve(REPO_ROOT, relativePath);
    },
  };
  serverRef = await createServer({
    root: REPO_ROOT,
    configFile: false,
    logLevel: 'warn',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [react(), sharedModulesPlugin],
    resolve: { conditions: ['browser', 'development', 'module', 'import', 'default'] },
    ssr: { resolve: { conditions: ['browser', 'development', 'module', 'import', 'default'] } },
    // This server only ever `ssrLoadModule`s a short, fixed list of host
    // modules plus one plugin bundle — never a whole document — so the
    // dependency-crawl `optimizeDeps` normally runs from an HTML entry point
    // has nothing to scan and nothing to buy. Left enabled it walks every
    // `.html` file under `REPO_ROOT` looking for one, which is slow and, for
    // `paneview.html`'s own import of `@shellux/sdk`, noisy on stderr.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return serverRef;
}

/**
 * Run every check against one built `.lwplugin`, stopping at the first
 * failure. Returns `{ ok: true, manifest }` or `{ ok: false, check, reason }`.
 */
export async function runChecks(packagePath) {
  const server = await createCheckServer();
  const scratchRoot = join(REPO_ROOT, 'dist-plugins');
  mkdirSync(scratchRoot, { recursive: true });
  const tmpDir = mkdtempSync(join(scratchRoot, 'plugin-check-'));
  try {
    const { readPluginPackage, nodePluginPackageFs } = await server.ssrLoadModule(
      resolve(REPO_ROOT, 'electron/main/plugins/pluginPackage.ts'),
    );

    // Checks 1 and 2 — Package, then Contract version.
    const result = readPluginPackage(nodePluginPackageFs, packagePath);
    if (!result.ok) {
      return { ok: false, check: 'package', reason: result.reason };
    }
    const { manifest, bundle, compatibility } = result.plugin;
    if (compatibility.state === 'incompatible') {
      return { ok: false, check: 'contract-version', reason: compatibility.reason };
    }

    // Check 3 — Imports, over the bundle's own text.
    const bundleText = Buffer.from(bundle).toString('utf8');
    const importsResult = checkImports(bundleText);
    if (!importsResult.ok) {
      return importsResult;
    }

    // The bundle is written to a real file so it can be `ssrLoadModule`d as a
    // real ES module — a `data:` URL import would work for a specifier-free
    // module, but this one has to be RESOLVED against `/shared/*`, which needs
    // a module graph.
    const bundlePath = join(tmpDir, 'bundle.js');
    writeFileSync(bundlePath, bundleText);

    // Check 4 — Registration.
    let moduleNamespace;
    try {
      moduleNamespace = await server.ssrLoadModule(bundlePath);
    } catch (error) {
      return { ok: false, check: 'registration', reason: `the bundle could not be loaded as an ES module: ${describeThrown(error)}` };
    }
    const { validateBlueprint } = await server.ssrLoadModule(resolve(REPO_ROOT, 'src/core/RegistryContext.tsx'));
    let blueprint;
    try {
      blueprint = validateBlueprint(moduleNamespace.default);
    } catch (error) {
      return { ok: false, check: 'registration', reason: `the default export failed validateBlueprint: ${describeThrown(error)}` };
    }
    if (blueprint.id !== manifest.id) {
      return {
        ok: false,
        check: 'registration',
        reason: `the registered blueprint's id "${blueprint.id}" differs from the manifest's id "${manifest.id}"`,
      };
    }

    // Check 5 — Lifecycle.
    const lifecycleResult = await checkLifecycle(server, blueprint);
    if (!lifecycleResult.ok) {
      return lifecycleResult;
    }

    // Check 6 — Render.
    const renderResult = await checkRender(server, blueprint);
    if (!renderResult.ok) {
      return renderResult;
    }

    return { ok: true, manifest };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    await server.close();
  }
}

async function main() {
  const argPath = process.argv[2];
  let packagePath;
  try {
    packagePath = resolvePackagePath(argPath);
  } catch (error) {
    console.error(describeThrown(error));
    process.exitCode = 1;
    return;
  }

  const result = await runChecks(packagePath);
  if (result.ok) {
    console.log(
      `plugin-check: PASS ${result.manifest.id}@${result.manifest.version} — package, contract-version, imports, registration, lifecycle, render`,
    );
    return;
  }
  console.error(`plugin-check: FAIL [${result.check}] ${result.reason}`);
  process.exitCode = 1;
}

// Run only when invoked as the CLI, not when imported for its exports by a test.
const invokedDirectly = typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
