import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaceSearch } from './PlaceSearch';
import { geocode } from '@shared/utils/geocode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/utils/geocode', () => ({ geocode: vi.fn() }));

const mockGeocode = geocode as unknown as ReturnType<typeof vi.fn>;

describe('PlaceSearch', () => {
  beforeEach(() => {
    mockGeocode.mockReset();
  });

  it('NO busca por tecla: solo con Enter', async () => {
    mockGeocode.mockResolvedValue({ kind: 'empty' });
    render(<PlaceSearch onFound={vi.fn()} />);
    const input = screen.getByLabelText('map:searchPlace');

    fireEvent.change(input, { target: { value: 'Poc' } });
    fireEvent.change(input, { target: { value: 'Pocitos' } });

    // La politica de Nominatim topea en 1 request por segundo. Buscar por tecla
    // la violaria con solo escribir un barrio.
    expect(mockGeocode).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockGeocode).toHaveBeenCalledTimes(1));
  });

  it('avisa hacia arriba con las coordenadas encontradas', async () => {
    const onFound = vi.fn();
    mockGeocode.mockResolvedValue({ kind: 'ok', lat: -34.91, lng: -56.15, label: 'Pocitos' });

    render(<PlaceSearch onFound={onFound} />);
    fireEvent.change(screen.getByLabelText('map:searchPlace'), { target: { value: 'Pocitos' } });
    fireEvent.keyDown(screen.getByLabelText('map:searchPlace'), { key: 'Enter' });

    await waitFor(() => expect(onFound).toHaveBeenCalledWith(-34.91, -56.15, 'Pocitos'));
  });

  it('SIN RESULTADOS y ERROR DE RED dicen cosas distintas', async () => {
    const { rerender } = render(<PlaceSearch onFound={vi.fn()} />);
    const input = () => screen.getByLabelText('map:searchPlace');

    mockGeocode.mockResolvedValue({ kind: 'empty' });
    fireEvent.change(input(), { target: { value: 'asdkjh' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('map:searchNotFound')).toBeTruthy());

    rerender(<PlaceSearch onFound={vi.fn()} />);
    mockGeocode.mockResolvedValue({ kind: 'error' });
    fireEvent.change(input(), { target: { value: 'Pocitos' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    // Uno le dice al usuario que reescriba; el otro, que reintente. Colapsarlos
    // en un mensaje unico manda a la gente a corregir un texto que estaba bien.
    await waitFor(() => expect(screen.getByText('map:searchError')).toBeTruthy());
    expect(screen.queryByText('map:searchNotFound')).toBeNull();
  });

  it('el mensaje viejo se limpia al buscar de nuevo', async () => {
    mockGeocode.mockResolvedValue({ kind: 'empty' });
    render(<PlaceSearch onFound={vi.fn()} />);
    const input = screen.getByLabelText('map:searchPlace');

    fireEvent.change(input, { target: { value: 'asdkjh' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('map:searchNotFound')).toBeTruthy());

    mockGeocode.mockResolvedValue({ kind: 'ok', lat: 1, lng: 2, label: 'Pocitos' });
    fireEvent.change(input, { target: { value: 'Pocitos' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Un error que sobrevive a una busqueda exitosa hace creer que fallo.
    await waitFor(() => expect(screen.queryByText('map:searchNotFound')).toBeNull());
  });

  it('el estado se anuncia por aria-live', () => {
    render(<PlaceSearch onFound={vi.fn()} />);
    // Sin esto, un lector de pantalla no se entera de que la busqueda fallo:
    // el mensaje aparece en un lugar de la pantalla donde el foco no esta.
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('un geocode que TIRA no deja la pantalla clavada en "buscando"', async () => {
    mockGeocode.mockRejectedValue(new Error('boom'));
    render(<PlaceSearch onFound={vi.fn()} />);
    const input = screen.getByLabelText('map:searchPlace');

    fireEvent.change(input, { target: { value: 'Pocitos' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Sin el try, la fase se queda en 'buscando' para siempre y el usuario no
    // tiene forma de saber que ya no va a pasar nada.
    await waitFor(() => expect(screen.getByText('map:searchError')).toBeTruthy());
    expect(screen.queryByText('map:searchingPlace')).toBeNull();
  });
});
