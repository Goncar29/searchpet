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
    isPaused: false,
    isError: false,
    // `isPending` e `isFetching` se DERIVAN salvo que el caso los diga
    // explícito. React Query define `isLoading === isPending && isFetching`, y
    // una primera carga sin datos siempre es `pending`: un stub con
    // `isLoading: true, isPending: false` es un estado que NO EXISTE. Dejarlos
    // libres hizo que estos tests pasaran contra un predicado que la app real
    // nunca satisface.
    isFetching: over.isLoading === true,
    isPending: over.isLoading === true || over.isPaused === true,
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

  // Sin conectividad React Query PAUSA la consulta: no hay NADA en vuelo y no
  // lo va a haber hasta que vuelva la red. `ListState` ya pinta acá "cuando
  // vuelva la conexión, probá de nuevo", así que "publicar sin esperar"
  // anunciaría una espera que no está ocurriendo. Corresponde "publicar igual",
  // igual que ante un error.
  //
  // Este test estuvo un rato afirmando lo contrario. Se deja explícito porque
  // la distinción es fina: "no contestó" y "está contestando" no son lo mismo.
  it('offline (isPaused) dice "publicar igual", no "sin esperar"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isPaused: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByTestId('candidates-skip')).toHaveTextContent(
      'publish:candidates.publishAnyway',
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

// El salteo automático NO puede correr con un alta en vuelo.
//
// Mobile ya tenía este guard (se aplicó en el #230) y la web NO — divergieron
// en silencio, que es justo lo que el bloque de arriba dice que no puede pasar.
//
// El camino: la persona toca la salida mientras la consulta está en vuelo, eso
// PUBLICA y el alta tarda (Render despertando, 30s+). Mientras tanto la
// consulta contesta `[]`, `sinCandidatos` pasa a true y `yaSalteo` sigue en
// false —el click manual nunca lo tocó—, así que el efecto dispara `onSkip()`
// otra vez: DOS mascotas, el duplicado exacto que este paso existe para evitar.
it('no saltea automáticamente si ya hay un alta en vuelo', () => {
  const onSkip = vi.fn();
  const { rerender } = render(
    <CandidatesStep
      query={queryStub({ isLoading: true, data: undefined })}
      onSelect={vi.fn()}
      onSkip={onSkip}
      isPublishing={false}
    />,
  );

  // La persona toca "publicar sin esperar": el alta arranca.
  fireEvent.click(screen.getByTestId('candidates-skip'));
  expect(onSkip).toHaveBeenCalledTimes(1);

  // Y AHORA la consulta contesta vacío, con la publicación todavía en vuelo.
  rerender(
    <CandidatesStep
      query={queryStub({ data: [] })}
      onSelect={vi.fn()}
      onSkip={onSkip}
      isPublishing
    />,
  );

  expect(onSkip).toHaveBeenCalledTimes(1);

  // Y AHORA el alta FALLA: `isPublishing` vuelve a false con el paso todavía
  // en 'candidates'. Este tercer render es el que separa SUPRIMIR de DIFERIR —
  // sin él, el test certifica un guard que no se sostiene: la primera versión
  // salía sin marcar el ref y acá disparaba un segundo `onSkip()`, borrando de
  // paso el error que la persona tenía que leer.
  rerender(
    <CandidatesStep
      query={queryStub({ data: [] })}
      onSelect={vi.fn()}
      onSkip={onSkip}
      isPublishing={false}
    />,
  );

  expect(onSkip).toHaveBeenCalledTimes(1);
});

// El MISMO escenario en el ORDEN INVERSO: la publicación falla ANTES de que la
// consulta conteste.
//
// Es la mitad que delató que el guard dependía del orden. Con `isPublishing`
// como única defensa, el efecto sólo consumía el ref si la publicación seguía
// en vuelo justo cuando `sinCandidatos` cambiaba; si fallaba primero y la
// consulta contestaba después, salía un segundo `onSkip()`.
it('tampoco saltea si el alta falla ANTES de que la consulta conteste', () => {
  const onSkip = vi.fn();
  const p = (q: never, pub: boolean) => ({
    query: q,
    onSelect: vi.fn(),
    onSkip,
    isPublishing: pub,
  });

  const { rerender } = render(<CandidatesStep {...p(queryStub({ isLoading: true }), false)} />);
  fireEvent.click(screen.getByTestId('candidates-skip'));
  rerender(<CandidatesStep {...p(queryStub({ isLoading: true }), true)} />);
  rerender(<CandidatesStep {...p(queryStub({ isLoading: true }), false)} />);
  rerender(<CandidatesStep {...p(queryStub({ data: [] }), false)} />);

  expect(onSkip).toHaveBeenCalledTimes(1);
});

// Elegir "es este" también consume el salteo: la persona ya dijo que el animal
// tiene ficha, así que auto-publicar una nueva porque un refetch devolvió []
// crearía exactamente lo que acaba de decir que no hacía falta.
it('elegir un candidato también consume el salteo automático', () => {
  const onSkip = vi.fn();
  const onSelect = vi.fn();

  const { rerender } = render(
    <CandidatesStep query={queryStub({ data: [candidato] })} onSelect={onSelect} onSkip={onSkip} />,
  );

  fireEvent.click(screen.getByTestId('candidate-select'));
  expect(onSelect).toHaveBeenCalledTimes(1);

  rerender(
    <CandidatesStep query={queryStub({ data: [] })} onSelect={onSelect} onSkip={onSkip} />,
  );
  expect(onSkip).not.toHaveBeenCalled();
});

// El `return null` con cero candidatos: el efecto saltea solo y no tiene que
// haber ningún flash del paso mientras el wizard cambia. Estuvo relajado un
// commit para dejar la salida como reintento tras un fallo de publicación, y se
// revirtió: desocultaba el paso también en el camino automático —el más común—
// pintando el encabezado con cero tarjetas durante toda la publicación.
it('sin candidatos el paso no renderiza nada, ni siquiera publicando', () => {
  const { container, rerender } = render(
    <CandidatesStep query={queryStub({ data: [] })} onSelect={vi.fn()} onSkip={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();

  rerender(
    <CandidatesStep query={queryStub({ data: [] })} onSelect={vi.fn()} onSkip={vi.fn()} isPublishing />,
  );
  expect(container).toBeEmptyDOMElement();
});
