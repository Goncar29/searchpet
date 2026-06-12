import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SharePanel } from '../SharePanel';
import type { Pet } from '@shared/types';

interface SuccessStepProps {
  pet: Pet;
  intent: 'lost' | 'stray';
  failedPhotoCount: number;
  onRetryPhotos: () => void;
  isRetrying: boolean;
}

export function SuccessStep({ pet, intent, failedPhotoCount, onRetryPhotos, isRetrying }: SuccessStepProps) {
  const { t } = useTranslation('publish');

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5 text-center">
      <span className="text-4xl">✅</span>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
        {t(intent === 'lost' ? 'success.lostTitle' : 'success.strayTitle')}
      </h1>
      <p className="text-gray-500 dark:text-gray-400">
        {t(intent === 'lost' ? 'success.lostDescription' : 'success.strayDescription')}
      </p>

      {failedPhotoCount > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 p-3 space-y-2">
          <p className="text-yellow-800 dark:text-yellow-300 text-sm font-medium">
            {t('success.photoRetryTitle', { count: failedPhotoCount })}
          </p>
          <button
            type="button"
            onClick={onRetryPhotos}
            disabled={isRetrying}
            className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 underline underline-offset-2 hover:text-yellow-900 disabled:opacity-60"
          >
            {t('success.photoRetryAction')}
          </button>
        </div>
      )}

      <SharePanel petId={pet.id} petName={pet.name} pet={pet} />

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Link
          to={`/pets/${pet.id}`}
          className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('success.viewPet')}
        </Link>
        <Link
          to="/publish"
          className="flex-1 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {t('success.publishAnother')}
        </Link>
      </div>
    </div>
  );
}
