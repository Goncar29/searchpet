// Mobile shelter registration: gate, validation, payload, errors, success.
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import RegisterShelterScreen from '../app/shelters/register';
import i18n from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockUseMyShelter = jest.fn();
const mockUseRegisterShelter = jest.fn();
const mockUseVerificationStatus = jest.fn();
const hooks = () => ({
  useMyShelter: (...a: unknown[]) => mockUseMyShelter(...a),
  useRegisterShelter: (...a: unknown[]) => mockUseRegisterShelter(...a),
  useVerificationStatus: (...a: unknown[]) => mockUseVerificationStatus(...a),
});
jest.mock('@shared/hooks', () => hooks());
jest.mock('../../shared/hooks', () => hooks());

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const router = () => require('expo-router').__hookRouter;

let mutate: jest.Mock;

beforeEach(() => {
  mutate = jest.fn();
  mockUseMyShelter.mockReturnValue({ data: undefined, isLoading: false, isError: true });
  mockUseRegisterShelter.mockReturnValue({ mutate, isPending: false });
  mockUseVerificationStatus.mockReturnValue({
    data: { email_verified: true },
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  });
});

const fill = (utils: ReturnType<typeof render>, label: string, value: string) =>
  fireEvent.changeText(utils.getByLabelText(tr(label)), value);

const fillRequired = (u: ReturnType<typeof render>) => {
  fill(u, 'shelters:register.name', 'Patitas');
  fill(u, 'shelters:register.city', 'Montevideo');
};

describe('RegisterShelterScreen', () => {
  it('unverified email: shows the verify notice and no form', () => {
    mockUseVerificationStatus.mockReturnValue({
      data: { email_verified: false },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { queryByText, queryByLabelText } = render(<RegisterShelterScreen />);
    expect(queryByText(tr('shelters:register.emailUnverified'))).toBeTruthy();
    expect(queryByLabelText(tr('shelters:register.name'))).toBeNull();
  });

  it('failed verification check: retry, not the verify notice', () => {
    mockUseVerificationStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: jest.fn(),
    });
    const { queryByText } = render(<RegisterShelterScreen />);
    expect(queryByText(tr('shelters:register.emailUnverified'))).toBeNull();
    expect(queryByText(tr('common:retry'))).toBeTruthy();
  });

  it('already owns a shelter: redirects to the shelters list', () => {
    mockUseMyShelter.mockReturnValue({ data: { id: 's1', name: 'X', status: 'pending' }, isLoading: false });
    render(<RegisterShelterScreen />);
    expect(router().replace).toHaveBeenCalledWith('/shelters');
  });

  it('requires name and city and does not submit', () => {
    const u = render(<RegisterShelterScreen />);
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    expect(u.getByText(tr('shelters:register.nameRequired'))).toBeTruthy();
    expect(u.getByText(tr('shelters:register.cityRequired'))).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL and accepts an https one', () => {
    const u = render(<RegisterShelterScreen />);
    fillRequired(u);
    fill(u, 'shelters:register.websiteUrl', 'http://patitas.org');
    fill(u, 'shelters:register.donationUrl', 'patitas.org/donar');
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    expect(u.getAllByText(tr('shelters:register.invalidUrl'))).toHaveLength(2);
    expect(mutate).not.toHaveBeenCalled();

    fill(u, 'shelters:register.websiteUrl', 'https://patitas.org');
    fill(u, 'shelters:register.donationUrl', 'https://patitas.org/donar');
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    expect(u.queryByText(tr('shelters:register.invalidUrl'))).toBeNull();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('submits the trimmed payload', () => {
    const u = render(<RegisterShelterScreen />);
    fill(u, 'shelters:register.name', '  Patitas  ');
    fill(u, 'shelters:register.city', ' Montevideo ');
    fill(u, 'shelters:register.phone', ' 099 ');
    fill(u, 'shelters:register.email', ' a@b.co ');
    fill(u, 'shelters:register.description', ' hola ');
    fill(u, 'shelters:register.websiteUrl', ' https://patitas.org ');
    fill(u, 'shelters:register.donationUrl', ' https://patitas.org/d ');
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    expect(mutate.mock.calls[0][0]).toEqual({
      name: 'Patitas',
      city: 'Montevideo',
      phone: '099',
      email: 'a@b.co',
      description: 'hola',
      website_url: 'https://patitas.org',
      donation_url: 'https://patitas.org/d',
    });
  });

  it('maps an API error with getErrorMessage (shelter_already_owned is friendly)', async () => {
    const u = render(<RegisterShelterScreen />);
    fillRequired(u);
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    mutate.mock.calls[0][1].onError({ code: 'shelter_already_owned' });
    const friendly = tr('errors:shelter_already_owned');
    expect(friendly).not.toBe('errors:shelter_already_owned');
    await waitFor(() => expect(u.getByText(friendly)).toBeTruthy());
  });

  it('on success shows the pending-review state and goes back to the list', async () => {
    const u = render(<RegisterShelterScreen />);
    fillRequired(u);
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    mutate.mock.calls[0][1].onSuccess();
    await waitFor(() => {
      expect(u.getByText(tr('shelters:register.successTitle'))).toBeTruthy();
      expect(u.getByText(tr('shelters:register.successBody'))).toBeTruthy();
    });
    fireEvent.press(u.getByText(tr('shelters:register.goToList')));
    expect(router().replace).toHaveBeenCalledWith('/shelters');
  });

  it('after success the owner view repopulating does not eat the done state', async () => {
    const u = render(<RegisterShelterScreen />);
    fillRequired(u);
    fireEvent.press(u.getByText(tr('shelters:register.submit')));
    mockUseMyShelter.mockReturnValue({ data: { id: 's1', name: 'Patitas', status: 'pending' }, isLoading: false });
    mutate.mock.calls[0][1].onSuccess();
    u.rerender(<RegisterShelterScreen />);
    await waitFor(() => expect(u.getByText(tr('shelters:register.successTitle'))).toBeTruthy());
    expect(router().replace).not.toHaveBeenCalled();
  });
});
