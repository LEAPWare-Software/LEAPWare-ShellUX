import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('App', () => {
  it('renders the placeholder host surface', () => {
    render(<App />);
    expect(screen.getByText('ShellUX host')).toBeInTheDocument();
  });
});
