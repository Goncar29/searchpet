import { describe, it, expect } from 'vitest';
import { calendarDayToISO, todayAsCalendarDay, isFutureCalendarDay, isoToCalendarDay } from './reportDate';

describe('isoToCalendarDay', () => {
  // El invariante que importa: calendarDayToISO e isoToCalendarDay son inversas
  // en CUALQUIER zona. La forma obvia de la vuelta —iso.slice(0,10)— lee el dia
  // en UTC y reintroduce el corrimiento: en UTC+2 la medianoche local del 6 es
  // 2026-08-05T22:00:00Z, asi que el slice devuelve el 5 y el campo se
  // rehidrata un dia atras.
  it('es la inversa exacta de calendarDayToISO', () => {
    for (const dia of ['2026-08-06', '2026-01-01', '2026-12-31', '2024-02-29']) {
      expect(isoToCalendarDay(calendarDayToISO(dia))).toBe(dia);
    }
  });

  // Este es el guard de verdad, y hay que construirlo con cuidado: un instante
  // cualquiera NO sirve. `iso.slice(0,10)` solo miente cuando el dia de UTC del
  // instante difiere del dia LOCAL, o sea cuando la hora local cae del otro
  // lado de la medianoche de Greenwich. Se elige la hora segun el signo del
  // offset del runner, para que el test distinga en cualquier zona.
  //
  // (Una version anterior de este test usaba la medianoche local de UTC+2 fija
  // y pasaba igual con el defecto puesto en un runner UTC-3: no probaba nada.)
  it('no lee el dia en UTC — falla si se vuelve a usar iso.slice(0,10)', () => {
    const offsetMin = new Date().getTimezoneOffset();
    if (offsetMin === 0) return; // en UTC no hay diferencia que detectar

    // offset > 0 => al oeste: una hora local tardia empuja el UTC al dia siguiente.
    // offset < 0 => al este: una hora local temprana lo tira al dia anterior.
    const hora = offsetMin > 0 ? 23 : 1;
    const local = new Date(2026, 7, 4, hora, 0, 0);
    const iso = local.toISOString();

    // Precondicion: el instante elegido efectivamente cruza la medianoche UTC.
    expect(iso.slice(0, 10)).not.toBe('2026-08-04');
    // Y aun asi el dia de calendario local es el 4.
    expect(isoToCalendarDay(iso)).toBe('2026-08-04');
  });

  it('devuelve vacio ante undefined o un ISO invalido', () => {
    expect(isoToCalendarDay(undefined)).toBe('');
    expect(isoToCalendarDay('')).toBe('');
    expect(isoToCalendarDay('no soy una fecha')).toBe('');
  });
});

describe('calendarDayToISO', () => {
  // El invariante que importa, y el que la version con `T00:00:00Z` rompia:
  // el ISO que se manda tiene que volver a leerse como EL MISMO dia en la zona
  // de quien lo cargo. Da igual cual sea esa zona: se compara contra la fecha
  // local del propio Date, no contra un offset fijo.
  it('el instante que devuelve se lee como el mismo dia de calendario local', () => {
    for (const dia of ['2026-08-03', '2026-01-01', '2026-12-31', '2024-02-29']) {
      const iso = calendarDayToISO(dia);
      expect(iso).toBeDefined();
      const vuelta = new Date(iso!);
      const local = `${vuelta.getFullYear()}-${String(vuelta.getMonth() + 1).padStart(2, '0')}-${String(vuelta.getDate()).padStart(2, '0')}`;
      expect(local).toBe(dia);
    }
  });

  // La regresion concreta: `new Date('2026-08-03')` parsea como UTC y en
  // cualquier zona al oeste de Greenwich cae en el dia anterior.
  it('no usa el parseo UTC del string de fecha', () => {
    const iso = calendarDayToISO('2026-08-03')!;
    const comoUTCMidnight = new Date('2026-08-03T00:00:00Z').toISOString();
    // Solo coinciden si el runner esta exactamente en UTC; fuera de UTC tienen
    // que diferir, y esa diferencia es justamente el arreglo.
    if (new Date().getTimezoneOffset() !== 0) {
      expect(iso).not.toBe(comoUTCMidnight);
    }
    // En cualquier zona, incluida UTC, el dia local leido de vuelta es el 3.
    expect(new Date(iso).getDate()).toBe(3);
  });

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    for (const malo of ['', '   ', '03/08/2026', '2026-8-3', 'ayer', '2026-08-03T00:00:00Z']) {
      expect(calendarDayToISO(malo)).toBeUndefined();
    }
  });

  it('rechaza dias con forma valida pero inexistentes', () => {
    // new Date(2026, 1, 31) no explota: rebota al 3 de marzo. Si no se
    // chequeara la vuelta, un 31 de febrero se guardaria como otra fecha.
    expect(calendarDayToISO('2026-02-31')).toBeUndefined();
    expect(calendarDayToISO('2026-13-01')).toBeUndefined();
    expect(calendarDayToISO('2025-02-29')).toBeUndefined();
  });

  it('acepta el 29 de febrero de un bisiesto', () => {
    expect(calendarDayToISO('2024-02-29')).toBeDefined();
  });
});

describe('todayAsCalendarDay', () => {
  // El contrato, que vale en cualquier zona: devuelve el dia LOCAL del Date.
  it('devuelve el dia local del instante', () => {
    for (const iso of ['2026-01-01T03:00:00Z', '2026-06-15T18:30:00Z', '2026-12-31T23:59:00Z']) {
      const d = new Date(iso);
      const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(todayAsCalendarDay(d)).toBe(esperado);
    }
  });

  // La regresion: toISOString().slice(0,10) da el dia en UTC. Se construye a
  // proposito un instante donde el dia local y el de UTC NO coinciden, elegido
  // segun el offset del runner para que el test valga en cualquier zona
  // (en UTC no existe tal instante, y ahi se saltea).
  it('difiere del dia de UTC cuando el instante cae del otro lado de la medianoche', () => {
    const offsetMin = new Date().getTimezoneOffset();
    if (offsetMin === 0) return; // runner en UTC: no hay nada que distinguir

    // Al oeste (offset > 0) se toma justo despues de medianoche UTC, que local
    // sigue siendo el dia anterior. Al este, justo antes.
    const base = offsetMin > 0 ? new Date('2026-06-15T00:30:00Z') : new Date('2026-06-15T23:30:00Z');
    expect(todayAsCalendarDay(base)).not.toBe(base.toISOString().slice(0, 10));
  });
});

describe('isFutureCalendarDay', () => {
  const ahora = new Date(2026, 7, 6, 15, 0, 0); // 6 de agosto, hora local

  it('hoy no es futuro', () => {
    expect(isFutureCalendarDay('2026-08-06', ahora)).toBe(false);
  });

  it('manana si', () => {
    expect(isFutureCalendarDay('2026-08-07', ahora)).toBe(true);
  });

  it('ayer no', () => {
    expect(isFutureCalendarDay('2026-08-05', ahora)).toBe(false);
  });
});
