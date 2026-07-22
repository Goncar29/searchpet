import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ImpactLineChart } from './ImpactLineChart';

describe('ImpactLineChart', () => {
  it('renders a polyline with one coordinate per data point', () => {
    const data = [
      { month: '2026-05', count: 1 },
      { month: '2026-06', count: 3 },
      { month: '2026-07', count: 2 },
    ];
    const { container } = render(<ImpactLineChart data={data} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(3);
  });

  it('renders nothing when data is empty', () => {
    const { container } = render(<ImpactLineChart data={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
