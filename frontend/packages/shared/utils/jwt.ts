// ============================================================
// SearchPet — JWT helpers (shared)
// Client-side `exp` inspection WITHOUT signature verification. Used only to
// avoid showing a logged-in UI for a token the server will already reject.
// NEVER trust this for security decisions — the backend validates the
// signature on every request. No npm imports (atob/JSON only).
// ============================================================

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Returns true when the token is known to have expired.
 * - Missing/empty token → true (nothing usable).
 * - Unreadable token or no numeric `exp` claim → false (conservative: we can't
 *   prove it expired, so we don't force a logout).
 * - Otherwise compares `exp` (seconds) against `nowMs`.
 */
export function isJwtExpired(token: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  return payload.exp * 1000 <= nowMs;
}
