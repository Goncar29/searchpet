import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SheltersPage } from './SheltersPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: { total_pets: 10, total_found: 5, total_users: 20, total_reports: 30 } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('SheltersPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<SheltersPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra al menos un refugio hardcodeado', () => {
    render(<SheltersPage />, { wrapper });
    expect(screen.getByText('Refugio Animal Uruguay')).toBeTruthy();
  });
});
