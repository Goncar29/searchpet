// ============================================================
// StoryDetailPage — /stories/:id
// ============================================================
import { useParams, useNavigate, Link } from 'react-router';
import { useStory, useLikeStory, useUnlikeStory } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import { PawPlaceholder } from '../components/PawPlaceholder';

export function StoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: story, isLoading, isError } = useStory(id ?? '');
  const likeStory = useLikeStory();
  const unlikeStory = useUnlikeStory();
  const isToggling = likeStory.isPending || unlikeStory.isPending;

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="space-y-2 mt-6">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !story) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <PawPlaceholder className="w-16 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Historia no encontrada
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Esta historia no existe o fue eliminada.
        </p>
        <Link
          to="/stories"
          className="inline-flex items-center gap-2 text-primary font-semibold hover:underline"
        >
          ← Volver a historias
        </Link>
      </div>
    );
  }

  const handleLike = () => {
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Back link */}
      <Link
        to="/stories"
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-primary dark:hover:text-primary transition-colors mb-6"
      >
        ← Volver a historias
      </Link>

      <article className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 md:p-8">
        {/* Featured badge */}
        {story.featured && (
          <span className="inline-block text-xs font-bold text-yellow-950 bg-yellow-400 px-2 py-0.5 rounded-full mb-4">
            Destacada
          </span>
        )}

        {/* Pet photo hero */}
        {story.pet_photo && (
          <img
            src={story.pet_photo}
            alt={story.pet_name}
            className="w-full h-64 object-cover rounded-lg mb-6"
          />
        )}

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {story.title || story.pet_name}
        </h1>

        {/* Pet name */}
        <p className="text-base text-primary font-semibold mb-1">
          {story.pet_name}
        </p>

        {/* Hero / author */}
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Por <span className="font-medium text-gray-700 dark:text-gray-300">{story.user_name}</span>
          {story.hero_name ? (
            <> · Héroe: <span className="font-medium text-gray-700 dark:text-gray-300">{story.hero_name}</span></>
          ) : null}
        </p>

        {/* Date */}
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          {new Date(story.created_at).toLocaleDateString('es', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>

        {/* Photos */}
        {(story.photo_before || story.photo_after) && (
          <div className="flex gap-4 mb-6">
            {story.photo_before && (
              <div className="flex-1">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 text-center">Antes</p>
                <img
                  src={story.photo_before}
                  alt="Antes"
                  className="w-full h-40 object-cover rounded-lg"
                />
              </div>
            )}
            {story.photo_after && (
              <div className="flex-1">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 text-center">Después</p>
                <img
                  src={story.photo_after}
                  alt="Después"
                  className="w-full h-40 object-cover rounded-lg"
                />
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="prose dark:prose-invert max-w-none mb-8">
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
            {story.body}
          </p>
        </div>

        {/* Like button */}
        <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 pt-4">
          <button
            onClick={handleLike}
            disabled={isToggling}
            aria-pressed={story.liked_by_me}
            title={isAuthenticated ? 'Me gusta' : 'Inicia sesión para dar me gusta'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-700 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{story.liked_by_me ? '❤️' : '🤍'}</span>
            <span>{story.like_count}</span>
            <span className="hidden sm:inline">
              {isAuthenticated ? 'Me gusta' : 'Iniciá sesión para dar me gusta'}
            </span>
          </button>

          <Link
            to="/stories"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary dark:hover:text-primary transition-colors"
          >
            Ver todas las historias →
          </Link>
        </div>
      </article>
    </div>
  );
}
