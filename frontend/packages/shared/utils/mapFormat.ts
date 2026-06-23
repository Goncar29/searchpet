// ============================================================
// SearchPet — map popup formatters (shared)
// Pure, locale-aware helpers used by the web/mobile map popups.
// No npm imports (only Intl/Math) so they need no vite alias.
// ============================================================

/**
 * Formats a distance in meters into a short, human label.
 * - Under 1 km → whole meters ("850 m").
 * - 1 km and above → kilometers with one decimal, trailing ".0" stripped
 *   ("1 km", "1.2 km", "5.4 km").
 * Negative or non-finite input is clamped to "0 m".
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  // One decimal, but drop a trailing ".0" (1000 → "1 km", not "1.0 km").
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} km`;
}

/**
 * Formats the elapsed time between `iso` and `now` as a localized relative
 * string ("hace 3 horas" / "3 hours ago" / "há 3 horas") using the platform's
 * Intl.RelativeTimeFormat — no manual translation keys needed.
 * Picks the largest sensible unit (seconds → minutes → hours → days → months).
 * Returns an empty string when `iso` is missing or unparseable.
 */
export function formatTimeAgo(iso: string | null | undefined, now: Date, locale: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffSeconds = Math.round((then - now.getTime()) / 1000); // negative = past
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (abs < 60) return rtf.format(Math.round(diffSeconds), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  return rtf.format(Math.round(diffSeconds / 2592000), 'month');
}
