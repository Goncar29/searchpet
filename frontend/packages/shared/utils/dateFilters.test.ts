import { describe, it, expect } from 'vitest';
import { startOfDayISO, endOfDayISO } from './dateFilters';

describe('startOfDayISO', () => {
  it('maps a date-only input to UTC start of day', () => {
    expect(startOfDayISO('2026-06-15')).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('endOfDayISO', () => {
  it('maps a date-only input to UTC end of day (inclusive of the whole day)', () => {
    expect(endOfDayISO('2026-06-15')).toBe('2026-06-15T23:59:59.999Z');
  });

  it('lands strictly after start of day for the same date', () => {
    expect(new Date(endOfDayISO('2026-06-15')).getTime()).toBeGreaterThan(
      new Date(startOfDayISO('2026-06-15')).getTime()
    );
  });

  it('keeps the end bound within the same calendar day', () => {
    expect(endOfDayISO('2026-06-15').startsWith('2026-06-15')).toBe(true);
  });
});
