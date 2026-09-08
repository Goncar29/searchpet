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
    // Y el cartel de "no pudimos cargar" NO está: los datos siguen ahí, así que
    // el aviso correcto es la franja, no el cartel que reemplaza todo.
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  it('sin datos y con error, sí muestra el cartel', () => {
    mockUseLeaderboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<LeaderboardScreen />);
    // Se afirma que el cartel APARECE, no sólo que la fila no está.
    //
    // La versión anterior de este test tenía únicamente el `toBeNull()` de
    // abajo y un comentario diciendo que se pondría rojo si el arreglo fuera
    // "no mostrar nunca el error". Era falso: sin fila y sin cartel también
    // pasa. Lo levantó un code review.
    //
    // El texto es la clave literal porque el arnés no inicializa i18next
    // (`NO_I18NEXT_INSTANCE`), y eso es justamente lo que lo hace estable.
    expect(queryByText('common:loadErrorTitle')).toBeTruthy();
    expect(queryByText('Ana Pérez')).toBeNull();
  });
});
