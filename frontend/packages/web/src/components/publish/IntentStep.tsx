import { useTranslation } from 'react-i18next';

interface IntentStepProps {
  onSelect: (intent: 'lost' | 'stray' | 'adoption') => void;
}

export function IntentStep({ onSelect }: IntentStepProps) {
  const { t } = useTranslation('publish');
  // 'adoption' lives in the web-only `adoption` namespace (not `publish`), so
  // a dedicated `t` bound to it is used for that card only.
  const { t: tAdoption } = useTranslation('adoption');

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6 text-center">
        {t('intent.title')}
      </h1>
      <div className="grid sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onSelect('lost')}
          className="text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <span className="text-3xl">🐾</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
            {t('intent.lostTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('intent.lostDescription')}
          </p>
        </button>
        <button
          type="button"
          data-testid="intent-stray"
          onClick={() => onSelect('stray')}
          className="text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <span className="text-3xl">📍</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
            {t('intent.strayTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('intent.strayDescription')}
          </p>
        </button>
        <button
          type="button"
          data-testid="intent-adoption"
          onClick={() => onSelect('adoption')}
          className="text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <span className="text-3xl">🏠</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
            {tAdoption('publish.intentOption')}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {tAdoption('publish.intentHelp')}
          </p>
        </button>
      </div>
    </div>
  );
}
