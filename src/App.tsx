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
