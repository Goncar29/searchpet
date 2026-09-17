import { describe, it, expect } from 'vitest';
// `?raw` de Vite y NO `readFileSync(new URL(..., import.meta.url))`: bajo
// vitest ese `import.meta.url` no es un URL `file:` y tira "The URL must be of
// scheme file". Esto además no depende del cwd desde el que se corran los tests.
import groupsAdminSource from '../pages/admin/GroupsAdminPage.tsx?raw';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

// POR QUÉ ESTE ARCHIVO EXISTE: los tests de componente mockean `t` devolviendo
// la clave, así que una traducción faltante o vacía se pinta cruda EN SILENCIO y
// ninguno de ellos la ve. La única forma de cazarla es mirar los locales.
//
// El disparador fue agregar `groups.subtitle` al rediseñar esta pantalla: una
// clave nueva en tres archivos es exactamente el momento en que uno de los tres
// se queda atrás.

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    )
    .sort();
}

const grupos = (dict: { admin: { groups: Record<string, unknown> } }) => dict.admin.groups;

describe('admin.groups — paridad de claves en los tres idiomas', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(flatten(grupos(en))).toEqual(flatten(grupos(es)));
  });

  it('pt tiene exactamente las mismas claves que es', () => {
    expect(flatten(grupos(pt))).toEqual(flatten(grupos(es)));
  });

  // Una traducción vacía NO es una clave faltante: pasa la comparación de
  // arriba y en pantalla deja un hueco.
  it('ninguna traduccion quedo vacia', () => {
    for (const [idioma, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const [clave, valor] of Object.entries(grupos(dict))) {
        expect(typeof valor, `${idioma}: admin.groups.${clave}`).toBe('string');
        expect((valor as string).trim(), `${idioma}: admin.groups.${clave}`).not.toBe('');
      }
    }
  });
});

describe('admin.groups — las claves que la pantalla usa existen de verdad', () => {
  // Barre el fuente de la pantalla buscando `t('groups.x')`. La comparación de
  // arriba prueba que los tres idiomas COINCIDEN; esto prueba que coinciden con
  // lo que la pantalla realmente pide, que es otra pregunta: las tres podrían
  // estar de acuerdo en no tener la clave que se usa.
  const usadas = [...groupsAdminSource.matchAll(/t\('groups\.([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);

  // Sin esta aserción, un cambio de comillas o de forma de llamada dejaría el
  // barrido en CERO y los tests de abajo pasarían sobre una lista vacía — verde
  // sin haber mirado nada.
  it('el barrido ve las llamadas a t(), no una lista vacia', () => {
    expect(usadas.length).toBeGreaterThanOrEqual(10);
    expect(usadas).toContain('subtitle');
    expect(usadas).toContain('title');
  });

  it('cada clave usada existe en los tres idiomas', () => {
    for (const clave of usadas) {
      for (const [idioma, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
        expect(grupos(dict)[clave], `${idioma}: falta admin.groups.${clave}`).toBeDefined();
      }
    }
  });
});
