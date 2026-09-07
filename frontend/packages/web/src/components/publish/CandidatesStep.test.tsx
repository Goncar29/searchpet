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
//
// `isFetching` se DERIVA de `isLoading` salvo que el caso lo diga explícito, y
// eso no es comodidad: en React Query `isLoading === isPending && isFetching`,
// así que un stub con `isLoading: true, isFetching: false` es un estado que NO
// EXISTE. Dejarlo construible hizo que estos tests pasaran contra un predicado
// que la app real nunca satisface — un mock que modela lo imposible da verde
// sobre código que no se ejecuta.
const queryStub = (over: Record<string, unknown>) =>
  ({
    data: undefined,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    isFetching: over.isLoading === true,
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

  // Mismo invariante que el salteo automático, por la vía manual: la salida
  // PUBLICA, y publicar es asíncrono. Sin deshabilitar, dos clicks seguidos son
  // dos mascotas. `LocationStep` ya protegía su botón así; al mover la
  // publicación a este paso había que traerse la protección con ella.
  it('mientras publica, la salida queda deshabilitada', () => {
    const onSkip = vi.fn();
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={vi.fn()}
        onSkip={onSkip}
        isPublishing
      />,
    );

    const salida = screen.getByTestId('candidates-skip');
    expect(salida).toBeDisabled();
    fireEvent.click(salida);
    expect(onSkip).not.toHaveBeenCalled();
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

// La salida existe SIEMPRE (el paso nunca bloquea), pero su texto no puede
// decir lo mismo mientras carga que cuando la consulta falló.
//
// Con `data == null` a secas los dos estados son indistinguibles: en los dos
// `data` es undefined. El usuario ve el esqueleto y, al lado, un botón que dice
// "publicar igual" — que afirma que ya miró los candidatos y ninguno era. No
// miró ninguno: todavía no llegaron.
describe('la salida mientras la consulta carga', () => {
  it('no dice "publicar igual" antes de que el chequeo haya contestado', () => {
    render(
      <CandidatesStep
        query={queryStub({ isLoading: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.publishWithoutWaiting',
    );
  });

  // La mitad que fija la distinción: con la consulta CAÍDA sí corresponde
  // "publicar igual", porque ahí no hay nada que esperar.
  it('con la consulta caída sí dice "publicar igual"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.publishAnyway',
    );
  });

  // Y sigue sin bloquear: el paso nunca deja a alguien encerrado con un animal
  // en la calle esperando una consulta.
  it('la salida sigue habilitada mientras carga', () => {
    const onSkip = vi.fn();
    render(
      <CandidatesStep
        query={queryStub({ isLoading: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByTestId('candidates-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // Sin conectividad React Query PAUSA la consulta: `isFetching` es false y
  // `isLoading` también, pero la consulta nunca contestó y va a correr sola al
  // volver la red. `ListState` ya pinta acá su cartel de sin conexión, así que
  // con el predicado angosto el botón decía "publicar igual" AL LADO de un
  // cartel que explica que no se pudo consultar.
  it('offline (isPaused) tampoco dice "publicar igual"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isPaused: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.publishWithoutWaiting',
    );
  });

  // Reintentar después de un error deja `status` en 'error', así que
  // `isLoading` se queda en false mientras la petición está viva — en este
  // deployment, los 30s o más que tarda Render en despertar.
  it('un reintento en vuelo tras un error tampoco dice "publicar igual"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isError: true, isFetching: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.publishWithoutWaiting',
    );
  });

  // Y el contraejemplo que fija el `data == null`: con las tarjetas YA en
  // pantalla, un refetch no cambia lo que la persona tiene delante.
  it('un refetch con datos ya visibles sigue diciendo "ninguno de estos"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isFetching: true, data: [candidato] })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.noneOfThem',
    );
  });
});
