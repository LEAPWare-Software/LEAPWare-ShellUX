import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { Button } from '../ui/Button';
import { BUTTON_CLASS, LOADING_BAR_CLASS } from '../ui/buttonClasses';

/**
 * ============================================================================
 * THE BUTTON'S DOM, AND ONLY ITS DOM.
 * ============================================================================
 * Every visual claim about this button (the pressed step, the ring, the
 * disabled ink, the width kept while loading) is a painted fact jsdom cannot
 * see, and each is measured in `e2e/theme.spec.ts` or
 * `e2e/focus-visibility.spec.ts`. What is asserted here is what the DOM alone
 * decides: which class a variant gets, which label is in the accessibility
 * tree, whether activation is ignored while loading, and which bar is drawn.
 * ============================================================================
 */

describe('Button', () => {
  it('is a quiet type="button" by default, and primary only when asked', () => {
    render(
      <>
        <Button>Adjust stock</Button>
        <Button variant="primary" type="submit">
          Reorder
        </Button>
      </>,
    );
    const quiet = screen.getByRole('button', { name: 'Adjust stock' });
    const primary = screen.getByRole('button', { name: 'Reorder' });
    expect(quiet).toHaveAttribute('type', 'button');
    expect(quiet.className).toBe(BUTTON_CLASS.quiet);
    expect(primary).toHaveAttribute('type', 'submit');
    expect(primary.className).toBe(BUTTON_CLASS.primary);
  });

  it('gives both variants the one focus ring, the disabled ink and no opacity utility', () => {
    for (const className of Object.values(BUTTON_CLASS)) {
      expect(className).toContain(TOKEN_CLASS.controlFocusRing);
      expect(className).toContain(TOKEN_CLASS.buttonDisabled);
      expect(className).not.toMatch(/(?:^|\s)(?:\S+:)?opacity-/);
    }
    expect(BUTTON_CLASS.primary).toContain(TOKEN_CLASS.buttonPrimaryPressed);
    expect(BUTTON_CLASS.quiet).toContain(TOKEN_CLASS.buttonQuietPressed);
  });

  it('runs its click at rest, and ignores it while loading without leaving the tab order', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Reorder</Button>);
    const button = screen.getByRole('button', { name: 'Reorder' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveAttribute('aria-busy');

    rerender(
      <Button onClick={onClick} loading>
        Reorder
      </Button>,
    );
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
  });

  it('keeps both labels in one cell and hides the one not showing', () => {
    const { rerender } = render(<Button loadingLabel="Reordering">Reorder</Button>);
    const [idle, busy] = Array.from(screen.getByRole('button').children);
    expect(idle).toHaveTextContent('Reorder');
    expect(idle?.className).not.toContain('invisible');
    expect(busy).toHaveTextContent('Reordering');
    expect(busy?.className).toContain('invisible');
    for (const label of [idle, busy]) {
      expect(label?.className).toContain('col-start-1 row-start-1');
    }

    rerender(
      <Button loadingLabel="Reordering" loading>
        Reorder
      </Button>,
    );
    expect(idle?.className).toContain('invisible');
    expect(busy?.className).not.toContain('invisible');
  });

  it('keeps the idle label while loading when no loading label is given', () => {
    render(
      <Button variant="primary" loading>
        Reorder
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.children).toHaveLength(2);
    expect(button.children[0]?.className).not.toContain('invisible');
    expect(button.querySelector('[data-loading-bar]')?.className).toContain(
      LOADING_BAR_CLASS.primary,
    );
  });

  it('draws a determinate bar at the clamped progress, and no bar at rest', () => {
    const { rerender, container } = render(
      <Button loading progress={0.55}>
        Reorder
      </Button>,
    );
    const bar = (): HTMLElement | null => container.querySelector('[data-loading-bar]');
    expect(bar()).toHaveAttribute('data-loading-bar', 'determinate');
    expect(bar()).toHaveAttribute('aria-hidden', 'true');
    expect(bar()?.className).toContain(LOADING_BAR_CLASS.quiet);
    expect(bar()?.style.width).toBe('55%');

    rerender(
      <Button loading progress={4}>
        Reorder
      </Button>,
    );
    expect(bar()?.style.width).toBe('100%');
    rerender(
      <Button loading progress={-1}>
        Reorder
      </Button>,
    );
    expect(bar()?.style.width).toBe('0%');

    rerender(<Button progress={0.5}>Reorder</Button>);
    expect(bar()).toBeNull();
  });

  it('draws the indeterminate bar with no progress or a progress that is not a number', () => {
    const { rerender, container } = render(<Button loading>Reorder</Button>);
    const bar = (): HTMLElement | null => container.querySelector('[data-loading-bar]');
    expect(bar()).toHaveAttribute('data-loading-bar', 'indeterminate');
    expect(bar()?.className).toContain('w-full');
    expect(bar()?.style.width).toBe('');

    rerender(
      <Button loading progress={Number.NaN}>
        Reorder
      </Button>,
    );
    expect(bar()).toHaveAttribute('data-loading-bar', 'indeterminate');
  });
});
