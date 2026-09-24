import { useEffect, useReducer, useRef } from 'react';
import type { ReactElement } from 'react';
import { ShellLayout } from '../components/layout/ShellLayout';
import { ShellHostProvider, useActivation } from '../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../core/RegistryContext';
import { useShellContext } from '../core/ShellAPI';
import type { ShellStateStore } from '../core/ShellAPI';
import type { LEAPExtensionBlueprintInput } from '../core/types';
import { DatabasePlugin } from '../mocks/DatabasePlugin';
import { MailPlugin } from '../mocks/MailPlugin';

/**
 * ============================================================================
 * THE EXTENSION SURFACE — PANES 2 AND 3, ONE DOCUMENT, ONE PROCESS.
 * ============================================================================
 * This is the renderer half of the two-process topology. It is loaded by
 * `paneview.html` into the second `WebContentsView`
 * (`electron/main/paneViews.ts`), and it holds both extension panes in **one
 * document** — which is the whole reason two processes were built rather than
 * three.
 *
 * The spike measured what a document boundary between panes 2 and 3 would have
 * cost, on the build this project ships (`spike/topology/RESULTS.md`, Electron
 * 43.2.0 / Chromium 150):
 *
 *  - `Tab` from the last control of one view **wraps inside that view**. It
 *    never reaches the other. Crossing required `webContents.focus()` from main.
 *  - A cross-view `aria-labelledby` did not resolve; Chromium marked the name
 *    source `invalid` and fell back to the control's own text.
 *  - The same markup as two `<iframe>`s in ONE web contents produced
 *    byte-identical readings — so the thing that breaks the reference is the
 *    **document** edge, and putting the panes in one document is what fixes it.
 *
 * A list and its detail is the pair with the strongest relationship in the whole
 * product: it is where a user Tabs most often, and where `aria-activedescendant`
 * and `aria-controls` would naturally be used. Here, both work, because there is
 * one document.
 *
 * ---------------------------------------------------------------------------
 * IT RENDERS `ShellLayout`, AND THE FIRST VERSION OF THIS FILE DID NOT
 * ---------------------------------------------------------------------------
 * That version reimplemented panes 2 and 3 — its own panel group, its own
 * divider, its own fault boundaries, its own empty states. It was a fork, and it
 * cost what a fork costs: the floating toolbar, the block ledger and the omnibox
 * composer all live in `ShellLayout` and were therefore in **neither** view, so
 * Phase 8's chart was absent from the launched application altogether while
 * every test for it passed.
 *
 * What is here now is one line of composition — `<ShellLayout
 * surface="extension" />` — and the layout arithmetic, the fault-boundary order,
 * the density contract and the three-things-stacked shape of pane 3 are the ones
 * that are already tested. See `ShellSurface` in
 * `src/components/layout/ShellLayout.tsx` for what that prop removes and what it
 * keeps.
 *
 * ---------------------------------------------------------------------------
 * THE FOREGROUND CROSSES THE BOUNDARY AS STATE, NOT AS A COMMAND
 * ---------------------------------------------------------------------------
 * Pane 1 is in the other document, so a click on it cannot call this document's
 * activation controller. What it can do — and what it already did before this
 * file existed — is write `activeExtensionId` into the shell store, which is
 * replicated: `RibbonContext.activeExtensionId` is the first field
 * `REPLICATED_FIELD_MEMBERS` in `src/core/ipc/ReplicaStore.ts` lists, and it has
 * been carried across the port since Phase 6.
 *
 * `ExtensionSurface` below is what turns that field back into an activation on
 * this side. It is a SUBSCRIBER to the context rather than a second source of
 * truth: it never decides the foreground, it only reads it and asks its own
 * controller to catch up, so the two documents cannot disagree about which
 * extension is in front for longer than one commit.
 *
 * **The other half of that rule lives in `ShellLayout`**: the extension surface
 * neither restores the persisted foreground nor records it. There is one
 * navigation pane and it is host chrome's, so the persisted `activeExtensionId`
 * is host chrome's too. Two documents over one `localStorage` both restoring it
 * produced an interleaving that ended with both of them showing nothing; the
 * guard and the observation are written up at that effect.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS NOT, STATED SO IT IS NOT MISTAKEN FOR MORE
 * ---------------------------------------------------------------------------
 * **It registers the same two verification remotes `dev.html` does**, for the
 * same reason and with the same limit: the production shell registers no
 * extension, so a surface with an empty registry would render two empty panes
 * and prove nothing about the split. The blueprint itself does not cross the
 * boundary yet — `src/core/ipc/manifest.ts` implements the split that would let
 * it, and consuming that is the next piece of this seam rather than this one.
 *
 * **It lives outside the 100% coverage gate**, in `src/paneview/`, beside
 * `src/dev/` and `src/main.tsx` for the same reason: it is composition, not
 * logic. Every decision it makes about how a pane renders is made by
 * `ShellLayout`, which is inside the gate. What is put here is held to
 * "assembles things that are tested elsewhere".
 * ============================================================================
 */

/** The two verification remotes, in the order pane 1 lists them. */
const FIXTURE_EXTENSIONS: readonly LEAPExtensionBlueprintInput[] = Object.freeze([
  MailPlugin,
  DatabasePlugin,
]);

/**
 * Registers each blueprint once, from inside the provider, exactly as a plug-in
 * would — the same shape `src/dev/DevShell.tsx` uses, and for the same reason.
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
        console.error(
          `ShellUX extension surface: "${blueprint.id}" did not register.`,
          result.error,
        );
      }
    }
  }, [registry]);

  return null;
}

/**
 * Follow the replicated foreground, and render the panes underneath it.
 *
 * Reads `activeExtensionId` off the context — which host chrome's pane 1 wrote,
 * and the transport carried — and asks this document's own activation controller
 * to match it. The guard is what stops a loop: `activate` republishes the field,
 * so acting on a foreground that is already the foreground would post a write for
 * every commit that arrives.
 *
 * `blur()` for `null` rather than nothing at all, because "close extension" is a
 * host command on the other surface and panes 2 and 3 have to empty when it runs.
 *
 * An id this registry does not know activates nothing and is left alone, which is
 * the same answer `selectActiveExtensionId` gives a persisted id that is not
 * registered: a lazily loaded extension is indistinguishable from an absent one,
 * so this runs again on the next commit instead of deciding.
 *
 * ==========================================================================
 * **IT RENDERS `ShellLayout` RATHER THAN SITTING BESIDE IT, AND THE `bump` IS
 * WHY.** This was observed in the launched window rather than reasoned about:
 * the panes stayed empty while every message on the wire was correct.
 *
 * `activate` moves the controller's foreground, which is a REF, and it publishes
 * the new id through the store. In one document those two always happen together
 * with a React event that re-renders anyway. Here they do not: the context
 * ALREADY said `mail` — that is what this component just read, and why it
 * activated — so the publication changed nothing, the store's identity bail-out
 * suppressed the notification correctly, and no subscriber re-rendered. The
 * foreground had moved and nothing on the page knew.
 *
 * So this component owns the re-render: it forces one after it changes the
 * foreground, and the panes are its own children. `bump` cannot loop, because the
 * effect's dependencies do not include it and the guard above is already true by
 * the time it runs.
 * ==========================================================================
 */
function ExtensionSurface(): ReactElement {
  const activation = useActivation();
  const context = useShellContext();
  const wanted = context.activeExtensionId;
  const [, bump] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const current = activation.getActive();
    if ((current === null ? null : current.id) === wanted) {
      return;
    }
    if (wanted === null) {
      activation.blur();
    } else {
      activation.activate(wanted);
    }
    bump();
  }, [activation, wanted]);

  return <ShellLayout surface="extension" />;
}

export interface PaneViewShellProps {
  /**
   * The replicated store this surface reads and writes through.
   *
   * `undefined` only when `paneview.html` is opened with no native host beside
   * it, which nothing does on purpose. The panes then render against a local
   * store, show no extension, and are honest about it rather than pretending to
   * be a whole shell. See `wireExtensionSurface` in `src/App.tsx`.
   */
  readonly store?: ShellStateStore | undefined;
}

/**
 * The provider order is load-bearing and is the same as `src/App.tsx`'s.
 * `ShellHostProvider` resolves blueprints through the registry, so it must sit
 * inside `ExtensionRegistryProvider`; inverting the two throws at mount.
 */
export function PaneViewShell({ store }: PaneViewShellProps = {}): ReactElement {
  return (
    <ExtensionRegistryProvider runsPluginCode>
      <ShellHostProvider store={store}>
        <Registrar />
        <ExtensionSurface />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}
