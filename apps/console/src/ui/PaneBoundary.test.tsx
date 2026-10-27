import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaneBoundary } from './PaneBoundary';

function Boom(): never {
  throw new Error('pane exploded');
}

describe('PaneBoundary', () => {
  it('contains a pane failure and names it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PaneBoundary name="Routing">
        <Boom />
      </PaneBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Routing unavailable');
    expect(screen.getByText('pane exploded')).toBeInTheDocument();
  });
});
