import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MapFilterPanel } from './MapFilterPanel';

// Convencion de los tests de web: `t` devuelve la clave. Aca las claves son
// SELECTORES, no aserciones de texto — lo que se verifica son los callbacks.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const base = {
  draft: {},
  onDraftChange: vi.fn(),
  onToggleStatus: vi.fn(),
  onApply: vi.fn(),
  onReset: vi.fn(),
  rangeError: false,
  radius: 3,
  onRadiusChange: vi.fn(),
  showVets: false,
  onToggleVets: vi.fn(),
  onPlaceFound: vi.fn(),
};

describe('MapFilterPanel', () => {
  it('el rango invertido se avisa y marca los dos campos', () => {
    const { rerender } = render(<MapFilterPanel {...base} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('map:dateFrom')).toHaveAttribute('aria-invalid', 'false');

    rerender(<MapFilterPanel {...base} rangeError />);

    // role=alert y no un <p> mudo: el usuario acaba de apretar Aplicar y la
    // busqueda NO se dispara, asi que sin esto para un lector de pantalla no
    // pasa absolutamente nada.
    expect(screen.getByRole('alert').textContent).toBe('map:invalidRange');
    expect(screen.getByLabelText('map:dateFrom')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('map:dateTo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('el radio NO pasa por Aplicar: avisa al toque', () => {
    const onRadiusChange = vi.fn();
    const onApply = vi.fn();
    render(<MapFilterPanel {...base} onRadiusChange={onRadiusChange} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('map:radius'), { target: { value: '10' } });

    // El radio DIBUJA el circulo en pantalla. Diferirlo hasta Aplicar mostraria
    // un circulo que no coincide con los resultados.
    expect(onRadiusChange).toHaveBeenCalledWith(10);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('el toggle de veterinarias tampoco pasa por Aplicar', () => {
    const onToggleVets = vi.fn();
    const onApply = vi.fn();
    render(<MapFilterPanel {...base} onToggleVets={onToggleVets} onApply={onApply} />);

    fireEvent.click(screen.getByTestId('vets-toggle'));

    // Prende una CAPA del mapa; no filtra reportes.
    expect(onToggleVets).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('el tipo si espera a Aplicar', () => {
    const onDraftChange = vi.fn();
    const onApply = vi.fn();
    render(<MapFilterPanel {...base} onDraftChange={onDraftChange} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('map:typeLabel'), { target: { value: 'gato' } });
    expect(onDraftChange).toHaveBeenCalledWith({ type: 'gato' });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'map:apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('los chips de estado reflejan la seleccion con aria-pressed', () => {
    const onToggleStatus = vi.fn();
    render(
      <MapFilterPanel
        {...base}
        draft={{ status: ['lost'] }}
        onToggleStatus={onToggleStatus}
      />,
    );

    const perdido = screen.getByRole('button', { name: 'pets:card.lost' });
    const encontrado = screen.getByRole('button', { name: 'pets:card.found' });

    // Sin aria-pressed, un lector de pantalla lee los tres chips IGUAL y no hay
    // forma de saber cual esta activo.
    expect(perdido).toHaveAttribute('aria-pressed', 'true');
    expect(encontrado).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(encontrado);
    expect(onToggleStatus).toHaveBeenCalledWith('found');
  });

  it('vaciar los dias manda undefined y no cadena vacia', () => {
    const onDraftChange = vi.fn();
    render(
      <MapFilterPanel {...base} draft={{ fromDay: '2026-08-01' }} onDraftChange={onDraftChange} />,
    );

    fireEvent.change(screen.getByLabelText('map:dateFrom'), { target: { value: '' } });

    // Una cadena vacia entraria al queryKey como un filtro presente que no
    // filtra nada, y partiria el cache en dos por nada.
    expect(onDraftChange).toHaveBeenCalledWith({ fromDay: undefined });
  });
});
