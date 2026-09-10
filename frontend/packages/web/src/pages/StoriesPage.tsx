import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useStories, useLikeStory, useUnlikeStory, useStats } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { SuccessStory } from '@shared/types';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { StoryCard } from '../components/StoryCard';
import { Icon } from '../components/Icon';
import { ListState } from '../components/list/ListState';

export function StoriesPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['stories', 'common']);
  const { isAuthenticated } = useAuth();
  // Sin `select`: `StoryListResponse` es un alias de `SuccessStory[]`, no un
  // sobre paginado — el sobre lo devuelve `getStoriesAdmin`, que es otro
  // endpoint. `ListState` sólo exige `select` cuando el tipo NO es ya un array.
  const storiesQuery = useStories({ limit: 20 });
  const likeStory = useLikeStory();
  const unlikeStory = useUnlikeStory();
  const isToggling = likeStory.isPending || unlikeStory.isPending;

  // The design's headline number. It is read from `/api/stats`, a separate
  // query from the list, so it must fail on its own terms: when stats do not
  // load, the counter is simply absent. Rendering a placeholder zero would
  // state that nobody has ever been reunited — a claim we cannot make from a
  // failed request, and the exact mistake `ListState` exists to prevent one
  // level up.
  //
  // A real zero is hidden too: there is nothing to celebrate yet, and the
  // list's own empty state already says so without a giant 0 above it.
  //
  // The label is `Reencuentros` and NOT "pets reunited", because
  // `stats_handler.go` is explicit that this counts EPISODES: a pet that goes
  // missing twice adds +1 each time. "Lives" or "pets" would turn a count of
  // events into a count of individuals — the same class of overstatement this
  // counter's own visibility guard exists to avoid, one word to the right.
  const stats = useStats();
  const reunited = stats.data?.pets_reunited;
  const showCounter = typeof reunited === 'number' && reunited > 0;

  const toggleLike = (e: React.MouseEvent, story: SuccessStory) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (story.liked_by_me) {
      unlikeStory.mutate(story.id);
    } else {
      likeStory.mutate(story.id);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="text-center mb-10">
        <h1 className="font-display text-display-sm md:text-display font-semibold text-primary mb-3">
          {t('stories:title')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          {t('stories:subtitle')}
        </p>
        {showCounter && (
          <div className="mt-8">
            {/* `Intl.NumberFormat(i18n.language, { useGrouping: true })`, que es
                exactamente lo que hace `ImpactPage` para esta MISMA métrica.
                Las dos mitades importan:
                - `i18n.language` y no `toLocaleString()` pelado, que agrupa
                  según el locale del NAVEGADOR: con Chrome en `en-US` y la app
                  en español se leía `1,200` acá y `1.200` en Impacto.
                - `useGrouping: true` explícito, porque en español CLDR NO
                  agrupa los números de CUATRO dígitos: `toLocaleString('es')`
                  de 1200 da `1200` pelado mientras Impacto muestra `1.200`.
                  Medido — y sólo pasa en español y sólo con 4 dígitos: con
                  12000 las dos formas coinciden, así que un ejemplo más grande
                  habría escondido la diferencia. */}
            <p className="font-display text-display-sm md:text-display font-semibold text-primary">
              {new Intl.NumberFormat(i18n.language, { useGrouping: true }).format(reunited)}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {t('stories:reunitedLabel')}
            </p>
          </div>
        )}
      </div>

      <ListState
        query={storiesQuery}
        loading={
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">{t('stories:loading')}</p>
          </div>
        }
        empty={
          <div className="text-center py-16">
            <PawPlaceholder className="w-16 mx-auto mb-4" />
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
              {t('stories:empty.title')}
            </p>
            <p className="text-gray-500 dark:text-gray-400">{t('stories:empty.hint')}</p>
          </div>
        }
      >
        {(stories) => (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stories.map((story: SuccessStory) => (
              <StoryCard
                key={story.id}
                story={story}
                to={`/stories/${story.id}`}
                onToggleLike={toggleLike}
                likeBusy={isToggling}
                variant="panel"
              />
            ))}
          </div>
        )}
      </ListState>

      {/* Outside the ListState on purpose: the invitation to write a story is
          true whether the list loaded, failed or came back empty — and it is
          most useful precisely when there is nothing to read yet. */}
      <section className="mt-12 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="font-display text-headline font-semibold text-gray-900 dark:text-gray-100">
          {t('stories:cta.title')}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          {t('stories:cta.body')}
        </p>
        {/* Always shown, never gated on the session: /stories/create is a
            protected route, so an anonymous visitor lands on login and comes
            back. Hiding it would leave the page with no way in for exactly the
            person we are trying to invite. */}
        <Link
          to="/stories/create"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-white transition-colors hover:bg-primary/90"
        >
          <Icon name="celebration" />
          {t('stories:cta.button')}
        </Link>
      </section>
    </div>
  );
}
