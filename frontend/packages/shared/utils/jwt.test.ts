import { describe, it, expect } from 'vitest';
import { isJwtExpired } from './jwt';

const now = new Date('2026-06-23T12:00:00Z').getTime();
const nowSec = Math.floor(now / 1000);

// Builds an unsigned JWT-shaped string with the given payload (base64url).
function makeJwt(payload: object): string {
  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('isJwtExpired', () => {
  it('treats a missing/empty token as expired', () => {
    expect(isJwtExpired(null, now)).toBe(true);
    expect(isJwtExpired(undefined, now)).toBe(true);
    expect(isJwtExpired('', now)).toBe(true);
  });

  it('returns true for a token whose exp is in the past or exactly now', () => {
    expect(isJwtExpired(makeJwt({ exp: nowSec - 100 }), now)).toBe(true);
    expect(isJwtExpired(makeJwt({ exp: nowSec }), now)).toBe(true);
  });

  it('returns false for a token whose exp is in the future', () => {
    expect(isJwtExpired(makeJwt({ exp: nowSec + 3600 }), now)).toBe(false);
  });

  it('is conservative when it cannot determine expiry', () => {
    // No exp claim
    expect(isJwtExpired(makeJwt({ sub: 'abc' }), now)).toBe(false);
    // Not a JWT shape
    expect(isJwtExpired('saved-token', now)).toBe(false);
    // Malformed payload segment
    expect(isJwtExpired('a.b.c', now)).toBe(false);
  });
});
