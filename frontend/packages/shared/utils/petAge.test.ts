import { describe, it, expect } from 'vitest';
import { computePetAge } from './petAge';

// La edad se DERIVA de la fecha, nunca se guarda: guardar "3 años" es guardar
// un dato que queda viejo solo al pasar el año.
//
// Y se deriva RESPETANDO LA PRECISIÓN, que es lo que hace honesto el resultado.
// Con precisión 'year' el backend guarda "2022-01-01", pero ese 1 de enero es
// relleno: la mascota pudo nacer cualquier día de 2022. Calcular una edad
// exacta desde ahí sería inventar hasta 11 meses de certeza que nadie afirmó.

const HOY = new Date(2026, 7, 9); // 9 de agosto de 2026

describe('computePetAge', () => {
  it('sin fecha o sin precisión no devuelve nada', () => {
    expect(computePetAge(undefined, undefined, HOY)).toBeNull();
    expect(computePetAge('2022-03-09', undefined, HOY)).toBeNull();
    expect(computePetAge(undefined, 'day', HOY)).toBeNull();
    expect(computePetAge('', '', HOY)).toBeNull();
  });

  it('precisión day: edad exacta, sin aproximar', () => {
    expect(computePetAge('2022-03-09', 'day', HOY)).toEqual({
      unit: 'year',
      value: 4,
      approximate: false,
    });
  });

  it('el cumpleaños que todavía no llegó resta un año', () => {
    // Nació el 20 de diciembre: en agosto de 2026 tiene 3, no 4.
    expect(computePetAge('2022-12-20', 'day', HOY)).toEqual({
      unit: 'year',
      value: 3,
      approximate: false,
    });
  });

  it('precisión month y year son APROXIMADAS', () => {
    // Es la distinción entera de la feature. Con 'year' sólo sabemos el año, y
    // el "01-01" guardado es relleno: decir "4 años" a secas afirmaría un día
    // que el dueño nunca dio.
    expect(computePetAge('2022-01-01', 'year', HOY)).toEqual({
      unit: 'year',
      value: 4,
      approximate: true,
    });
    expect(computePetAge('2022-03-01', 'month', HOY)).toEqual({
      unit: 'year',
      value: 4,
      approximate: true,
    });
  });

  it('menos de un año se cuenta en MESES', () => {
    // El caso más común de una mascota recién sumada: un cachorro. "0 años" no
    // le dice nada a nadie que esté tratando de reconocerla.
    expect(computePetAge('2026-05-09', 'day', HOY)).toEqual({
      unit: 'month',
      value: 3,
      approximate: false,
    });
  });

  it('menos de un mes se cuenta en DÍAS', () => {
    expect(computePetAge('2026-08-02', 'day', HOY)).toEqual({
      unit: 'day',
      value: 7,
      approximate: false,
    });
  });

  it('con precisión year NUNCA baja a meses ni a días', () => {
    // Sabemos el año y nada más. Bajar a "hace 7 meses" desde un 01-01 de
    // relleno sería precisión inventada — el error que la feature entera existe
    // para evitar. Se informa el año, y el consumidor decide cómo decirlo.
    expect(computePetAge('2026-01-01', 'year', HOY)).toEqual({
      unit: 'year',
      value: 0,
      approximate: true,
    });
  });

  it('con precisión month tampoco baja a días', () => {
    // El día es relleno; los meses sí son reales.
    expect(computePetAge('2026-08-01', 'month', HOY)).toEqual({
      unit: 'month',
      value: 0,
      approximate: true,
    });
  });

  it('una fecha futura no produce una edad negativa', () => {
    // El backend tolera un día de gracia sobre UTC, así que una mascota con la
    // fecha de mañana existe. Mostrar "-1 años" sería peor que no mostrar nada.
    expect(computePetAge('2026-08-10', 'day', HOY)).toBeNull();
  });

  it('ignora un instante ISO, que no es un día de calendario', () => {
    expect(computePetAge('2022-03-09T00:00:00Z', 'day', HOY)).toBeNull();
  });
});
