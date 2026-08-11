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

  it('la respuesta LENTA de una busqueda vieja no pisa a la nueva', async () => {
    const onFound = vi.fn();
    // Primera busqueda: lenta. Segunda: instantanea. La vieja aterriza ULTIMA.
    //
    // OJO CON EL ARNES: la lenta resuelve con un 'ok' VALIDO, no con 'aborted'.
    // La primera version de este test la hacia resolver 'aborted' al recibir la
    // cancelacion, y asi pasaba CON Y SIN el arreglo — el mock estaba haciendo
    // el trabajo que el test tenia que verificar. Una respuesta ya en vuelo
    // puede llegar entera igual: abortar no rebobina el tiempo.
    let resolverLenta: ((v: unknown) => void) | undefined;
    mockGeocode
      .mockImplementationOnce(() => new Promise((res) => {
        resolverLenta = () => res({ kind: 'ok', lat: -34.46, lng: -57.84, label: 'Colonia' });
      }))
      .mockResolvedValueOnce({ kind: 'ok', lat: -34.95, lng: -54.95, label: 'Punta del Este' });

    render(<PlaceSearch onFound={onFound} />);
    const input = screen.getByLabelText('map:searchPlace');

    fireEvent.change(input, { target: { value: 'Colonia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.change(input, { target: { value: 'Punta del Este' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onFound).toHaveBeenCalledWith(-34.95, -54.95, 'Punta del Este'));

    // Ahora aterriza la vieja. Sin la guarda movia el mapa a Colonia con el
    // input diciendo "Punta del Este": el mapa a 300 km de lo que se lee.
    resolverLenta?.(undefined);
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onFound).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Colonia');
  });

  it('el EXITO tambien se anuncia, no solo los fallos', async () => {
    mockGeocode.mockResolvedValue({ kind: 'ok', lat: -34.91, lng: -56.15, label: 'Pocitos, Montevideo' });
    render(<PlaceSearch onFound={vi.fn()} />);
    const input = screen.getByLabelText('map:searchPlace');

    fireEvent.change(input, { target: { value: 'Pocitos' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // La region viva cubria buscando/vacio/error y NO el exito, asi que para
    // un lector de pantalla el mapa se movia en silencio: la unica confirmacion
    // era visual. La clave map:movedTo existia y no la usaba nadie.
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('map:movedTo'));
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
