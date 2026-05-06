import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('layout');

  const currentLang = i18n.language?.startsWith('en') ? 'en' : 'es';
  const nextLang = currentLang === 'es' ? 'en' : 'es';

  function handleToggle() {
    i18n.changeLanguage(nextLang);
    localStorage.setItem('searchpet-lang', nextLang);
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={t('language')}
      className="
        px-2 py-1 text-xs font-semibold rounded
        border border-gray-300 dark:border-gray-600
        text-gray-700 dark:text-gray-300
        bg-white dark:bg-gray-800
        hover:bg-gray-100 dark:hover:bg-gray-700
        transition-colors duration-150
      "
    >
      {currentLang.toUpperCase()}
    </button>
  );
}
