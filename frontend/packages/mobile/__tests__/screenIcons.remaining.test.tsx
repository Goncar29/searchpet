// The remaining mobile screens draw registry icons, not emoji.
//
// One generic hooks mock (a Proxy) hands every `use*` hook a neutral query
// result; a test overrides only the hooks its screen reads. Every assertion
// reads the drawn `Path` (and its fill) and scans the Text nodes for leftovers,
// so it fails if the wrong glyph is drawn or an emoji returns. Distinctions are
// tested on both sides (error vs not-found, signed out vs signed in).
import React from 'react';
import { render } from '@testing-library/react-native';
import AlertsScreen from '../app/alerts/index';
import BadgesScreen from '../app/badges/index';
import BlockedUsersScreen from '../app/blocked-users';
import FosterHomeDetailScreen from '../app/foster-home/[id]';
import FosterHomesScreen from '../app/foster-homes/index';
import FosterHomeMineScreen from '../app/foster-homes/mine';
import GroupsScreen from '../app/groups/index';
import GroupDetailScreen from '../app/groups/[id]';
import LeaderboardScreen from '../app/leaderboard/index';
import MyPetsScreen from '../app/my-pets';
import RegisterPetScreen from '../app/pets/register';
import SheltersScreen from '../app/shelters/index';
import StoriesScreen from '../app/story/index';
import StoryCreateScreen from '../app/story/create';
import StoryDetailScreen from '../app/story/[id]';
import { ApiError } from '../../shared/api/client';
import { COLORS } from '../constants';
import { drawnIcons, emojiTexts, fillsOf } from './support/icons';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'x-1', petId: 'pet-1' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key),
    i18n: { language: 'es' },
  }),
}));

const mockAuth = jest.fn();
jest.mock('../store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const s = mockAuth();
    return typeof selector === 'function' ? selector(s) : s;
  },
  useLocationStore: (selector?: (s: unknown) => unknown) => {
    const s = { latitude: null, longitude: null, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(s) : s;
  },
}));

const mockBase = {
  data: [] as unknown,
  error: null,
  isLoading: false,
  isPending: false,
  isError: false,
  isPaused: false,
  isFetching: false,
  isRefetching: false,
  refetch: jest.fn(),
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
};
const mockHooks: Record<string, unknown> = {};
const q = (over: object = {}) => ({ ...mockBase, ...over });
// `@shared/hooks` and the screens' relative path are the same module: one mock.
jest.mock('@shared/hooks', () =>
  new Proxy(
    { __esModule: true },
    {
      get: (target, name) => {
        if (name === '__esModule') return true;
        if (name === 'useCiudadDecidida') return jest.requireActual('../../shared/hooks/useCiudadDecidida').useCiudadDecidida;
        if (typeof name !== 'string' || !name.startsWith('use')) return undefined;
        return () => (name in mockHooks ? mockHooks[name] : { ...mockBase });
      },
    },
  ),
);

const set = (name: string, value: unknown) => {
  mockHooks[name] = value;
};

beforeEach(() => {
  for (const k of Object.keys(mockHooks)) delete mockHooks[k];
  mockAuth.mockReturnValue({ user: { id: 'u-1', city: 'Montevideo' }, isAuthenticated: true, isLoading: false });
});

describe('alerts', () => {
  const alert = {
    id: 'a1',
    name: 'Casa',
    alert_latitude: -34.9,
    alert_longitude: -56.16,
    radius_km: 5,
    is_active: true,
  };

  it('draws the bell in the intro and the muted bell when there are no alerts', () => {
    set('useAlerts', q({ data: [] }));
    const ui = render(<AlertsScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['notifications', 'notifications-off']));
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws the pin on each alert card and not the muted bell', () => {
    set('useAlerts', q({ data: [alert] }));
    const ui = render(<AlertsScreen />);
    expect(drawnIcons(ui)).toContain('location-on');
    expect(drawnIcons(ui)).not.toContain('notifications-off');
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('badges', () => {
  it('draws the lock for a signed-out visitor', () => {
    mockAuth.mockReturnValue({ user: null, isAuthenticated: false });
    const ui = render(<BadgesScreen />);
    expect(drawnIcons(ui)).toEqual(['lock']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws the trophy title and the empty medal when signed in with no badges', () => {
    set('useMyBadges', q({ data: [] }));
    const ui = render(<BadgesScreen />);
    expect(drawnIcons(ui)).toEqual(['emoji-events', 'military-tech']);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('blocked users', () => {
  it('draws the green check in the empty state', () => {
    set('useBlockedUsers', q({ data: [] }));
    const ui = render(<BlockedUsersScreen />);
    expect(drawnIcons(ui)).toEqual(['check-circle']);
    expect(fillsOf(ui, 'check-circle')).toEqual([COLORS.success]);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('foster home detail', () => {
  it('tells apart a failed read (warning), offline (wifi-off) and a missing home (home)', () => {
    set('useFosterHomeByID', q({ data: undefined, isError: true, error: new ApiError('boom', 500, 'x') }));
    const failed = render(<FosterHomeDetailScreen />);
    expect(drawnIcons(failed)).toEqual(['warning']);
    failed.unmount();

    set('useFosterHomeByID', q({ data: undefined, isPaused: true }));
    const offline = render(<FosterHomeDetailScreen />);
    expect(drawnIcons(offline)).toEqual(['wifi-off']);
    offline.unmount();

    set('useFosterHomeByID', q({ data: undefined, isError: true, error: new ApiError('foster_home_not_found', 404, 'x') }));
    const missing = render(<FosterHomeDetailScreen />);
    expect(drawnIcons(missing)).toEqual(['home']);
    expect(emojiTexts(missing)).toEqual([]);
  });

  it('draws the placeholder home and the city pin for a home without photos', () => {
    set(
      'useFosterHomeByID',
      q({
        data: {
          id: 'f1',
          city: 'Canelones',
          housing_type: 'house',
          photos: [],
          animal_types: ['dog'],
          status: 'approved',
          user_id: 'other',
        },
      }),
    );
    const ui = render(<FosterHomeDetailScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['home', 'location-on']));
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('foster homes list and mine', () => {
  it('draws the placeholder home and the pin on each card', () => {
    set('useFosterHomes', q({ data: [{ id: 'f1', city: 'Salto', housing_type: 'house', photos: [], animal_types: ['dog'] }] }));
    const ui = render(<FosterHomesScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['home', 'location-on']));
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws the home when the user has not registered one yet', () => {
    set('useMyFosterHome', q({ data: undefined, isError: true, error: { status: 404, code: 'foster_home_not_found' } }));
    const ui = render(<FosterHomeMineScreen />);
    expect(drawnIcons(ui)).toEqual(['home']);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('groups', () => {
  it('draws the people icon for an empty list and the pin on each group card', () => {
    set('useGroups', q({ data: [] }));
    const empty = render(<GroupsScreen />);
    expect(drawnIcons(empty)).toEqual(expect.arrayContaining(['group']));
    expect(emojiTexts(empty)).toEqual([]);
    empty.unmount();

    set('useGroups', q({ data: [{ id: 'g1', city: 'Rocha', member_count: 3, is_member: false }] }));
    const full = render(<GroupsScreen />);
    expect(drawnIcons(full)).toContain('location-on');
    expect(drawnIcons(full)).not.toContain('group');
  });

  it('detail: not found draws the search icon; a group draws the pin, the people title and the empty-members hint', () => {
    set('useGroup', q({ data: undefined, isError: true }));
    const missing = render(<GroupDetailScreen />);
    expect(drawnIcons(missing)).toEqual(['search']);
    missing.unmount();

    set('useGroup', q({ data: { id: 'g1', city: 'Rocha', member_count: 0, is_member: false } }));
    set('useGroupMembers', q({ data: [] }));
    const ok = render(<GroupDetailScreen />);
    expect(drawnIcons(ok)).toEqual(expect.arrayContaining(['location-on', 'group', 'help']));
    expect(emojiTexts(ok)).toEqual([]);
  });
});

describe('leaderboard', () => {
  it('draws the legend medal, the city icon and the empty search icon', () => {
    set('useLeaderboard', q({ data: [] }));
    const ui = render(<LeaderboardScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['military-tech', 'location-city', 'search']));
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('my pets', () => {
  const pet = {
    id: 'p1',
    name: 'Rex',
    type: 'perro',
    status: 'registered',
    color: 'negro',
    photos: [{ id: 'ph', url: 'https://x/y.jpg' }],
    created_at: '2026-01-01T00:00:00Z',
  };

  it('draws the camera count and a delete icon that carries a label', () => {
    set('useMyPets', q({ data: [pet] }));
    set('useReportedPets', q({ data: [] }));
    const ui = render(<MyPetsScreen />);
    expect(drawnIcons(ui)).toEqual(expect.arrayContaining(['photo-camera', 'delete']));
    expect(fillsOf(ui, 'delete')).toEqual([COLORS.danger]);
    expect(ui.getByLabelText('common:delete')).toBeTruthy();
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('register pet', () => {
  it('draws the lock for a signed-out visitor, the camera and no emoji when signed in', () => {
    mockAuth.mockReturnValue({ user: null, isAuthenticated: false });
    const out = render(<RegisterPetScreen />);
    expect(drawnIcons(out)).toEqual(['lock']);
    expect(emojiTexts(out)).toEqual([]);
    out.unmount();

    mockAuth.mockReturnValue({ user: { id: 'u-1' }, isAuthenticated: true });
    const inn = render(<RegisterPetScreen />);
    expect(drawnIcons(inn)).toContain('photo-camera');
    expect(drawnIcons(inn)).not.toContain('lock');
    expect(emojiTexts(inn)).toEqual([]);
  });
});

describe('shelters', () => {
  it('draws the pin only on shelters that have a city', () => {
    set('useShelters', q({ data: [{ id: 's1', name: 'Refugio', city: 'Colonia', description: 'x', donation_url: 'https://x.org' }] }));
    const withCity = render(<SheltersScreen />);
    expect(drawnIcons(withCity)).toContain('location-on');
    expect(emojiTexts(withCity)).toEqual([]);
    withCity.unmount();

    set('useShelters', q({ data: [{ id: 's1', name: 'Refugio', description: 'x', donation_url: 'https://x.org' }] }));
    const without = render(<SheltersScreen />);
    expect(drawnIcons(without)).not.toContain('location-on');
  });
});

describe('stories', () => {
  const story = {
    id: 's1',
    pet_name: 'Luna',
    title: 'Volvio',
    body: 'Historia',
    like_count: 2,
    liked_by_me: false,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('list: draws the filled heart next to the like count', () => {
    set('useStories', q({ data: [story] }));
    const ui = render(<StoriesScreen />);
    expect(drawnIcons(ui)).toContain('favorite-filled');
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('create: draws the celebration icon', () => {
    const ui = render(<StoryCreateScreen />);
    expect(drawnIcons(ui)).toContain('celebration');
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('detail: tells apart a failed read (warning) from a missing story (sad face), and shows the pet badge', () => {
    set('useStory', q({ data: undefined, isError: true }));
    const failed = render(<StoryDetailScreen />);
    expect(drawnIcons(failed)).toEqual(['warning']);
    failed.unmount();

    set('useStory', q({ data: undefined }));
    const missing = render(<StoryDetailScreen />);
    expect(drawnIcons(missing)).toEqual(['sentiment-dissatisfied']);
    missing.unmount();

    set('useStory', q({ data: story }));
    const ok = render(<StoryDetailScreen />);
    expect(drawnIcons(ok)).toEqual(expect.arrayContaining(['pets', 'favorite']));
    expect(emojiTexts(ok)).toEqual([]);
  });
});
