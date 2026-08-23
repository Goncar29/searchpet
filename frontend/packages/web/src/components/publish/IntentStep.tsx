import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

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
      {/* Las tarjetas llevan `flex flex-col items-start` por alineación, no por
          estilo. Chromium centra verticalmente el contenido de un <button> en una
          caja anónima interna, y el grid estira las tres a la misma altura: como
          cada una tiene distinto largo de descripción, el contenido de la más
          corta quedaba centrado y bajaba. Medido a 1280px: los iconos arrancaban
          en y=187, 197 y 231 — 44px de desfase — dentro de tarjetas idénticas de
          254px. Sólo se destraba volviendo el botón un contenedor flex explícito:
          `display:block` NO alcanza (probado, el desfase seguía en 44px) y
          `align-self:start` alinea pero rompe la altura pareja de las tarjetas.
          Ya pasaba con los emojis; sus tamaños dispares lo disimulaban. */}
      <div className="grid sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onSelect('lost')}
          className="flex flex-col items-start text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <Icon name="pets" className="text-3xl text-primary" />
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
          className="flex flex-col items-start text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <Icon name="location-on" className="text-3xl text-primary" />
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
          className="flex flex-col items-start text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary p-6 transition-colors bg-white dark:bg-gray-900"
        >
          <Icon name="home" className="text-3xl text-primary" />
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
