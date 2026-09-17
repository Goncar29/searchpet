// El Ranking arranca en la ciudad de quien mira, no en la del proyecto.
//
// 'Montevideo' es el default de SearchPet (regla #10), no la ciudad del
// usuario: a alguien de Salto la pantalla le mostraba un ranking ajeno como si
// fuera el suyo — plausible, silencioso y equivocado.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import LeaderboardScreen from '../app/leaderboard/index';

const mockUseLeaderboard = jest.fn();

/** Cada ciudad que la pantalla le pidió al hook, en orden. */
const ciudadesPedidas: string[] = [];

// La pantalla importa por ruta relativa (`../../../shared/hooks`), igual que el
// otro test de esta pantalla.
// `useCiudadDecidida` va REAL, no mockeado: es justamente la política que estos
// tests miden. Se toma de su propio archivo para no arrastrar el resto de
// `shared/hooks`, que importa react-query y el cliente HTTP.
jest.mock('../../shared/hooks', () => ({
  useLeaderboard: (city: string) => {
    ciudadesPedidas.push(city);
    return mockUseLeaderboard(city);
  },
  useCiudadDecidida: jest.requireActual('../../shared/hooks/useCiudadDecidida')
    .useCiudadDecidida,
}));

// La sesión es VARIABLE: con un `user` fijo el test no distinguiría "sembró"
// de "no sembró". El nombre DEBE empezar con `mock`: jest hoistea las fábricas
// de `jest.mock` por encima de las declaraciones y sólo permite referenciar
// variables con ese prefijo — sin él, el suite no compila y falla con
// `Test suite failed to run`, que se ve igual que un test en rojo.
let mockUsuario: { id?: string; city?: string } | null = null;

// `isLoading` del store es lo que distingue "todavía no sé tu ciudad" de "sé
// que no tenés". Con un valor fijo no se podría probar el default adelantado:
// la pantalla arrancaba consultando Montevideo antes de que llegara la sesión.
let mockCargandoSesion = false;

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { user: mockUsuario, isLoading: mockCargandoSesion };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const ultimaCiudad = () => ciudadesPedidas[ciudadesPedidas.length - 1];

beforeEach(() => {
  ciudadesPedidas.length = 0;
  mockUsuario = null;
  mockCargandoSesion = false;
  mockUseLeaderboard.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  });
});

describe('Ranking — precarga de la ciudad del usuario', () => {
  it('con sesión y ciudad, consulta la suya sin que nadie toque nada', () => {
    mockUsuario = { city: 'Salto' };
    render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Salto');
  });

  // Sin sesión se conserva el default del proyecto: es lo que había antes y
  // esta pantalla no tiene estado vacío para "todavía no sé tu ciudad".
  it('sin sesión mantiene el default del proyecto', () => {
    render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Montevideo');
  });

  // El store hidrata desde SecureStore de forma asíncrona, así que la sesión
  // llega DESPUÉS del primer render. Con el valor inicial de `useState` esto
  // se quedaría en el default para siempre — y la pantalla se vería igual de
  // sana que si el usuario no tuviera ciudad.
  it('siembra aunque la sesión llegue después del primer render', () => {
    const { rerender } = render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Montevideo');

    mockUsuario = { city: 'Rivera' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Rivera');
  });

  // La mitad que protege la siembra contra una ciudad vacía.
  //
  // OJO CÓMO SE AFIRMA: con ciudad vacía, sembrar y no sembrar dejan la misma
  // ciudad pedida (el default), así que mirar sólo eso pasa con la guarda
  // puesta o sacada. Lo que la guarda cuida es no QUEMAR la siembra: si
  // sembrara con '', la ciudad que llegue después ya no entraría nunca.
  it('con ciudad vacía no gasta la siembra: la que llega después sí entra', () => {
    mockUsuario = { city: '   ' };
    const { rerender } = render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Montevideo');

    mockUsuario = { city: 'Paysandú' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Paysandú');
  });

  // Y la que protege la ELECCIÓN del usuario contra el default. La ciudad del
  // perfil tiene que CAMBIAR para probar algo: las dependencias del efecto son
  // `[usuario?.city]`, así que con el mismo valor no vuelve a correr y esto
  // pasaría sin el ref.
  it('una vez sembrada, un cambio de ciudad en el perfil no la vuelve a pisar', () => {
    mockUsuario = { city: 'Salto' };
    const { rerender } = render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Salto');

    mockUsuario = { city: 'Rivera' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Salto');
  });

  // EL ORDEN MÁS PROBABLE, y el que la primera versión rompía.
  //
  // El store hidrata desde SecureStore de forma asíncrona, así que la pantalla
  // se dibuja antes de que llegue el perfil: quien busca una ciudad apenas
  // entra lo hace con la sesión todavía en vuelo. Ahí el ref sigue en false, y
  // una guarda que sólo pregunta "¿ya sembré?" deja que el perfil aterrice
  // encima y le pise la búsqueda.
  //
  // El test de arriba no alcanza: busca DESPUÉS de que la siembra ocurrió.
  it('el perfil que llega TARDE no pisa una búsqueda ya hecha', () => {
    const { getByPlaceholderText, rerender } = render(<LeaderboardScreen />);

    // No hay botón: la pantalla aplica con `onSubmitEditing` y `onBlur`.
    const input = getByPlaceholderText('leaderboard:cityPlaceholder');
    fireEvent.changeText(input, 'Salto');
    fireEvent(input, 'submitEditing');
    expect(ultimaCiudad()).toBe('Salto');

    // Recién ahora hidrata la sesión.
    mockUsuario = { city: 'Rivera' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Salto');
  });

  // El default NO se adelanta a la sesión.
  //
  // Con 'Montevideo' en el `useState` inicial, la query salía en el PRIMER
  // render: alguien de Salto veía un ranking de Montevideo rotulado como propio
  // durante toda la hidratación. Es el mismo "plausible, silencioso y
  // equivocado" que esta pantalla vino a eliminar, en una ventana más corta.
  //
  // LO QUE SE AFIRMA ES QUE MONTEVIDEO NUNCA SE PIDIÓ, no sólo cuál es la
  // última ciudad: mirar el final no distingue "no se adelantó" de "se adelantó
  // y después lo corrigió", que es exactamente el defecto.
  it('no consulta el default mientras la sesión no se resolvió', () => {
    mockCargandoSesion = true;
    const { rerender } = render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('');

    mockCargandoSesion = false;
    mockUsuario = { id: 'a', city: 'Salto' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Salto');
    expect(ciudadesPedidas).not.toContain('Montevideo');
  });

  // La guarda del submit vacío, que en web estaba testeada y acá NO.
  //
  // Y acá es MÁS alcanzable que en web: `applyCity` cuelga también de `onBlur`,
  // así que alcanza con tocar afuera del campo — no hace falta ni apretar
  // Enter. Si un blur vacío marcara la ciudad como decidida, la siembra quedaría
  // quemada y la pantalla se clavaría en el default para siempre.
  it('un blur con el campo vacío no quema la siembra', () => {
    mockCargandoSesion = true;
    const { getByPlaceholderText, rerender } = render(<LeaderboardScreen />);

    const input = getByPlaceholderText('leaderboard:cityPlaceholder');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'blur');

    mockCargandoSesion = false;
    mockUsuario = { id: 'a', city: 'Durazno' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Durazno');
  });

  // Cambio de IDENTIDAD, que es distinto de un cambio de ciudad.
  //
  // En web esto no se veía porque el logout hace `navigate('/')` y la página se
  // desmonta con su ref. Acá la pantalla sobrevive, así que sin soltar la
  // decisión B entraba y veía el ranking de la ciudad de A como si fuera suyo.
  //
  // Ojo con la diferencia contra el test de "no la vuelve a pisar": ahí cambia
  // la ciudad del MISMO usuario y no tiene que sembrar; acá cambia la persona y
  // sí tiene que hacerlo.
  it('al cambiar de usuario suelta la decisión y siembra la nueva ciudad', () => {
    mockUsuario = { id: 'a', city: 'Salto' };
    const { rerender } = render(<LeaderboardScreen />);
    expect(ultimaCiudad()).toBe('Salto');

    mockUsuario = { id: 'b', city: 'Melo' };
    rerender(<LeaderboardScreen />);

    expect(ultimaCiudad()).toBe('Melo');
  });
});
