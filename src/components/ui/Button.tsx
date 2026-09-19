import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { BUTTON_CLASS, LOADING_BAR_CLASS } from './buttonClasses';
import type { ButtonVariant } from './buttonClasses';

/**
 * ============================================================================
 * A BUTTON THAT KEEPS ITS WIDTH WHILE IT WORKS.
 * ============================================================================
 * The v4 *States* screen draws loading as the label replaced **in place** by
 * its in-progress verb ("Reorder" becomes "Reordering"), with a bar along the
 * button's bottom edge. Not a centred spinner, and not a button that jumps
 * narrower or wider under the pointer that just pressed it.
 *
 * Width is kept by construction rather than by measurement: both labels sit in
 * the same grid cell of an `inline-grid`, and the one not showing is
 * `invisible`, which keeps its box and leaves the accessibility tree. The button
 * is therefore as wide as the wider label in both states, with no
 * `ResizeObserver` and no stored pixel width.
 *
 * While loading the button stays focusable and keeps focus, says `aria-busy`,
 * and ignores activation, so a second press cannot start the work twice. It is
 * not `disabled`: that would repaint it in disabled ink and drop focus to the
 * document, which is what a keyboard user who just pressed Enter least wants.
 *
 * *Tests:* `src/components/__tests__/Button.test.tsx`, and in a real browser
 * `e2e/theme.spec.ts` — "keeps a loading button at its idle width, with its bar
 * inside its own box".
 * ============================================================================
 */

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'type'> {
  /** `quiet` unless this is the one primary action of its surface. */
  readonly variant?: ButtonVariant;
  readonly type?: 'button' | 'submit' | 'reset';
  /** The idle label: a verb in the operator's words. */
  readonly children: ReactNode;
  /** Whether the action is in progress. */
  readonly loading?: boolean;
  /** The in-progress verb shown in place of the label, e.g. "Reordering". */
  readonly loadingLabel?: ReactNode;
  /**
   * Determinate progress from 0 to 1, clamped. Absent, or not a finite number,
   * draws the indeterminate bar.
   */
  readonly progress?: number;
}

/** The determinate bar's width, or `undefined` for the indeterminate bar. */
function barWidth(progress: number | undefined): string | undefined {
  if (progress === undefined || !Number.isFinite(progress)) {
    return undefined;
  }
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`;
}

export function Button({
  variant = 'quiet',
  type = 'button',
  children,
  loading = false,
  loadingLabel,
  progress,
  onClick,
  ...rest
}: ButtonProps): ReactElement {
  const width = barWidth(progress);
  const showsLoadingLabel = loading && loadingLabel !== undefined;
  return (
    <button
      {...rest}
      type={type}
      className={BUTTON_CLASS[variant]}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
    >
      <span className={`col-start-1 row-start-1 ${showsLoadingLabel ? 'invisible' : ''}`}>
        {children}
      </span>
      {loadingLabel === undefined ? null : (
        <span className={`col-start-1 row-start-1 ${showsLoadingLabel ? '' : 'invisible'}`}>
          {loadingLabel}
        </span>
      )}
      {loading ? (
        <span
          aria-hidden="true"
          data-loading-bar={width === undefined ? 'indeterminate' : 'determinate'}
          className={`${LOADING_BAR_CLASS[variant]} ${
            width === undefined ? 'w-full animate-pulse motion-reduce:animate-none' : ''
          }`}
          style={width === undefined ? undefined : { width }}
        />
      ) : null}
    </button>
  );
}
