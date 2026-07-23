import { Link, useNavigate } from 'react-router';
import { useStories, useLikeStory, useUnlikeStory } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { SuccessStory } from '@shared/types';
import { PawPlaceholder } from '../components/PawPlaceholder';

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

export function StoriesPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: stories, isLoading } = useStories({ limit: 20 });
  const likeStory = useLikeStory();
  const unlikeStory = useUnlikeStory();
  const isToggling = likeStory.isPending || unlikeStory.isPending;

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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
          Historias de éxito
        </h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          Mascotas que volvieron a casa gracias a la comunidad.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Cargando historias...</p>
        </div>
      ) : stories && stories.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stories.map((story: SuccessStory) => (
            <Link
              key={story.id}
              to={`/stories/${story.id}`}
              className="block cursor-pointer"
            >
            <div
              className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-shadow flex flex-col"
            >
              {story.pet_photo && (
                <img
                  src={story.pet_photo}
                  alt={story.pet_name}
                  className="w-full h-40 object-cover rounded-lg mb-4"
                />
              )}
              {story.featured && (
                <span className="self-start text-xs font-bold text-yellow-950 bg-yellow-400 px-2 py-0.5 rounded-full mb-3">
                  Destacada
                </span>
              )}

              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
                {story.title || story.pet_name}
              </h3>
              <p className="text-sm text-primary font-semibold mb-2">
                {story.pet_name}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 flex-1 mb-4">
                {truncate(story.body, 100)}
              </p>

              <div className="flex items-center justify-between mt-auto">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(story.created_at).toLocaleDateString()}
                </p>
                <button
                  onClick={(e) => toggleLike(e, story)}
                  disabled={isToggling}
                  aria-pressed={story.liked_by_me}
                  aria-label={story.liked_by_me ? 'Quitar me gusta' : 'Me gusta'}
                  className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  <span>{story.liked_by_me ? '❤️' : '🤍'}</span>
                  <span className="font-semibold">{story.like_count}</span>
                </button>
              </div>
            </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <PawPlaceholder className="w-16 mx-auto mb-4" />
          <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
            Todavía no hay historias
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            Cuando una mascota sea encontrada, su historia aparecerá aquí.
          </p>
        </div>
      )}
    </div>
  );
}
