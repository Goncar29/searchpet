// El Ranking arranca en la ciudad de quien mira, no en la del proyecto.
//
// 'Montevideo' es el default de SearchPet (regla #10), no la ciudad del
// usuario: a alguien de Salto la pantalla le mostraba un ranking ajeno como si
// fuera el suyo — plausible, silencioso y equivocado.
import React from 'react';
import { render } from '@testing-library/react-native';
import LeaderboardScreen from '../app/leaderboard/index';

const mockUseLeaderboard = jest.fn();

/** Cada ciudad que la pantalla le pidió al hook, en orden. */
const ciudadesPedidas: string[] = [];

// La pantalla importa por ruta relativa (`../../../shared/hooks`), igual que el
// otro test de esta pantalla.
jest.mock('../../shared/hooks', () => ({
  useLeaderboard: (city: string) => {
    ciudadesPedidas.push(city);
    return mockUseLeaderboard(city);
  },
}));

// La sesión es VARIABLE: con un `user` fijo el test no distinguiría "sembró"
// de "no sembró". El nombre DEBE empezar con `mock`: jest hoistea las fábricas
// de `jest.mock` por encima de las declaraciones y sólo permite referenciar
// variables con ese prefijo — sin él, el suite no compila y falla con
// `Test suite failed to run`, que se ve igual que un test en rojo.
let mockUsuario: { city?: string } | null = null;

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { user: mockUsuario };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const ultimaCiudad = () => ciudadesPedidas[ciudadesPedidas.length - 1];

beforeEach(() => {
  ciudadesPedidas.length = 0;
  mockUsuario = null;
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
});
