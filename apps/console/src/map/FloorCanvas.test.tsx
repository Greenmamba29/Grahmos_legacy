import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fixtures, planRoutes } from '@terranova/core';
import { FloorCanvas } from './FloorCanvas';

describe('FloorCanvas', () => {
  it('renders rooms, POIs, hazard and the route from the floor contract', () => {
    const floor = fixtures.CITY_CENTER_L2;
    const hazard = { x: 0, y: 19 };
    const plan = planRoutes({ floor, mode: 'occupant', hazardXY: hazard });
    const { container } = render(
      <FloorCanvas
        floor={floor}
        origin={null}
        hazard={hazard}
        primary={plan.primary}
        alternate={plan.alternate}
        clickMode="none"
      />,
    );
    expect(screen.getByRole('img', { name: /SafetyMap floor plan/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.unit-room').length).toBe(6);
    expect(container.querySelectorAll('.poi-exit').length).toBe(3);
    expect(container.querySelector('.hazard-zone')).not.toBeNull();
    expect(container.querySelector('.route-primary')).not.toBeNull();
    expect(container.querySelector('.route-through-hazard')).toBeNull();
  });
});
