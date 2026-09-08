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
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  it('sin datos y con error, muestra el cartel en vez de los logros', () => {
    mockUseMyBadges.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<BadgesScreen />);
    // El cartel APARECE. Sin esta línea, "no mostrar nunca el error" pasaría
    // el test igual — que es lo que pasaba antes de que lo levantara un code
    // review. El texto es la clave literal porque el arnés no inicializa
    // i18next, y eso lo vuelve estable.
    expect(queryByText('common:loadErrorTitle')).toBeTruthy();
    expect(queryByText('logro_de_prueba')).toBeNull();
  });
});
