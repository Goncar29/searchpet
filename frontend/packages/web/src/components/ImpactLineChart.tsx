import type { ImpactMonthlyCount } from '@shared/types';

interface ImpactLineChartProps {
  data: ImpactMonthlyCount[];
  color?: string;
  height?: number;
  // Accessible name for the chart. Pass the already-translated label so screen
  // readers get it in the user's language (the component has no i18n of its own).
  label?: string;
}

// Hand-rolled SVG line chart — zero dependencies. Renders a filled area under a
// polyline. The viewBox is a fixed 600xheight coordinate space scaled to 100%
// width by the browser, so it is responsive without JS.
export function ImpactLineChart({ data, color = '#22c55e', height = 160, label = 'Reunions per month' }: ImpactLineChartProps) {
  if (data.length === 0) return null;

  const width = 600;
  const pad = 6;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const coords = data.map((d, i) => {
    const x = i * stepX;
    const y = height - pad - (d.count / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(' ');
  const area = `${line} ${width},${height} 0,${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="auto"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon points={area} fill={color} fillOpacity={0.13} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
