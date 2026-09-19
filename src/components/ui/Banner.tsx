import type { ReactElement, ReactNode } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

/**
 * ============================================================================
 * A STATUS, INLINE IN THE BLOCK IT IS ABOUT.
 * ============================================================================
 * Four statuses (error, warning, success, info), each drawn the same three ways
 * at once: a status WASH behind the whole banner, a MARK at its leading edge,
 * and a first line in the status INK at focus weight. Colour is never the only
 * channel: the mark's shape and the words both say it (DESIGN.md "pair every
 * status colour with a word or a mark").
 *
 * **No border, and no side stripe.** R7 on the v4 canvas: a block error is a
 * wash without a border. A coloured `border-left` is the side-stripe DESIGN.md
 * §6 forbids by name, and an outline boxes a thing the wash already bounds. So
 * this component writes no border class at all, and the browser lane measures
 * a zero-width border on all four sides rather than trusting that absence.
 * *Tests:* `e2e/theme.spec.ts` — "draws every banner as a wash with no border
 * on any side".
 *
 * The info first line is primary ink, not info ink: there is no `--text-info`
 * token, and `--status-info` on its own wash is declared at 3:1, which is a
 * mark's threshold and not a word's. See `tokenClasses.ts`. Every banner's
 * words are measured on their painted wash in all three themes by
 * `e2e/theme.spec.ts` — "clears 4.5:1 for every banner's words on its own wash,
 * in every theme".
 *
 * An error is `role="alert"`, announced when it appears; the other three are
 * `role="status"`, announced politely.
 * ============================================================================
 */

/** The four statuses a banner can carry. */
export type BannerStatus = 'error' | 'warning' | 'success' | 'info';

export interface BannerProps {
  readonly status: BannerStatus;
  /** The first line: what happened, in the operator's words. */
  readonly title: ReactNode;
  /** The detail under it, if there is any. */
  readonly children?: ReactNode;
  /** Quiet buttons that act on the status, e.g. *Try again*. */
  readonly actions?: ReactNode;
}

/** Wash, mark ink and word ink, per status. */
const STATUS_CLASS: Readonly<
  Record<BannerStatus, { readonly wash: string; readonly mark: string; readonly text: string }>
> = Object.freeze({
  error: {
    wash: TOKEN_CLASS.statusDangerWash,
    mark: TOKEN_CLASS.statusDangerMark,
    text: TOKEN_CLASS.statusDangerText,
  },
  warning: {
    wash: TOKEN_CLASS.statusWarningWash,
    mark: TOKEN_CLASS.statusWarningMark,
    text: TOKEN_CLASS.statusWarningText,
  },
  success: {
    wash: TOKEN_CLASS.statusSuccessWash,
    mark: TOKEN_CLASS.statusSuccessMark,
    text: TOKEN_CLASS.statusSuccessText,
  },
  info: {
    wash: TOKEN_CLASS.statusInfoWash,
    mark: TOKEN_CLASS.statusInfoMark,
    text: TOKEN_CLASS.statusInfoText,
  },
});

/** A 16px stroked glyph in the mark's ink. */
function strokeMark(paths: readonly string[], circle: boolean): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="h-4 w-4 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {circle ? <circle cx="8" cy="8" r="5.5" /> : null}
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A 6px dot centred in a 16px box, filled with the mark's ink. */
const DOT_MARK: ReactElement = (
  <span aria-hidden="true" className="flex h-4 w-4 flex-none items-center justify-center">
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
  </span>
);

/** The mark per status: the canvas's circled bang, triangle, and two dots. */
const STATUS_MARK: Readonly<Record<BannerStatus, ReactElement>> = Object.freeze({
  error: strokeMark(['M8 5v3.5M8 10.8v.1'], true),
  warning: strokeMark(['M8 2.5 14 13H2z', 'M8 6.5v3M8 11.2v.1'], false),
  success: DOT_MARK,
  info: DOT_MARK,
});

export function Banner({ status, title, children, actions }: BannerProps): ReactElement {
  const tone = STATUS_CLASS[status];
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      data-banner-status={status}
      className={`flex gap-2.5 rounded-md px-3 py-2.5 ${tone.wash}`}
    >
      <span data-banner-mark="" className={`flex-none ${tone.mark}`}>
        {STATUS_MARK[status]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p data-banner-title="" className={`text-[12px] font-semibold leading-4 ${tone.text}`}>
          {title}
        </p>
        {children === undefined ? null : (
          <div data-banner-body="" className={`text-[12px] leading-[17px] ${TOKEN_CLASS.appText}`}>
            {children}
          </div>
        )}
        {actions === undefined ? null : <div className="mt-1 flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
