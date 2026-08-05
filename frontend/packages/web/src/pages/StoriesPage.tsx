import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useStories, useLikeStory, useUnlikeStory } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import type { SuccessStory } from '@shared/types';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { StoryCard } from '../components/StoryCard';

export function StoriesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['stories', 'common']);
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
        <h1 className="font-display text-display-sm md:text-display text-gray-900 dark:text-gray-100 mb-3">
          {t('stories:title')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          {t('stories:subtitle')}
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">{t('stories:loading')}</p>
        </div>
      ) : stories && stories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {stories.map((story: SuccessStory) => (
            <StoryCard
              key={story.id}
              story={story}
              to={`/stories/${story.id}`}
              onToggleLike={toggleLike}
              likeBusy={isToggling}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <PawPlaceholder className="w-16 mx-auto mb-4" />
          <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
            {t('stories:empty.title')}
          </p>
          <p className="text-gray-500 dark:text-gray-400">{t('stories:empty.hint')}</p>
        </div>
      )}
    </div>
  );
}
