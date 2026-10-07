// Pet Detail screen smoke test
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import PetDetailScreen from '../app/pet/[id]';

// expo-router setup: useLocalSearchParams returns { id: 'pet-123' }
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'pet-123' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

let mockAuthUser: { id: string } | null = null;

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      user: mockAuthUser,
      token: null,
      isAuthenticated: mockAuthUser != null,
      isLoading: false,
      login: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
}));

const mockUsePetByID = jest.fn();
const mockBlockMutate = jest.fn();
const mockUseReportsByPetID = jest.fn();
const mockMarkFoundMutate = jest.fn();
const mockUseHelperCandidates = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('@shared/hooks', () => ({
  usePetByID: (...args: unknown[]) => mockUsePetByID(...args),
  useReportsByPetID: () => mockUseReportsByPetID(),
  useMarkPetAsFound: () => ({ mutate: mockMarkFoundMutate, isPending: false }),
  useHelperCandidates: (...args: unknown[]) => mockUseHelperCandidates(...args),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));

jest.mock('../components/PdfFlyerButton', () => ({
  PdfFlyerButton: () => null,
}));

jest.mock('../components/TimelineMap', () => ({
  TimelineMap: () => null,
}));

const mockPetBase = {
  id: 'pet-123',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'negro',
  description: 'Un perro muy bueno',
  owner_id: 'owner-1',
  photos: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  mockUsePetByID.mockReturnValue({ data: null, isLoading: true });
  mockUseReportsByPetID.mockReturnValue({ data: [] });
});

// El historial de avistamientos es lo que dice DONDE se vio a la mascota. Con
// `reports ?? []` una consulta caida dibujaba el mapa vacio, o sea "nadie la
// vio" — y esa es la pregunta entera de la pantalla en una app para encontrar
// mascotas perdidas.
//
// `errorTitle` nombra la SECCION y no la causa. El titulo por defecto dice "no
// pudimos cargar esta lista", que en las pantallas donde la lista ES la pagina
// se entiende solo; aca el cartel aterriza en medio de un detalle donde la foto,
// los datos y el contacto cargaron bien, asi que sin nombrar el historial el
// usuario no sabe a que se refiere. Mismo criterio que la web (PR #190).
describe('PetDetailScreen — el historial no pudo cargar', () => {
  const petVisible = {
    ...mockPetBase,
    status: 'lost',
    owner: { id: 'owner-1', name: 'Ana', phone: '099', is_verified: false },
  };

  it('avisa que fallo el historial, nombrando la seccion', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: undefined, isError: true });
    const { getByText, queryByText } = render(<PetDetailScreen />);

    expect(getByText('pets:detail.timelineLoadError')).toBeTruthy();
    // El titulo generico NO: no nombra que seccion fallo.
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  // La mitad positiva. Un historial genuinamente vacio —una mascota registrada
  // que nadie reporto todavia— no puede disparar el cartel: ahi SI preguntamos y
  // la respuesta fue "ninguno". Sin este test, un guard escrito de mas pondria
  // "no pudimos cargar" sobre cada mascota sin avistamientos.
  it('un historial vacio de verdad no dispara ningun cartel', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: [] });
    const { queryByText } = render(<PetDetailScreen />);

    expect(queryByText('pets:detail.timelineLoadError')).toBeNull();
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  // El resto de la pantalla NO se cae con el historial: la foto, los datos y el
  // contacto cargaron bien y se siguen viendo. Una falla, un cartel.
  it('el detalle sigue en pie aunque el historial falle', () => {
    mockUsePetByID.mockReturnValue({ data: petVisible, isLoading: false });
    mockUseReportsByPetID.mockReturnValue({ data: undefined, isError: true });
    const { getByText } = render(<PetDetailScreen />);

    expect(getByText('Firulais')).toBeTruthy();
  });
});

describe('PetDetailScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<PetDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra el badge REGISTRADA para mascotas con status registered', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'registered' },
      isLoading: false,
    });
    const { queryByText } = render(<PetDetailScreen />);
    expect(queryByText(/perdido/i)).toBeNull();
  });

  it('no muestra el badge de status lost para mascotas con status found', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'found' },
      isLoading: false,
    });
    const { queryByText } = render(<PetDetailScreen />);
    expect(queryByText(/pets:status\.lost/i)).toBeNull();
  });

  it('routes adoption pets to the adoption body (no lost scaffolding)', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'adoption', city: 'Montevideo', owner: { id: 'owner-1', name: 'Ana' } },
      isLoading: false,
    });
    const { queryByTestId } = render(<PetDetailScreen />);
    // login-gate is unique to AdoptionPetBody → proves the adoption body rendered
    // in place of the lost-pet body (which has no such element).
    expect(queryByTestId('login-gate')).toBeTruthy();
  });
});

// Cuándo se vio por última vez al animal (issue #221).
//
// Igual que en la ficha web, estos tests NO verifican el texto traducido: el
// arnés devuelve la clave. Afirman la DECISIÓN DE RENDERIZAR. El texto lo cubren
// los tests del helper y los plurales i18n.plurals.test.ts.
describe('ultima vista', () => {
  it('muestra el bloque cuando el backend manda la fecha', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'stray', last_seen_at: '2026-05-03T09:30:00Z' },
      isLoading: false,
    });
    const { getByTestId } = render(<PetDetailScreen />);
    expect(getByTestId('last-seen')).toBeTruthy();
  });

  // La mitad negativa: un bloque que se renderiza siempre con texto vacío no se
  // ve como un error, se ve como un hueco sin explicación.
  it('no muestra nada cuando el backend no manda last_seen_at', () => {
    mockUsePetByID.mockReturnValue({
      data: { ...mockPetBase, status: 'found', last_seen_at: undefined },
      isLoading: false,
    });
    const { queryByTestId } = render(<PetDetailScreen />);
    expect(queryByTestId('last-seen')).toBeNull();
  });
});

// El menu del dueno (bloquear / denunciar) toma el id de `pet.owner.id` desde
// que G5 tipo la pantalla; antes lo tomaba de `pet.owner_id`. Es el unico
// cambio de comportamiento de ese PR, asi que se fija aca: bloquear desde el
// menu bloquea al dueno de la mascota, no a otro ni a nadie.
describe('PetDetailScreen — menu del dueno', () => {
  it('bloquear desde el menu bloquea al dueno de la mascota', () => {
    const { Alert, ActionSheetIOS } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const sheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    mockUsePetByID.mockReturnValue({
      data: {
        ...mockPetBase,
        status: 'lost',
        owner: { id: 'owner-1', name: 'Ana', is_verified: false },
      },
      isLoading: false,
    });

    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('⋮'));

    // iOS abre un action sheet y Android un Alert con botones: se elige
    // "bloquear" en el que se haya abierto.
    if (sheetSpy.mock.calls.length > 0) {
      const onSelect = sheetSpy.mock.calls[0][1] as (index: number) => void;
      onSelect(1);
    } else {
      const buttons = alertSpy.mock.calls[0][2] as { onPress?: () => void }[];
      buttons[1].onPress?.();
    }

    expect(mockBlockMutate).toHaveBeenCalledTimes(1);
    expect(mockBlockMutate.mock.calls[0][0]).toEqual({ userId: 'owner-1' });
    alertSpy.mockRestore();
    sheetSpy.mockRestore();
  });
});

// The public profile needs no session, so tapping the owner's name opens it
// for anyone, logged in or not.
describe('PetDetailScreen — perfil del dueno', () => {
  it('tocar el nombre del dueno abre su perfil publico', () => {
    mockUsePetByID.mockReturnValue({
      data: {
        ...mockPetBase,
        status: 'lost',
        owner: { id: 'owner-1', name: 'Ana', is_verified: false },
      },
      isLoading: false,
    });

    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('Ana'));

    expect(mockRouterPush).toHaveBeenCalledWith('/users/owner-1');
  });
});

// T8 — marcar la mascota como encontrada pregunta quién ayudó. Mantiene el
// empujón a contar la historia al terminar.
describe('PetDetailScreen — confirmar quién ayudó', () => {
  const lostPet = {
    ...mockPetBase,
    status: 'lost',
    owner: { id: 'owner-1', name: 'Dueño', is_verified: false },
  };

  beforeEach(() => {
    mockAuthUser = { id: 'owner-1' };
    mockUsePetByID.mockReturnValue({ data: lostPet, isLoading: false });
    mockMarkFoundMutate.mockReset();
    mockRouterPush.mockReset();
    mockUseHelperCandidates.mockReset();
    mockUseHelperCandidates.mockReturnValue({
      data: [{ id: 'u-ana', name: 'Ana' }],
      isError: false,
      refetch: jest.fn(),
    });
  });
  afterEach(() => {
    mockAuthUser = null;
  });

  it('el botón abre el selector en vez de marcar directo', () => {
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));

    expect(screen.getByText('pets:helpers.title')).toBeTruthy();
    expect(mockMarkFoundMutate).not.toHaveBeenCalled();
  });

  it('confirmar con ayudantes manda helperIds por la mutación', () => {
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('Ana'));
    fireEvent.press(screen.getByText('common:confirm'));

    expect(mockMarkFoundMutate.mock.calls[0][0]).toEqual({ id: 'pet-123', helperIds: ['u-ana'] });
  });

  it('"Nadie me ayudó" manda helperIds vacío', () => {
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('pets:helpers.nobody'));
    fireEvent.press(screen.getByText('common:confirm'));

    expect(mockMarkFoundMutate.mock.calls[0][0]).toEqual({ id: 'pet-123', helperIds: [] });
  });

  it('sin candidatos no manda helperIds', () => {
    mockUseHelperCandidates.mockReturnValue({ data: [], isError: false, refetch: jest.fn() });
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('common:confirm'));

    expect(mockMarkFoundMutate.mock.calls[0][0]).toEqual({ id: 'pet-123', helperIds: undefined });
  });

  it('si la API rechaza, el modal sigue abierto con el error y la selección', () => {
    const { ApiError } = require('../../shared/api/client');
    mockMarkFoundMutate.mockImplementation((_arg, opts) =>
      opts.onError(new ApiError('invalid_helpers', 400, 'x')),
    );
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('Ana'));
    fireEvent.press(screen.getByText('common:confirm'));

    expect(screen.getByText('errors:unknown_error')).toBeTruthy();
    expect(screen.getByText('pets:helpers.title')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Ana' }).props.accessibilityState.checked).toBe(true);
  });

  it('al terminar cierra el modal y ofrece contar la historia', () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockMarkFoundMutate.mockImplementation((_arg, opts) => opts.onSuccess());
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('Ana'));
    fireEvent.press(screen.getByText('common:confirm'));

    expect(screen.queryByText('pets:helpers.title')).toBeNull();
    const buttons = alertSpy.mock.calls[0][2] as { onPress?: () => void }[];
    buttons[0].onPress?.();
    expect(mockRouterPush).toHaveBeenCalledWith('/story/create?petId=pet-123');
    alertSpy.mockRestore();
  });

  it('cancelar cierra el modal sin marcar nada', () => {
    render(<PetDetailScreen />);
    fireEvent.press(screen.getByText('pet_detail:markAsFound'));
    fireEvent.press(screen.getByText('common:cancel'));

    expect(screen.queryByText('pets:helpers.title')).toBeNull();
    expect(mockMarkFoundMutate).not.toHaveBeenCalled();
  });
});
