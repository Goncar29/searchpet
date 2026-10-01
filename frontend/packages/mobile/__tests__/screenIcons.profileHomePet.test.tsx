// Profile menu, home chips, public profile and pet detail draw registry icons,
// not emoji. Every test reads the drawn `Path` (and its fill) and scans the
// Text nodes for leftovers, so it fails if the wrong glyph is drawn or an emoji
// returns. Distinctions are tested on BOTH sides (filled vs empty star, verified
// vs not).
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ProfileScreen from '../app/(tabs)/profile';
import HomeScreen from '../app/(tabs)/index';
import UserProfileScreen from '../app/users/[id]';
import PetDetailScreen from '../app/pet/[id]';
import { COLORS } from '../constants';
import { drawnIcons, emojiTexts, fillsOf } from './support/icons';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'x-1' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
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
  useLanguageStore: (selector: (s: unknown) => unknown) => selector({ setLanguage: jest.fn() }),
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

const mockProfile = jest.fn();
const mockReviews = jest.fn();
const mockPet = jest.fn();
const mockReports = jest.fn();
const mockSearch = jest.fn();
const mockStories = jest.fn();

// `@shared/hooks` and `../../shared/hooks` are the same module: one mock.
jest.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: [] }),
  usePublicProfile: (...a: unknown[]) => mockProfile(...a),
  useUploadProfilePhotoNative: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useVerificationStatus: () => ({ data: { is_verified: false }, error: null }),
  useSendEmailOTP: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useConfirmEmailOTP: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUserPets: () => ({
    data: { data: [], total: 0 },
    isLoading: false,
    isPending: false,
    isError: false,
    isPaused: false,
    refetch: jest.fn(),
  }),
  useUserReviews: (...a: unknown[]) => mockReviews(...a),
  useCreateReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useBlockUser: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [], isLoading: false, isError: false }),
  useSubmitAbuseReport: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  usePetByID: (...a: unknown[]) => mockPet(...a),
  useReportsByPetID: () => mockReports(),
  useMarkPetAsFound: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSearchPets: (...a: unknown[]) => mockSearch(...a),
  useStories: () => mockStories(),
  useImageClassify: () => ({ classify: jest.fn(), isModelLoading: false, isClassifying: false }),
  useImageSearchNative: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@shared/utils/whatsappTemplates', () => ({ buildWhatsAppContactURL: () => 'https://wa.me/' }));
jest.mock('../components/ShareButton', () => ({ ShareButton: () => null }));
jest.mock('../components/PdfFlyerButton', () => ({ PdfFlyerButton: () => null }));
jest.mock('../components/TimelineMap', () => ({ TimelineMap: () => null }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key),
    i18n: { language: 'es' },
  }),
}));

beforeEach(() => {
  mockAuth.mockReturnValue({
    user: { id: 'owner-1', name: 'Carlos', email: 'c@x.com', city: 'Montevideo' },
    isAuthenticated: true,
    isLoading: false,
    logout: jest.fn(),
  });
});

describe('profile screen', () => {
  beforeEach(() => mockProfile.mockReturnValue({ data: null }));

  it('draws one registry icon per menu row, the avatar placeholder and the city pin', () => {
    const ui = render(<ProfileScreen />);
    expect(drawnIcons(ui)).toEqual([
      'person',
      'location-on',
      'edit',
      'pets',
      'home',
      'emoji-events',
      'workspace-premium',
      'notifications',
      'group',
      'home-work',
      'location-city',
      'block',
      'settings',
      'language',
      'link',
    ]);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws the person icon on the signed-out screen', () => {
    mockAuth.mockReturnValue({ user: null, isAuthenticated: false, logout: jest.fn() });
    const ui = render(<ProfileScreen />);
    expect(drawnIcons(ui)).toEqual(['person']);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('public profile', () => {
  const profile = {
    id: 'x-1',
    name: 'Marina',
    city: 'Montevideo',
    total_points: 1,
    found_count: 0,
    total_reports: 0,
    share_count: 0,
    avg_rating: 3,
    badges: [] as unknown[],
    review_count: 1,
    created_at: '2026-01-01T00:00:00Z',
  };
  const review = {
    id: 'r1',
    reviewer_id: 'other',
    reviewee_id: 'x-1',
    stars: 2,
    comment: 'ok',
    created_at: '2026-01-02T00:00:00Z',
    reviewer_name: 'Pepe',
  };
  beforeEach(() => {
    mockProfile.mockReturnValue(ok(profile));
    mockReviews.mockReturnValue(ok({ reviews: [review] }));
  });

  it('lights as many rating stars as the rating and leaves the rest as outlines', () => {
    const ui = render(<UserProfileScreen />);
    expect(emojiTexts(ui)).toEqual([]);
    const lit = fillsOf(ui, 'star-filled').filter((f) => f === COLORS.accent);
    const dim = fillsOf(ui, 'star').filter((f) => f === COLORS.placeholder);
    // header rating 3 + the one review's 2 + the reviews section title icon; the
    // review form selector adds outlines but no lit stars before one is picked.
    expect(lit).toHaveLength(3 + 2 + 1);
    expect(dim.length).toBeGreaterThanOrEqual(2 + 3);
  });

  it('labels each rating row with the star count so screen readers get a number', () => {
    const ui = render(<UserProfileScreen />);
    expect(ui.getByLabelText('users:starCount:3')).toBeTruthy();
    expect(ui.getByLabelText('users:starCount:2')).toBeTruthy();
  });

  it('draws the search icon and no emoji when the profile does not exist', () => {
    mockProfile.mockReturnValue(ok(null));
    const ui = render(<UserProfileScreen />);
    expect(drawnIcons(ui)).toEqual(['search']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws icons for the city and the empty sections', () => {
    mockProfile.mockReturnValue(ok({ ...profile, avg_rating: 0 }));
    mockReviews.mockReturnValue(ok({ reviews: [] }));
    const ui = render(<UserProfileScreen />);
    expect(drawnIcons(ui)).toEqual(
      expect.arrayContaining(['location-on', 'military-tech', 'pets', 'chat-bubble']),
    );
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('pet detail', () => {
  const base = {
    id: 'x-1',
    name: 'Firulais',
    type: 'perro',
    color: 'negro',
    owner_id: 'owner-1',
    photos: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    owner: { id: 'owner-1', name: 'Ana', phone: '099', is_verified: false },
  };
  beforeEach(() => mockReports.mockReturnValue(ok([])));

  it('draws the search icon when the pet does not exist', () => {
    mockPet.mockReturnValue({ data: null, isLoading: false });
    const ui = render(<PetDetailScreen />);
    expect(drawnIcons(ui)).toEqual(['search']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('a lost pet shows the mark-as-found check icon, not the story button', () => {
    mockPet.mockReturnValue({ data: { ...base, status: 'lost' }, isLoading: false });
    const ui = render(<PetDetailScreen />);
    const icons = drawnIcons(ui);
    expect(icons).toContain('check-circle');
    expect(icons).not.toContain('celebration');
    expect(icons).toContain('person');
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('a found pet shows the story button icon, not the mark-as-found one', () => {
    mockPet.mockReturnValue({ data: { ...base, status: 'found' }, isLoading: false });
    const ui = render(<PetDetailScreen />);
    const icons = drawnIcons(ui);
    expect(icons).toContain('celebration');
    expect(icons).not.toContain('check-circle');
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('a verified report shows the check and its place the pin; an unverified one neither', () => {
    mockPet.mockReturnValue({ data: { ...base, status: 'lost', owner_id: 'someone' }, isLoading: false });
    const report = (over: object) => ({
      id: 'rep',
      pet_id: 'x-1',
      status: 'sighting',
      latitude: 1,
      longitude: 1,
      created_at: '2024-02-01T00:00:00Z',
      ...over,
    });
    mockReports.mockReturnValue(ok([report({ is_verified: true, location_description: 'Parque Rodo' })]));
    const withBoth = render(<PetDetailScreen />);
    expect(drawnIcons(withBoth)).toEqual(expect.arrayContaining(['check', 'location-on']));
    expect(emojiTexts(withBoth)).toEqual([]);
    withBoth.unmount();

    mockReports.mockReturnValue(ok([report({ is_verified: false })]));
    const withNone = render(<PetDetailScreen />);
    expect(drawnIcons(withNone)).not.toContain('check');
    expect(drawnIcons(withNone)).not.toContain('location-on');
  });
});

describe('home screen', () => {
  beforeEach(() => {
    mockSearch.mockReturnValue(ok([]));
    mockStories.mockReturnValue(
      ok([{ id: 's1', pet_name: 'Luna', body: 'Volvio a casa', like_count: 4, created_at: '2026-01-01T00:00:00Z' }]),
    );
    mockAuth.mockReturnValue({ user: null, isAuthenticated: false });
  });

  it('draws the filter chips, story likes and login arrow as icons with no emoji', () => {
    const ui = render(<HomeScreen />);
    expect(drawnIcons(ui)).toEqual(
      expect.arrayContaining(['tune', 'photo-camera', 'favorite-filled', 'arrow-forward']),
    );
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('tints the "more filters" icon with the chip state', () => {
    const ui = render(<HomeScreen />);
    expect(fillsOf(ui, 'tune')).toEqual([COLORS.textSecondary]);
    fireEvent.press(ui.getByText('home:more'));
    expect(fillsOf(ui, 'tune')).toEqual([COLORS.white]);
  });
});
