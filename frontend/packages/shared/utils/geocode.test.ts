import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocode } from './geocode';

const OK = [
  { lat: '-34.9187', lon: '-56.1567', display_name: 'Pocitos, Montevideo, Uruguay' },
];

describe('geocode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('una cancelacion NUESTRA no es un error de red', async () => {
    const ctrl = new AbortController();
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      ctrl.abort();
      return Promise.reject(abortError);
    });

    const r = await geocode('Pocitos', { signal: ctrl.signal });

    // Cancelamos nosotros porque hay una busqueda mas nueva. Colapsarlo en
    // 'error' le diria "revisa tu conexion" a alguien cuya conexion esta
    // perfecta, cada vez que busca dos veces seguidas rapido.
    expect(r).toEqual({ kind: 'aborted' });
  });

  it('devuelve las coordenadas y la etiqueta del primer resultado', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => OK,
    });

    const r = await geocode('Pocitos');
    expect(r).toEqual({
      kind: 'ok',
      lat: -34.9187,
      lng: -56.1567,
      label: 'Pocitos, Montevideo, Uruguay',
    });
  });

  it('distingue SIN RESULTADOS de un error de red', async () => {
    // Un no-op silencioso se lee como una app rota: el usuario escribe, aprieta
    // Enter y no pasa nada. Los dos casos tienen que poder decir algo distinto.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    expect(await geocode('asdkjhasd')).toEqual({ kind: 'empty' });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    expect(await geocode('Pocitos')).toEqual({ kind: 'error' });
  });

  it('una respuesta HTTP no-ok es error, no vacio', async () => {
    // Un 429 de Nominatim con cuerpo vacio no significa "no encontre nada".
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => [],
    });
    expect(await geocode('Pocitos')).toEqual({ kind: 'error' });
  });

  it('una consulta vacia no le pega a la red', async () => {
    expect(await geocode('   ')).toEqual({ kind: 'empty' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('NO intenta setear User-Agent', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => OK,
    });
    await geocode('Pocitos');

    // Es un header PROHIBIDO por la especificacion de fetch: el browser lo
    // ignora. Setearlo seria codigo que parece cumplir la politica de Nominatim
    // y no hace nada. Lo que identifica al llamador es el Referer automatico.
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] ?? {};
    const headers = JSON.stringify((init as RequestInit).headers ?? {});
    expect(headers.toLowerCase()).not.toContain('user-agent');
  });

  it('pide un solo resultado y en el idioma dado', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => OK,
    });
    await geocode('Pocitos', { language: 'pt' });

    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('nominatim.openstreetmap.org/search');
    expect(url).toContain('limit=1');
    expect(url).toContain('accept-language=pt');
  });

  it('descarta un resultado con coordenadas no numericas', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [{ lat: 'nope', lon: '-56.1', display_name: 'x' }],
    });
    // Mover el mapa a NaN,NaN lo deja en blanco sin un solo error visible.
    expect(await geocode('Pocitos')).toEqual({ kind: 'error' });
  });
});
