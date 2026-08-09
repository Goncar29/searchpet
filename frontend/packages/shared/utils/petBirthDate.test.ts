import { describe, it, expect } from 'vitest';
import {
  composeBirthDate,
  decomposeBirthDate,
  birthDateYears,
  selectableMonths,
  selectableDays,
} from './petBirthDate';

// La precisión se DERIVA de cuánto llenó el usuario. Ese es todo el diseño: si
// el formulario no tiene un control de precisión separado, el par incoherente
// que el backend rechaza con 400 no se puede construir desde la UI.
describe('composeBirthDate', () => {
  it('sólo año → precisión year, y el día se rellena con 01', () => {
    expect(composeBirthDate({ year: '2022', month: '', day: '' })).toEqual({
      birth_date: '2022-01-01',
      birth_date_precision: 'year',
    });
  });

  it('año y mes → precisión month', () => {
    expect(composeBirthDate({ year: '2022', month: '3', day: '' })).toEqual({
      birth_date: '2022-03-01',
      birth_date_precision: 'month',
    });
  });

  it('año, mes y día → precisión day', () => {
    expect(composeBirthDate({ year: '2022', month: '3', day: '9' })).toEqual({
      birth_date: '2022-03-09',
      birth_date_precision: 'day',
    });
  });

  it('rellena con ceros a la izquierda', () => {
    // El backend parsea con el layout "2006-01-02" exacto: un "2022-3-9" no
    // matchea y vuelve 400.
    expect(composeBirthDate({ year: '2022', month: '3', day: '9' })?.birth_date).toBe('2022-03-09');
  });

  it('sin año no hay fecha, aunque vengan mes y día', () => {
    // El año es lo único obligatorio. Un mes suelto no ubica nada en el tiempo,
    // y el formulario deshabilita mes/día hasta que haya año — esto es la red
    // por si alguien arma el estado de otra forma.
    expect(composeBirthDate({ year: '', month: '3', day: '9' })).toBeUndefined();
    expect(composeBirthDate({ year: '', month: '', day: '' })).toBeUndefined();
  });

  it('un día sin mes se ignora y queda precisión year', () => {
    // "el 9 de algún mes de 2022" no es representable: el modelo tiene tres
    // niveles y ninguno dice eso. Se conserva lo que SÍ se sabe.
    expect(composeBirthDate({ year: '2022', month: '', day: '9' })).toEqual({
      birth_date: '2022-01-01',
      birth_date_precision: 'year',
    });
  });

  it('rechaza un día que no existe en ese mes', () => {
    // new Date(2022, 1, 30) rebota al 2 de marzo EN SILENCIO. Sin este guard se
    // guardaría una fecha que el usuario no eligió.
    expect(composeBirthDate({ year: '2022', month: '2', day: '30' })).toBeUndefined();
    // Y el 29 de febrero sí existe en año bisiesto.
    expect(composeBirthDate({ year: '2024', month: '2', day: '29' })?.birth_date).toBe('2024-02-29');
  });

  it('rechaza una fecha futura', () => {
    const hoy = new Date();
    const anioQueViene = String(hoy.getFullYear() + 1);
    expect(composeBirthDate({ year: anioQueViene, month: '', day: '' })).toBeUndefined();
  });

  it('acepta hoy mismo', () => {
    // Un cachorro recién nacido es un caso real, no un borde teórico.
    const hoy = new Date();
    expect(
      composeBirthDate({
        year: String(hoy.getFullYear()),
        month: String(hoy.getMonth() + 1),
        day: String(hoy.getDate()),
      })
    ).toEqual({
      birth_date: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`,
      birth_date_precision: 'day',
    });
  });
});

// La vuelta: rehidratar el formulario de edición desde lo guardado.
describe('decomposeBirthDate', () => {
  it('respeta la precisión y NO devuelve componentes que no son reales', () => {
    // Esto es lo importante de toda la feature. El backend guarda "2022-01-01"
    // para una precisión 'year' porque la columna es DATE y necesita un día.
    // Si el formulario rehidratara mes=enero y día=1, el usuario vería una
    // fecha exacta que nunca afirmó — y al guardar de nuevo quedaría como 'day'.
    // El dato se contaminaría solo, con abrir y cerrar la pantalla.
    expect(decomposeBirthDate('2022-01-01', 'year')).toEqual({ year: '2022', month: '', day: '' });
    expect(decomposeBirthDate('2022-03-01', 'month')).toEqual({ year: '2022', month: '3', day: '' });
    expect(decomposeBirthDate('2022-03-09', 'day')).toEqual({ year: '2022', month: '3', day: '9' });
  });

  it('sin fecha o sin precisión devuelve todo vacío', () => {
    const vacio = { year: '', month: '', day: '' };
    expect(decomposeBirthDate(undefined, undefined)).toEqual(vacio);
    expect(decomposeBirthDate('2022-03-09', undefined)).toEqual(vacio);
    expect(decomposeBirthDate(undefined, 'day')).toEqual(vacio);
    expect(decomposeBirthDate('', '')).toEqual(vacio);
  });

  it('ignora un instante ISO, que es el formato que el backend rechaza', () => {
    expect(decomposeBirthDate('2022-03-09T00:00:00Z', 'day')).toEqual({ year: '', month: '', day: '' });
  });

  it('componer lo que se descompuso devuelve lo mismo', () => {
    // La ida y la vuelta tienen que ser inversas exactas: sin esto, abrir el
    // formulario de edición y guardar sin tocar nada cambiaría el dato.
    for (const [fecha, prec] of [
      ['2022-01-01', 'year'],
      ['2022-03-01', 'month'],
      ['2022-03-09', 'day'],
    ] as const) {
      expect(composeBirthDate(decomposeBirthDate(fecha, prec))).toEqual({
        birth_date: fecha,
        birth_date_precision: prec,
      });
    }
  });
});

describe('birthDateYears', () => {
  it('cubre el mismo rango que el backend, del más nuevo al más viejo', () => {
    // 150 y no un rango "razonable" más corto: el piso del backend es 150
    // porque el tipo `otro` incluye tortugas y loros. Con 30, el año de una
    // mascota longeva era IMPOSIBLE de cargar desde la web — y si ya existía,
    // el select no tenía la opción, React lo dejaba en selectedIndex = -1, y el
    // año se veía vacío con mes y día llenos.
    const anios = birthDateYears(new Date(2026, 7, 9));
    expect(anios[0]).toBe(2026);
    expect(anios.at(-1)).toBe(2026 - 150);
    expect(anios).toHaveLength(151);
  });
});

// La otra mitad del arreglo del borrado silencioso: si no se puede ELEGIR una
// fecha futura, composeBirthDate no tiene por qué rechazarla, y el update no
// llega nunca al `?? ''` que borraba el par.
describe('selectableMonths / selectableDays', () => {
  const hoy = new Date(2026, 7, 9); // 9 de agosto de 2026

  it('un año pasado ofrece los 12 meses y el mes completo', () => {
    expect(selectableMonths('2022', hoy)).toHaveLength(12);
    expect(selectableDays('2022', '1', hoy)).toHaveLength(31);
  });

  it('el año EN CURSO se corta en el mes de hoy', () => {
    const meses = selectableMonths('2026', hoy);
    expect(meses).toHaveLength(8);
    expect(meses.at(-1)).toBe(8);
    expect(meses).not.toContain(12);
  });

  it('el mes en curso se corta en el día de hoy', () => {
    const dias = selectableDays('2026', '8', hoy);
    expect(dias.at(-1)).toBe(9);
    expect(dias).not.toContain(31);
  });

  it('un mes pasado del año en curso va completo', () => {
    expect(selectableDays('2026', '7', hoy)).toHaveLength(31);
  });

  it('nada de lo ofrecido puede producir una fecha que composeBirthDate rechace', () => {
    // El invariante que une las dos piezas. Si alguna combinación elegible
    // devolviera undefined, el update la leería como "borrá el par".
    for (const m of selectableMonths('2026', hoy)) {
      for (const d of selectableDays('2026', String(m), hoy)) {
        const r = composeBirthDate({ year: '2026', month: String(m), day: String(d) }, hoy);
        expect(r, `2026-${m}-${d} tendría que ser válida`).toBeDefined();
      }
    }
  });
});
