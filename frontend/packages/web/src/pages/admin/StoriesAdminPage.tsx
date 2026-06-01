import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import type { SuccessStory } from '@shared/types';

export function StoriesAdminPage() {
  const queryClient = useQueryClient();

  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories'],
    queryFn: () => apiClient.getStories({ limit: 50 }),
  });

  const featureMutation = useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      apiClient.setStoryFeatured(id, featured),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stories'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.adminDeleteStory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stories'] }),
  });

  const handleDelete = (story: SuccessStory) => {
    if (window.confirm(`Delete story "${story.title || story.pet_name}"? This cannot be undone.`)) {
      deleteMutation.mutate(story.id);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Stories</h2>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading stories...</p>
        </div>
      ) : stories && stories.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Title</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Author</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Featured</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Created</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Actions</th>
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
                      {story.featured ? 'Featured' : 'Normal'}
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
                        {story.featured ? 'Unfeature' : 'Feature'}
                      </button>
                      <button
                        onClick={() => handleDelete(story)}
                        disabled={deleteMutation.isPending}
                        className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          No stories found.
        </div>
      )}
    </div>
  );
}
