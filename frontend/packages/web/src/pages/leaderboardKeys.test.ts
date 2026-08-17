import { describe, it, expect } from 'vitest';
import es from '../i18n/locales/es.json';
import en from '../i18n/locales/en.json';
import pt from '../i18n/locales/pt.json';

/**
 * LeaderboardPage.test.tsx mockea react-i18next, así que asserta sobre
 * `'leaderboard:rowAria'` exista o no la clave. Una clave faltante se resuelve
 * a sí misma y se pinta cruda, sin un solo error (regla #12): la fila se
 * anunciaría "leaderboard:rowAria" a un lector de pantalla con todos los tests
 * en verde.
 *
 * Estas aserciones son la otra mitad — verifican que las claves existan, no que
 * la página las pida.
 */
const LOCALES = { es, en, pt } as const;

/** Claves que agregó el rediseño. */
const NEW_KEYS = [
  'cityLabel',
  'rowAria',
  'podiumAria',
  'moreBadges',
  'statReunited',
  'statHelpers',
] as const;

/**
 * Claves que reciben `count` y por lo tanto NECESITAN sus formas plurales.
 *
 * i18next sólo pluraliza si existen las claves sufijadas; con la base sola cae
 * de vuelta a ella y renderiza "1 logros más". Y `rest === 1` es alcanzable:
 * son seis logros posibles y la fila muestra tres.
 */
const PLURAL_KEYS = ['moreBadges', 'badgeCount'] as const;

/** Claves cuyo placeholder es lo único que las hace útiles. */
const PLACEHOLDERS: Record<string, string[]> = {
  rowAria: ['{{rank}}', '{{name}}', '{{points}}'],
  podiumAria: ['{{place}}', '{{name}}', '{{points}}'],
  moreBadges: ['{{count}}'],
  empty: ['{{city}}'],
};

describe('LeaderboardPage translation keys', () => {
  for (const [lang, bundle] of Object.entries(LOCALES)) {
    const lb = (bundle as { leaderboard: Record<string, unknown> }).leaderboard;

    for (const key of NEW_KEYS) {
      it(`${lang} defines leaderboard:${key}`, () => {
        expect(typeof lb[key]).toBe('string');
        expect((lb[key] as string).trim()).not.toBe('');
        // La forma que toma una traducción faltante: la clave como su valor.
        expect(lb[key]).not.toMatch(/^leaderboard[.:]/);
      });
    }

    for (const key of PLURAL_KEYS) {
      it(`${lang} defines both plural forms of leaderboard:${key}`, () => {
        for (const suffix of ['_one', '_other']) {
          const form = lb[`${key}${suffix}`];
          expect(typeof form).toBe('string');
          expect(form).toContain('{{count}}');
        }
        // Si las dos formas dicen lo mismo, no hay pluralización: es el mismo
        // "1 logros más" con dos claves en vez de una.
        expect(lb[`${key}_one`]).not.toBe(lb[`${key}_other`]);
      });
    }

    for (const [key, tokens] of Object.entries(PLACEHOLDERS)) {
      it(`${lang} keeps every placeholder in leaderboard:${key}`, () => {
        // Sin el placeholder la etiqueta sigue leyéndose bien en pantalla y
        // deja de cumplir su único trabajo: distinguir una fila de las otras
        // diecinueve. Es un fallo silencioso.
        for (const token of tokens) {
          expect(lb[key]).toContain(token);
        }
      });
    }
  }
});
