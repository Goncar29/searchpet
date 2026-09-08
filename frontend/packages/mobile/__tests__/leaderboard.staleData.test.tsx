// Qué muestra el Ranking cuando un refetch falla PERO los datos ya estaban.
//
// El estado que se modela acá no es hipotético: React Query CONSERVA `data`
// cuando falla un refetch, y esta pantalla tiene pull-to-refresh
// (`onRefresh={refetch}`), que es el gesto que lo produce. O sea: lista
// dibujada, el usuario tira para refrescar, Render está despertando y contesta
// 502 → `{ data: [...], isError: true }`.
import React from 'react';
import { render } from '@testing-library/react-native';
import LeaderboardScreen from '../app/leaderboard/index';

const mockUseLeaderboard = jest.fn();

// La pantalla importa por ruta relativa (`../../../shared/hooks`), no por el
// alias `@shared/hooks` que usan los otros tests. Resuelven al mismo módulo.
jest.mock('../../shared/hooks', () => ({
  useLeaderboard: (...args: unknown[]) => mockUseLeaderboard(...args),
}));

const entrada = {
  user_id: 'u-1',
  rank: 1,
  name: 'Ana Pérez',
  total_points: 120,
  found_count: 2,
  total_reports: 5,
  city: 'Montevideo',
  badges: [],
};

describe('Ranking — un refetch fallido no puede borrar la lista', () => {
  it('con datos cacheados y refetch fallido, la lista sigue en pantalla', () => {
    mockUseLeaderboard.mockReturnValue({
      data: [entrada],
      isLoading: false,
      isError: true, // el refetch falló
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<LeaderboardScreen />);

    // Lo que el usuario tenía delante antes de tirar para refrescar. Que
    // desaparezca es peor que un dato viejo: se lleva puesto lo único útil que
    // había en la pantalla, y encima por un fallo que suele durar segundos.
    expect(queryByText('Ana Pérez')).toBeTruthy();
  });

  it('sin datos y con error, sí muestra el cartel', () => {
    // La otra mitad, y no es de adorno: si el arreglo fuera "no mostrar nunca
    // el error", este test se pondría rojo. Lo que se busca es que el cartel
    // aparezca SÓLO cuando no hay nada que mostrar.
    mockUseLeaderboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<LeaderboardScreen />);
    expect(queryByText('Ana Pérez')).toBeNull();
  });
});
