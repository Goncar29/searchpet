import { describe, it, expect } from 'vitest';
import es from '@shared/i18n/locales/es.json';
import en from '@shared/i18n/locales/en.json';
import pt from '@shared/i18n/locales/pt.json';

/**
 * AuthField.test.tsx mocks react-i18next with `t: (key) => key`, which is right
 * for asserting behaviour but blind to the translations themselves: if
 * `auth:showPassword` were missing, the reveal button would announce the literal
 * string "auth:showPassword" to a screen reader and all four of those tests
 * would still pass. i18next resolves a missing key to the key itself and logs
 * nothing (rule #12), so nothing else would catch it either.
 *
 * These assertions are the missing half — they check the keys exist, not that
 * the component asks for them.
 */
const LOCALES = { es, en, pt } as const;

describe('AuthField translation keys', () => {
  for (const [lang, bundle] of Object.entries(LOCALES)) {
    const auth = (bundle as { auth: Record<string, unknown> }).auth;

    it(`${lang} defines both reveal-toggle labels`, () => {
      expect(typeof auth.showPassword).toBe('string');
      expect(typeof auth.hidePassword).toBe('string');
      expect((auth.showPassword as string).trim()).not.toBe('');
      expect((auth.hidePassword as string).trim()).not.toBe('');
    });

    it(`${lang} gives the two states different labels`, () => {
      // A toggle whose two states announce the same thing tells a screen-reader
      // user nothing about what pressing it just did.
      expect(auth.showPassword).not.toBe(auth.hidePassword);
    });

    it(`${lang} never leaves a namespaced key as its own value`, () => {
      // The shape a missing translation takes: the key echoed back as the value.
      expect(auth.showPassword).not.toMatch(/^auth[.:]/);
      expect(auth.hidePassword).not.toMatch(/^auth[.:]/);
    });
  }
});
