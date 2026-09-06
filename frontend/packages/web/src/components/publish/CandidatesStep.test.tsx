import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CandidatesStep } from './CandidatesStep';
import type { StrayCandidate } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    t: (key: string) => (key.includes(':') ? key : `${Array.isArray(ns) ? ns[0] : ns}:${key}`),
    i18n: { language: 'es' },
  }),
}));

const candidato: StrayCandidate = {
  id: 'pet-1',
  name: 'Marrón',
  type: 'perro',
  photo_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg',
  last_seen_nearby_at: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
  distance_meters: 312,
};

// El sobre mínimo de UseQueryResult que consume ListState.
const queryStub = (over: Record<string, unknown>) =>
  ({
    data: undefined,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  }) as never;

describe('CandidatesStep', () => {
  it('con la consulta caída muestra el cartel de error, NO "no hay candidatos"', () => {
    const onSkip = vi.fn();
    render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={onSkip}
      />,
    );

    // El cartel de error existe...
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // ...y el usuario NO queda encerrado: sigue pudiendo publicar.
    expect(screen.getByText('publish:candidates.publishAnyway')).toBeInTheDocument();
    // Y NO se saltea solo: un fallo no es una respuesta, así que la decisión
    // de publicar igual tiene que tomarla la persona.
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('con cero candidatos NO se muestra nada y avisa que hay que seguir', () => {
    const onSkip = vi.fn();
    const { container } = render(
      <CandidatesStep query={queryStub({ data: [] })} onSelect={vi.fn()} onSkip={onSkip} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  // El paso existe para evitar un duplicado: si su propio salteo automático se
  // dispara dos veces, CREA el duplicado. Y re-renderiza seguro — `onSkip` sale
  // sin memoizar del wizard, y publicar es asíncrono, así que entre la llamada y
  // el cambio de paso hay al menos un render (isPending del mutation).
  it('con cero candidatos llama a onSkip UNA sola vez aunque re-renderice', () => {
    const onSkip = vi.fn();
    const { rerender } = render(
      <CandidatesStep query={queryStub({ data: [] })} onSelect={vi.fn()} onSkip={onSkip} />,
    );

    // Identidad nueva de onSkip en cada render, como pasa de verdad.
    rerender(
      <CandidatesStep
        query={queryStub({ data: [] })}
        onSelect={vi.fn()}
        onSkip={(...args) => onSkip(...args)}
      />,
    );
    rerender(
      <CandidatesStep
        query={queryStub({ data: [] })}
        onSelect={vi.fn()}
        onSkip={(...args) => onSkip(...args)}
      />,
    );

    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('lista los candidatos y "es este" devuelve el elegido', () => {
    const onSelect = vi.fn();
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={onSelect}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText('Marrón')).toBeInTheDocument();
    // La tarjeta NUNCA usa la palabra "vencido" — dice cuándo se lo vio.
    expect(screen.queryByText(/vencid/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('publish:candidates.isThisOne'));
    expect(onSelect).toHaveBeenCalledWith(candidato);
  });

  it('con candidatos el botón de salida dice "ninguno", no "publicar igual"', () => {
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText('publish:candidates.noneOfThem')).toBeInTheDocument();
    expect(screen.queryByText('publish:candidates.publishAnyway')).not.toBeInTheDocument();
  });
});
