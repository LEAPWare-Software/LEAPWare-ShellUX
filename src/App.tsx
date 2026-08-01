import type { ReactElement } from 'react';
import { ShellLayout } from './components/layout/ShellLayout';
import { ShellHostProvider } from './core/ActivationContext';
import { ExtensionRegistryProvider } from './core/RegistryContext';

/**
 * The host surface: the two providers, then the shell.
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
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <ShellLayout />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}
