// Single source of truth for status-badge background colors across the web app.
// WCAG AA: white text on each returned background clears the 4.5:1 contrast ratio
// (the audited -600/-700 shades). Keep new statuses here so the palette can't
// drift back to the low-contrast -400/-500 shades on individual pages.
const STATUS_BADGE_BG: Record<string, string> = {
  lost: 'bg-red-600',
  stray: 'bg-amber-700',
  sighting: 'bg-amber-700',
  found: 'bg-green-700',
  archived: 'bg-gray-600',
  registered: 'bg-gray-600',
};

export function statusBadgeBg(status: string): string {
  return STATUS_BADGE_BG[status] ?? 'bg-gray-600';
}
