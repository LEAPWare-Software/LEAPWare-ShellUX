import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import App from '../App';
import { useRegistry } from '../core/RegistryContext';
import type { LEAPExtensionBlueprintInput } from '../core/types';
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
 * through its own HTML document, `dev.html`, which is **not** a build input:
 * `vite.config.ts` declares `build.rollupOptions.input` explicitly, and the two
 * entries in it are `index.html` and `paneview.html`. A root HTML file that is
 * not in that list is served by the dev server and is **not** emitted into
 * `dist/`. Nothing here is imported by `src/main.tsx` or by `src/App.tsx`, so
 * what the production bundle renders is exactly what it rendered before this
 * file existed. There is no flag to set and no way for a mock to reach a user.
 *
 * **That input list used to be Vite's default, and the sentence here used to say
 * "`index.html` alone".** Phase 7's process split gave the shell a second
 * production document — the extension surface — so the default stopped being the
 * right answer and the exclusion of `dev.html` became something to state rather
 * than something to inherit. The guarantee is unchanged; what defends it moved
 * from a default to a list.
 *
 * **The dev server also serves this at `/`, and that changes neither half of the
 * paragraph above.** `vite.config.ts` installs a middleware that rewrites the one
 * path `/` to `dev.html`, so `npm run dev` opens a shell with something in it
 * rather than an empty frame. It is registered under `configureServer`, a hook
 * `vite build` never calls, so the production input set is untouched by
 * construction rather than by convention — and it reads no environment variable
 * either, which is the same ADR-0002 argument applied to which document a bare
 * `/` resolves to. `/index.html` is deliberately not rewritten, so the
 * empty-registry shell stays reachable by name.
 * *Tests:* `e2e/dev-routing.spec.ts` — "serves the fixture shell at the bare root,
 * with both remotes registered" and "leaves /index.html on the production shell,
 * whose registry is empty".
 *
 * This file registers plug-ins. It asserts nothing and claims nothing: it is a
 * test fixture, not a second host surface.
 * ============================================================================
 */

/** The two verification remotes, in the order pane 1 lists them. */
const FIXTURE_EXTENSIONS: readonly LEAPExtensionBlueprintInput[] = Object.freeze([
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
 * `App` with the two verification remotes registered, and nothing else.
 *
 * **It renders `App` rather than restating its provider stack**, which it used to
 * do. That stack's order is load-bearing — `ShellHostProvider` resolves
 * blueprints through the registry, so inverting the two throws at mount — and a
 * second copy of a load-bearing order is a second thing to get wrong. `App`
 * takes a `children` slot rendered inside both providers, which is exactly where
 * a plug-in registers itself from, so this file is now the registrar and the
 * import list that reaches the mocks.
 *
 * **It names no surface either**, for the reason `src/main.tsx` gives:
 * `dev.html` is two things — the browser lane's fixture, and the document host
 * chrome's `WebContentsView` loads in a DEVELOPMENT run of the native host,
 * because `electron/main/index.ts` decision 4 points that view at the dev
 * server's root on purpose — and `App` decides which from the presence of the
 * host bridge. A prop here would be a second answer to a question that already
 * has one.
 *
 * **`runsPluginCode` is the one exception to that argument, and it is not a
 * second answer to which surface this is.** It answers a different question
 * `App` has no other way to derive: whether this document also happens to be
 * what host chrome loads in a dev run. `dev.html` is genuinely both the
 * browser-lane fixture (where `Registrar` below registers `lifecycle`-bearing
 * plugins and those hooks must fire) and host chrome's dev-run document
 * (where the packaged-topology guarantee does not apply) — this repo already
 * accepts that as a stated dev-vs-packaged gap, not something to solve here.
 * See ADR-0006 decision 6's amendment for issue #183.
 *
 * A consequence worth naming rather than discovering: this surface is now inside
 * `RootBoundary` too. That is a strict improvement — the fixture used to be the
 * one document in the repository where a throw above the pane boundaries emptied
 * `#root` with nothing to report — and it changes no markup, because the
 * boundary renders its children untouched until something throws.
 */
export function DevShell(): ReactElement {
  return (
    <App runsPluginCode>
      <Registrar />
    </App>
  );
}
