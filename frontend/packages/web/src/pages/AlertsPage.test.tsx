import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertsPage } from './AlertsPage';
import type { LocationAlert } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const state = vi.hoisted(() => ({
  data: [] as unknown[] | undefined,
  isError: false,
}));

vi.mock('@shared/hooks', () => ({
  useAlerts: () => ({
    data: state.data,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: state.isError,
    error: state.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
  useCreateAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAlert: () => ({ mutate: vi.fn(), isPending: false }),
}));

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1',
    name: 'Mi barrio',
    alert_latitude: -34.9011,
    alert_longitude: -56.1645,
    radius_km: 5,
    is_active: true,
    ...overrides,
  } as unknown as LocationAlert;
}

describe('AlertsPage', () => {
  beforeEach(() => {
    state.data = [];
    state.isError = false;
  });

  it('con alertas dibuja la lista', () => {
    state.data = [alert()];

    render(<AlertsPage />);

    expect(screen.getByText('Mi barrio')).toBeInTheDocument();
    expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
  });

  it('sin alertas dice que no hay ninguna', () => {
    render(<AlertsPage />);

    expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con la query caida NO dice que no tenes alertas', () => {
    state.data = undefined;
    state.isError = true;

    render(<AlertsPage />);

    expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // El titulo vive FUERA de la rama que se envuelve: es `Mis alertas ({{count}}/{{max}})`
  // y con la query caida `data ?? []` lo dejaba afirmando "0/10" al lado del
  // cartel que dice que no pudimos leer nada.
  it('con la query caida el titulo NO afirma un conteo', () => {
    state.data = undefined;
    state.isError = true;

    render(<AlertsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('titleNoCount');
  });

  it('con datos el titulo SI lleva el conteo', () => {
    state.data = [alert()];

    render(<AlertsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('title');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('titleNoCount');
  });
});
