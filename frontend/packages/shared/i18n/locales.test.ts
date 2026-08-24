import { describe, it, expect } from 'vitest';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

/**
 * El asterisco de obligatorio es PRESENTACION, y no puede vivir dentro del texto
 * traducido.
 *
 * De donde sale esta regla: `publish.strayForm.typeLabel` decia "Tipo *", y
 * cuando la web paso ese campo a `<FormField required>` —que dibuja su PROPIO
 * asterisco en un span hermano— la pantalla quedo mostrando DOS: "Tipo * *".
 * Medido en el navegador con innerText, en es/en/pt y en las dos pantallas que
 * usan la clave.
 *
 * Y el detalle que hace falta este archivo: la suite de componentes es
 * ESTRUCTURALMENTE INCAPAZ de ver ese defecto. Los tests mockean i18next con
 * `t: (key) => key`, asi que el label renderizado es la clave literal
 * (`publish:strayForm.typeLabel`), que no contiene ningun asterisco. El bug solo
 * existe cuando hay traducciones de verdad. Por eso el invariante se afirma
 * sobre los ARCHIVOS, que es el unico nivel donde se puede ver.
 *
 * Mismo patron que las reglas #34 y #37: cuando el arnes es mas indulgente que
 * produccion, hay que bajar la asercion al nivel donde el dato vive.
 */

// `auth.register.*LabelRequired` son MOBILE-ONLY y ahi el asterisco del texto es
// la unica senal de obligatorio: no hay FormField en React Native que lo agregue.
// Exentas a proposito, no por olvido. Si alguna pantalla WEB llega a consumir
// estas claves con `<FormField required>`, va a reproducir el mismo doble
// asterisco y hay que sacarlas de esta lista.
//
// La exencion es por RUTA COMPLETA y no por namespace de primer nivel: `register`
// no es top-level, cuelga de `auth`. Exentar 'register' a secas no eximia nada y
// ademas habria eximido cualquier `register` que apareciera en otro namespace.
const RUTAS_EXENTAS = ['auth.register.'];

function textosConAsterisco(obj: unknown, ruta: string[] = []): string[] {
  const path = ruta.join('.');
  if (typeof obj === 'string') {
    if (RUTAS_EXENTAS.some((p) => path.startsWith(p))) return [];
    return obj.includes('*') ? [`${path} = ${JSON.stringify(obj)}`] : [];
  }
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => textosConAsterisco(v, [...ruta, k]));
}

describe('locales compartidos — el asterisco de obligatorio no va en el texto', () => {
  for (const [lang, dict] of Object.entries({ es, en, pt })) {
    it(`${lang}: ningun texto traducible trae un asterisco`, () => {
      expect(textosConAsterisco(dict)).toEqual([]);
    });
  }

  // La clave concreta que causo el defecto, afirmada por su nombre: si alguien
  // la reescribe, el mensaje del test dice exactamente que se rompio y por que,
  // sin tener que reconstruirlo desde una lista generica.
  for (const [lang, dict] of Object.entries({ es, en, pt })) {
    it(`${lang}: strayForm.typeLabel no reintroduce el asterisco`, () => {
      const publish = (dict as { publish?: { strayForm?: { typeLabel?: string } } }).publish;
      expect(publish?.strayForm?.typeLabel).toBeTruthy();
      expect(publish!.strayForm!.typeLabel).not.toContain('*');
    });
  }
});
