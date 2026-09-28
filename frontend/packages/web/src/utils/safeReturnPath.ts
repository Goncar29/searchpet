/**
 * Validates the `returnUrl` query param before navigating to it after login.
 *
 * Only a same-origin absolute path is allowed: it must start with a single
 * `/`. Anything else falls back to `/`:
 * - `//host` and `/\host` are protocol-relative once the browser parses them
 *   (the URL parser treats a backslash as a slash);
 * - control characters are rejected outright, because the URL parser strips
 *   tab and newline, so `/\t/host` would become `//host`;
 * - schemes (`https:`, `javascript:`) and relative paths do not start with `/`.
 */
export function safeReturnPath(raw: string | null): string {
  if (!raw || raw[0] !== '/') return '/';
  if (raw[1] === '/' || raw[1] === '\\') return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return '/';
  return raw;
}
