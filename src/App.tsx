import type { ReactElement } from 'react';
import { RootBoundary } from './components/error/RootBoundary';
import { ShellLayout } from './components/layout/ShellLayout';
import { ShellHostProvider } from './core/ActivationContext';
import { ExtensionRegistryProvider } from './core/RegistryContext';

/**
 * The host surface: the root boundary, the two providers, then the shell.
 *
 * **`RootBoundary` is outermost, and it has to be.** `ShellLayout` wraps every
 * pane and the ribbon in a `FaultBoundary`, but a boundary never catches itself
 * or a parent — so a throw in either provider's own render, or in `ShellLayout`'s
 * own render above its inner boundaries, unmounted the entire React root and left
 * an empty `#root`. In a browser that is a white page; under the Electron host
 * this project is becoming, it is a blank native window with no address bar and
 * nothing for a user to report.
 *
 * **What is still above it, stated rather than left to be discovered:** this
 * function's own render body, and everything in `src/main.tsx`. A throw at module
 * scope happens during import evaluation, before React runs at all, so no
 * boundary anywhere can see it. This body is a bare `return` today, which is why
 * that band is narrow — but it is not empty, and it is not covered.
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
 */
export default function App(): ReactElement {
  return (
    <RootBoundary>
      <ExtensionRegistryProvider>
        <ShellHostProvider>
          <ShellLayout />
        </ShellHostProvider>
      </ExtensionRegistryProvider>
    </RootBoundary>
  );
}
