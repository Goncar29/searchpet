import { test, expect } from '@playwright/test';

// The backend hands out share URLs as <APP_URL>/share/<token>. In production a
// vercel.json rewrite usually consumes that path at the edge, which is why this
// regressed silently: neither `vite dev` nor `vite preview` reads vercel.json, so
// the path used to match no route at all and render a blank page. The same gap is
// reachable in production whenever sw.js serves the cached shell for an offline
// navigation and the rewrite is never reached. This suite runs against `vite
// preview`, which exercises that no-rewrite path directly.
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('a copied /share/<token> link lands on the shared pet page', async ({ page }) => {
  await page.goto(`/share/${TOKEN}`);

  await expect(page).toHaveURL(`/pet/${TOKEN}`);

  // The URL alone is not the thing worth asserting. If /pet/:token were renamed or
  // removed, the redirect would still fire, the URL would still read /pet/<token>,
  // and this test would stay green while the user got the blank page the redirect
  // was added to prevent — a success signal emitted without the check happening.
  // What proves the landing works is that SharedPetPage actually rendered. The
  // token above belongs to no pet, so it renders the not-found heading. CI runs a
  // real backend and answers immediately; a local run without one waits out React
  // Query's retries first, measured at ~13s, hence the generous timeout.
  await expect(page.getByRole('heading')).toBeVisible({ timeout: 20_000 });
});

// api/share.js rejects anything that is not 32 hex chars and serves the home page
// instead. The SPA route mirrors that check, so a hand-typed token cannot resolve
// into an unrelated route or into no route at all.
test('a malformed /share/<token> goes home instead of nowhere', async ({ page }) => {
  await page.goto('/share/..%2F..%2Fmap');

  await expect(page).toHaveURL('/');
});
