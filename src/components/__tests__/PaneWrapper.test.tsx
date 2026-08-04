import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { PaneWrapper } from '../layout/PaneWrapper';

/**
 * `PaneWrapper` is presentational, so these are DOM-shape assertions and nothing
 * more. What they defend is the part of the pane contract that other components
 * depend on and cannot see: which element is the scroll container, which slots
 * exist, and that the pane's chrome comes from the shell's token roles rather
 * than from a colour this file spells out for itself.
 *
 * **The colour assertions below are weaker than the ones they replace, and the
 * comment in `src/core/theme/tokenClasses.ts` is the honest account of how.** In
 * short: this file and the component now read the same constant, so an assertion
 * here proves the pane uses the shell's pane-border ROLE and can no longer prove
 * the role resolves to a sane colour. `scripts/check-tokens.mjs` measures the
 * values and `e2e/theme.spec.ts` measures the compiled stylesheet; neither is
 * optional cover, and neither can run in jsdom.
 */

/** The pane box for `label`, i.e. the element carrying the chrome classes. */
function paneBox(label: string): HTMLElement {
  return screen.getByRole('region', { name: label });
}

describe('PaneWrapper', () => {
  it('exposes the pane as a labelled region carrying its pane id', () => {
    render(
      <PaneWrapper paneId="pane2" label="List">
        body
      </PaneWrapper>,
    );
    expect(paneBox('List')).toHaveAttribute('data-pane', 'pane2');
  });

  it('carries a 1px token border, as one declaration rather than a light and dark pair', () => {
    render(
      <PaneWrapper paneId="pane1" label="Navigation">
        body
      </PaneWrapper>,
    );
    const box = paneBox('Navigation');
    // `border` with no width utility is Tailwind's 1px border.
    expect(box).toHaveClass('border');
    expect(box).toHaveClass(TOKEN_CLASS.paneBorder);
    // ...and the surface and text come from the same place, so a theme swap
    // cannot move one and leave another behind.
    expect(box).toHaveClass(TOKEN_CLASS.paneSurface);
    expect(box).toHaveClass(TOKEN_CLASS.paneText);

    // ONE declaration, not two. This is the half of the claim that is not
    // circular: it does not matter what `paneBorder` resolves to, there must be
    // no appearance-conditional variant beside it. Before this change the pane
    // carried `border-neutral-200 dark:border-neutral-800`, and the `dark:`
    // half was exercised by nothing at all — jsdom implements no `matchMedia`
    // and applies no stylesheet — which is issue #67. It is answered by
    // deleting the variant, and this is what stops one coming back.
    for (const token of box.className.split(/\s+/)) {
      expect(token.startsWith('dark:'), `${token} is an untestable variant`).toBe(false);
    }
  });

  it('confines scrolling to the body, so the pane box itself never scrolls', () => {
    const { container } = render(
      <PaneWrapper paneId="pane3" label="Detail">
        body
      </PaneWrapper>,
    );
    expect(paneBox('Detail')).toHaveClass('overflow-hidden');
    const body = container.querySelector('[data-pane-slot="body"]');
    expect(body).not.toBeNull();
    expect(body).toHaveClass('overflow-auto');
    // The automatic-minimum-size escape hatch. Without it a long unbreakable
    // string in a pane widens the whole row and the document grows a horizontal
    // scrollbar, which ISSUE-002 forbids.
    expect(body).toHaveClass('min-w-0');
    expect(paneBox('Detail')).toHaveClass('min-w-0');
  });

  it('omits all three optional slots when none is declared', () => {
    const { container } = render(
      <PaneWrapper paneId="pane2" label="List">
        body
      </PaneWrapper>,
    );
    expect(container.querySelector('[data-pane-slot="header"]')).toBeNull();
    expect(container.querySelector('[data-pane-slot="drawer"]')).toBeNull();
    expect(container.querySelector('[data-pane-slot="footer"]')).toBeNull();
  });

  it('renders a footer outside the scroll container, after the body in document order', () => {
    const { container } = render(
      <PaneWrapper paneId="pane3" label="Detail" footer={<span>Composer</span>}>
        body
      </PaneWrapper>,
    );
    const slot = container.querySelector('[data-pane-slot="footer"]');
    expect(slot).not.toBeNull();
    expect(screen.getByText('Composer')).toBeInTheDocument();

    // The footer must NOT be a descendant of the body, or it scrolls with the
    // ledger, which is the defect it exists to fix (GitHub issue #110).
    const body = container.querySelector('[data-pane-slot="body"]');
    expect(body).not.toBeNull();
    expect(body?.contains(slot ?? null)).toBe(false);

    // And it comes after the body, not before it.
    expect(
      (body as Element).compareDocumentPosition(slot as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('declares the body a column flex container, which is a CLASS assertion and not a layout one', () => {
    // jsdom does not lay out. This asserts the class is present, which is the
    // most this suite can honestly claim: it cannot observe that a child with
    // `flex-1` now fills the pane, because nothing here has height. The
    // behavioural guard is one named case in the browser lane, and it is not
    // the docked-footer case beside it — reverting this class leaves that one
    // green. *Test:* `e2e/shell-layout.spec.ts` — "gives pane 3 a detail stack
    // that reaches the bottom of the scroll container rather than stopping at
    // its content".
    const { container } = render(
      <PaneWrapper paneId="pane3" label="Detail">
        body
      </PaneWrapper>,
    );
    const body = container.querySelector('[data-pane-slot="body"]');
    expect(body).toHaveClass('flex');
    expect(body).toHaveClass('flex-col');
  });

  it('renders a header without a drawer', () => {
    const { container } = render(
      <PaneWrapper paneId="pane2" label="List" header={<span>List header</span>}>
        body
      </PaneWrapper>,
    );
    expect(screen.getByText('List header')).toBeInTheDocument();
    expect(container.querySelector('[data-pane-slot="header"]')).not.toBeNull();
    expect(container.querySelector('[data-pane-slot="drawer"]')).toBeNull();
  });

  it('renders a trailing drawer without a header, so the slots are independent', () => {
    const { container } = render(
      <PaneWrapper paneId="pane3" label="Detail" trailing={<span>Utilities</span>}>
        body
      </PaneWrapper>,
    );
    expect(screen.getByText('Utilities')).toBeInTheDocument();
    expect(container.querySelector('[data-pane-slot="header"]')).toBeNull();
    expect(container.querySelector('[data-pane-slot="drawer"]')).not.toBeNull();
  });

  it('appends caller classes without dropping the shared chrome', () => {
    render(
      <PaneWrapper paneId="pane1" label="Navigation" className="rounded-none">
        body
      </PaneWrapper>,
    );
    const box = paneBox('Navigation');
    expect(box).toHaveClass('rounded-none');
    expect(box).toHaveClass(TOKEN_CLASS.paneBorder);
  });

  it('sets the base type inside the density band', () => {
    render(
      <PaneWrapper paneId="pane2" label="List">
        body
      </PaneWrapper>,
    );
    expect(paneBox('List')).toHaveClass('text-[12px]');
  });
});
