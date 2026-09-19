import type { ReactElement } from 'react';
import { ExtensionHostBoundary } from '../../core/ActivationContext';
import type { ActiveExtension } from '../../core/ActivationContext';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { RibbonContext } from '../../core/types';
import { FaultBoundary } from '../error/FaultBoundary';

interface ExtensionPaneProps {
  readonly active: ActiveExtension;
  readonly pane: 'pane2' | 'pane3';
  /** Host text naming the surface, for the fault surface. Never plug-in text. */
  readonly label: string;
  readonly context: Readonly<RibbonContext>;
}

/**
 * A plug-in view, inside both boundaries the host is required to wrap it in.
 *
 * ORDER: `FaultBoundary` OUTSIDE `ExtensionHostBoundary`. See decision 5 in
 * `ShellLayout.tsx`'s banner — the inner one throws for a non-string
 * `extensionId`, and a boundary beneath it could not catch its own parent.
 */
export function ExtensionPane({ active, pane, label, context }: ExtensionPaneProps): ReactElement {
  const View = active.blueprint.views[pane];
  return (
    <FaultBoundary boundaryLabel={label} extensionId={active.id} resetKey={active.id}>
      <ExtensionHostBoundary extensionId={active.id}>
        <View shell={active.shell} context={context} />
      </ExtensionHostBoundary>
    </FaultBoundary>
  );
}

/**
 * Body text for a pane with nothing to show.
 *
 * This used to be `text-neutral-500` with a `dark:text-neutral-400` beside it,
 * and that pair is the clearest single illustration of what the token set
 * replaces. `#737373` measured 4.18:1 on the dark pane — under the 4.5:1 WCAG
 * 1.4.3 requires of 12px body text — while measuring fine in light, so the fix
 * had to be a per-theme override written by hand at every muted string in the
 * shell. `--text-muted` is resolved per theme by the generator and validated
 * against all eight surfaces in all three themes, so the override has nothing
 * left to correct and one declaration replaces two.
 */
export function EmptyPane({ children }: { readonly children: string }): ReactElement {
  return <p className={`p-1 text-[12px] leading-5 ${TOKEN_CLASS.mutedText}`}>{children}</p>;
}
