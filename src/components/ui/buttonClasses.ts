import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

/**
 * ============================================================================
 * THE SHELL'S TWO BUTTONS, AS CLASS STRINGS.
 * ============================================================================
 * DESIGN.md §5 has two buttons, and one of them is the default: **quiet**
 * (content-white, primary ink, 1px default rule) is what a button is, and
 * **primary** (petrol fill) is the one action a surface is for. The One
 * Primary Rule, "at most one petrol-filled control per surface", is a rule a
 * reviewer applies at the call site; nothing here can count a surface.
 *
 * Both share one box, so a quiet button and a primary button side by side are
 * the same size: 24px tall, a 1px border on both (transparent on primary), and
 * 11px of padding inside it, which is the 12px of DESIGN.md measured from the
 * outer edge. A disabled button draws a subtle rule, so the primary's border
 * exists at rest precisely so that disabling it does not move a pixel.
 *
 * The box is an `inline-grid` because `Button.tsx` stacks its idle label and its
 * loading label in one cell: the button is as wide as the wider of the two in
 * both states, so it keeps its width while loading.
 *
 * The states, and where each is measured in a real browser, since jsdom paints
 * none of them:
 *
 *  - hover and pressed: one surface step each. *Tests:* `e2e/theme.spec.ts` —
 *    "paints pressed one step past hover, on a quiet and on a primary button".
 *  - focus: the two-tone ring on `:focus-visible` only. *Tests:*
 *    `e2e/focus-visibility.spec.ts` — "paints no ring on a mouse click and the
 *    two-tone ring on a Tab, in the light theme", and in dark and high contrast.
 *  - disabled: `--text-disabled` ink at full opacity. *Tests:* `e2e/theme.spec.ts`
 *    — "draws a disabled button in disabled ink at full opacity".
 *  - loading: `Button.tsx`.
 * ============================================================================
 */

/** Which of the two buttons. */
export type ButtonVariant = 'primary' | 'quiet';

/** The box both variants share: size, type, radius, focus and the micro transition. */
const BUTTON_BOX =
  'relative inline-grid h-6 flex-none items-center justify-items-center overflow-hidden ' +
  'whitespace-nowrap rounded-md border px-[11px] text-[12px] font-medium leading-4 ' +
  'transition-[color,background-color,border-color,box-shadow] duration-micro ease-shell ' +
  `motion-reduce:transition-none disabled:cursor-default ${TOKEN_CLASS.controlFocusRing} ` +
  TOKEN_CLASS.buttonDisabled;

/** The complete class of each button, every state included. */
export const BUTTON_CLASS: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  primary:
    `${BUTTON_BOX} ${TOKEN_CLASS.buttonPrimaryRest} ${TOKEN_CLASS.buttonPrimaryHover} ` +
    TOKEN_CLASS.buttonPrimaryPressed,
  quiet:
    `${BUTTON_BOX} ${TOKEN_CLASS.buttonQuietRest} ${TOKEN_CLASS.buttonQuietHover} ` +
    TOKEN_CLASS.buttonQuietPressed,
});

/**
 * The loading bar along the button's bottom edge, inside its own box.
 *
 * `absolute` against the button's `relative`, and the button's `overflow-hidden`
 * plus its radius clip it, so it can never paint outside the control it belongs
 * to. 2px, the canvas's height.
 */
export const LOADING_BAR_CLASS: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  primary: `absolute bottom-0 left-0 h-0.5 ${TOKEN_CLASS.buttonLoadingBarPrimary}`,
  quiet: `absolute bottom-0 left-0 h-0.5 ${TOKEN_CLASS.buttonLoadingBarQuiet}`,
});
