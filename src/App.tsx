import type { ReactElement } from 'react';
import { FaultBoundary } from './components/error/FaultBoundary';
import { ShellLayout } from './components/layout/ShellLayout';
import { ShellHostProvider } from './core/ActivationContext';
import { ExtensionRegistryProvider } from './core/RegistryContext';

/**
 * The host surface: one fault boundary, the two providers, then the shell.
 *
 * Order is not a preference. `ShellHostProvider` resolves blueprints through the
 * registry and watches the registry's revision so that unregistering an
 * extension revokes its handle, so it must sit INSIDE
 * `ExtensionRegistryProvider`. Inverting the two throws
 * "useRegistry must be called inside an <ExtensionRegistryProvider>" at mount.
 *
 * Nothing is registered here. The shell renders with an empty registry — no
 * extensions, no active extension, an empty ribbon on the trailing side and
 * three valid panes — and the mock extensions that fill it are ISSUE-005.
 *
 * **Persistence is deliberately not composed here, and this file used to be
 * named as one of the two that did not consume it.** `ShellLayout` takes an
 * optional `engine` prop and falls back to `getDefaultHydrationEngine()`, the
 * process-wide engine over `localStorage`; passing that same singleton down from
 * here would add an import and change nothing at runtime. What DOES belong here
 * is the fact that there is exactly one of them: two engines over one storage
 * entry would be two views of the layout that never observe each other's writes,
 * which is the same reasoning `ShellHostProvider` uses for owning one store. A
 * second shell in one page is the case the prop exists for, and there is not one.
 * *Tests:* `src/__tests__/App.test.tsx` — "restores a layout the shell persisted
 * through the process-wide engine, with nothing wired up here".
 *
 * ---------------------------------------------------------------------------
 * THE ROOT FAULT BOUNDARY, AND WHY IT IS HERE RATHER THAN ANYWHERE ELSE
 * ---------------------------------------------------------------------------
 * `ShellLayout` already wraps the ribbon and all three panes in their own
 * `FaultBoundary`, so a plug-in view that throws takes down one surface. Three
 * throws had nothing above them at all and were a WHITE SCREEN: one from
 * `ExtensionRegistryProvider`'s render, one from `ShellHostProvider`'s render,
 * and one from `ShellLayout`'s own render body — the body that composes those
 * boundaries, and therefore the body none of them is above.
 *
 * A React boundary only ever catches its own subtree, so the OUTERMOST position
 * in this file is the only one that covers all three. Inside either provider it
 * would miss that provider and the one above it; inside `ShellLayout` it would
 * be the very body that throws. `main.tsx` was considered and rejected: a
 * boundary there would additionally cover a throw in `App`'s own body, but that
 * body is now a single element-creation expression which cannot throw, so it
 * would catch nothing extra while being unreachable from the suite — `main.tsx`
 * needs a real `#root` and is never rendered by a test. An untested boundary
 * that catches nothing is worse than no boundary, so `main.tsx` is left alone.
 *
 * The props are deliberate. `variant` is left at its default `'pane'`, because
 * `'row'` renders no `role="alert"` and no control by design — it is shaped for
 * the inside of the virtualizer's `role="option"` element, which is exactly wrong
 * for a whole-app fallback; `'pane'`'s live region, clipped message and bounded
 * Retry are what a top-level failure wants. `extensionId` is `null` because this
 * surface is host-owned and sits ABOVE the registry: no registry-validated id
 * exists at this point in the tree, and no extension is implicated in a provider
 * or shell-body throw. No `resetKey` is passed at all — nothing above this
 * boundary changes, there is no active-extension value in scope here, and
 * `exactOptionalPropertyTypes` makes omitting the prop and passing `undefined`
 * two different things.
 *
 * **What it still does not catch**, because a boundary described as wider than it
 * is, is worse than none: errors thrown in event handlers; `setTimeout`,
 * `setInterval` and `requestAnimationFrame` callbacks; unhandled promise
 * rejections; anything thrown by the fallback itself; and anything that throws at
 * MODULE-EVALUATION time, before React renders at all — including `main.tsx`'s
 * own missing-`#root` throw, which happens before `createRoot(…).render(…)` is
 * ever called and which no boundary anywhere can see.
 *
 * *Tests:* `src/__tests__/AppRootBoundary.test.tsx` — "catches a throw from the
 * shell render body that used to leave a blank page" and "catches a throw from
 * inside the host provider, which only a boundary above it can see".
 */
export default function App(): ReactElement {
  return (
    <FaultBoundary boundaryLabel="The shell" extensionId={null}>
      <ExtensionRegistryProvider>
        <ShellHostProvider>
          <ShellLayout />
        </ShellHostProvider>
      </ExtensionRegistryProvider>
    </FaultBoundary>
  );
}
