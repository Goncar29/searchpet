// CTA at the bottom of the shelters directory: three states.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ShelterRegisterCta } from '../components/ShelterRegisterCta';
import i18n from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockUseMyShelter = jest.fn();
jest.mock('@shared/hooks', () => ({ useMyShelter: (...a: unknown[]) => mockUseMyShelter(...a) }));
jest.mock('../../shared/hooks', () => ({ useMyShelter: (...a: unknown[]) => mockUseMyShelter(...a) }));

let mockAuth = { isAuthenticated: true };
jest.mock('../store', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => (typeof sel === 'function' ? sel(mockAuth) : mockAuth),
}));

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const router = () => require('expo-router').__hookRouter;

const myShelter = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Patitas Felices',
  city: 'Montevideo',
  is_verified: false,
  created_at: '2024-01-01T00:00:00Z',
  status: 'pending',
  ...over,
});

beforeEach(() => {
  mockAuth = { isAuthenticated: true };
  mockUseMyShelter.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { code: 'shelter_not_found' } });
});

describe('ShelterRegisterCta', () => {
  it('logged out: offers login, not the register button, and does not query the owner view', () => {
    mockAuth = { isAuthenticated: false };
    const { getByText, queryByText } = render(<ShelterRegisterCta />);
    expect(queryByText(tr('shelters:registerButton'))).toBeNull();
    fireEvent.press(getByText(tr('shelters:loginToRegister')));
    expect(router().push).toHaveBeenCalledWith('/login');
    expect(mockUseMyShelter).toHaveBeenCalledWith(false);
  });

  it('no shelter: offers the register button, which opens the form', () => {
    const { getByText, queryByText } = render(<ShelterRegisterCta />);
    expect(queryByText(tr('shelters:myShelter.status.pending'))).toBeNull();
    fireEvent.press(getByText(tr('shelters:registerButton')));
    expect(router().push).toHaveBeenCalledWith('/shelters/register');
  });

  it('has a shelter: shows its name and status instead of the register button', () => {
    mockUseMyShelter.mockReturnValue({ data: myShelter(), isLoading: false, isError: false });
    const { getByText, queryByText } = render(<ShelterRegisterCta />);
    expect(getByText('Patitas Felices')).toBeTruthy();
    expect(getByText(tr('shelters:myShelter.status.pending'))).toBeTruthy();
    expect(queryByText(tr('shelters:registerButton'))).toBeNull();
  });

  it('rejected shelter shows the rejection reason', () => {
    mockUseMyShelter.mockReturnValue({
      data: myShelter({ status: 'rejected', rejection_reason: 'Link roto' }),
      isLoading: false,
      isError: false,
    });
    const { getByText } = render(<ShelterRegisterCta />);
    expect(getByText(tr('shelters:myShelter.status.rejected'))).toBeTruthy();
    expect(getByText(tr('shelters:myShelter.rejectedReason', { reason: 'Link roto' }))).toBeTruthy();
  });

  it('approved shelter shows the approved status', () => {
    mockUseMyShelter.mockReturnValue({ data: myShelter({ status: 'approved' }), isLoading: false, isError: false });
    const { getByText } = render(<ShelterRegisterCta />);
    expect(getByText(tr('shelters:myShelter.status.approved'))).toBeTruthy();
  });

  it('loading the owner view shows neither the register button nor a status', () => {
    mockUseMyShelter.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { queryByText } = render(<ShelterRegisterCta />);
    expect(queryByText(tr('shelters:registerButton'))).toBeNull();
    expect(queryByText(tr('shelters:myShelter.status.pending'))).toBeNull();
  });
});
