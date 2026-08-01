import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { ShellLayout } from '../components/layout/ShellLayout';
import { ShellHostProvider } from '../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../core/RegistryContext';
import type { LEAPExtensionBlueprint } from '../core/types';
import { DatabasePlugin } from '../mocks/DatabasePlugin';
import { MailPlugin } from '../mocks/MailPlugin';

/**
 * ============================================================================
 * THE DEV-ONLY FIXTURE SURFACE. NOT PART OF THE PRODUCTION BUNDLE.
 * ============================================================================
 * `src/App.tsx` registers no extension, by design — the host is a shell, and the
 * shell it renders in production is an empty one. That makes it an unusable
 * target for the browser lane: there are no contextual ribbon actions to
 * overflow, no rows to select and no hotkey to dispatch, so every assertion that
 * matters would be vacuous against it.
 *
 * This component is `App` with the two verification remotes in `src/mocks/`
 * registered, and it is what `e2e/` drives.
 *
 * **How "dev-only" is enforced, and why it is not an environment variable.**
 * ADR-0002 forbids a local-environment dependency without a working default, so
 * a `VITE_MOCKS=1` switch was not an option. Instead this surface is reached
 * through its own HTML document, `dev.html`, and Vite's production input is
 * `index.html` alone — `build.rollupOptions.input` is left at its default, so a
 * root HTML file that `index.html` does not reference is served by the dev
 * server and is **not** emitted into `dist/`. Nothing here is imported by
 * `src/main.tsx` or by `src/App.tsx`, so what the production bundle renders is
 * exactly what it rendered before this file existed. There is no flag to set and
 * no way for a mock to reach a user.
 *
 * This file registers plug-ins. It asserts nothing and claims nothing: it is a
 * test fixture, not a second host surface.
 * ============================================================================
 */

/** The two verification remotes, in the order pane 1 lists them. */
const FIXTURE_EXTENSIONS: readonly LEAPExtensionBlueprint[] = Object.freeze([
  MailPlugin,
  DatabasePlugin,
]);

/**
 * Registers each blueprint once, from inside the provider, exactly as a plug-in
 * would — the same shape `src/__tests__/IntegrationSuite.test.tsx` uses.
 *
 * `register` returns a discriminated union and never throws, so a failure is
 * reported rather than caught. Swallowing one would present as "the shell
 * renders but pane 1 is empty", which is a considerably worse thing to debug
 * from a browser test than a console error naming the extension.
 */
function Registrar(): null {
  const registry = useRegistry();
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) {
      return;
    }
    registered.current = true;
    for (const blueprint of FIXTURE_EXTENSIONS) {
      const result = registry.register(blueprint);
      if (!result.ok) {
        console.error(`ShellUX dev fixture: "${blueprint.id}" did not register.`, result.error);
      }
    }
  }, [registry]);

  return null;
}

/**
 * The provider order is load-bearing and is the same as `src/App.tsx`'s.
 * `ShellHostProvider` resolves blueprints through the registry, so it must sit
 * inside `ExtensionRegistryProvider`; inverting the two throws at mount.
 */
export function DevShell(): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <Registrar />
        <ShellLayout />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}
