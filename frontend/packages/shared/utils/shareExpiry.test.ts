import { describe, it, expect } from 'vitest';
import { getExpiryInfo } from './shareExpiry';

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe('getExpiryInfo', () => {
  it('returns no expiry when expiresAt is undefined', () => {
    const info = getExpiryInfo(undefined);
    expect(info.hasExpiry).toBe(false);
    expect(info.isExpired).toBe(false);
  });

  it('returns no expiry for an invalid date string', () => {
    const info = getExpiryInfo('not-a-date');
    expect(info.hasExpiry).toBe(false);
  });

  it('marks a future date as valid with days remaining', () => {
    const info = getExpiryInfo(inDays(20));
    expect(info.hasExpiry).toBe(true);
    expect(info.isExpired).toBe(false);
    expect(info.isWarning).toBe(false);
    expect(info.daysRemaining).toBe(20);
    expect(info.expiresAt).toBeInstanceOf(Date);
  });

  it('warns when fewer than 7 days remain', () => {
    const info = getExpiryInfo(inDays(3));
    expect(info.isWarning).toBe(true);
    expect(info.isExpired).toBe(false);
  });

  it('marks a past date as expired', () => {
    const info = getExpiryInfo(inDays(-1));
    expect(info.isExpired).toBe(true);
  });

  // Regla: mientras la búsqueda siga activa el link no vence (QR impresos)
  it('ignores expiry while the pet is still lost', () => {
    const info = getExpiryInfo(inDays(-10), 'lost');
    expect(info.hasExpiry).toBe(false);
    expect(info.isExpired).toBe(false);
  });

  it('ignores expiry while the pet is still stray', () => {
    const info = getExpiryInfo(inDays(-10), 'stray');
    expect(info.hasExpiry).toBe(false);
    expect(info.isExpired).toBe(false);
  });

  it('applies expiry once the pet is found', () => {
    const info = getExpiryInfo(inDays(-10), 'found');
    expect(info.isExpired).toBe(true);
  });

  it('applies expiry for registered and archived pets', () => {
    expect(getExpiryInfo(inDays(-10), 'registered').isExpired).toBe(true);
    expect(getExpiryInfo(inDays(-10), 'archived').isExpired).toBe(true);
  });
});
