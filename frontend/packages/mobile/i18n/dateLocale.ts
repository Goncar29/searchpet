const DATE_LOCALE_MAP: Record<string, string> = {
  es: 'es-UY',
  en: 'en-US',
  pt: 'pt-BR',
};

export function getDateLocale(lang: string): string {
  return DATE_LOCALE_MAP[lang] ?? 'es-UY';
}
