import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SuccessStory } from '@shared/types';
import { Icon } from './Icon';

/**
 * Photo for a success story, in the order that tells the story best: the
 * "after" shot first (a reunion is best told by its happy ending), then the
 * pet's own photo, then the "before".
 *
 * The API stores an empty string — not null — for a photo that was never set,
 * so an empty value must not count as a photo: `<img src="">` resolves against
 * the page URL and draws as a broken image.
 *
 * That is guarded TWICE, and measured: `||` (which rejects `''`, where `??`
 * would keep it) and the truthiness check on `cover` at the call site. Flipping
 * either one alone still renders correctly; the regression test only goes red
 * when both flip together. Do not "simplify" one away on the grounds that the
 * other covers it — that leaves a single point of failure with a test that
 * says nothing.
 */
function storyCover(story: SuccessStory): string | undefined {
  return story.photo_after || story.pet_photo || story.photo_before || undefined;
}

type StoryCardProps = {
  story: SuccessStory;
  /** Where the whole card navigates to. */
  to: string;
  /**
   * Makes the like count an interactive toggle. Omit it for a read-only card
   * (the home feed shows likes but does not let you set them).
   */
  onToggleLike?: (e: MouseEvent, story: SuccessStory) => void;
  likeBusy?: boolean;
};

/**
 * The one success-story card. It exists because there used to be two — one on
 * the home and one on /stories — and they drifted: the home read three photo
 * fields while /stories read only `pet_photo`, so the same story rendered with
 * a photo on one page and without on the other.
 */
export function StoryCard({ story, to, onToggleLike, likeBusy }: StoryCardProps) {
  const { t } = useTranslation('stories');
  const cover = storyCover(story);

  // One badge, not two: `featured` is rarer and editorial, so it wins over the
  // generic "reunited" label when a story has both.
  const badge = (
    <span
      className={`self-start rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-widest ${
        story.featured
          ? 'bg-accent text-yellow-950'
          : cover
          ? 'bg-primary text-white'
          : 'bg-primary/10 text-primary'
      }`}
    >
      {story.featured ? t('badge.featured') : t('badge.reunited')}
    </span>
  );

  const likes = onToggleLike ? (
    <button
      type="button"
      onClick={(e) => onToggleLike(e, story)}
      disabled={likeBusy}
      aria-pressed={story.liked_by_me}
      aria-label={story.liked_by_me ? t('unlike') : t('like')}
      className="inline-flex items-center gap-1.5 transition-colors hover:text-red-400 disabled:opacity-50"
    >
      <Icon name={story.liked_by_me ? 'favorite-filled' : 'favorite'} />
      <span className="font-semibold">{story.like_count}</span>
    </button>
  ) : (
    // Read-only: the icon is aria-hidden, so without this the screen reader
    // announces a bare number with no idea what it counts. The emoji this
    // replaced was announced by name and carried that meaning for free.
    <span className="inline-flex items-center gap-1.5">
      <Icon name={story.liked_by_me ? 'favorite-filled' : 'favorite'} />
      <span className="font-semibold">{story.like_count}</span>
      <span className="sr-only">{t('likeCount', { count: story.like_count })}</span>
    </span>
  );

  return (
    // `h-full` matters: the grid stretches its items, but only if the item
    // itself fills the track. Without it the cards step down like a staircase.
    <Link
      to={to}
      className="group relative flex h-full min-h-72 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
    >
      {cover ? (
        <>
          <img
            src={cover}
            alt={story.pet_name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {/* Scrim: the text below is white over an arbitrary user photo, so it
              needs a guaranteed dark base to stay readable. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="relative mt-auto flex flex-col p-5 text-white">
            {badge}
            <h3 className="font-display text-headline mt-2 line-clamp-2">
              {story.title || story.pet_name}
            </h3>
            <p className="line-clamp-2 text-sm text-white/80">{story.body}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-white/70">
              <span>{new Date(story.created_at).toLocaleDateString()}</span>
              {likes}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col p-5">
          {badge}
          <h3 className="font-display text-headline mt-2 line-clamp-2 text-gray-900 dark:text-gray-100">
            {story.title || story.pet_name}
          </h3>
          <p className="mt-0.5 text-sm font-semibold text-primary">{story.pet_name}</p>
          <p className="mt-2 line-clamp-3 flex-1 text-sm text-gray-600 dark:text-gray-300">
            {story.body}
          </p>
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{new Date(story.created_at).toLocaleDateString()}</span>
            {likes}
          </div>
        </div>
      )}
    </Link>
  );
}
