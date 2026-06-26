import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';

export function GroupsAdminPage() {
  const { t } = useTranslation('admin');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createGroup({
        name,
        city,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: (group) => {
      setSuccessMessage(t('groups.success', { name: group.name, city: group.city }));
      setName('');
      setCity('');
      setDescription('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !city.trim()) return;
    setSuccessMessage('');
    createMutation.mutate();
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('groups.title')}</h2>

      <div className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="group-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('groups.name')} <span className="text-red-500">*</span>
            </label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('groups.namePlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="group-city"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('groups.city')} <span className="text-red-500">*</span>
            </label>
            <input
              id="group-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t('groups.cityPlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="group-description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('groups.description')} <span className="text-gray-400 font-normal">{t('groups.optional')}</span>
            </label>
            <textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('groups.descPlaceholder')}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {t('groups.error')}
            </p>
          )}

          {successMessage && (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              {successMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim() || !city.trim()}
            className="w-full py-2 px-4 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? t('groups.creating') : t('groups.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
