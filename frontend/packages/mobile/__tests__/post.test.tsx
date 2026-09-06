// Post (Publish wizard) screen smoke test
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import PostScreen from '../app/(tabs)/post';

// El mock global de `jest.setup.js` devuelve un `jest.fn()` NUEVO en cada
// llamada a useRouter(), así que no se puede afirmar nada sobre él desde
// afuera. Acá hace falta una referencia estable para verificar a dónde deriva
// "es este".
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

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
const mockCreateReportMutateAsync = jest.fn();
const mockPublishStrayMutateAsync = jest.fn();

jest.mock('@shared/hooks', () => ({
  useMyPets: jest.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: jest.fn(() => ({ mutateAsync: mockPublishLostMutateAsync, isPending: false })),
  usePublishStrayNative: jest.fn(() => ({ mutateAsync: mockPublishStrayMutateAsync, isPending: false })),
  useCreatePet: jest.fn(() => ({ mutateAsync: mockCreatePetMutateAsync, isPending: false })),
  useUploadPhotoNative: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  // Por default: NO hay callejeros cerca. Con eso el paso de candidatos se
  // saltea solo y los casos de abajo siguen midiendo lo que siempre midieron —
  // el default del mock preserva el flujo anterior en vez de reescribirlo.
  // Los casos que SÍ ejercitan el paso pisan este valor.
  useStrayCandidates: jest.fn(() => ({
    data: [],
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    refetch: jest.fn(),
  })),
  useCreateReport: jest.fn(() => ({ mutateAsync: mockCreateReportMutateAsync, isPending: false })),
}));

const { useMyPets, useStrayCandidates } = jest.requireMock('@shared/hooks');

beforeEach(() => {
  useMyPets.mockReturnValue({ data: [], isLoading: false });
  // Vuelve al default "no hay callejeros cerca", así el paso se saltea y los
  // casos que no lo ejercitan miden lo que siempre midieron.
  useStrayCandidates.mockReturnValue({
    data: [],
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockPublishStrayMutateAsync.mockReset();
  mockPublishStrayMutateAsync.mockResolvedValue({
    pet: { id: 'pet-2', name: 'Sin nombre', type: 'perro', status: 'stray', photos: [] },
    failedPhotoIndexes: [],
  });
  mockCreateReportMutateAsync.mockReset();
  mockCreateReportMutateAsync.mockResolvedValue({ id: 'report-1' });
  mockPush.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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

  // El asterisco de obligatorio del campo Tipo se escribe ACA, en el JSX, y ya no
  // viene dentro de la traduccion: la clave es compartida con la web, donde
  // FormField dibuja el suyo, y con el asterisco en el texto salian DOS.
  //
  // Este assert es el unico que lo protege. La clave ahora esta guardada por
  // shared/i18n/locales.test.ts, que exige que NO tenga asterisco — asi que sin
  // esto, alguien que borre el ` *` de este componente deja a mobile sin su unica
  // marca de obligatorio con la suite entera en verde.
  it('el campo Tipo conserva su marca de obligatorio en mobile', () => {
    const { getByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.strayTitle'));
    expect(getByText('publish:strayForm.typeLabel *')).toBeTruthy();
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

  // Una consulta CAIDA no puede decir "no tenes mascotas". Con `pets` en
  // undefined, `eligiblePets` queda vacio y `ownsAnyPet` en false, asi que el
  // paso mostraba el cartel de "registrate una" y mandaba a /pets/register: al
  // dueno de una mascota se le pedia registrarla DE NUEVO, y el duplicado que
  // sale de ahi nace de un error de red.
  //
  // La mitad positiva la afirma el test de arriba ("shows the empty state when
  // there are no eligible pets"), que sigue exigiendo el cartel con `data: []`.
  // Sin esa otra mitad, un guard escrito de mas —que tapara tambien el vacio
  // real— pasaria verde y dejaria sin salida a quien de verdad no tiene ninguna.
  it('una consulta caida avisa que fallo, y NO dice que no tenes mascotas', () => {
    useMyPets.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));

    expect(getByText('common:loadErrorTitle')).toBeTruthy();
    expect(queryByText('publish:lostPet.empty')).toBeNull();
    expect(queryByText('publish:lostPet.noneEligible')).toBeNull();
  });

  // Sin red el cartel tiene que hablar de la CONEXION. El de error de carga
  // culpa al servidor, que offline es falso — y lo accionable ahi es "cuando
  // vuelva la conexion", no "reintentar contra un servidor que no tiene la culpa".
  it('sin conexion avisa que es la red, no que la lista este vacia', () => {
    useMyPets.mockReturnValue({ data: undefined, isLoading: false, isPaused: true });
    const { getByText, queryByText } = render(<PostScreen />);
    fireEvent.press(getByText('publish:intent.lostTitle'));

    expect(getByText('common:offlineTitle')).toBeTruthy();
    expect(queryByText('publish:lostPet.empty')).toBeNull();
    expect(queryByText('common:loadErrorTitle')).toBeNull();
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

// El paso sólo cumple su función si INTERCEPTA: mostrar la lista sin frenar el
// alta no evitaría ningún duplicado. Por eso lo que se afirma acá es que NO se
// publicó — que la tarjeta se dibuje ya lo cubre CandidatesStep.test.
describe('PostScreen — el paso de candidatos intercepta el alta', () => {
  const candidato = {
    id: 'pet-vecino',
    name: 'Marroncito',
    type: 'perro',
    photo_url: '',
    last_seen_nearby_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    distance_meters: 312,
  };

  const conCandidatos = (over: Record<string, unknown> = {}) => {
    useStrayCandidates.mockReturnValue({
      data: [candidato],
      isLoading: false,
      isPending: false,
      isPaused: false,
      isError: false,
      refetch: jest.fn(),
      ...over,
    });
  };

  // Deja el wizard parado en el paso de candidatos, con el borrador completo.
  const llegarACandidatos = async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///stray.jpg' }],
    });
    const utils = render(<PostScreen />);
    fireEvent.press(utils.getByText('publish:intent.strayTitle'));
    await act(async () => {
      fireEvent.press(utils.getByText('publish:strayForm.gallery'));
    });
    fireEvent.press(utils.getByText('pets:types.perro'));
    fireEvent.press(utils.getByText('publish:strayForm.next'));
    await act(async () => {
      fireEvent.press(utils.getByText('publish:location.publish'));
    });
    return utils;
  };

  it('con un callejero cerca pregunta ANTES de publicar, y no publica', async () => {
    conCandidatos();
    const { getByText, queryByText } = await llegarACandidatos();

    expect(getByText('publish:candidates.title')).toBeTruthy();
    expect(getByText('Marroncito')).toBeTruthy();
    // Lo que importa: la mascota NO se creó.
    expect(mockPublishStrayMutateAsync).not.toHaveBeenCalled();
    expect(queryByText('publish:success.strayTitle')).toBeNull();
  });

  it('"ninguno" publica el callejero nuevo', async () => {
    conCandidatos();
    const { getByText } = await llegarACandidatos();

    await act(async () => {
      fireEvent.press(getByText('publish:candidates.noneOfThem'));
    });

    expect(mockPublishStrayMutateAsync).toHaveBeenCalledTimes(1);
    expect(getByText('publish:success.strayTitle')).toBeTruthy();
  });

  // "Es este" reporta sobre la ficha existente CON la ubicación que la persona
  // ya marcó, y no crea ninguna mascota. Un tap, sin volver a pedir el dato.
  it('"es este" reporta sobre la ficha existente y NO crea nada', async () => {
    conCandidatos();
    const { getByText } = await llegarACandidatos();

    fireEvent.press(getByText('publish:candidates.isThisOne'));

    // El Alert de confirmación: se dispara el botón de confirmar.
    const [, , botones] = (Alert.alert as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      await botones.find((b: { text: string }) => b.text === 'publish:candidates.confirmAction').onPress();
    });

    expect(mockCreateReportMutateAsync).toHaveBeenCalledWith({
      pet_id: 'pet-vecino',
      status: 'sighting',
      latitude: -34.9011,
      longitude: -56.1645,
    });
    expect(mockPublishStrayMutateAsync).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/pet/pet-vecino');
  });

  // Una consulta caída no puede dejar a nadie sin publicar un animal que está
  // en la calle ahora: se muestra el cartel y la salida sigue publicando.
  it('con la consulta caída ofrece publicar igual, y publica', async () => {
    conCandidatos({ data: undefined, isError: true });
    const { getByText } = await llegarACandidatos();

    expect(getByText('publish:candidates.errorTitle')).toBeTruthy();
    expect(mockPublishStrayMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByText('publish:candidates.publishAnyway'));
    });
    expect(mockPublishStrayMutateAsync).toHaveBeenCalledTimes(1);
  });

  // Los dos botones del paso siguen ADELANTE (publicar igual / es este), así
  // que sin la flecha una ubicación mal marcada no tiene arreglo salvo salirse
  // de la pestaña. Y tiene que volver a `location` con el borrador VIVO: si
  // rebotara al selector, corregir el pin costaría cargar las fotos de nuevo.
  it('la flecha vuelve al mapa sin perder el borrador', async () => {
    conCandidatos();
    const { getByText, queryByText } = await llegarACandidatos();

    fireEvent.press(getByText('← publish:backStep'));

    expect(getByText('publish:location.publish')).toBeTruthy();
    expect(queryByText('publish:intent.strayTitle')).toBeNull();

    // El borrador sobrevivió: volver a publicar reabre el paso de candidatos
    // en vez de rebotar por falta de datos.
    await act(async () => {
      fireEvent.press(getByText('publish:location.publish'));
    });
    expect(getByText('publish:candidates.title')).toBeTruthy();
    expect(mockPublishStrayMutateAsync).not.toHaveBeenCalled();
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
