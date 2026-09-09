import { describe, it, expect } from 'vitest';
// `?raw` de Vite y NO `readFileSync(new URL(..., import.meta.url))`: bajo vitest
// ese `import.meta.url` no es scheme `file:` y tira "The URL must be of scheme
// file". Esto además no depende del cwd desde el que se corran los tests.
import userProfileSource from '../pages/UserProfilePage.tsx?raw';
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

// LO QUE ESTE BLOQUE AGREGA sobre la paridad de arriba, y es el hueco que
// `CLAUDE.md` anotaba: comparar en/pt contra es NO ve una clave que falta en LOS
// TRES. Ese caso —el de escribir `t('profile:public.postsErrors')` cuando el
// locale dice `postsError`— sólo lo caza leyendo los call sites reales.
describe('profile.public — las claves que la página usa existen de verdad', () => {
  // DOS formas, no una: la pantalla hace `useTranslation(['profile'])`, así que
  // `profile` es el namespace POR DEFECTO y `t('public.x')` —sin prefijo—
  // renderiza igual de bien en runtime. Un regex que sólo mira el prefijo deja
  // esa forma fuera del barrido sin avisar. Hoy no se usa; mañana sí.
  const ESTATICAS = /\bt\(\s*'(?:profile:)?public\.([a-zA-Z0-9_.]+)'/g;
  // Backtick = clave armada en runtime. El barrido estático NO la puede
  // resolver, así que cada una necesita su verificación a mano (abajo).
  const DINAMICAS = /\bt\(\s*`(?:profile:)?public\.[^`]*\$\{/g;
  // Cualquier `t(` que apunte a este namespace, en la forma que sea. Sirve para
  // exigir que el barrido las haya visto TODAS en vez de "más de N".
  const CANDIDATAS = /\bt\(\s*['`](?:profile:)?public\./g;

  const usadas = [...userProfileSource.matchAll(ESTATICAS)].map((m) => m[1]).sort();
  const dinamicas = [...userProfileSource.matchAll(DINAMICAS)];
  const candidatas = [...userProfileSource.matchAll(CANDIDATAS)];

  function resolve(dict: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>(
      (acc, part) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict
    );
  }

  it('el barrido vio TODAS las llamadas al namespace, no "más de N"', () => {
    // Contra el total de candidatas y NO contra un número mágico. Un `>25` con
    // 41 call sites deja que 16 desaparezcan del barrido en silencio: alcanza
    // con que alguien escriba una llamada en una forma que el regex no cubre
    // para que esa clave deje de verificarse mientras el test sigue verde.
    //
    // No se puede comparar contra "todos los `t(` del archivo" como hace
    // `downloadKeys.test.ts`, porque acá conviven varios namespaces: de 48
    // llamadas, 7 son de `pets`/`common` y no deben barrerse.
    expect(usadas.length + dinamicas.length).toBe(candidatas.length);
    expect(candidatas.length, 'el barrido quedó vacío — dejó de matchear').toBeGreaterThan(25);
  });

  it('cada clave estática usada existe en los tres idiomas', () => {
    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      const p = dict.profile.public as unknown as Record<string, unknown>;
      for (const key of usadas) {
        // Una clave PLURAL no existe con su nombre pelado: i18next la resuelve
        // a `<key>_one` / `<key>_other` según el `count`. `reviewCount` es así,
        // y sin esta rama el test la reportaba como faltante — un falso
        // positivo del barrido, no un defecto de la página.
        //
        // Y exigir las DOS formas no es de más: con sólo `_one` en el locale, un
        // conteo de 2 cae al fallback y muestra "2 reseña".
        const directa = resolve(p, key);
        if (typeof directa === 'string') continue;

        const one = resolve(p, `${key}_one`);
        const other = resolve(p, `${key}_other`);
        expect(
          typeof one === 'string' && typeof other === 'string',
          `${lang}.profile.public.${key} — la usa UserProfilePage.tsx y no está en el locale ` +
            `(ni como clave directa ni como plural _one/_other)`
        ).toBe(true);
      }
    }
  });

  // Las claves dinámicas son el punto ciego del barrido. En vez de ignorarlas,
  // se cuentan: hoy hay UNA (`reasons.${reason}`) y está verificada abajo. Si
  // aparece una segunda, este test se cae y obliga a mirarla en vez de dejarla
  // pasar en silencio — que es exactamente cómo un barrido "completo" empieza a
  // cubrir menos de lo que dice.
  it('sólo hay una clave dinámica, y es la de los motivos de denuncia', () => {
    expect(
      dinamicas.length,
      `apareció una llamada dinámica nueva a profile:public — agregá su verificación acá`
    ).toBe(1);
  });

  it('los motivos de denuncia existen en los tres idiomas', () => {
    // La lista vive inline en el JSX (`['spam','fake',...] as AbuseReason[]`),
    // así que se lee del fuente en vez de copiarse: si alguien agrega un motivo
    // al botón y se olvida del locale, esto lo caza.
    const m = userProfileSource.match(/\[([^\]]+)\]\s*as\s+AbuseReason\[\]/);
    expect(m, 'no encontré la lista de AbuseReason en UserProfilePage.tsx').not.toBeNull();
    // `[a-zA-Z_]` y no `[a-z]`: con el regex angosto, un motivo nuevo como
    // `'hate_speech'` o `'fakeProfile'` no matchea y desaparece de la lista
    // ENTERA — el botón lo ofrecería sin traducir y este test seguiría verde,
    // que es justo lo contrario de lo que promete.
    const crudos = m?.[1] ?? '';
    const motivos = [...crudos.matchAll(/'([a-zA-Z_]+)'/g)].map((x) => x[1]);
    // Y se cuenta contra las comillas del propio fragmento: si algún valor no
    // matchea el regex, el barrido queda corto y esto lo delata en vez de
    // dejarlo pasar.
    const comillas = (crudos.match(/'/g) ?? []).length / 2;
    expect(motivos.length, `el regex de motivos dejó fuera ${comillas - motivos.length} valor(es)`)
      .toBe(comillas);
    expect(motivos.length, 'la lista de motivos salió vacía — el regex dejó de matchear').toBeGreaterThan(2);

    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const motivo of motivos) {
        expect(
          resolve(dict.profile.public as unknown as Record<string, unknown>, `reasons.${motivo}`),
          `${lang}.profile.public.reasons.${motivo} — el botón lo ofrece y no está traducido`
        ).toBeTypeOf('string');
      }
    }
  });

  // El namespace `profile` tiene que estar registrado en los tres bloques de
  // `i18n/index.ts`, o la página renderiza las claves crudas en producción
  // (regla #21). Los asserts de arriba leen los JSON directamente, así que
  // ninguno lo vería.
  it('el namespace está registrado en LOS TRES bloques', async () => {
    // `hasResourceBundle` y no `t()`, y esta es la diferencia entera:
    // `i18n/index.ts` tiene `fallbackLng: 'es'`, así que con `profile` faltando
    // SÓLO en el bloque `en`, `t('profile:public.x')` devuelve el string EN
    // ESPAÑOL — una cadena perfectamente válida que ninguna comparación contra
    // la clave puede distinguir.
    //
    // O sea que el usuario en inglés ve el perfil público entero en español y
    // los tests no se enteran. Verificado: borrando esa única línea, las 9
    // aserciones seguían verdes. El borrado TOTAL sí fallaba — por eso el
    // comentario anterior decía "verificado" y era cierto sólo para el caso
    // menos probable. Lo levantó un code review.
    const i18n = (await import('./index')).default;
    for (const lang of ['es', 'en', 'pt'] as const) {
      expect(
        i18n.hasResourceBundle(lang, 'profile'),
        `el namespace 'profile' no está registrado para "${lang}" en i18n/index.ts — ` +
          `con fallbackLng esa pantalla se ve en español y nada más falla`
      ).toBe(true);
    }
  });

  it('el namespace resuelve en la instancia real de i18next', async () => {
    const i18n = (await import('./index')).default;
    for (const lang of ['es', 'en', 'pt'] as const) {
      await i18n.changeLanguage(lang);
      for (const key of usadas) {
        const full = `profile:public.${key}`;
        // `count` SIEMPRE, y no sólo para las plurales: sin él, i18next no
        // puede elegir entre `_one` y `_other` y devuelve la clave — que este
        // test leería como "el namespace no resuelve". Es inofensivo para las
        // demás: si la traducción no usa `{{count}}`, el dato se ignora.
        const value = i18n.t(full, { count: 1 });
        // Las DOS formas, y la segunda es la que importa: cuando el namespace
        // no está registrado, i18next devuelve la clave SIN el prefijo
        // (`public.title`), no la cadena completa. Comparando sólo contra
        // `full`, este test pasaba con el namespace borrado — verificado.
        expect(value, `${full} no resuelve en "${lang}"`).not.toBe(full);
        expect(value, `${full} no resuelve en "${lang}" (namespace sin registrar)`)
          .not.toBe(`public.${key}`);
      }
    }
  });
});
