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

// Estas cuatro son MOBILE-ONLY (`mobile/app/register.tsx`) y ahi el asterisco del
// texto es la unica senal de obligatorio: no hay FormField en React Native que lo
// agregue. Exentas a proposito, no por olvido.
//
// Se listan UNA POR UNA y no como prefijo `auth.register.`: ese subarbol tambien
// lo consume el RegisterPage de la web, asi que un prefijo eximiria en silencio a
// una clave futura que si termine dentro de un `<FormField required>` — que es
// exactamente el doble asterisco que este archivo viene a impedir. La exencion
// tiene que ser tan angosta como su justificacion.
//
// (La web hoy no duplica nada ahi: arma el label como `${t('auth:register.name')} *`
// sobre AuthField, que no tiene prop `required`.)
const CLAVES_EXENTAS = [
  'auth.register.nameLabelRequired',
  'auth.register.emailLabelRequired',
  'auth.register.passwordLabelRequired',
  'auth.register.confirmLabelRequired',
];

function textosConAsterisco(obj: unknown, ruta: string[] = []): string[] {
  const path = ruta.join('.');
  if (typeof obj === 'string') {
    if (CLAVES_EXENTAS.includes(path)) return [];
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

/**
 * Paridad de claves entre los tres idiomas.
 *
 * El diseño de `ListState` (2026-08-25) afirmaba que este archivo YA aseguraba
 * paridad de claves entre es/en/pt, y que por eso una clave sumada a un solo
 * idioma haria fallar la suite. Es FALSO — se verifico leyendo el archivo:
 * hasta este cambio, lo unico que se afirmaba era la regla del asterisco de
 * arriba. Ninguna clave faltante rompia nada.
 *
 * El costo real de esa clave faltante es la regla #21 del CLAUDE.md del
 * proyecto: `useTranslation` devuelve la CLAVE CRUDA cuando no encuentra la
 * traduccion, sin un solo error en consola. Nadie se entera hasta que alguien
 * mira la pantalla en ese idioma.
 *
 * Se compara cada idioma contra `es` como referencia, en las DOS direcciones:
 * claves que le faltan (una traduccion olvidada) y claves de mas (una clave
 * huerfana que ya no existe en `es` pero sigue viva en otro idioma). Cualquiera
 * de las dos es un desvio real y las dos quedan mudas sin este test.
 */
function rutasDeClaves(obj: unknown, prefijo = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefijo];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    rutasDeClaves(v, prefijo ? `${prefijo}.${k}` : k),
  );
}

describe('locales compartidos — paridad de claves entre es/en/pt', () => {
  const referencia = rutasDeClaves(es);
  const otros = { en, pt } as const;

  for (const [lang, dict] of Object.entries(otros)) {
    it(`${lang}: no le falta ninguna clave que tenga es`, () => {
      const propias = new Set(rutasDeClaves(dict));
      const faltantes = referencia.filter((ruta) => !propias.has(ruta));
      expect(faltantes).toEqual([]);
    });

    it(`${lang}: no tiene claves huerfanas que es ya no tenga`, () => {
      const deReferencia = new Set(referencia);
      const propias = rutasDeClaves(dict);
      const huerfanas = propias.filter((ruta) => !deReferencia.has(ruta));
      expect(huerfanas).toEqual([]);
    });
  }
});
