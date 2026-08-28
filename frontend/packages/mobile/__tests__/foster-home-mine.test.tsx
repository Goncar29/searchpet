// MyFosterHomeScreen — a suspended foster home used to freeze the form and
// mute the save button (a dead end for the owner). Editing IS resubmitting:
// this covers exactly what that change decides, not the whole screen.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MyFosterHomeScreen from '../app/foster-homes/mine';

// expo-router is mocked globally in jest.setup.js.
// expo-image-picker and @shared/utils/apiErrors are mocked globally via
// jest.config.js moduleNameMapper.

const mockUseMyFosterHome = jest.fn();
const mockUseUpdateMyFosterHome = jest.fn();
const mockUseUploadFosterHomePhoto = jest.fn();
const mockUseDeleteFosterHomePhoto = jest.fn();

// The screen imports via the '@shared/hooks' alias (not a relative path) —
// mirrors foster-homes.test.tsx, the sibling suite for this same screen.
jest.mock('@shared/hooks', () => ({
  useMyFosterHome: (...args: unknown[]) => mockUseMyFosterHome(...args),
  useUpdateMyFosterHome: (...args: unknown[]) => mockUseUpdateMyFosterHome(...args),
  useUploadFosterHomePhoto: (...args: unknown[]) => mockUseUploadFosterHomePhoto(...args),
  useDeleteFosterHomePhoto: (...args: unknown[]) => mockUseDeleteFosterHomePhoto(...args),
}));

const suspendedFixture = {
  id: 'fh-1',
  owner_user_id: 'user-1',
  city: 'Montevideo',
  housing_type: 'house' as const,
  animal_types: ['dog'] as const,
  capacity: 3,
  description: 'Casa con patio grande',
  whatsapp_phone: '',
  photos: [],
  status: 'suspended' as const,
  rejection_reason: 'Faltan fotos del patio',
  created_at: '2024-01-01T00:00:00Z',
};

const mockMutate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMyFosterHome.mockReturnValue({
    data: suspendedFixture,
    error: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUseUpdateMyFosterHome.mockReturnValue({ mutate: mockMutate, isPending: false });
  mockUseUploadFosterHomePhoto.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  mockUseDeleteFosterHomePhoto.mockReturnValue({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
});

describe('MyFosterHomeScreen — hogar suspendido', () => {
  it('el formulario queda editable y el botón ofrece reenviar', () => {
    const { getByDisplayValue, queryByText } = render(<MyFosterHomeScreen />);

    const cityInput = getByDisplayValue('Montevideo');
    expect(cityInput.props.editable).not.toBe(false);

    expect(queryByText(/fosterHomes:mine\.resubmit\b/i)).toBeTruthy();
  });

  it('al presionar el botón, llama a la mutación de actualizar', () => {
    const { getByText } = render(<MyFosterHomeScreen />);

    fireEvent.press(getByText(/fosterHomes:mine\.resubmit\b/i));

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
