import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaneWrapper } from '../layout/PaneWrapper';

/**
 * `PaneWrapper` is presentational, so these are DOM-shape assertions and nothing
 * more. What they defend is the part of the pane contract that other components
 * depend on and cannot see: which element is the scroll container, which slots
 * exist, and that the border tokens are the ones the density contract names.
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

  it('carries a 1px neutral border in both themes', () => {
    render(
      <PaneWrapper paneId="pane1" label="Navigation">
        body
      </PaneWrapper>,
    );
    const box = paneBox('Navigation');
    // `border` with no width utility is Tailwind's 1px border.
    expect(box).toHaveClass('border');
    expect(box).toHaveClass('border-neutral-200');
    expect(box).toHaveClass('dark:border-neutral-800');
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

  it('omits both optional slots when neither is declared', () => {
    const { container } = render(
      <PaneWrapper paneId="pane2" label="List">
        body
      </PaneWrapper>,
    );
    expect(container.querySelector('[data-pane-slot="header"]')).toBeNull();
    expect(container.querySelector('[data-pane-slot="drawer"]')).toBeNull();
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
    expect(box).toHaveClass('border-neutral-200');
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
