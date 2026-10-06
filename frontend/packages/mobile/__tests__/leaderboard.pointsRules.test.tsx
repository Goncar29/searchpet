// The "?" next to the achievements legend opens a popup that explains how points
// and badges are earned, and when they are NOT. It runs against the REAL i18n
// instance (not a key-echo mock) so the numbers it asserts are the ones a person
// would read, and they must come from the shared constants.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import LeaderboardScreen from '../app/leaderboard/index';
import i18n from '../i18n';
import { POINTS, BADGE_THRESHOLDS } from '../../shared/constants/gamification';
import { BADGE_META } from '../../shared/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

const OPEN = 'How points and badges work';

describe('Leaderboard — points rules popup', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('has a labelled "?" button and the popup starts closed', () => {
    const { getByLabelText, queryByText } = render(<LeaderboardScreen />);
    const button = getByLabelText(OPEN);
    expect(button.props.accessibilityRole).toBe('button');
    expect(queryByText('How you earn points')).toBeNull();
  });

  it('opens the popup with the four sections when pressed', () => {
    const { getByLabelText, getByText } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(OPEN));

    expect(getByText('How you earn points')).toBeTruthy();
    expect(getByText('What does NOT earn points')).toBeTruthy();
    expect(getByText('Badges')).toBeTruthy();
    expect(getByText('How the ranking works')).toBeTruthy();
  });

  it('renders the numbers from the shared constants', () => {
    const { getByLabelText, getByText } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(OPEN));

    expect(getByText(new RegExp(`\\+${POINTS.report} points each`))).toBeTruthy();
    expect(getByText(new RegExp(`\\+${POINTS.share} points, once per pet`))).toBeTruthy();
    expect(getByText(new RegExp(`\\+${POINTS.helper} points, once per pet`))).toBeTruthy();
    expect(getByText(new RegExp(`Receive a review.*\\+${POINTS.reviewReceived} points`))).toBeTruthy();
    expect(getByText(new RegExp(`takes its ${POINTS.reviewReceived} points back`))).toBeTruthy();
    expect(
      getByText(new RegExp(`Post ${BADGE_THRESHOLDS.communityGuardianReports} location reports in total.*does not take the badge away`)),
    ).toBeTruthy();
    expect(
      getByText(`Be confirmed as a helper for ${BADGE_THRESHOLDS.superFinderPets} different pets.`),
    ).toBeTruthy();
  });

  it('says what does NOT earn points', () => {
    const { getByLabelText, getByText } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(OPEN));

    expect(getByText(/Marking your own pet as found/)).toBeTruthy();
    expect(getByText(/Being confirmed again as a helper for the same pet/)).toBeTruthy();
    expect(getByText(/Writing a review/)).toBeTruthy();
  });

  it('lists every badge by its label', () => {
    const { getByLabelText, getAllByText } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(OPEN));

    for (const meta of Object.values(BADGE_META)) {
      // Each label shows in the legend behind the popup AND in the popup.
      expect(getAllByText(i18n.t(meta.labelKey)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('closes from the close button', () => {
    const { getByLabelText, queryByText } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(OPEN));
    expect(queryByText('How you earn points')).toBeTruthy();

    fireEvent.press(getByLabelText('Close'));
    expect(queryByText('How you earn points')).toBeNull();
  });

  // The rules are taller than a phone screen. A ScrollView inside a card with
  // maxHeight grows to its content on Android unless it can shrink, so the end
  // of the text was cut off with nothing to scroll (APK rc4).
  it('the rules scroll inside the card instead of overflowing it', () => {
    const { getByLabelText, UNSAFE_getAllByType } = render(<LeaderboardScreen />);
    fireEvent.press(getByLabelText(i18n.t('pointsRules:open')));
    const { ScrollView, StyleSheet } = require('react-native');
    const rules = UNSAFE_getAllByType(ScrollView).find((sv: any) => sv.props.testID === 'points-rules-scroll');
    expect(rules).toBeDefined();
    expect(StyleSheet.flatten(rules.props.style)).toMatchObject({ flexShrink: 1 });
  });
});
