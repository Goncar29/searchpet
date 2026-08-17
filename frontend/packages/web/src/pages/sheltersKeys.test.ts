import { describe, it, expect } from 'vitest';
import es from '../i18n/locales/es.json';
import en from '../i18n/locales/en.json';
import pt from '../i18n/locales/pt.json';

/**
 * SheltersPage.test.tsx mocks react-i18next with `t: (key) => key`, which is
 * right for asserting behaviour but blind to the translations themselves: it
 * asserts on `'shelters:searchButton'` whether or not that key exists. i18next
 * resolves a missing key to the key itself and logs nothing (rule #12), so the
 * button would read "shelters:searchButton" in the browser with every test
 * still green.
 *
 * These assertions are the missing half — they check the keys exist in all
 * three bundles, not that the page asks for them.
 */
const LOCALES = { es, en, pt } as const;

/** Keys the redesign added; every one is user-visible copy. */
const NEW_KEYS = [
  'cityLabel',
  'searchPlaceholder',
  'searchButton',
  'emptyForCity',
  'clearFilter',
  'registerCtaBody',
] as const;

describe('SheltersPage translation keys', () => {
  for (const [lang, bundle] of Object.entries(LOCALES)) {
    const shelters = (bundle as { shelters: Record<string, unknown> }).shelters;

    for (const key of NEW_KEYS) {
      it(`${lang} defines shelters:${key}`, () => {
        expect(typeof shelters[key]).toBe('string');
        expect((shelters[key] as string).trim()).not.toBe('');
        // The shape a missing translation takes: the key echoed back as value.
        expect(shelters[key]).not.toMatch(/^shelters[.:]/);
      });
    }

    it(`${lang} keeps the {{city}} placeholder in emptyForCity`, () => {
      // Without it the message loses the one detail that distinguishes it from
      // the directory-wide empty state, which is its whole reason to exist.
      expect(shelters.emptyForCity).toContain('{{city}}');
    });
  }
});
