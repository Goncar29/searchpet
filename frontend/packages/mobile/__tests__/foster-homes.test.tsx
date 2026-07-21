// Foster homes screens smoke tests (directory, register, mine)
import React from 'react';
import { render } from '@testing-library/react-native';
import FosterHomesScreen from '../app/foster-homes/index';
import RegisterFosterHomeScreen from '../app/foster-homes/register';
import MyFosterHomeScreen from '../app/foster-homes/mine';

// expo-router is mocked globally in jest.setup.js (push/back/replace/navigate,
// useLocalSearchParams returns {}). No screen-specific params are needed here.

const mockUseFosterHomes = jest.fn();
const mockUseMyFosterHome = jest.fn();
const mockUseVerificationStatus = jest.fn();
const mockUseRegisterFosterHome = jest.fn();
const mockUseUpdateMyFosterHome = jest.fn();
const mockUseUploadFosterHomePhoto = jest.fn();
const mockUseDeleteFosterHomePhoto = jest.fn();

// These screens import via the '@shared/hooks' alias (not a relative path),
// so the mock target is the alias itself — mirrors index.test.tsx / pet-detail.test.tsx.
jest.mock('@shared/hooks', () => ({
  useFosterHomes: (...args: unknown[]) => mockUseFosterHomes(...args),
  useMyFosterHome: (...args: unknown[]) => mockUseMyFosterHome(...args),
  useVerificationStatus: (...args: unknown[]) => mockUseVerificationStatus(...args),
  useRegisterFosterHome: (...args: unknown[]) => mockUseRegisterFosterHome(...args),
  useUpdateMyFosterHome: (...args: unknown[]) => mockUseUpdateMyFosterHome(...args),
  useUploadFosterHomePhoto: (...args: unknown[]) => mockUseUploadFosterHomePhoto(...args),
  useDeleteFosterHomePhoto: (...args: unknown[]) => mockUseDeleteFosterHomePhoto(...args),
}));

// expo-image-picker is mocked globally via jest.config.js moduleNameMapper.
// @shared/utils/apiErrors is mocked globally via jest.config.js moduleNameMapper.

const fosterHomeFixture = {
  id: 'fh-1',
  owner_user_id: 'user-1',
  city: 'Montevideo',
  housing_type: 'house' as const,
  animal_types: ['dog'] as const,
  capacity: 3,
  description: 'Casa con patio grande',
  photos: [],
  created_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  mockUseFosterHomes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: jest.fn() });
  mockUseMyFosterHome.mockReturnValue({
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUseVerificationStatus.mockReturnValue({ data: { email_verified: true }, isLoading: false });
  mockUseRegisterFosterHome.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  mockUseUpdateMyFosterHome.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  mockUseUploadFosterHomePhoto.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  mockUseDeleteFosterHomePhoto.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
});

describe('FosterHomesScreen (directorio)', () => {
  it('muestra un hogar transitorio de la lista', () => {
    mockUseFosterHomes.mockReturnValue({
      data: [fosterHomeFixture],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { queryByText } = render(<FosterHomesScreen />);
    expect(queryByText(/Montevideo/)).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay hogares', () => {
    mockUseFosterHomes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: jest.fn() });
    const { queryByText } = render(<FosterHomesScreen />);
    expect(queryByText(/fosterHomes:directory\.empty/i)).toBeTruthy();
  });
});

describe('RegisterFosterHomeScreen', () => {
  it('muestra el aviso de email no verificado', () => {
    mockUseMyFosterHome.mockReturnValue({ data: undefined, isLoading: false });
    mockUseVerificationStatus.mockReturnValue({ data: { email_verified: false }, isLoading: false });

    const { queryByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText(/fosterHomes:register\.emailUnverified/i)).toBeTruthy();
  });
});

describe('MyFosterHomeScreen', () => {
  it('muestra el CTA de registro cuando el usuario no tiene hogar transitorio', () => {
    mockUseMyFosterHome.mockReturnValue({
      data: undefined,
      error: { code: 'foster_home_not_found' },
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<MyFosterHomeScreen />);
    expect(queryByText(/fosterHomes:mine\.registerNow/i)).toBeTruthy();
  });

  it('muestra el mensaje de estado suspendido', () => {
    mockUseMyFosterHome.mockReturnValue({
      data: { ...fosterHomeFixture, status: 'suspended' },
      error: null,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<MyFosterHomeScreen />);
    expect(queryByText(/fosterHomes:mine\.statusSuspended/i)).toBeTruthy();
  });
});
