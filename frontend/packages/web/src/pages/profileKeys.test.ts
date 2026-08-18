import { describe, it, expect } from 'vitest';
import es from '../i18n/locales/es.json';
import en from '../i18n/locales/en.json';
import pt from '../i18n/locales/pt.json';

/**
 * ProfilePage.test.tsx mockea react-i18next con `t: (key) => key`, que es lo
 * correcto para afirmar comportamiento pero es CIEGO a las traducciones: afirma
 * sobre `'profile:allInAdoption'` exista o no esa clave. i18next resuelve una
 * clave faltante devolviendo la clave misma y no loguea nada (regla #12), así
 * que la pantalla mostraría el texto crudo con todos los tests en verde.
 *
 * Existe porque eso PASÓ: `allInAdoption` se insertó con un `String.replace`
 * anclado en `"viewAll"`, que reemplaza la PRIMERA ocurrencia — y la primera
 * está en `home.successStories`, no en `profile`. La clave quedó en el objeto
 * equivocado en los tres idiomas, `profile.allInAdoption` no existía, y los 22
 * tests de la página seguían verdes. Lo encontró el code-review, no la suite.
 *
 * El repo ya tenía este patrón (`sheltersKeys`, `leaderboardKeys`); el rediseño
 * del perfil sumó once claves y ningún guard equivalente. Esta es la otra mitad:
 * chequea que las claves EXISTAN, no que la página las pida.
 */
const LOCALES = { es, en, pt } as const;

/** Las claves que sumó el rediseño; todas son texto que ve el usuario. */
const NEW_KEYS = [
  'edit',
  'memberSince',
  'noPhone',
  'myPetsSubtitle',
  'reportsSubtitle',
  'adoptionSubtitle',
  'viewAll',
  'viewAllPets',
  'viewAllReports',
  'viewAllAdoption',
  'allInAdoption',
] as const;

/**
 * Etiqueta visible → su nombre accesible. WCAG 2.5.3 "Label in Name" pide que
 * la primera esté contenida en el segundo.
 *
 * Acá no es teoría: las tres secciones repiten el MISMO texto visible ("Ver
 * todas"), y el `aria-label` existe justamente para distinguirlas. Quien maneja
 * la web por voz dice "click Ver todas" y el software matchea contra el nombre
 * ACCESIBLE: si el visible no está adentro, no pasa nada.
 */
const LABEL_PAIRS = [
  ['viewAll', 'viewAllPets'],
  ['viewAll', 'viewAllReports'],
  ['viewAll', 'viewAllAdoption'],
] as const;

describe('ProfilePage translation keys', () => {
  for (const [lang, bundle] of Object.entries(LOCALES)) {
    const profile = (bundle as { profile: Record<string, unknown> }).profile;

    for (const key of NEW_KEYS) {
      it(`${lang} define profile:${key}`, () => {
        expect(typeof profile[key]).toBe('string');
        expect((profile[key] as string).trim()).not.toBe('');
        // La forma que toma una traducción faltante: la clave devuelta como valor.
        expect(profile[key]).not.toMatch(/^profile[.:]/);
      });
    }

    it(`${lang} conserva el placeholder {{date}} en memberSince`, () => {
      // Sin él la línea dice "Miembro desde" y nada más: pierde el único dato
      // que la justifica, y se ve perfectamente bien en pantalla.
      expect(profile.memberSince).toContain('{{date}}');
    });

    for (const [visible, aria] of LABEL_PAIRS) {
      it(`${lang}: el nombre accesible de ${aria} contiene su etiqueta visible`, () => {
        expect(profile[aria]).toContain(profile[visible]);
      });
    }

    it(`${lang} no dejó allInAdoption colgando en home.successStories`, () => {
      // De ahí vino el defecto: el replace anclado en "viewAll" la metió en el
      // primer objeto que tenía esa clave. Nadie lee esa copia.
      const home = (bundle as { home: { successStories?: Record<string, unknown> } }).home;
      expect(home.successStories?.allInAdoption).toBeUndefined();
    });
  }
});
