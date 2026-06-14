import { test, expect } from '@playwright/test';
import { uniqueEmail, seedUser, loginAs, getToken, seedStray, markFound, seedStory } from './helpers';

// Cross-stack proof of the per-user story like toggle (Slice 2, PR #2).
//
// The heart is a TOGGLE driven by the server's `liked_by_me`: liking fills it
// and bumps the count, clicking again unlikes and restores it. Because the UI
// flips to "unlike" after the first like, a user can never inflate a story past
// one like from the client — the backend's recompute-based counter (proven by
// the Go integration tests) is what the UI mirrors. This spec verifies that the
// count never drifts across a like/unlike cycle and that the truth survives a
// reload (server-sourced, not just optimistic).
test.describe('Story likes', () => {
  const password = 'password123';
  let email: string;
  let storyTitle: string;

  test.beforeAll(async () => {
    email = uniqueEmail();
    await seedUser(email, password);
    const token = await getToken(email, password);

    // A story can only be told about a FOUND pet, so seed a stray, mark it
    // found, then create the story the test will like.
    const petId = await seedStray(token, `LikeStray-${Date.now()}`);
    await markFound(token, petId);
    storyTitle = `LikeStory-${Date.now()}`;
    await seedStory(token, petId, storyTitle, 'Volvió a casa gracias a la comunidad.');
  });

  test('like fills the heart and bumps the count; unlike restores it without drift', async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/stories');

    // Target this run's story card by its unique title, then its like button.
    const card = page.locator('a', { hasText: storyTitle });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const likeButton = card.getByRole('button', { name: /me gusta/i });

    // Initial state: nobody has liked it yet — outline heart, count 0.
    await expect(likeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(likeButton).toContainText('🤍');
    await expect(likeButton).toContainText('0');

    // Like → filled heart, count 1 (server truth after reconcile).
    await likeButton.click();
    await expect(likeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(likeButton).toContainText('❤️');
    await expect(likeButton).toContainText('1');

    // The count is server-sourced, not just optimistic: a reload still shows 1.
    await page.reload();
    const reloadedLiked = page.locator('a', { hasText: storyTitle }).getByRole('button', { name: /me gusta/i });
    await expect(reloadedLiked).toHaveAttribute('aria-pressed', 'true');
    await expect(reloadedLiked).toContainText('1');

    // Unlike → back to outline heart, count 0 (no drift to 2, no negative).
    await reloadedLiked.click();
    await expect(reloadedLiked).toHaveAttribute('aria-pressed', 'false');
    await expect(reloadedLiked).toContainText('🤍');
    await expect(reloadedLiked).toContainText('0');

    // Reload once more: the unlike persisted, count stays 0.
    await page.reload();
    const reloadedUnliked = page.locator('a', { hasText: storyTitle }).getByRole('button', { name: /me gusta/i });
    await expect(reloadedUnliked).toHaveAttribute('aria-pressed', 'false');
    await expect(reloadedUnliked).toContainText('0');
  });
});
