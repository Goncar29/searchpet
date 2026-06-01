import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('layout');

  const currentLang = LANGUAGES.some((l) => l.code === i18n.language)
    ? i18n.language
    : 'es';

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    localStorage.setItem('searchpet-lang', lang);
  }

  return (
    <select
      value={currentLang}
      onChange={handleChange}
      aria-label={t('language')}
      className="
        px-2 py-1 text-xs font-semibold rounded
        border border-gray-300 dark:border-gray-600
        text-gray-700 dark:text-gray-300
        bg-white dark:bg-gray-800
        hover:bg-gray-100 dark:hover:bg-gray-700
        transition-colors duration-150
        cursor-pointer
      "
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
