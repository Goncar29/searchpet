import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SuccessStory } from '@shared/types';
import { cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
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
  /**
   * Which of the two designs to draw. The two Stitch screens differ on purpose:
   * the home ("Happy Reunions") stacks four tall photo tiles with the text over
   * a gradient, while /stories ("Finales Felices") uses a white panel with the
   * photo on top so the body copy gets room to breathe.
   *
   * `overlay` is the default so that adding this prop cannot change the home by
   * omission — the page that wants the new look has to ask for it.
   */
  variant?: 'overlay' | 'panel';
};

/**
 * The one success-story card. It exists because there used to be two — one on
 * the home and one on /stories — and they drifted: the home read three photo
 * fields while /stories read only `pet_photo`, so the same story rendered with
 * a photo on one page and without on the other.
 */
export function StoryCard({
  story,
  to,
  onToggleLike,
  likeBusy,
  variant = 'overlay',
}: StoryCardProps) {
  const { t } = useTranslation('stories');
  const cover = storyCover(story);

  // One badge, not two: `featured` is rarer and editorial, so it wins over the
  // generic "reunited" label when a story has both.
  //
  // El caso sin foto lleva `dark:text-primary-light` por el mismo motivo que el
  // nombre de la mascota y la franja de abajo, y es el PEOR de los tres: sobre
  // `bg-primary/10` compuesto contra `dark:bg-gray-900` el fondo queda en
  // rgb(34,29,39), donde `text-primary` da 3.45:1 — y esto es texto de 10.4px,
  // o sea normal, así que AA pide 4.5. Con primary-light son 7.35:1.
  //
  // Los otros dos casos no lo necesitan y por eso no lo llevan: `bg-accent` es
  // un amarillo claro con texto `yellow-950`, y `bg-primary` con texto blanco es
  // justo la dirección para la que el primary fue calibrado (4.77:1).
  const badge = (
    <span
      className={`self-start rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-widest ${
        story.featured
          ? 'bg-accent text-yellow-950'
          : cover
          ? 'bg-primary text-white'
          : 'bg-primary/10 text-primary dark:text-primary-light'
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

  const date = <span>{new Date(story.created_at).toLocaleDateString()}</span>;

  if (variant === 'panel') {
    return (
      // `h-full` for the same reason as below: the grid stretches its items only
      // if the item fills the track.
      <Link
        to={to}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
      >
        {cover && (
          <div className="relative aspect-[4/3] overflow-hidden">
            {/* `cloudinaryCardThumb` y no `cover` crudo: el backend sube a
                `w_1200,c_limit` (~107-198 KB por foto en producción), así que
                20 historias servidas al original son ~2-4 MB para llenar cajas
                de 389px. El bandwidth de Cloudinary es el recurso que se paga
                (regla #55).
                `cloudinaryCardThumb` (`c_lfill`) y no `cloudinaryFit` porque
                esta caja es `object-cover`: el `object-fit` decide la
                transformación, no el tamaño. */}
            <img
              src={cloudinaryCardThumb(cover, 'story')}
              alt={story.pet_name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute left-4 top-4">{badge}</div>
          </div>
        )}
        <div className="flex flex-1 flex-col p-5">
          {/* Without a photo there is no image to pin the badge onto, so it
              leads the body instead — the same fallback the overlay uses. */}
          {!cover && <div className="mb-2 flex">{badge}</div>}
          <h3 className="font-display text-headline line-clamp-2 font-semibold text-gray-900 dark:text-gray-100">
            {story.title || story.pet_name}
          </h3>
          {/* Mismo motivo de contraste que la franja de abajo. Este renglón
              es PREEXISTENTE en la rama sin foto: se arregla acá porque es el
              mismo defecto a tres líneas de distancia, y dejar una mitad sin
              tocar es peor que no haber mirado. */}
          <p className="mt-0.5 text-sm font-semibold text-primary dark:text-primary-light">
            {story.pet_name}
          </p>
          <p className="mt-2 line-clamp-3 flex-1 text-sm text-gray-600 dark:text-gray-300">
            {story.body}
          </p>
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            {date}
            {likes}
          </div>
          {/* A <span>, not a link or a button: the whole card is already an
              anchor, so a real one would nest interactive content inside an
              <a> (invalid HTML) and make a screen reader announce the same
              destination twice. It is aria-hidden for that second reason — the
              card's own accessible name already says where this goes. */}
          {/* `dark:text-primary-light` y no `text-primary` a secas: el primary
              está calibrado para BLANCO SOBRE primary (4.77:1), no para primary
              sobre casi-negro, que da 3.72:1 contra `dark:bg-gray-900`. Esto es
              texto de 14px semibold, o sea texto normal, así que WCAG AA pide
              4.5 y no el 3:1 del texto grande — el h1 y el contador sí son
              display y por eso se quedan en `text-primary`. Con primary-light
              son 7.92:1. */}
          <span
            aria-hidden="true"
            className="mt-4 block rounded-lg border border-primary/30 py-2 text-center text-sm font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-white dark:text-primary-light dark:group-hover:text-white"
          >
            {t('readMore')}
          </span>
        </div>
      </Link>
    );
  }

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
              {date}
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
          {/* Mismo motivo de contraste que la franja de abajo. Este renglón
              es PREEXISTENTE en la rama sin foto: se arregla acá porque es el
              mismo defecto a tres líneas de distancia, y dejar una mitad sin
              tocar es peor que no haber mirado. */}
          <p className="mt-0.5 text-sm font-semibold text-primary dark:text-primary-light">
            {story.pet_name}
          </p>
          <p className="mt-2 line-clamp-3 flex-1 text-sm text-gray-600 dark:text-gray-300">
            {story.body}
          </p>
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            {date}
            {likes}
          </div>
        </div>
      )}
    </Link>
  );
}
