// Los plurales del feed, contra los locales REALES.
//
// Existe porque el arnés de pantallas no inicializa i18next: ahí `t()` devuelve
// la clave, así que ningún test de pantalla puede ver que una forma plural no
// resuelve. `home:results_plural` vivió así — la clave estaba en el JSON, se
// leía perfectamente razonable, y NUNCA se usaba: el sufijo `_plural` se
// eliminó en i18next v21 y este proyecto está en v26, donde las categorías son
// `_one`/`_other`. `t('home:results', { count: 2 })` devolvía "2 resultado".
import i18next from 'i18next';

import sharedEs from '../../shared/i18n/locales/es.json';
import sharedEn from '../../shared/i18n/locales/en.json';
import sharedPt from '../../shared/i18n/locales/pt.json';
import mobileEs from '../i18n/locales/es.json';
import mobileEn from '../i18n/locales/en.json';
import mobilePt from '../i18n/locales/pt.json';

let i18n: typeof i18next;

beforeAll(async () => {
  i18n = i18next.createInstance();
  await i18n.init({
    lng: 'es',
    fallbackLng: 'es',
    resources: {
      es: { ...sharedEs, ...mobileEs },
      en: { ...sharedEn, ...mobileEn },
      pt: { ...sharedPt, ...mobilePt },
    },
    interpolation: { escapeValue: false },
  });
});

describe('plurales del feed', () => {
  // Se comparan las frases SIN los números, y eso no es un detalle: comparar
  // las cadenas enteras es una aserción vacía. Con el `_plural` muerto,
  // "1 resultado" y "2 resultado" ya difieren —por el dígito— así que
  // `uno !== varios` pasa feliz con el bug puesto. Lo que tiene que cambiar es
  // el SUSTANTIVO. (Escribí primero la versión vacía y la delató restaurar el
  // bug: pasó igual.)
  it('la frase, no sólo el número, cambia entre singular y plural', async () => {
    const casos: [string, Record<string, unknown>][] = [
      ['home:results', {}],
      ['home:activeReports', { radius: 10 }],
    ];
    const sinNumeros = (s: string) => s.replace(/\d+/g, 'N');

    for (const lng of ['es', 'en', 'pt']) {
      await i18n.changeLanguage(lng);
      for (const [clave, extra] of casos) {
        const uno = i18n.t(clave, { count: 1, ...extra });
        const varios = i18n.t(clave, { count: 2, ...extra });
        expect(sinNumeros(uno)).not.toBe(sinNumeros(varios));
        expect(uno).toContain('1');
        expect(varios).toContain('2');
      }
    }
  });

  it('el español no dice "1 reportes activos"', async () => {
    await i18n.changeLanguage('es');

    expect(i18n.t('home:activeReports', { count: 1, radius: 10 })).toBe(
      '1 reporte activo · radio 10 km',
    );
    expect(i18n.t('home:activeReports', { count: 2, radius: 10 })).toBe(
      '2 reportes activos · radio 10 km',
    );
    expect(i18n.t('home:results', { count: 2 })).toBe('2 resultados');
  });

  // El cero NO se comporta igual en los tres idiomas, y eso es correcto: el
  // CLDR pone el 0 en la categoría `one` para portugués (`i = 0..1`) y en
  // `other` para español e inglés. Es exactamente lo que un ternario
  // `count !== 1` escrito a mano se equivoca, y el motivo para usar el
  // mecanismo de i18next en vez de armarlo a mano.
  it('el cero sigue la regla de cada idioma', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('home:results', { count: 0 })).toBe('0 resultados');

    await i18n.changeLanguage('en');
    expect(i18n.t('home:results', { count: 0 })).toBe('0 results');

    await i18n.changeLanguage('pt');
    expect(i18n.t('home:results', { count: 0 })).toBe('0 resultado');
  });

  // La clave que se muestra cuando NO sabemos el conteo. Se llama igual que en
  // la web (`home:resultsUnknown`) porque es el mismo concepto: dos nombres
  // para lo mismo es cómo la próxima pantalla inventa un tercero.
  it('resultsUnknown y radiusOnly existen en los tres idiomas', async () => {
    for (const lng of ['es', 'en', 'pt']) {
      await i18n.changeLanguage(lng);
      expect(i18n.t('home:resultsUnknown')).not.toContain(':');
      expect(i18n.t('home:resultsUnknown')).not.toBe('resultsUnknown');
      expect(i18n.t('home:radiusOnly', { radius: 10 })).toContain('10');
    }
  });
});
