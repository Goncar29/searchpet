// ============================================================
// SearchPet — is there a newer APK than the one installed?
//
// The APK ships from GitHub releases, not a store, so nothing tells the user a
// new version exists. The release guard in build-apk.yml keeps each tag equal
// to app.json's version, so the tag of the latest release is the version to
// compare against. `releases/latest` skips drafts and prereleases.
// ============================================================

export const LATEST_RELEASE_API =
  'https://api.github.com/repos/Goncar29/searchpet/releases/latest';

/** Always the newest release's APK: GitHub redirects it to the current asset. */
export const APK_DOWNLOAD_URL =
  'https://github.com/Goncar29/searchpet/releases/latest/download/SearchPet.apk';

/** "1.2.0" → [1, 2, 0]; anything else (prerelease suffix included) → null. */
function parseVersion(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return version.split('.').map(Number);
}

/**
 * True only when both versions parse and `latest` is strictly newer. An
 * unreadable version never claims an update: a false "new version" would send
 * the user to download the same APK they already have.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * The latest release's version without its "v", or null on any failure: no
 * network, a GitHub error or rate limit (60 requests/hour per IP without a
 * token), or a body without a tag. Failing quietly is the point — an update
 * notice is never worth an error on screen.
 */
export async function fetchLatestVersion(fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown };
    if (typeof body?.tag_name !== 'string') return null;
    return body.tag_name.replace(/^v/, '');
  } catch {
    return null;
  }
}
