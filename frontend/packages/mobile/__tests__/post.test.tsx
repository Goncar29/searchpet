// Post (Publish wizard) screen smoke test
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import PostScreen from '../app/(tabs)/post';

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      setAccessToken: jest.fn(),
      MapView: ({ children, ...props }: any) => React.createElement(View, { testID: 'map', ...props }, children),
      Camera: () => null,
      UserLocation: () => null,
      PointAnnotation: ({ children, onDragEnd, ...props }: any) =>
        React.createElement(View, { testID: 'pin', onTouchEnd: () => onDragEnd?.({ geometry: { coordinates: [-56.2, -34.95] } }), ...props }, children),
    },
  };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: -34.95, longitude: -56.2 } }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));

const mockAuthState = {
  user: { id: 'user-1', name: 'Carlos' } as { id: string; name: string } | null,
  token: 'jwt-token' as string | null,
  isAuthenticated: true,
  isLoading: false,
  login: jest.fn(),
  register: jest.fn(),
};

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    return typeof selector === 'function' ? selector(mockAuthState) : mockAuthState;
  },
  useLocationStore: (selector: (state: unknown) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const mockPublishLostMutateAsync = jest.fn();
const mockCreatePetMutateAsync = jest.fn();

jest.mock('@shared/hooks', () => ({
  useMyPets: jest.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: jest.fn(() => ({ mutateAsync: mockPublishLostMutateAsync, isPending: false })),
  usePublishStrayNative: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useCreatePet: jest.fn(() => ({ mutateAsync: mockCreatePetMutateAsync, isPending: false })),
  useUploadPhotoNative: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

const { useMyPets } = jest.requireMock('@shared/hooks');

beforeEach(() => {
  useMyPets.mockReturnValue({ data: [], isLoading: false });
  mockPublishLostMutateAsync.mockReset();
  mockPublishLostMutateAsync.mockResolvedValue({ id: 'pet-1', status: 'lost' });
  mockCreatePetMutateAsync.mockReset();
  mockCreatePetMutateAsync.mockResolvedValue({ id: 'pet-2', name: 'Sin nombre', status: 'adoption' });
  mockAuthState.isAuthenticated = true;
  mockAuthState.user = { id: 'user-1', name: 'Carlos' };
  mockAuthState.login = jest.fn();
  mockAuthState.register = jest.fn();
});

describe('PostScreen (Publish wizard)', () => {
  it('renders the intent step first', () => {
    const { getByText } = render(<PostScreen />);
    expect(getByText('publish:intent.lostTitle')).toBeTruthy();
    expect(getByText('publish:intent.strayTitle')).toBeTruthy();
  });

  it('selecting the lost intent advances to the lost-pet step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.empty')).toBeTruthy();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));
    expect(getByText('publish:strayForm.title')).toBeTruthy();
  });

  it('renders the adoption intent option and advances to the adoption-form step when selected', () => {
    const { getByText } = render(<PostScreen />);
    expect(getByText('adoption:publish.intentOption')).toBeTruthy();
    fireEvent.press(getByText('adoption:publish.intentOption'));
    expect(getByText('adoption:publish.title')).toBeTruthy();
  });
});

describe('PostScreen — lost path', () => {
  it('shows the empty state when there are no eligible pets', () => {
    useMyPets.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.empty')).toBeTruthy();
  });

  it('lists registered pets and selecting one advances to location', () => {
    useMyPets.mockReturnValue({
      data: [
        { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] },
        { id: 'pet-2', name: 'Michi', type: 'gato', status: 'lost', photos: [] },
      ],
      isLoading: false,
    });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('Firulais')).toBeTruthy();
    expect(queryByText('Michi')).toBeNull();
    fireEvent.press(getByText('Firulais'));
    expect(getByText('publish:location.title')).toBeTruthy();
  });
});

describe('PostScreen — stray path', () => {
  it('blocks continuing without photo or type, then advances once both are set', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///stray.jpg' }],
    });

    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));

    fireEvent.press(getByText('publish:strayForm.next'));
    expect(getByText('publish:strayForm.photoRequired')).toBeTruthy();
    expect(getByText('publish:strayForm.typeRequired')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('publish:strayForm.gallery'));
    });
    await waitFor(() => expect(queryByText('publish:strayForm.photoRequired')).toBeNull());

    fireEvent.press(getByText('pets:types.perro'));
    fireEvent.press(getByText('publish:strayForm.next'));
    expect(getByText('publish:location.title')).toBeTruthy();
  });
});

describe('PostScreen — adoption path', () => {
  it('blocks submitting without photo, type, or city, then creates the pet and advances to success', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///adoption.jpg' }],
    });

    const { getByText, queryByText, getByPlaceholderText } = render(<PostScreen />);
    fireEvent.press(getByText('adoption:publish.intentOption'));

    fireEvent.press(getByText('adoption:publish.submit'));
    expect(getByText('publish:strayForm.photoRequired')).toBeTruthy();
    expect(getByText('publish:strayForm.typeRequired')).toBeTruthy();
    expect(getByText('adoption:publish.cityRequired')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('publish:strayForm.gallery'));
    });
    await waitFor(() => expect(queryByText('publish:strayForm.photoRequired')).toBeNull());

    fireEvent.press(getByText('pets:types.perro'));
    fireEvent.changeText(getByPlaceholderText('adoption:publish.cityPlaceholder'), 'Montevideo');

    await act(async () => {
      fireEvent.press(getByText('adoption:publish.submit'));
    });

    expect(mockCreatePetMutateAsync).toHaveBeenCalledWith({
      name: 'publish:strayForm.unnamedPet',
      type: 'perro',
      breed: undefined,
      color: undefined,
      description: undefined,
      city: 'Montevideo',
      status: 'adoption',
    });
    expect(getByText('publish:success.adoptionTitle')).toBeTruthy();
  });
});

describe('PostScreen — location step', () => {
  it('renders the map and publishes with the default Montevideo location', async () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    });
    const { getByText, getByTestId } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    fireEvent.press(getByText('Firulais'));

    expect(getByText('publish:location.title')).toBeTruthy();
    expect(getByTestId('map')).toBeTruthy();

    fireEvent.changeText(getByTestId('location-note-input'), 'Cerca de la plaza');
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    expect(mockPublishLostMutateAsync).toHaveBeenCalledWith({
      id: 'pet-1',
      data: { latitude: -34.9011, longitude: -56.1645, note: 'Cerca de la plaza' },
    });
    expect(getByText('publish:success.lostTitle')).toBeTruthy();
  });
});

describe('PostScreen — unauthenticated lost path', () => {
  it('routes a guest selecting "lost" to inline auth instead of the dead-end empty state', async () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.user = null;
    mockAuthState.login = jest.fn().mockImplementation(async () => {
      mockAuthState.isAuthenticated = true;
      mockAuthState.user = { id: 'user-3', name: 'Carlos' };
    });

    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    });

    const { getByText, queryByText, getByPlaceholderText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));

    // Guest must see inline auth, never the empty-state dead-end.
    expect(getByText('publish:auth.title')).toBeTruthy();
    expect(queryByText('publish:lostPet.empty')).toBeNull();

    fireEvent.changeText(getByPlaceholderText('auth:login.email'), 'carlos@test.com');
    fireEvent.changeText(getByPlaceholderText('auth:login.password'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('publish:auth.continue'));
    });

    // After auth, lost flow advances to lost-pet selection (not auto-submit).
    expect(getByText('Firulais')).toBeTruthy();
    expect(mockAuthState.login).toHaveBeenCalledWith('carlos@test.com', 'password123');
  });
});
