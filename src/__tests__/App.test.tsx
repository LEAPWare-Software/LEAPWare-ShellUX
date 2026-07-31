import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

/**
 * `App` is two providers and the shell, so what is worth asserting here is the
 * wiring — that the providers are present, nested the right way round, and that
 * the shell renders against an empty registry. Everything the shell DOES is
 * asserted in `src/components/__tests__/ShellLayout.test.tsx`.
 *
 * The previous version of this file asserted the placeholder text "ShellUX host"
 * that ISSUE-001 shipped. That placeholder is gone, so the assertion is
 * rewritten rather than adapted.
 */
describe('App', () => {
  it('mounts the registry and host providers, so the shell renders at all', () => {
    // Both hooks the shell calls on its first line — `useRegistry` and
    // `useActivation` — throw when their provider is missing, so a shell that
    // renders is proof that both providers are above it and in the right order.
    render(<App />);
    expect(screen.getByRole('toolbar', { name: 'Shell ribbon' })).toBeInTheDocument();
  });

  it('renders all three panes with an empty registry', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
  });

  it('leaves the ribbon contextual side empty when nothing is registered', () => {
    const { container } = render(<App />);
    const contextual = container.querySelector('[data-ribbon-side="extension"]');
    expect(contextual).not.toBeNull();
    expect(contextual?.querySelectorAll('button')).toHaveLength(0);
  });
});
