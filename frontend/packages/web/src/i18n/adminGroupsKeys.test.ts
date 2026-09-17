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

function resolve(dict: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict
    );
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
  //
  // Recorre las hojas APLANADAS y no `Object.entries` a secas: el día que
  // `admin.groups` tenga un objeto anidado —que `flatten` ya contempla—, la
  // versión chata fallaría con "esto no es un string" sobre el objeto, en vez de
  // señalar la hoja vacía. Un guard que falla por el motivo equivocado manda a
  // buscar el problema al lugar equivocado.
  it('ninguna traduccion quedo vacia', () => {
    for (const [idioma, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const clave of flatten(grupos(dict))) {
        const valor = resolve(grupos(dict), clave);
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
  // `\s*` después de `t(`: sin eso el regex exige que `t(` y la clave estén
  // PEGADOS, y una llamada larga que Prettier parta en varias líneas dejaría de
  // matchear. Esa clave se caía del barrido en silencio.
  const usadas = [...groupsAdminSource.matchAll(/t\(\s*'groups\.([a-zA-Z0-9_]+)'/g)].map(
    (m) => m[1]
  );

  // El centinela NO es un umbral mágico, y ésa es la diferencia.
  //
  // Antes decía `>= 10` sobre 13 claves reales: perder una —justo lo que provoca
  // una llamada reformateada— pasaba en verde, o sea que el guard se debilitaba
  // sin avisar. Un número fijo tampoco sirve: agregar una clave lo rompería sin
  // que nada esté mal.
  //
  // Lo que se compara es el barrido contra la MISMA fuente contada de otra
  // forma: cada `'groups.` literal del archivo tiene que haber sido parseado. Si
  // el regex deja de ver una llamada, el literal sigue ahí y los números se
  // separan.
  it('el barrido parsea TODAS las llamadas a t(), no una parte', () => {
    const literales = (groupsAdminSource.match(/'groups\./g) ?? []).length;
    expect(usadas.length).toBe(literales);
    expect(usadas.length).toBeGreaterThan(0);
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
