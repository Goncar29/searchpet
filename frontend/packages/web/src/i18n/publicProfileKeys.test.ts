import { describe, it, expect } from 'vitest';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

// Las claves se comparan APLANADAS: `profile.public.reasons` es un objeto
// anidado, y comparar sólo el primer nivel no vería una traducción que se
// olvidó un motivo de denuncia adentro.
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  ).sort();
}

describe('profile.public — paridad de claves en los tres idiomas', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(flatten(en.profile.public)).toEqual(flatten(es.profile.public));
  });

  it('pt tiene exactamente las mismas claves que es', () => {
    expect(flatten(pt.profile.public)).toEqual(flatten(es.profile.public));
  });

  // Una traducción vacía no es una clave faltante: pasa la comparación de
  // arriba y en pantalla se ve un hueco. Este test no lo puede ver ningún
  // test de componente, porque esos mockean `t` devolviendo la clave.
  it('ninguna traducción quedó vacía', () => {
    for (const [lang, dict] of [['en', en], ['pt', pt], ['es', es]] as const) {
      const walk = (o: Record<string, unknown>, path = '') => {
        for (const [k, v] of Object.entries(o)) {
          if (v !== null && typeof v === 'object') walk(v as Record<string, unknown>, `${path}${k}.`);
          else expect(String(v).trim(), `${lang}.profile.public.${path}${k}`).not.toBe('');
        }
      };
      walk(dict.profile.public);
    }
  });

  // Los placeholders de interpolación no se traducen: uno traducido no da
  // error, simplemente no renderiza nada donde iba el dato.
  it('los placeholders sobreviven la traducción', () => {
    const cases: Array<[string, string[]]> = [
      ['postsCapped', ['{{shown}}', '{{total}}']],
      ['confirmBlock', ['{{name}}']],
      ['confirmUnblock', ['{{name}}']],
      ['reviewCount_one', ['{{count}}']],
      ['reviewCount_other', ['{{count}}']],
    ];
    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const [key, placeholders] of cases) {
        const value = (dict.profile.public as unknown as Record<string, string>)[key];
        for (const p of placeholders) {
          expect(value, `${lang}.profile.public.${key}`).toContain(p);
        }
      }
    }
  });
});
