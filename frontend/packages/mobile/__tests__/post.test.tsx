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

jest.mock('../store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    const state = {
      user: { id: 'user-1', name: 'Carlos' },
      token: 'jwt-token',
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      register: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: (selector: (state: unknown) => unknown) => {
    const state = { latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@shared/hooks', () => ({
  useMyPets: jest.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  usePublishStrayNative: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useUploadPhotoNative: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

const { useMyPets } = jest.requireMock('@shared/hooks');

beforeEach(() => {
  useMyPets.mockReturnValue({ data: [], isLoading: false });
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

    expect(getByText('publish:success.lostTitle')).toBeTruthy();
  });
});
