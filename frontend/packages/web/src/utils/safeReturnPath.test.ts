import { describe, it, expect } from 'vitest';
import { safeReturnPath } from './safeReturnPath';

describe('safeReturnPath', () => {
  it.each([
    ['/'],
    ['/pets/123'],
    ['/messages?user=abc'],
    ['/publish?paso=stray-form#top'],
  ])('keeps the same-origin path %s', (raw) => {
    expect(safeReturnPath(raw)).toBe(raw);
  });

  it.each([
    ['null', null],
    ['empty', ''],
  ])('falls back to / when the param is %s', (_label, raw) => {
    expect(safeReturnPath(raw)).toBe('/');
  });

  // Each of these leaves the origin once the browser parses it as a URL.
  it.each([
    ['absolute URL', 'https://evil.example/login'],
    ['protocol-relative', '//evil.example'],
    ['backslash, parsed as a slash', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'pets/123'],
    // The URL parser strips tab and newline, so "/\t/x" becomes "//x".
    ['tab between the slashes', '/\t/evil.example'],
    ['newline between the slashes', '/\n/evil.example'],
    ['DEL character', '/\x7f/evil.example'],
  ])('rejects a %s and falls back to /', (_label, raw) => {
    expect(safeReturnPath(raw)).toBe('/');
  });
});
