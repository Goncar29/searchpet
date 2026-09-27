import { escapeHtml } from '../utils/escapeHtml';

// The flyer test only sends double quotes, < > and &. These cover the rest of
// the documented contract: safe in single-quoted attributes too, and any
// value (not just strings) turns into text without throwing.
describe('escapeHtml', () => {
  it('escapes the single quote, so single-quoted attributes are safe too', () => {
    expect(escapeHtml("x' onerror='y")).toBe('x&#39; onerror=&#39;y');
  });

  it('escapes & before the other entities (no double escaping of our own output)', () => {
    expect(escapeHtml('<a href="?a=1&b=2">')).toBe('&lt;a href=&quot;?a=1&amp;b=2&quot;&gt;');
  });

  it('turns null and undefined into an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-string values', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
