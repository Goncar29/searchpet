// ============================================================
// Date-range filter helpers (shared web + mobile).
// A native <input type="date"> yields a date-only string (YYYY-MM-DD).
// new Date('YYYY-MM-DD') parses as UTC midnight, so sending it raw as the
// `to` bound silently EXCLUDES the selected day (everything after 00:00 is
// "after" the bound). endOfDayISO pushes `to` to 23:59:59.999Z so the range
// is inclusive of the whole chosen day.
// ============================================================

const DAY_MS = 86_400_000;

// startOfDayISO maps a YYYY-MM-DD input to the UTC start-of-day ISO string.
export function startOfDayISO(date: string): string {
  return new Date(date).toISOString();
}

// endOfDayISO maps a YYYY-MM-DD input to the UTC end-of-day ISO string
// (23:59:59.999Z), making a `to` bound inclusive of the selected day.
export function endOfDayISO(date: string): string {
  return new Date(new Date(date).getTime() + DAY_MS - 1).toISOString();
}
