import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationOnboardingStep } from './LocationOnboardingStep';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const updateMyLocation = vi.fn();
vi.mock('@shared/api/client', () => ({
  apiClient: {
    updateMyLocation: (...args: unknown[]) => updateMyLocation(...args),
  },
}));

function mockGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(navigator, 'geolocation', { value: impl, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMyLocation.mockResolvedValue({});
});

describe('LocationOnboardingStep', () => {
  it('saves coordinates when the browser grants permission', async () => {
    mockGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: -34.9011, longitude: -56.1645 } } as GeolocationPosition),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() =>
      expect(updateMyLocation).toHaveBeenCalledWith({ latitude: -34.9011, longitude: -56.1645 }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('falls back to the city field when permission is denied', async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) =>
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() => expect(screen.getByLabelText('auth:location.cityLabel')).toBeInTheDocument());
    expect(screen.getByText('auth:location.permissionDenied')).toBeInTheDocument();
    expect(updateMyLocation).not.toHaveBeenCalled();
  });

  it('saves the city typed in the fallback field', async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) =>
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));
    await waitFor(() => screen.getByLabelText('auth:location.cityLabel'));

    await user.type(screen.getByLabelText('auth:location.cityLabel'), '  Montevideo  ');
    await user.click(screen.getByRole('button', { name: 'auth:location.saveCity' }));

    await waitFor(() => expect(updateMyLocation).toHaveBeenCalledWith({ city: 'Montevideo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('is skippable and never calls the API when skipped', async () => {
    mockGeolocation({ getCurrentPosition: vi.fn() });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.skip' }));

    expect(updateMyLocation).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('still finishes when saving fails — location is never a blocker', async () => {
    updateMyLocation.mockRejectedValue(new Error('network'));
    mockGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: -34.9, longitude: -56.1 } } as GeolocationPosition),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('falls back to the city field when the browser has no geolocation at all', async () => {
    // Older/locked-down browsers expose no navigator.geolocation.
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    const user = userEvent.setup();

    render(<LocationOnboardingStep onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'auth:location.useMyLocation' }));

    expect(screen.getByLabelText('auth:location.cityLabel')).toBeInTheDocument();
  });
});
