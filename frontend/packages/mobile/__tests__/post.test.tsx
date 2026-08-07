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

describe('PostScreen — salir del paso elegido', () => {
  // Elegir una de las tres opciones era un camino de ida: ningun paso recibia
  // un onBack, asi que la unica salida era irse a otra pestana.
  it('vuelve a las tres opciones desde el paso de mascota perdida', () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    });
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:lostPet.title')).toBeTruthy();

    fireEvent.press(getByText('← publish:back'));
    expect(getByText('publish:intent.title')).toBeTruthy();
  });

  it('vuelve a las tres opciones desde el formulario de callejera', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));
    expect(getByText('publish:strayForm.title')).toBeTruthy();

    fireEvent.press(getByText('← publish:back'));
    expect(getByText('publish:intent.title')).toBeTruthy();
  });

  it('vuelve a las tres opciones desde el formulario de adopcion', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('adoption:publish.intentOption'));
    expect(getByText('adoption:publish.title')).toBeTruthy();

    fireEvent.press(getByText('← publish:back'));
    expect(getByText('publish:intent.title')).toBeTruthy();
  });

  it('vuelve a las tres opciones desde el login al que cae un visitante sin sesion', () => {
    mockAuthState.isAuthenticated = false;
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));
    expect(getByText('publish:auth.title')).toBeTruthy();

    fireEvent.press(getByText('← publish:back'));
    expect(getByText('publish:intent.title')).toBeTruthy();
  });
});

describe('PostScreen — el usuario ya tiene mascotas propias', () => {
  it('con mascotas propias pero ninguna elegible, manda a Mis mascotas y no a crear otra', () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Nala', type: 'perro', status: 'lost', photos: [] }],
      isLoading: false,
    });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));

    expect(getByText('publish:lostPet.noneEligible')).toBeTruthy();
    expect(queryByText('publish:lostPet.empty')).toBeNull();
  });

  // Una publicacion de adopcion es una mascota propia, pero la pestana "Mis
  // mascotas" del destino la deja en su propia solapa: mandarlo ahi lo dejaba
  // en una pestana vacia que le dice que no tiene mascotas.
  it('con SOLO una publicacion de adopcion ofrece registrar, porque Mis mascotas le quedaria vacia', () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Toby', type: 'perro', status: 'adoption', photos: [] }],
      isLoading: false,
    });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));

    expect(getByText('publish:lostPet.empty')).toBeTruthy();
    expect(queryByText('publish:lostPet.noneEligible')).toBeNull();
  });
});

// El reporte inicial de mobile solo podia decir DONDE. Entre que una mascota
// se pierde y el dueno llega a publicarla pueden pasar dias, asi que la fecha
// de creacion no sustituye a cuando ocurrio.
describe('PostScreen — fecha del reporte', () => {
  const abrirUbicacion = () => {
    useMyPets.mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    });
    const utils = render(<PostScreen />);
    fireEvent.press(utils.getByText('publish:intent.lostTitle'));
    fireEvent.press(utils.getByText('Firulais'));
    return utils;
  };

  it('manda la fecha en que se perdio', async () => {
    const { getByText, getByTestId } = abrirUbicacion();
    fireEvent.changeText(getByTestId('location-date-input'), '2026-08-04');
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    // Se afirma el DIA que se lee de vuelta, no un string UTC literal: mandar
    // `2026-08-04T00:00:00Z` guardaba el 3 en toda zona al oeste de Greenwich,
    // y un literal ataria el test a la zona del runner tapando ese bug.
    const enviado = mockPublishLostMutateAsync.mock.calls[0][0].data.occurred_at as string;
    const vuelta = new Date(enviado);
    const dia = `${vuelta.getFullYear()}-${String(vuelta.getMonth() + 1).padStart(2, '0')}-${String(vuelta.getDate()).padStart(2, '0')}`;
    expect(dia).toBe('2026-08-04');
  });

  it('sin fecha no manda occurred_at', async () => {
    const { getByText } = abrirUbicacion();
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    const enviado = mockPublishLostMutateAsync.mock.calls[0][0];
    expect(enviado.data.occurred_at).toBeUndefined();
  });

  // Se valida en el cliente porque el backend rechaza con invalid_input
  // generico, sin decir cual campo: el usuario veria un rojo sin saber que
  // corregir.
  it('bloquea una fecha futura y no envia nada', async () => {
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { getByText, getByTestId } = abrirUbicacion();
    fireEvent.changeText(getByTestId('location-date-input'), manana);
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    expect(mockPublishLostMutateAsync).not.toHaveBeenCalled();
    expect(getByText('publish:location.dateFuture')).toBeTruthy();
  });

  it('bloquea una fecha con formato invalido', async () => {
    const { getByText, getByTestId } = abrirUbicacion();
    fireEvent.changeText(getByTestId('location-date-input'), '04/08/2026');
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    expect(mockPublishLostMutateAsync).not.toHaveBeenCalled();
    expect(getByText('publish:location.dateInvalid')).toBeTruthy();
  });

  // 31 de febrero tiene la forma correcta pero no existe: el regex solo no
  // alcanza, por eso se compara el ISO de vuelta.
  it('bloquea una fecha con forma valida pero inexistente', async () => {
    const { getByText, getByTestId } = abrirUbicacion();
    fireEvent.changeText(getByTestId('location-date-input'), '2026-02-31');
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });

    expect(mockPublishLostMutateAsync).not.toHaveBeenCalled();
    expect(getByText('publish:location.dateInvalid')).toBeTruthy();
  });
});
