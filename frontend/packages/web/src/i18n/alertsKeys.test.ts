import { describe, it, expect } from 'vitest';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

// POR QUÉ EXISTE: los tests de componente mockean `t` devolviendo la clave, así
// que una traducción faltante o vacía se pinta cruda EN SILENCIO y ninguno la
// ve. La única forma de cazarla es mirar los locales.
//
// El disparador fue agregar `alerts.subtitle` al rediseñar la pantalla: una
// clave nueva en tres archivos es justo el momento en que uno se queda atrás.
//
// ACÁ NO HAY BARRIDO DEL FUENTE, a diferencia de `adminGroupsKeys`, y el motivo
// importa: `AlertsPage` hace `useTranslation(['alerts', 'pets'])` y llama
// `t('title')` sin prefijo, así que un barrido de `t('x')` no puede decir a qué
// namespace pertenece cada clave. Un guard que no distingue eso reportaría
// faltantes de `pets` como faltantes de `alerts`. Se afirma lo que se puede
// afirmar bien.

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    )
    .sort();
}

function resolve(dict: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict
    );
}

const alertas = (dict: { alerts: Record<string, unknown> }) => dict.alerts;

describe('alerts — paridad de claves en los tres idiomas', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(flatten(alertas(en))).toEqual(flatten(alertas(es)));
  });

  it('pt tiene exactamente las mismas claves que es', () => {
    expect(flatten(alertas(pt))).toEqual(flatten(alertas(es)));
  });

  // Una traducción vacía NO es una clave faltante: pasa la comparación de
  // arriba y en pantalla deja un hueco.
  it('ninguna traduccion quedo vacia', () => {
    for (const [idioma, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const clave of flatten(alertas(dict))) {
        const valor = resolve(alertas(dict), clave);
        expect(typeof valor, `${idioma}: alerts.${clave}`).toBe('string');
        expect((valor as string).trim(), `${idioma}: alerts.${clave}`).not.toBe('');
      }
    }
  });

  // El centinela: sin esto, un `alerts` vacío o renombrado dejaría los tres
  // tests de arriba comparando listas vacías entre sí — verde sin haber mirado
  // nada. Es el mismo agujero que la tercera ronda de revisión encontró en el
  // guard de `admin.groups`.
  it('el namespace tiene claves de verdad, no una lista vacia', () => {
    expect(flatten(alertas(es)).length).toBeGreaterThan(0);
    expect(flatten(alertas(es))).toContain('subtitle');
    expect(flatten(alertas(es))).toContain('titleNoCount');
  });

  // POR QUÉ ESTÁ ACÁ Y NO EN EL TEST DEL COMPONENTE: estas tres claves son
  // nombres ACCESIBLES de controles que se repiten en cada tarjeta de una
  // grilla de hasta 10. Lo único que los vuelve distinguibles es que lleven el
  // nombre de la alerta adentro.
  //
  // `AlertsPage.test.tsx` no puede afirmarlo: su mock de `t` devuelve la clave,
  // así que las diez tarjetas rinden el mismo texto pase lo que pase. El
  // componente puede probar que el nombre sale de una clave propia; que esa
  // clave interpole, sólo se ve mirando el locale.
  //
  // Sin esto, traducir `toggleLabel` como "Alerta" a secas dejaría todo verde y
  // devolvería el defecto exacto que estas claves vinieron a cerrar.
  it('los nombres accesibles que se repiten por tarjeta interpolan el nombre', () => {
    for (const [idioma, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const clave of ['showOnMap', 'toggleLabel', 'deleteLabel']) {
        const valor = resolve(alertas(dict), clave) as string;
        expect(valor, `${idioma}: alerts.${clave}`).toContain('{{name}}');
      }
    }
  });
});
