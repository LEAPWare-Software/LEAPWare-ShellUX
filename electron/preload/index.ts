/**
 * ============================================================================
 * THE PRELOAD, AND WHY IT IS EMPTY ON PURPOSE.
 * ============================================================================
 *
 * This file exposes nothing. It imports nothing. It contains no executable
 * statement at all, and that is the deliverable rather than a placeholder for
 * one.
 *
 * WHAT AN API HERE WOULD COST. A `contextBridge.exposeInMainWorld` call is a
 * contract: once a renderer reads `window.<something>`, that name and that shape
 * are load-bearing, and the extension-facing half of this project already has a
 * hard rule that a contract is validated at its door and frozen behind it
 * (ADR-0001 Amendment A, and the trust-boundary banner at the top of
 * `src/core/types.ts`). Phase 1 has nothing to put behind such a door. The
 * surface Phase 6 needs — a `PortLike`, an authoritative store's patch channel,
 * a theme injection point — is being designed against an in-process transport
 * first, precisely so that it is proven before a process boundary is added to
 * it. Guessing at that surface now would produce a name Phase 6 has to keep for
 * compatibility with nothing, or break for no reason. An empty preload has
 * neither problem.
 *
 * WHY THE FILE EXISTS AND IS WIRED ANYWAY, RATHER THAN BEING ADDED LATER. Three
 * things become true the moment `webPreferences.preload` points at a real path,
 * and all three are cheaper to discover now than in the middle of Phase 6:
 *
 *   1. **The path resolves.** The main process computes this file's location
 *      from its own, and that arithmetic is different in a checkout and in a
 *      packaged archive. `preload-error` in electron/main/index.ts reports it if
 *      it is ever wrong.
 *
 *   2. **The module format is fixed, and it is not the one this repository
 *      defaults to.** `sandbox: true` is not negotiable (electron/main/index.ts
 *      decision 1), and **a sandboxed preload script cannot use ESM imports** —
 *      an ESM preload requires the `.mjs` extension and requires the sandbox to
 *      be off. Meanwhile the repository's root `package.json` declares
 *      `"type": "module"`, so an emitted `.js` file is an ES module by default
 *      everywhere else in this tree. The two facts collide exactly here.
 *
 *      This file sidesteps the collision instead of resolving it, because it can
 *      afford to: with no `import` and no `export` it is a script, and a script
 *      is valid under either module system. **That property is not free, and it
 *      was nearly lost to a compiler default.** Under `module: NodeNext`,
 *      TypeScript's default `moduleDetection` of `"auto"` calls this file an ES
 *      module anyway — because the nearest `package.json` says so — and emits
 *      `export {};` at the top to keep it one, which is a syntax error in the
 *      CommonJS realm it is loaded into. `electron/tsconfig.json` sets
 *      `moduleDetection: "legacy"` for that single reason, and the reason is
 *      written at both ends because a flag whose absence produces a syntax error
 *      in an empty file is not a thing anyone will guess at twice.
 *
 *      **The first line of real code here ends the sidestep.** Whoever writes it
 *      must make this file compile to CommonJS — `require('electron')`, not
 *      `import` — and must make the emitted artefact say so, either by an
 *      explicit `.cjs` extension or by a `"type"` field beside it.
 *
 *   3. **The security posture is already the one Phase 6 needs**, so the first
 *      bridged call is written against `contextIsolation: true` and
 *      `sandbox: true` rather than being written first and hardened afterwards.
 *      Hardening afterwards is how a `nodeIntegration: true` shortcut survives
 *      into a release.
 *
 * WHAT IS NOT CLAIMED HERE. An empty preload is not a security control and this
 * comment does not present it as one. It withholds nothing that
 * `contextIsolation` and `sandbox` were not already withholding; it simply adds
 * no new surface to the three switches in electron/main/index.ts. In the
 * vocabulary ADR-0001 Amendment E fixes for this repository, the switches are
 * the integrity control and this file is an absence — and an absence is not a
 * third thing to be listed beside them.
 *
 * THE ONE THING THIS FILE IS LIKELY TO DO FIRST, RECORDED SO IT IS NOT
 * REDESIGNED FROM SCRATCH. The pivot plan's R6 is a flash of the wrong theme:
 * the resolved token set arrives over IPC, and the document paints before it
 * does. The fix named there is to write the built-in theme of the correct
 * appearance from the preload, before first paint, and to treat the IPC message
 * as a refinement. That work needs the theme pipeline (Phase 2) and the
 * transport seam (Phase 6) and belongs to neither of them yet. Until then, the
 * main process carries the coarse half of the same idea in its window
 * background colour, and this file stays as it is.
 * ============================================================================
 */
