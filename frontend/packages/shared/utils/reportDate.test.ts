import { describe, it, expect } from 'vitest';
import { calendarDayToISO, todayAsCalendarDay, isFutureCalendarDay } from './reportDate';

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
