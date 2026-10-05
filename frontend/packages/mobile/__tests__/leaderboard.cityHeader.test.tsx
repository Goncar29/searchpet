// The city heading of the ranking: the icon must sit right next to the city
// name, both inset from the screen edge. The list has no horizontal padding,
// so the inset belongs to the ROW; on the text alone it pushed the city away
// and left the icon glued to the edge (seen on a real phone, APK rc3).
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import LeaderboardScreen from '../app/leaderboard/index';
import { SPACING } from '../constants';

jest.mock('../../shared/hooks', () => ({
  useLeaderboard: () => ({
    data: [{ user_id: 'u1', name: 'Ana', total_points: 10, rank: 1, badges: [] }],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
  useCiudadDecidida: jest.requireActual('../../shared/hooks/useCiudadDecidida').useCiudadDecidida,
}));

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = { user: { id: 'me', city: 'Montevideo' }, isLoading: false };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('Ranking — city heading', () => {
  it('insets the icon and the city together, from the row', () => {
    const { getByTestId, getByText } = render(<LeaderboardScreen />);

    const row = StyleSheet.flatten(getByTestId('leaderboard-city-header').props.style);
    expect(row.marginHorizontal).toBe(SPACING.lg);

    const city = StyleSheet.flatten(getByText('Montevideo').props.style);
    expect(city.marginHorizontal ?? 0).toBe(0);
    expect(city.marginLeft ?? 0).toBe(0);
  });
});
