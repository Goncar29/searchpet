import { describe, it, expect } from 'vitest';
import { formatDistance, formatTimeAgo } from './mapFormat';

describe('formatDistance', () => {
  it('shows whole meters under 1 km', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(123.7)).toBe('124 m');
  });

  it('shows kilometers with one decimal at/over 1 km, dropping a trailing .0', () => {
    expect(formatDistance(1000)).toBe('1 km');
    expect(formatDistance(1200)).toBe('1.2 km');
    expect(formatDistance(5400)).toBe('5.4 km');
    expect(formatDistance(10000)).toBe('10 km');
  });

  it('clamps invalid input to 0 m', () => {
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(Infinity)).toBe('0 m');
  });
});

describe('formatTimeAgo', () => {
  const now = new Date('2026-06-23T12:00:00Z');

  it('returns empty string for missing/invalid dates', () => {
    expect(formatTimeAgo(null, now, 'en')).toBe('');
    expect(formatTimeAgo(undefined, now, 'en')).toBe('');
    expect(formatTimeAgo('not-a-date', now, 'en')).toBe('');
  });

  it('buckets into the largest sensible unit (en locale)', () => {
    expect(formatTimeAgo('2026-06-23T11:58:00Z', now, 'en')).toMatch(/2 minutes ago/);
    expect(formatTimeAgo('2026-06-23T10:00:00Z', now, 'en')).toMatch(/2 hours ago/);
    expect(formatTimeAgo('2026-06-20T12:00:00Z', now, 'en')).toMatch(/3 days ago/);
  });

  it('localizes the output (es)', () => {
    expect(formatTimeAgo('2026-06-23T10:00:00Z', now, 'es')).toMatch(/hace 2 horas/i);
  });
});
