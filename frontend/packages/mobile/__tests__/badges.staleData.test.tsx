// Qué muestran Mis logros cuando un refetch falla PERO los datos ya estaban.
//
// Misma clase que `leaderboard.staleData.test.tsx`: React Query CONSERVA `data`
// cuando falla un refetch, y esta pantalla tiene pull-to-refresh
// (`onRefresh={refetch}`). O sea que el estado se alcanza con un gesto que el
// usuario hace a propósito, no con una carambola.
import React from 'react';
import { render } from '@testing-library/react-native';
import BadgesScreen from '../app/badges/index';

const mockUseMyBadges = jest.fn();
const mockUseAuthStore = jest.fn();

jest.mock('../../shared/hooks', () => ({
  useMyBadges: (...args: unknown[]) => mockUseMyBadges(...args),
}));

jest.mock('../store', () => ({
  useAuthStore: (...args: unknown[]) => mockUseAuthStore(...args),
}));

// `badge_type` a propósito FUERA de BADGE_META: ahí `BadgeCard` cae al
// `badge.badge_type` crudo como etiqueta, así que el texto que se busca no
// depende de que i18n esté inicializado en el arnés.
const logro = {
  id: 'b-1',
  user_id: 'u-1',
  badge_type: 'logro_de_prueba',
  earned_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mockUseAuthStore.mockReturnValue({ isAuthenticated: true });
});

describe('Mis logros — un refetch fallido no puede borrar la lista', () => {
  it('con datos cacheados y refetch fallido, los logros siguen en pantalla', () => {
    mockUseMyBadges.mockReturnValue({
      data: [logro],
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<BadgesScreen />);

    expect(queryByText('logro_de_prueba')).toBeTruthy();
  });

  it('sin datos y con error, no muestra logros', () => {
    // La otra mitad: si el arreglo fuera "no mostrar nunca el error", esto
    // seguiría pasando, pero el test de arriba pasaría por el motivo
    // equivocado. Se afirman las dos para que la distinción exista de verdad.
    mockUseMyBadges.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<BadgesScreen />);
    expect(queryByText('logro_de_prueba')).toBeNull();
  });
});
