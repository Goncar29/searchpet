// The email-verification gate on the foster home registration screen must tell
// three states apart: loading, failed, and answered. A failed or pending
// request used to read as "email not verified".
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RegisterFosterHomeScreen from '../app/foster-homes/register';

const mockUseMyFosterHome = jest.fn();
const mockUseVerificationStatus = jest.fn();
const mockUseRegisterFosterHome = jest.fn();

jest.mock('@shared/hooks', () => ({
  useMyFosterHome: (...a: unknown[]) => mockUseMyFosterHome(...a),
  useVerificationStatus: (...a: unknown[]) => mockUseVerificationStatus(...a),
  useRegisterFosterHome: (...a: unknown[]) => mockUseRegisterFosterHome(...a),
}));

beforeEach(() => {
  mockUseMyFosterHome.mockReturnValue({ data: undefined, isLoading: false });
  mockUseRegisterFosterHome.mockReturnValue({ mutate: jest.fn(), isPending: false });
});

describe('foster home register: verification gate', () => {
  it('loading shows a spinner and not the verify block', () => {
    mockUseVerificationStatus.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() });
    const { queryByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText('fosterHomes:register.emailUnverified')).toBeNull();
    expect(queryByText('fosterHomes:register.city')).toBeNull();
  });

  it('error shows a retry button (which refetches) and NOT the verify block', () => {
    const refetch = jest.fn();
    mockUseVerificationStatus.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const { queryByText, getByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText('fosterHomes:register.emailUnverified')).toBeNull();
    fireEvent.press(getByText('common:retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('answered false shows the verify notice and no form', () => {
    mockUseVerificationStatus.mockReturnValue({ data: { email_verified: false }, isLoading: false, isError: false, refetch: jest.fn() });
    const { queryByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText('fosterHomes:register.emailUnverified')).toBeTruthy();
    expect(queryByText('fosterHomes:register.city')).toBeNull();
  });

  it('answered true shows the form and no verify notice', () => {
    mockUseVerificationStatus.mockReturnValue({ data: { email_verified: true }, isLoading: false, isError: false, refetch: jest.fn() });
    const { queryByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText('fosterHomes:register.emailUnverified')).toBeNull();
    expect(queryByText('fosterHomes:register.city')).toBeTruthy();
  });

  it('asks for a fresh status on mount', () => {
    mockUseVerificationStatus.mockReturnValue({ data: { email_verified: true }, isLoading: false, isError: false, refetch: jest.fn() });
    render(<RegisterFosterHomeScreen />);
    expect(mockUseVerificationStatus).toHaveBeenCalledWith({ refetchOnMount: 'always' });
  });

  it('cached "false" while refetching is treated as pending, not as the verify block', () => {
    mockUseVerificationStatus.mockReturnValue({ data: { email_verified: false }, isLoading: false, isFetching: true, isError: false, refetch: jest.fn() });
    const { queryByText } = render(<RegisterFosterHomeScreen />);
    expect(queryByText('fosterHomes:register.emailUnverified')).toBeNull();
  });
});
