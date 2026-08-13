import { describe, it, expect } from 'vitest';
import { safeExternalUrl } from './safeExternalUrl';

describe('safeExternalUrl', () => {
  it('lets a normal http(s) link through untouched', () => {
    expect(safeExternalUrl('https://veterinaria.uy')).toBe('https://veterinaria.uy');
    expect(safeExternalUrl('http://veterinaria.uy/horarios?x=1')).toBe(
      'http://veterinaria.uy/horarios?x=1',
    );
  });

  it('rejects schemes that execute when clicked', () => {
    expect(safeExternalUrl('javascript:alert(document.cookie)')).toBeUndefined();
    // Case matters here only because it must NOT: the URL parser lowercases the
    // protocol, and a check written against the raw string would miss this one.
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeUndefined();
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeUndefined();
  });

  it('rejects anything without a scheme to vouch for', () => {
    expect(safeExternalUrl('//evil.example')).toBeUndefined();
    expect(safeExternalUrl('veterinaria.uy')).toBeUndefined();
    expect(safeExternalUrl('')).toBeUndefined();
    expect(safeExternalUrl(null)).toBeUndefined();
    expect(safeExternalUrl(undefined)).toBeUndefined();
  });
});
