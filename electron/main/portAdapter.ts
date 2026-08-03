/**
 * ============================================================================
 * `MessagePortMain` → `PortLike`. THE SEAM'S OWN PREDICTION, CHECKED.
 * ============================================================================
 * `src/core/ipc/PortLike.ts` predicted this file, wrote the body it expected,
 * and said what it would prove: *"The adapter is therefore ~10 lines living in
 * `electron/`, and it is the only code in the pivot's state design that no unit
 * test covers — which is a statement about ten lines rather than about the
 * design."* It also named the two facts an adapter has to carry: a real
 * `MessagePortMain` hands its handler a `MessageEvent` rather than the message,
 * and the port must be `start()`ed before anything is delivered.
 *
 * **The prediction held on both counts, and the executable half of it is nine
 * lines.** `adaptMessagePort` below is `postMessage` forwarded, `event.data`
 * unwrapped, and `start()` called. Nothing else was needed: the `onmessage`
 * property is settable rather than an `addEventListener` pair, which is what
 * lets a plain object satisfy the interface; and every value crossing is
 * primitive-leaved by construction, so no serializer appears here.
 *
 * **One correction to the prediction, and it is favourable.** The claim that
 * this is "the only code no unit test covers" is now false, and this file is why
 * it is false: `MessagePortMain` is structurally an `EventEmitter` with
 * `on`/`postMessage`/`start`, so a fake satisfies it in five lines and
 * `electron/__tests__/portAdapter.test.ts` exercises the unwrap, the `start` and
 * the late-handler drop with no Electron imported. `electron/**` is outside the
 * 100% coverage gate — the gate covers `src/core/**`, `src/components/**` and
 * `src/hooks/**` — so this is tested rather than gated, and the distinction is
 * stated rather than blurred.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES **NOT** IMPORT, AND THE MEASUREMENT BEHIND IT
 * ---------------------------------------------------------------------------
 * It does not import `PortLike` from `src/core/ipc/PortLike.ts`. It restates the
 * two members structurally, and that is a defect being contained rather than a
 * style choice, so it is written down:
 *
 * **The main process cannot import `src/` at all under its current compilation
 * model.** `electron/tsconfig.json` compiles with `module: "NodeNext"` — it must,
 * because Node resolves these files and the sandboxed preload's `.cjs` emit
 * depends on it — and every relative import under `src/` is *extensionless*,
 * because the renderer is resolved by a bundler. Compiling
 * `src/core/ipc/AuthoritativeStore.ts` into a `NodeNext` program was tried and
 * reports `TS2835: Relative import paths need explicit file extensions … Did you
 * mean '../types.js'?` on **every** relative import in the graph, before any
 * question of `lib` or of React arises.
 *
 * That is a real finding about the seam's PLACEMENT, and it is not a finding
 * about the seam's SHAPE. The interface is right — the adapter really is ten
 * lines. What was never checked in Phase 6 is the assumption underneath it: that
 * main could `import` the module the adapter adapts *for*. It cannot, yet. The
 * ADR-0001 amendment records the two ways out (bundle the main process with the
 * Vite already in `devDependencies`, or give `src/`'s relative imports the `.js`
 * suffix TypeScript and Vite both resolve back to `.ts`) and records that
 * neither was taken in this phase.
 *
 * Restating two members here is bounded and checkable: `PortMessageHandler` and
 * `PortLike` are two lines of type, they are pinned to the spelling in `src/` by
 * `electron/__tests__/portAdapter.test.ts`, and when main can import the real one
 * this declaration is deleted rather than migrated.
 * ============================================================================
 */

/** Structurally identical to `PortMessageHandler` in `src/core/ipc/PortLike.ts`. */
export type PortMessageHandler = (message: unknown) => void;

/** Structurally identical to `PortLike` in `src/core/ipc/PortLike.ts`. */
export interface PortLike {
  postMessage(message: unknown): void;
  onmessage: PortMessageHandler | null;
}

/**
 * The half of `MessagePortMain` this adapter touches.
 *
 * Declared structurally rather than imported from `electron`, so that the
 * adapter's test needs no Electron and so that the three members it actually
 * uses are visible at the top of the file instead of behind a class with
 * thirty.
 */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): unknown;
  start(): void;
}

/**
 * Wrap one end of an Electron `MessageChannelMain` as a `PortLike`.
 *
 * **`start()` is called here and not left to the caller.** A `MessagePortMain`
 * queues nothing until it is started, and `AuthoritativeStore.connect` posts its
 * opening `resync` as its first act — so a port started one line later than it
 * should be loses the snapshot every replica renders from, silently, on a code
 * path that has no error. Starting it inside the adapter makes "the port is
 * live" a property of having one rather than of remembering something.
 *
 * **`onmessage` is a plain property on the returned object, and the handler is
 * read at DELIVERY time.** That is the drop-not-queue semantics `PortLike`
 * documents: a message that arrives before anybody has installed a handler is
 * discarded, which is the honest model of a renderer that has not finished
 * booting. It is also why the arrow below reads `seam.onmessage` rather than
 * capturing it — capturing would freeze whichever handler existed when `adapt`
 * ran, which is `null` in every real call site.
 */
export function adaptMessagePort(port: MessagePortLike): PortLike {
  const seam: PortLike = {
    postMessage: (message: unknown): void => {
      port.postMessage(message);
    },
    onmessage: null,
  };
  port.on('message', (event) => {
    seam.onmessage?.(event.data);
  });
  port.start();
  return seam;
}
