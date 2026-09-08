import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';

export function DownloadPage() {
  const { t } = useTranslation('download');

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="text-center mb-10">
        <Logo className="h-16 w-16 mx-auto mb-4 text-primary" />
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t('title')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          {t('subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        {/* Android APK */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            {/* El icono toma el color de la accion de su tarjeta (verde el APK,
                primary las otras dos) para no inventar una paleta nueva: los
                emojis que reemplaza traian su propio color y quitarlo dejaba
                las tres tarjetas planas. */}
            <Icon name="android" className="text-4xl flex-shrink-0 text-green-500" />
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                {t('android.title')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t('android.description')}
              </p>
              <a
                href="https://github.com/Goncar29/searchpet/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 text-white font-bold px-6 py-3 rounded-lg hover:bg-green-600 transition-colors"
                aria-label={t('android.ctaLabel')}
              >
                {t('android.cta')}
              </a>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {t('android.note')}
              </p>
            </div>
          </div>
        </div>

        {/* PWA */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <Icon name="language" className="text-4xl flex-shrink-0 text-primary" />
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                {t('webApp.title')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t('webApp.description')}
              </p>
              {/* La numeracion queda en el markup y NO en la traduccion: un
                  traductor no puede desordenarla ni perderla, y el orden de los
                  pasos es el mismo en los tres idiomas. */}
              <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-4 list-none">
                <li>1. {t('webApp.step1')}</li>
                {/* El icono de compartir va como marcado y NO como emoji dentro
                    de la traduccion: el ⬆️ que estaba ahi lo pinta la fuente de
                    emoji del sistema —en Windows sale como un cuadrito de
                    color— y desentonaba con los tres iconos monocromo de las
                    tarjetas. Aca ademas hereda el color del texto. */}
                <li>
                  2. {t('webApp.step2')}{' '}
                  <Icon name="share" className="inline align-text-bottom" />
                </li>
                <li>3. {t('webApp.step3')}</li>
                <li>4. {t('webApp.step4')}</li>
              </ol>
              <a
                href="/"
                className="inline-flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-lg hover:bg-primary-dark transition-colors"
                aria-label={t('webApp.ctaLabel')}
              >
                {t('webApp.cta')}
              </a>
            </div>
          </div>
        </div>

        {/* Expo Go */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <Icon name="install-mobile" className="text-4xl flex-shrink-0 text-primary" />
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                {t('expo.title')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t('expo.description')}
              </p>
              <div className="flex gap-3">
                <a
                  href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label={t('expo.androidLabel')}
                >
                  {t('expo.android')}
                </a>
                <span className="text-gray-300" aria-hidden>|</span>
                <a
                  href="https://apps.apple.com/app/expo-go/id982107779"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label={t('expo.iosLabel')}
                >
                  {t('expo.ios')}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Instrucciones fuentes desconocidas */}
      <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-6">
        <h3 className="font-bold text-gray-900 dark:text-white mb-2">
          {t('sideload.title')}
        </h3>
        <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-none">
          <li>1. {t('sideload.step1')}</li>
          <li>2. {t('sideload.step2')}</li>
          <li>3. {t('sideload.step3')}</li>
          <li>4. {t('sideload.step4')}</li>
        </ol>
      </div>
    </div>
  );
}
