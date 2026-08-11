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
      places: [{ lat: -34.9187, lng: -56.1567, label: 'Pocitos, Montevideo, Uruguay' }],
    });
  });

  it('devuelve TODOS los candidatos, no solo el primero', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: '50.93', lon: '6.95', display_name: 'Colonia, Renania, Alemania' },
        { lat: '-34.47', lon: '-57.84', display_name: 'Colonia del Sacramento, Uruguay' },
      ],
    });

    const r = await geocode('colonia');
    // Con limit=1 nos quedabamos con el primero del ranking GLOBAL, y para
    // "colonia" ese es Koln: mandabamos a 11.000 km a alguien que buscaba a su
    // mascota. Ningun sesgo elimina la ambiguedad; la elige el usuario.
    expect(r.kind === 'ok' && r.places.map((p) => p.label)).toEqual([
      'Colonia, Renania, Alemania',
      'Colonia del Sacramento, Uruguay',
    ]);
  });

  it('un candidato roto se descarta SOLO, sin tirar los buenos', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: 'nope', lon: '-57.84', display_name: 'Roto' },
        { lat: '-34.47', lon: '-57.84', display_name: 'Colonia del Sacramento, Uruguay' },
      ],
    });

    const r = await geocode('colonia');
    // Que uno venga ilegible no es motivo para tirar los otros cuatro.
    expect(r.kind === 'ok' && r.places.map((p) => p.label)).toEqual(['Colonia del Sacramento, Uruguay']);
  });

  it('preferencia por region: manda viewbox solo si le dan `near`', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => OK,
    });

    await geocode('colonia');
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('viewbox');

    await geocode('colonia', { near: { lat: -34.9011, lng: -56.1645 } });
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]);

    // Medido contra Nominatim: con +-0.05 grados (lo que se ve a zoom 13) y con
    // +-0.5, Koln SIGUE saliendo primero. Recien a +-3 gana Colonia del
    // Sacramento. O sea que pasar los limites visibles del mapa — la
    // implementacion intuitiva — no arregla nada.
    expect(decodeURIComponent(url)).toContain('viewbox=-59.1645,-31.9011,-53.1645,-37.9011');
    // NO se manda bounded: restringir rompe buscar algo lejano a proposito.
    expect(url).not.toContain('bounded');
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

  it('pide varios candidatos y en el idioma dado', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => OK,
    });
    await geocode('Pocitos', { language: 'pt' });

    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('nominatim.openstreetmap.org/search');
    // limit=5, NO 1: con uno solo no hay nada que desambiguar.
    expect(url).toContain('limit=5');
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
