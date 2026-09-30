// The shared mobile components draw registry icons, not emoji.
//
// Every test reads the drawn `Path` for the expected icon AND scans the Text
// nodes for leftover emoji, so it fails both when the wrong glyph is drawn and
// when an emoji creeps back. Intentional exception: emoji inside the WhatsApp
// message text (`shared/utils/whatsappTemplates.ts`) and in the flyer PDF are
// out of scope and never reach these components' Text nodes.
import React from 'react';
import Svg from 'react-native-svg';
import { render } from '@testing-library/react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Pet, Report, StrayCandidate } from '../../shared/types';
import { ListState } from '../components/list/ListState';
import { PetCard } from '../components/PetCard';
import { PdfFlyerButton } from '../components/PdfFlyerButton';
import { AdoptionPetBody } from '../components/AdoptionPetBody';
import { IntentStep } from '../components/publish/IntentStep';
import { SuccessStep } from '../components/publish/SuccessStep';
import { CandidatesStep } from '../components/publish/CandidatesStep';
import { drawnIcons, emojiTexts } from './support/icons';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));
const authState = { user: null as null | { id: string }, isAuthenticated: false };
jest.mock('../store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));
jest.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));
jest.mock('../components/ShareButton', () => ({ ShareButton: () => null }));
// `@shared/hooks` and `../../shared/hooks` are the same module: one mock.
jest.mock('@shared/hooks', () => ({
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useGenerateShareLink: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

const pet: Pet = {
  id: 'pet-1',
  owner_id: 'owner-1',
  name: 'Michi',
  type: 'gato',
  color: 'gris',
  status: 'adoption',
  city: 'Montevideo',
  photos: [],
  owner: { id: 'owner-1', name: 'Ana', is_verified: false },
  created_at: new Date().toISOString(),
};

describe('ListState error card', () => {
  const query = {
    data: undefined,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: true,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<unknown[]>;

  it('draws the warning icon, hidden from screen readers, and no emoji', () => {
    const ui = render(
      <ListState query={query} loading={null}>
        {() => null}
      </ListState>,
    );
    expect(drawnIcons(ui)).toEqual(['warning']);
    expect(emojiTexts(ui)).toEqual([]);
    const svg = ui.UNSAFE_getByType(Svg);
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(svg.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('PetCard', () => {
  it('draws location-on next to the location and no emoji', () => {
    const report = {
      id: 'r1',
      pet_id: 'pet-1',
      reporter_id: 'u1',
      status: 'lost',
      latitude: 0,
      longitude: 0,
      is_verified: false,
      created_at: new Date().toISOString(),
      location_description: 'Plaza Independencia',
      pet: { ...pet, status: 'lost', type: 'perro' },
    } as unknown as Report;
    const ui = render(<PetCard report={report} onPress={() => {}} />);
    expect(ui.getByText('Plaza Independencia')).toBeTruthy();
    expect(drawnIcons(ui)).toContain('location-on');
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('PdfFlyerButton', () => {
  it('draws description in the button and no emoji', () => {
    const ui = render(<PdfFlyerButton pet={pet} />);
    expect(drawnIcons(ui)).toEqual(['description']);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('AdoptionPetBody', () => {
  it('adopted: draws the celebration icon and no emoji', () => {
    const ui = render(<AdoptionPetBody pet={{ ...pet, status: 'adopted' }} />);
    expect(drawnIcons(ui)).toEqual(['celebration']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('logged out: draws person and lock, no emoji', () => {
    const ui = render(<AdoptionPetBody pet={pet} />);
    expect(drawnIcons(ui)).toEqual(['person', 'lock']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('logged in: draws person, chat-bubble and the flyer button icon, no emoji', () => {
    authState.user = { id: 'other' };
    authState.isAuthenticated = true;
    const ui = render(<AdoptionPetBody pet={pet} />);
    authState.user = null;
    authState.isAuthenticated = false;
    expect(drawnIcons(ui)).toEqual(['person', 'chat-bubble', 'description']);
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('publish wizard', () => {
  it('IntentStep draws pets, location-on and home, in that order', () => {
    const ui = render(<IntentStep onSelect={() => {}} />);
    expect(drawnIcons(ui)).toEqual(['pets', 'location-on', 'home']);
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('SuccessStep draws check-circle and no emoji', () => {
    const ui = render(
      <SuccessStep
        pet={{ ...pet, status: 'stray' }}
        intent="stray"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
        onGoToFeed={jest.fn()}
      />,
    );
    expect(drawnIcons(ui)).toContain('check-circle');
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('CandidatesStep draws pets in the empty photo slot and no emoji', () => {
    const sinFoto: StrayCandidate = {
      id: 'c1',
      name: 'Marroncito',
      type: 'perro',
      photo_url: '',
      last_seen_nearby_at: new Date().toISOString(),
      distance_meters: 100,
    };
    const query = {
      data: [sinFoto],
      isLoading: false,
      isPending: false,
      isFetching: false,
      isPaused: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as UseQueryResult<StrayCandidate[]>;
    const ui = render(<CandidatesStep query={query} onSelect={jest.fn()} onSkip={jest.fn()} />);
    expect(drawnIcons(ui)).toContain('pets');
    expect(emojiTexts(ui)).toEqual([]);
  });
});
