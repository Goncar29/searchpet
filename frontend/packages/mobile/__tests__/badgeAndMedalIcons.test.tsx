// Badges and leaderboard medals are registry icons, not emoji.
//
// Covers the three mobile render sites of BADGE_META (my badges, the
// leaderboard legend, the public profile card) plus the top-3 medals. Every
// assertion reads the drawn `Path` (`d` and `fill`) rather than a text node, so
// the test fails if an emoji comes back or if a site draws the wrong glyph.
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import BadgesScreen from '../app/badges/index';
import LeaderboardScreen from '../app/leaderboard/index';
import UserProfileScreen from '../app/users/[id]';
import { BADGE_META } from '../../shared/types';
import { ICON_PATHS } from '../../shared/icons/paths';
import { COLORS } from '../constants';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'u-9' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const ok = (data: unknown) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isPaused: false,
  isFetching: false,
  refetch: jest.fn(),
});

const mockBadges = jest.fn();
const mockLeaderboard = jest.fn();
const mockProfile = jest.fn();
const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });

jest.mock('../../shared/hooks', () => ({
  useMyBadges: (...a: unknown[]) => mockBadges(...a),
  useLeaderboard: (...a: unknown[]) => mockLeaderboard(...a),
  useCiudadDecidida: jest.requireActual('../../shared/hooks/useCiudadDecidida').useCiudadDecidida,
  usePublicProfile: (...a: unknown[]) => mockProfile(...a),
  useUserPets: () => ok({ data: [], total: 0 }),
  useUserReviews: () => ok({ reviews: [] }),
  useBlockedUsers: () => ok([]),
  useCreateReview: mutation,
  useUpdateReview: mutation,
  useDeleteReview: mutation,
  useBlockUser: mutation,
  useSubmitAbuseReport: mutation,
}));

jest.mock('../store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      user: { id: 'u-1', city: 'Montevideo' },
      isLoading: false,
      isAuthenticated: true,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const BADGE_EMOJI = ['🤝', '🦸', '📣', '✅', '🛡️', '🌟', '🏅'];

function drawn(ui: ReturnType<typeof render>) {
  return ui.UNSAFE_getAllByType(Path).map((p) => p.props.d as string);
}

function noBadgeEmojiText(ui: ReturnType<typeof render>) {
  const texts = ui.UNSAFE_getAllByType(Text).map((t) => [t.props.children].flat().join(''));
  return texts.filter((t) => BADGE_EMOJI.includes(t.trim()));
}

const badge = (badge_type: string) => ({
  id: `b-${badge_type}`,
  user_id: 'u-1',
  badge_type,
  earned_at: '2026-01-01T00:00:00Z',
});

describe('BADGE_META', () => {
  it('maps each badge to its owner-approved icon, all of them in the registry', () => {
    const icons = Object.fromEntries(Object.entries(BADGE_META).map(([k, m]) => [k, m.icon]));
    expect(icons).toEqual({
      first_helper: 'handshake',
      community_guardian: 'shield',
      social_butterfly: 'campaign',
      verified_finder: 'check-circle',
      super_finder: 'star-filled',
      pet_rescuer: 'emoji-events',
    });
    for (const meta of Object.values(BADGE_META)) {
      expect(ICON_PATHS[meta.icon]).toBeDefined();
    }
  });
});

describe('Mis logros', () => {
  it.each(Object.entries(BADGE_META))('the %s card draws its own icon', (type, meta) => {
    mockBadges.mockReturnValue(ok([badge(type)]));
    const ui = render(<BadgesScreen />);
    expect(drawn(ui)).toContain(ICON_PATHS[meta.icon]);
    expect(noBadgeEmojiText(ui)).toEqual([]);
  });

  it('an unknown badge draws military-tech, not the medal emoji', () => {
    mockBadges.mockReturnValue(ok([badge('logro_de_prueba')]));
    const ui = render(<BadgesScreen />);
    expect(drawn(ui)).toContain(ICON_PATHS['military-tech']);
    expect(noBadgeEmojiText(ui)).toEqual([]);
  });
});

describe('Perfil público — badge card', () => {
  const perfil = (badges: unknown[]) =>
    mockProfile.mockReturnValue(
      ok({
        id: 'u-9',
        name: 'Marina Torres',
        city: 'Montevideo',
        total_points: 42,
        found_count: 1,
        total_reports: 3,
        share_count: 0,
        avg_rating: 0,
        badges,
        review_count: 0,
        created_at: '2026-01-01T00:00:00Z',
      }),
    );

  it('a known badge draws its icon and an unknown one draws military-tech', () => {
    perfil([badge('first_helper'), badge('otro_logro')]);
    const ui = render(<UserProfileScreen />);
    const paths = drawn(ui);
    expect(paths).toContain(ICON_PATHS.handshake);
    expect(paths).toContain(ICON_PATHS['military-tech']);
    expect(noBadgeEmojiText(ui)).toEqual([]);
  });
});

describe('Ranking', () => {
  const entry = (rank: number) => ({
    user_id: `u-${rank}`,
    rank,
    name: `Persona ${rank}`,
    total_points: 100 - rank,
    found_count: 0,
    total_reports: 0,
    city: 'Montevideo',
    badges: [],
  });

  it('the legend draws one registry icon per BADGE_META entry', () => {
    mockLeaderboard.mockReturnValue(ok([]));
    const ui = render(<LeaderboardScreen />);
    const paths = drawn(ui);
    for (const meta of Object.values(BADGE_META)) {
      expect(paths).toContain(ICON_PATHS[meta.icon]);
    }
    expect(noBadgeEmojiText(ui)).toEqual([]);
  });

  it('ranks 1-3 get a gold, silver and bronze medal with a rank label; 4 is a number', () => {
    mockLeaderboard.mockReturnValue(ok([entry(1), entry(2), entry(3), entry(4)]));
    const ui = render(<LeaderboardScreen />);
    const medals = ui
      .UNSAFE_getAllByType(Path)
      .filter((p) => p.props.d === ICON_PATHS['workspace-premium'])
      .map((p) => p.props.fill);
    expect(medals).toEqual([COLORS.medalGold, COLORS.medalSilver, COLORS.medalBronze]);
    expect(new Set(medals).size).toBe(3);
    expect(ui.getByLabelText('#1')).toBeTruthy();
    expect(ui.getByLabelText('#2')).toBeTruthy();
    expect(ui.getByLabelText('#3')).toBeTruthy();
    // Rank 4 has no medal: it is still the plain number.
    expect(ui.queryByLabelText('#4')).toBeNull();
    expect(ui.getByText('4')).toBeTruthy();
    const texts = ui.UNSAFE_getAllByType(Text).map((t) => [t.props.children].flat().join(''));
    expect(texts.filter((t) => /[🥇🥈🥉]/u.test(t))).toEqual([]);
  });
});
