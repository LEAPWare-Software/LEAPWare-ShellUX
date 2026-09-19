import type { ReactElement } from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

interface ShellResizeHandleProps {
  readonly label: string;
}

/**
 * A divider. Mouse dragging and the window-splitter keyboard pattern both come
 * from the library; see decision 3 in the banner of
 * `ShellLayout.tsx`.
 *
 * THREE THINGS HERE ARE ACCESSIBILITY FIXES, AND ALL THREE ARE EASY TO UNDO BY
 * ACCIDENT.
 *
 * COLOUR. The divider once used the SAME value as the 1px border on the panes
 * either side of it, so it did not read as a control at all — it read as one
 * more pane border, at 1.26:1 against the panes it separates. WCAG 1.4.11 wants
 * 3:1 for a control's visual boundary.
 *
 * It now uses `--control-divider` and `--control-divider-hover`, which are their
 * own token group rather than a shade of `--border-*`. `design/README.md`
 * "Honest limits" item 9 records why: this is a filled 4px bar with hover and
 * drag states, not a border, and folding it into `--border-strong` would have
 * made one token answer to two different measurements. `--control-divider`
 * measures 5.94:1 on `--surface-app` in light and 8.10:1 in dark.
 *
 * The hover and drag states still move AWAY from the page background in each
 * theme — darker in light, lighter in dark — but that direction now lives in the
 * token values rather than in a `dark:` variant here, which is why there are two
 * declarations where there were six.
 *
 * TARGET SIZE. The visual divider stays 4px, because a 24px bar between two
 * panes would look broken. `hitAreaMargins` widens the region the library's own
 * pointer tracking treats as this handle, without touching the painted width:
 * 4 + 12 + 12 = 28px of fine-pointer target, over the 24px WCAG 2.5.8 asks for.
 * The library's defaults are `coarse: 15, fine: 5`, which is 14px and not
 * enough; `coarse` is restated at its default so that the pair is read as one
 * decision rather than as a half-configured object.
 *
 * ORIENTATION. A `separator` reports `aria-orientation="horizontal"` by default,
 * and these are vertical splitters between side-by-side panes. The library
 * spreads unknown props onto the element before setting `role`, so the attribute
 * reaches the DOM and nothing of the library's own is displaced.
 */
export function ShellResizeHandle({ label }: ShellResizeHandleProps): ReactElement {
  return (
    <PanelResizeHandle
      aria-label={label}
      aria-orientation="vertical"
      hitAreaMargins={{ coarse: 15, fine: 12 }}
      className={
        'w-1 flex-none cursor-col-resize outline-none ' +
        `${TOKEN_CLASS.dividerIdle} ${TOKEN_CLASS.dividerHover} ` +
        `${TOKEN_CLASS.dividerFocus} ${TOKEN_CLASS.dividerDrag}`
      }
    />
  );
}
