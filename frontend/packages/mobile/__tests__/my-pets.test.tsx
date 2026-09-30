// My Pets screen smoke test
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import MyPetsScreen from '../app/my-pets';
import { drawnIcons } from './support/icons';
import { Text } from 'react-native';

// expo-router is mocked globally in jest.setup.js

jest.mock('../store', () => ({
  useLocationStore: () => ({ latitude: -34.9011, longitude: -56.1645, setLocation: jest.fn() }),
}));

// This file otherwise relies on react-i18next's uninitialized-instance
// passthrough (`t(key)` -> `key`, or `opts.defaultValue` when given — see
// react-i18next's `notReadyT`). Suggestion 1 added `{ defaultValue: item.type }`
// to the `pets:types.*` call, and in that passthrough that makes ANY type
// ('perro', unmapped or not) render as its raw value, so the old regex proxy
// (`/pets:types\.perro/`, proving `t()` was actually called) can no longer
// tell a real translation apart from a raw literal never routed through
// i18n. Resolving `pets:types.*` against the real locale — same idea as
// PetCard.test.tsx's mock — restores that: a known type genuinely
// translates ('perro' -> 'Perro'), while every other key keeps the original
// passthrough behaviour so no other assertion in this file is affected.
jest.mock('react-i18next', () => {
  const petTypes = require('../../shared/i18n/locales/es.json').pets.types;
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key.startsWith('pets:types.')) {
          const known = petTypes[key.slice('pets:types.'.length)];
          if (known) return known;
        }
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
        return key;
      },
    }),
  };
});

const mockUseMyPets = jest.fn();
const mockUseReportedPets = jest.fn();
const mockUpdatePetMutateAsync = jest.fn();

// Screen imports via relative '../../shared/hooks'; '../../shared/hooks'
// from this test resolves to the same module.
jest.mock('../../shared/hooks', () => ({
  useMyPets: () => mockUseMyPets(),
  useReportedPets: () => mockUseReportedPets(),
  useDeletePet: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn(), isPending: false, variables: undefined }),
  useCreateReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPetAsFound: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdatePet: () => ({ mutateAsync: mockUpdatePetMutateAsync, isPending: false }),
}));

const ownedPet = {
  id: 'pet-1',
  owner_id: 'user-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'negro',
  status: 'registered',
  photos: [],
  created_at: new Date().toISOString(),
};

const adoptionPet = {
  id: 'pet-2',
  owner_id: 'user-1',
  name: 'Michi',
  type: 'gato',
  breed: '',
  color: 'gris',
  status: 'adoption',
  photos: [],
  created_at: new Date().toISOString(),
};

const adoptedPet = {
  id: 'pet-3',
  owner_id: 'user-1',
  name: 'Rex',
  type: 'perro',
  breed: '',
  color: 'blanco',
  status: 'adopted',
  photos: [],
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  mockUseMyPets.mockReturnValue({
    data: [ownedPet, adoptionPet],
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
  mockUseReportedPets.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
  mockUpdatePetMutateAsync.mockClear();
});

// Una consulta caída se pintaba igual que "no tenés nada". En la pestaña propia
// es el peor caso de los tres, porque el cartel no sólo miente: trae el botón
// "Registrar mascota", así que empuja al dueño a cargar de nuevo una mascota que
// ya tiene. El duplicado que sale de ahí nace de un error de red.
//
// Cada pestaña se afirma con SU consulta rota y las DOS mitades: el cartel de
// error aparece y el de vacío no. Sin la mitad positiva —los tests de vacío real
// de más abajo— un guard escrito de más taparía también el vacío legítimo y
// dejaría sin salida a quien de verdad no tiene ninguna.
describe('MyPetsScreen — una consulta caída no se pinta como lista vacía', () => {
  it('la pestaña propia avisa que falló, y NO dice "no tenés mascotas"', () => {
    mockUseMyPets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);

    expect(screen.getByText('common:loadErrorTitle')).toBeTruthy();
    expect(screen.queryByText('my_pets:emptyTitle')).toBeNull();
    expect(screen.queryByText('my_pets:registerPet')).toBeNull();
  });

  it('la pestaña de reportadas avisa con SU consulta, no con la de las propias', () => {
    mockUseReportedPets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('pets:reports.tabReported'));

    expect(screen.getByText('common:loadErrorTitle')).toBeTruthy();
    expect(screen.queryByText('pets:reports.empty')).toBeNull();
  });

  it('la pestaña de adopción avisa cuando falla la consulta de las propias', () => {
    mockUseMyPets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('adoption:profile.tab'));

    expect(screen.getByText('common:loadErrorTitle')).toBeTruthy();
    expect(screen.queryByText('adoption:profile.empty')).toBeNull();
  });

  // UNA falla, UN cartel. Las dos consultas son independientes y cada pestaña
  // mira la suya: que se caiga la de reportadas no puede tapar las mascotas
  // propias, que sí tenemos y sí se pueden mostrar.
  it('una consulta caída no contamina la pestaña que sí cargó', () => {
    mockUseReportedPets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);

    expect(screen.getByText('Firulais')).toBeTruthy();
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
  });

  // La mitad positiva: un vacío REAL sigue diciendo que está vacío, con su
  // botón para registrar. Es la salida de quien recién empieza.
  it('un vacío real sigue ofreciendo registrar una mascota', () => {
    mockUseMyPets.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);

    expect(screen.getByText('my_pets:emptyTitle')).toBeTruthy();
    expect(screen.queryByText('common:loadErrorTitle')).toBeNull();
  });
});

describe('MyPetsScreen', () => {
  it('renderiza sin lanzar errores', () => {
    const { toJSON } = render(<MyPetsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  // Rule #12/M5: `item.type` is a raw domain literal ('perro', 'gato'...); it
  // must go through i18next, not render as-is.
  //
  // Exact match on the pet row's own text, not a loose /Perro/ over the
  // whole screen (see __tests__/index.photoSearch.test.tsx): the row's
  // <Text> is `${icon} ${type} · ${breed}` as sibling expressions in one
  // node, so its full content is deterministic — and unlike a substring
  // match, this fails if `item.type` ever stops going through `t()`.
  it('el tipo de mascota sale de i18n, no el literal crudo', () => {
    render(<MyPetsScreen />);
    // The type icon is drawn separately (`dog`), so the text is the label only.
    expect(screen.getByText('Perro · Labrador')).toBeTruthy();
  });

  it('el tab "owned" excluye mascotas en adopción', () => {
    render(<MyPetsScreen />);
    expect(screen.getByText('Firulais')).toBeTruthy();
    expect(screen.queryByText('Michi')).toBeNull();
  });

  it('el tab "En adopción" muestra solo mascotas en adopción/adoptadas', () => {
    render(<MyPetsScreen />);
    const adoptionTab = screen.getByText('adoption:profile.tab');
    fireEvent.press(adoptionTab);

    expect(screen.getByText('Michi')).toBeTruthy();
    expect(screen.queryByText('Firulais')).toBeNull();
  });

  it('muestra "Marcar adoptado" para una mascota en adopción y no para una ya adoptada', () => {
    mockUseMyPets.mockReturnValue({
      data: [ownedPet, adoptionPet, adoptedPet],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('adoption:profile.tab'));

    // adoptionPet ('Michi', status 'adoption') gets the action.
    expect(screen.getAllByText('adoption:profile.markAdopted')).toHaveLength(1);
    // adoptedPet ('Rex', status 'adopted') does not.
    expect(screen.getByText('Rex')).toBeTruthy();
  });

  it('al confirmar "Marcar adoptado" llama a useUpdatePet con status adopted', () => {
    // i18next.t() is called on the bare singleton here (not via the react-i18next
    // hook), so without an initialized instance button labels resolve to `undefined`
    // in this test env — match by position (mirrors [cancel, confirm] order) instead.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.[1]?.onPress?.();
    });

    mockUseMyPets.mockReturnValue({
      data: [ownedPet, adoptionPet],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    render(<MyPetsScreen />);
    fireEvent.press(screen.getByText('adoption:profile.tab'));
    fireEvent.press(screen.getByText('adoption:profile.markAdopted'));

    expect(mockUpdatePetMutateAsync).toHaveBeenCalledWith({
      id: 'pet-2',
      data: { status: 'adopted' },
    });

    alertSpy.mockRestore();
  });
});

describe('MyPetsScreen — pet type icons', () => {
  const only = (ui: Parameters<typeof drawnIcons>[0]) =>
    drawnIcons(ui).filter((n) => ['dog', 'cat', 'bird', 'pets'].includes(n));

  it('draws the icon of each pet type in the photo slot and on the type line', () => {
    mockUseMyPets.mockReturnValue({
      data: [ownedPet, { ...ownedPet, id: 'pet-9', name: 'Mishi', type: 'gato' }],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const ui = render(<MyPetsScreen />);
    expect(only(ui).sort()).toEqual(['cat', 'cat', 'dog', 'dog']);
    const texts = ui.UNSAFE_getAllByType(Text).map((t) => [t.props.children].flat(Infinity).join(''));
    expect(texts.filter((s) => /[🐾🐕🐱🐦]/u.test(s))).toEqual([]);
  });

  it('an unknown type falls back to the paw icon (pets)', () => {
    mockUseMyPets.mockReturnValue({
      data: [{ ...ownedPet, type: 'hamster' }],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const ui = render(<MyPetsScreen />);
    expect(only(ui)).toEqual(['pets', 'pets']);
  });
});
