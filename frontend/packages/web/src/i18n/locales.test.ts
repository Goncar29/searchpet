import { describe, it, expect } from 'vitest';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

/**
 * Gemelo web-only de `shared/i18n/locales.test.ts`. Mismo invariante: el
 * asterisco de obligatorio es PRESENTACION y no puede vivir dentro del texto
 * traducido, porque `<FormField required>` dibuja el suyo y salen DOS.
 *
 * Existe por separado porque el guard de shared recorre SOLO los locales de
 * shared, y varias pantallas alimentan FormField desde ESTOS archivos —
 * CreateStoryPage (`create.petLabel/titleLabel/bodyLabel`), ForgotPasswordPage
 * (`forgotPassword.email/code/newPassword`) y la cola de refugios del admin. Sin
 * este archivo, agregar `"titleLabel": "Titulo *"` reintroducia exactamente el
 * defecto que el otro guard impide, sin que nada fallara.
 *
 * Acá no hay exenciones: estos locales son web-only, y en la web el asterisco
 * siempre lo pone el componente. Si algún día hace falta una, va listada clave
 * por clave y con su motivo, nunca por prefijo.
 */
function textosConAsterisco(obj: unknown, ruta: string[] = []): string[] {
  if (typeof obj === 'string') {
    return obj.includes('*') ? [`${ruta.join('.')} = ${JSON.stringify(obj)}`] : [];
  }
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => textosConAsterisco(v, [...ruta, k]));
}

describe('locales web-only — el asterisco de obligatorio no va en el texto', () => {
  for (const [lang, dict] of Object.entries({ es, en, pt })) {
    it(`${lang}: ningun texto traducible trae un asterisco`, () => {
      expect(textosConAsterisco(dict)).toEqual([]);
    });
  }
});
