import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { Banner } from '../ui/Banner';
import type { BannerStatus } from '../ui/Banner';

/**
 * ============================================================================
 * THE BANNER'S DOM. ITS PAINT IS MEASURED IN `e2e/theme.spec.ts`.
 * ============================================================================
 * The wash, the absent border and the contrast of its words are painted facts,
 * and this file cannot see any of them. It asserts the three channels are all
 * present, a mark and words beside the colour, and the role each status is
 * announced with.
 * ============================================================================
 */

interface Tone {
  readonly status: BannerStatus;
  readonly role: string;
  readonly wash: string;
  readonly mark: string;
  readonly text: string;
}

const TONES: readonly Tone[] = [
  {
    status: 'error',
    role: 'alert',
    wash: TOKEN_CLASS.statusDangerWash,
    mark: TOKEN_CLASS.statusDangerMark,
    text: TOKEN_CLASS.statusDangerText,
  },
  {
    status: 'warning',
    role: 'status',
    wash: TOKEN_CLASS.statusWarningWash,
    mark: TOKEN_CLASS.statusWarningMark,
    text: TOKEN_CLASS.statusWarningText,
  },
  {
    status: 'success',
    role: 'status',
    wash: TOKEN_CLASS.statusSuccessWash,
    mark: TOKEN_CLASS.statusSuccessMark,
    text: TOKEN_CLASS.statusSuccessText,
  },
  {
    status: 'info',
    role: 'status',
    wash: TOKEN_CLASS.statusInfoWash,
    mark: TOKEN_CLASS.statusInfoMark,
    text: TOKEN_CLASS.statusInfoText,
  },
];

describe('Banner', () => {
  it.each(TONES)(
    'draws a $status banner as wash, mark and words, announced as $role',
    ({ status, role, wash, mark, text }) => {
      render(
        <Banner status={status} title="First line">
          Detail
        </Banner>,
      );
      const banner = screen.getByRole(role);
      expect(banner).toHaveAttribute('data-banner-status', status);
      expect(banner.className).toContain(wash);
      expect(banner.className).not.toMatch(/(?:^|\s)border/);
      expect(banner.querySelector('[data-banner-mark]')?.className).toContain(mark);
      expect(banner.querySelector('[data-banner-mark] [aria-hidden="true"]')).not.toBeNull();
      const title = banner.querySelector('[data-banner-title]');
      expect(title).toHaveTextContent('First line');
      expect(title?.className).toContain(text);
      expect(title?.className).toContain('font-semibold');
      expect(banner.querySelector('[data-banner-body]')).toHaveTextContent('Detail');
    },
  );

  it('draws a stroked glyph for error and warning and a dot for success and info', () => {
    render(
      <>
        <Banner status="error" title="e" />
        <Banner status="warning" title="w" />
        <Banner status="success" title="s" />
        <Banner status="info" title="i" />
      </>,
    );
    const glyph = (status: BannerStatus): Element | null | undefined =>
      document.querySelector(`[data-banner-status="${status}"] [data-banner-mark]`)
        ?.firstElementChild;
    expect(glyph('error')?.tagName.toLowerCase()).toBe('svg');
    expect(glyph('error')?.querySelector('circle')).not.toBeNull();
    expect(glyph('warning')?.tagName.toLowerCase()).toBe('svg');
    expect(glyph('warning')?.querySelector('circle')).toBeNull();
    expect(glyph('success')?.tagName.toLowerCase()).toBe('span');
    expect(glyph('info')?.tagName.toLowerCase()).toBe('span');
  });

  it('renders no body and no action row when given neither, and both when given both', () => {
    const { rerender, container } = render(<Banner status="info" title="Only a title" />);
    expect(container.querySelector('[data-banner-body]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <Banner status="error" title="t" actions={<button type="button">Try again</button>}>
        d
      </Banner>,
    );
    expect(container.querySelector('[data-banner-body]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
