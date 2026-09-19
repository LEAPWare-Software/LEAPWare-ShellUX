import type { ExtensionViewProps, LEAPExtensionBlueprintInput } from '../core/types';

/**
 * ============================================================================
 * THE SMALLEST EXTENSION THAT IS A REAL EXTENSION. COPY THIS FILE.
 * ============================================================================
 * This is the on-ramp #52 says the repository did not have. Until it existed the
 * only two examples were `src/mocks/MailPlugin.tsx` and
 * `src/mocks/DatabasePlugin.tsx` — around a thousand lines each, and *verification
 * remotes* rather than samples: their job is to exercise the host's edges, so they
 * carry seeded catalogues, running timers, a deliberately throwing renderer and a
 * payload channel. Everything an author has to read past to find the contract.
 *
 * **The contract is five keys and two components, and that is what is below.**
 * Nothing here is elided, nothing is pseudo-code, and it is registered and
 * rendered by `src/examples/__tests__/HelloExtension.test.tsx` — so if this file
 * stops being a working extension, that test fails rather than a reader finding
 * out. An example nobody runs is a promise, and this repository has a rule about
 * those.
 *
 * WHAT THE HOST REQUIRES OF YOU, IN FULL:
 *
 *   id             matches `EXTENSION_ID_PATTERN`, unique across the registry
 *   name           display text, rendered as a text node
 *   version        opaque to the host
 *   navigationTree the rows your extension puts in pane 1
 *   commands       what you contribute to the four command surfaces
 *   views          `pane2` and `pane3`, both required
 *
 * WHAT YOU DO NOT DO, AND CANNOT:
 *
 *  - You do not import anything from `src/core/` except **types**. This file's
 *    single import is `import type`, which compiles to nothing. An extension that
 *    reaches for `useShellStore` or the registry has left the contract.
 *  - You do not receive host internals. Your views are handed `shell` — a
 *    deep-frozen `IShellAPI` scoped to you — and `context`, an immutable snapshot.
 *    That is the whole surface.
 *  - You do not style the shell. Colours, spacing and typography come from the
 *    host's token classes; a hard-coded colour here is a theme that breaks in the
 *    other three.
 *
 * THE ONE THING TO COPY MOST CAREFULLY: **every string you supply is untrusted
 * from the host's point of view**, so it reaches the DOM as a JSX text node and
 * never as markup, a URL or an attribute that could execute. `icon` is a lookup
 * key into a host-owned table — you supply `'box'`, the host decides what that
 * draws — which is why an unknown key renders a fallback glyph rather than
 * nothing, and why no icon you name can ever be a path this module controls.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHOW, so that you know where to go next rather
 * than assuming it is unsupported: persisted per-extension state, the structured
 * payload channel that lets pane 2 and pane 3 share state across a process split,
 * badge counts, navigation metrics, `when` expressions, hotkey chords and
 * selection-scoped commands. All are documented in `DEVELOPER.md`, and all are
 * demonstrated by the two verification remotes — which are the right thing to
 * read *second*. Nor does it declare the optional `lifecycle` hooks or call
 * `setNavigationTree` and `clearBadge` (host contract 1.1): an extension with no
 * timer, connection or user-created folder has nothing to put in them, and an
 * empty hook would teach the wrong reflex. `DEVELOPER.md`, "Lifecycle hooks",
 * shows them in use.
 * ============================================================================
 */

/**
 * A pane-2 view. Two rows, and the selection lives in host context rather than in
 * this module — which is the point: `shell.setSelectedItem` publishes it, and
 * pane 3 reads it back through `context` without the two components knowing each
 * other.
 */
function HelloList({ shell, context }: ExtensionViewProps): React.ReactElement {
  return (
    <ul>
      {['first', 'second'].map((id) => (
        <li key={id}>
          <button
            type="button"
            aria-pressed={context.selectedItemId === id}
            onClick={(): void => {
              shell.setSelectedItem(id);
            }}
          >
            Item the {id}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A pane-3 view. Reads the selection the list published; owns nothing. */
function HelloDetail({ context }: ExtensionViewProps): React.ReactElement {
  return (
    <p>
      {context.selectedItemId === null
        ? 'Nothing selected.'
        : `You selected the ${context.selectedItemId} item.`}
    </p>
  );
}

/**
 * The manifest, and the only export a module needs.
 *
 * Frozen because the registry copies what it reads and a manifest that changes
 * after registration is a manifest the host and the module disagree about.
 * Freezing is not what makes it safe — the host re-validates every field at the
 * door, over plain JavaScript — it is what stops *this* module from being the
 * one that drifts.
 */
export const HelloExtension: LEAPExtensionBlueprintInput = Object.freeze({
  id: 'hello-example',
  name: 'Hello Extension',
  version: '1.0.0',
  navigationTree: [
    { id: 'greetings', label: 'Greetings', icon: 'box' },
    { id: 'farewells', label: 'Farewells', icon: 'layers' },
  ],
  commands: [
    {
      id: 'clear-selection',
      label: 'Clear selection',
      icon: 'close',
      // A pure function of the host context. It must not read this module's own
      // state: a command surface re-renders on host context change, not on
      // yours, so a predicate closing over module state is evaluated against a
      // stale snapshot and produces a surface that lies.
      isVisible: (ctx): boolean => ctx.selectedItemId !== null,
      onExecute: (_ctx, shell): void => {
        shell.setSelectedItem(null);
      },
    },
  ],
  views: { pane2: HelloList, pane3: HelloDetail },
});
