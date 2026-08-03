/**
 * ============================================================================
 * THE TRANSPORT SEAM — TWO MEMBERS, AND THE REASON IT IS ONLY TWO
 * ============================================================================
 * This is the whole surface `src/core/ipc/**` knows about a process boundary.
 * `AuthoritativeStore` and `ReplicaStore` are written against it and against
 * nothing else, so the entire cross-process state design is exercisable in one
 * jsdom process with a fake on both ends and no Electron anywhere.
 *
 * **It is deliberately `HydrationEngine`'s `ShellStorage` seam, one door along.**
 * That interface is two members — `getItem`/`setItem` — chosen so that
 * `localStorage` satisfies it without an adapter and a test can hand the engine
 * a storage that throws. This one is `postMessage`/`onmessage`, chosen so that
 * Electron's `MessagePortMain` and the DOM's `MessagePort` both satisfy it
 * *almost* without an adapter, and so that a test can hand a store a port that
 * counts, delays, reorders or refuses messages. The precedent matters because it
 * is the reason this phase can be verified at all: §10 of the native-host plan
 * records that jsdom can prove none of the visual or native work, and the answer
 * both times is to put the untestable part behind a two-member interface and
 * leave it outside `src/`.
 *
 * **What the eventual adapter has to do, and why it is not here.** A real
 * `MessagePortMain` hands its handler a `MessageEvent`, not the message: the
 * payload is at `event.data`, and the port must be `start()`ed before anything is
 * delivered. Neither fact belongs in `src/`, because neither is checkable under
 * jsdom. The adapter is therefore ~10 lines living in `electron/`.
 *
 * ```ts
 * // electron/main/portAdapter.ts — Phase 7, NOT part of this module
 * function adapt(port: MessagePortMain): PortLike {
 *   const seam: PortLike = { postMessage: (m) => port.postMessage(m), onmessage: null };
 *   port.on('message', (event) => seam.onmessage?.(event.data));
 *   port.start();
 *   return seam;
 * }
 * ```
 *
 * ---------------------------------------------------------------------------
 * PHASE 7 BUILT IT. TWO CLAIMS ABOVE HELD AND TWO DID NOT.
 * ---------------------------------------------------------------------------
 * `electron/main/portAdapter.ts` exists and its body is the one written above,
 * line for line. **The shape of this seam was right.** Two claims made around it
 * need correcting, and they are corrected here rather than quietly dropped:
 *
 * 1. ~~"the only code in the pivot's state design that no unit test covers"~~.
 *    False, and the adapter itself is why: `MessagePortMain` is structurally
 *    three members, so a fake satisfies it in a few lines and both facts the
 *    adapter absorbs — the `MessageEvent` wrapper and the mandatory `start()` —
 *    are directly observable with no Electron imported. *Tests:*
 *    `electron/__tests__/portAdapter.test.ts` — "starts the port, because a port
 *    nobody started delivers nothing" and "DROPS a message that arrives before a
 *    handler is installed, which is PortLike s documented semantics". It is
 *    **tested but not gated**: the 100% coverage threshold covers `src/core/**`,
 *    `src/components/**` and `src/hooks/**`, and `electron/**` is outside it.
 *
 * 2. **The placement assumption underneath the whole seam was never checked, and
 *    it does not hold yet.** This module is written as though main will `import`
 *    it. Main cannot. `electron/tsconfig.json` compiles with
 *    `module: "NodeNext"`, because Node resolves those files and the sandboxed
 *    preload's `.cjs` emit depends on it — and **every relative import under
 *    `src/` is extensionless**, because a bundler resolves the renderer.
 *    Compiling `src/core/ipc/AuthoritativeStore.ts` into that program was tried
 *    and answers `TS2835: Relative import paths need explicit file extensions …
 *    Did you mean '../types.js'?` on every relative import in the graph, before
 *    any question of `lib` or of React arises. So `electron/main/portAdapter.ts`
 *    restates `PortLike`'s two members structurally rather than importing them,
 *    and the restatement is pinned to this file's exact spelling by the test
 *    above. The two ways out — bundling the main process with the Vite already
 *    in `devDependencies`, or giving `src/`'s relative imports the `.js` suffix
 *    that TypeScript and Vite both resolve back to `.ts` — are recorded in
 *    ADR-0001's Phase 7 amendment, and neither was taken in that phase.
 *
 * **What a `PortLike` implementation is REQUIRED to do, because the design rests
 * on it and an in-process fake could accidentally not do it: it must behave as
 * though the message were structured-cloned.** A fake that hands the same object
 * reference to the other end makes an entire class of defect invisible — a
 * retained prototype, a live getter, a shared mutable array, a React component
 * that "crosses" because nothing ever tried to serialize it. The fakes under
 * `__tests__` therefore call the platform `structuredClone` on every message, so
 * that a value which could not really cross does not silently appear to.
 * *Tests:* `src/core/ipc/__tests__/portLike.test.ts` — "a port that clones
 * strips the null prototype a host-owned record was built with" and "a port that
 * clones refuses a React component reference outright".
 * ============================================================================
 */

/**
 * What a port hands its owner when the other end posts something.
 *
 * `unknown`, never a typed message, and that is the trust boundary: a renderer's
 * port is reachable from renderer code, so the value arriving at main is exactly
 * as untrusted as a plug-in blueprint. `AuthoritativeStore` validates it before
 * anything reads a field off it.
 */
export type PortMessageHandler = (message: unknown) => void;

/**
 * One end of a message channel.
 *
 * `onmessage` is a mutable property rather than an `addEventListener` pair, and
 * that is not only to match `MessagePortMain`:
 * `src/__tests__/noEventListener.test.ts`
 * forbids `addEventListener` in every module under `src/` outside one named
 * allowlist, and a transport seam that needed an exemption would be widening the
 * repository's one global-listener guarantee for a port that is not a DOM event
 * target. A settable handler needs nothing from that allowlist.
 *
 * Exactly one handler, replacing rather than accumulating. Two consumers of one
 * port is not a topology this design has — each renderer owns one port and main
 * owns the other end — and a set of handlers would invite a second reader whose
 * ordering relative to the first nothing defines.
 */
export interface PortLike {
  /**
   * Send `message` to the other end.
   *
   * **The caller must treat this as a structured-clone door**, even where an
   * in-process fake could get away with passing the reference along. Everything
   * this module's callers post is host-owned and primitive-leaved for exactly
   * that reason — see `StoreOperation` in `./protocol`.
   */
  postMessage(message: unknown): void;
  /**
   * Called with each message the other end posts, or `null` for a port nobody is
   * reading.
   *
   * A message posted while this is `null` is DROPPED, not queued. That is the
   * honest in-process model of a renderer that has not finished booting, and it
   * is why `AuthoritativeStore.connect` sends its opening snapshot rather than
   * expecting the replica to ask for one: the connect order is the host's to
   * choose, and the host chooses it after the replica exists.
   */
  onmessage: PortMessageHandler | null;
}
