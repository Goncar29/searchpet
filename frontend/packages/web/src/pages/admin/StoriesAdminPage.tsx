import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import type { SuccessStory } from '@shared/types';
import { Pagination } from '../../components/Pagination';

const PAGE_SIZE = 20;

export function StoriesAdminPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: result, isLoading } = useQuery({
    queryKey: ['stories-admin', page],
    queryFn: () => apiClient.getStoriesAdmin({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const stories = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Deleting a story can shrink the list — never sit on an empty page past the end.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const invalidateStories = () => {
    queryClient.invalidateQueries({ queryKey: ['stories-admin'] });
    queryClient.invalidateQueries({ queryKey: ['stories'] }); // public feed
  };

  const featureMutation = useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      apiClient.setStoryFeatured(id, featured),
    onSuccess: invalidateStories,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.adminDeleteStory(id),
    onSuccess: invalidateStories,
  });

  const handleDelete = (story: SuccessStory) => {
    if (window.confirm(t('stories.confirmDelete', { name: story.title || story.pet_name }))) {
      deleteMutation.mutate(story.id);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('stories.title')}</h2>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">{t('stories.loading')}</p>
        </div>
      ) : stories.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('stories.col.title')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('stories.col.author')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('stories.col.featured')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('stories.col.created')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('stories.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {stories.map((story: SuccessStory) => (
                <tr
                  key={story.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="py-2 px-3 text-gray-900 dark:text-gray-100 max-w-xs truncate">
                    {story.title || story.pet_name}
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                    {story.user_name}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        story.featured
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {story.featured ? t('stories.badge.featured') : t('stories.badge.normal')}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                    {new Date(story.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          featureMutation.mutate({
                            id: story.id,
                            featured: !story.featured,
                          })
                        }
                        disabled={featureMutation.isPending}
                        className="text-xs font-medium px-2 py-1 rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:hover:bg-yellow-900/60 transition-colors disabled:opacity-50"
                      >
                        {story.featured ? t('stories.action.unfeature') : t('stories.action.feature')}
                      </button>
                      <button
                        onClick={() => handleDelete(story)}
                        disabled={deleteMutation.isPending}
                        className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50"
                      >
                        {t('stories.action.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          {t('stories.empty')}
        </div>
      )}
    </div>
  );
}
