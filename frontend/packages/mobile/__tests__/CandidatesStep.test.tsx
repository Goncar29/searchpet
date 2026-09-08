// CandidatesStep (mobile) — el paso que evita publicar un callejero duplicado.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CandidatesStep } from '../components/publish/CandidatesStep';
import type { StrayCandidate } from '../../shared/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const candidato: StrayCandidate = {
  id: 'pet-vecino',
  name: 'Marroncito',
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
    refetch: jest.fn(),
    ...over,
  }) as never;

describe('CandidatesStep', () => {
  it('con la consulta caída muestra el cartel de error, NO "no hay candidatos"', () => {
    const onSkip = jest.fn();
    render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={onSkip}
      />,
    );

    expect(screen.getByText('publish:candidates.errorTitle')).toBeTruthy();
    // El usuario NO queda encerrado: sigue pudiendo publicar.
    expect(screen.getByText('publish:candidates.publishAnyway')).toBeTruthy();
    // Y NO se saltea solo: un fallo no es una respuesta, así que la decisión de
    // publicar igual la toma la persona.
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('con cero candidatos no dibuja el paso y avisa que hay que seguir', () => {
    const onSkip = jest.fn();
    render(<CandidatesStep query={queryStub({ data: [] })} onSelect={jest.fn()} onSkip={onSkip} />);

    expect(screen.queryByText('publish:candidates.title')).toBeNull();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // El paso existe para evitar un duplicado: si su salteo automático se dispara
  // dos veces, CREA el duplicado. Y re-renderiza seguro — `onSkip` sale sin
  // memoizar del wizard y publicar es asíncrono, así que entre la llamada y el
  // cambio de paso hay al menos un render.
  it('con cero candidatos llama a onSkip UNA sola vez aunque re-renderice', () => {
    const onSkip = jest.fn();
    const { rerender } = render(
      <CandidatesStep query={queryStub({ data: [] })} onSelect={jest.fn()} onSkip={onSkip} />,
    );

    // Identidad nueva de onSkip en cada render, como pasa de verdad.
    rerender(
      <CandidatesStep
        query={queryStub({ data: [] })}
        onSelect={jest.fn()}
        onSkip={() => onSkip()}
      />,
    );
    rerender(
      <CandidatesStep
        query={queryStub({ data: [] })}
        onSelect={jest.fn()}
        onSkip={() => onSkip()}
      />,
    );

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('lista los candidatos y "es este" devuelve el elegido', () => {
    const onSelect = jest.fn();
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={onSelect}
        onSkip={jest.fn()}
      />,
    );

    expect(screen.getByText('Marroncito')).toBeTruthy();
    // La tarjeta NUNCA usa la palabra "vencido": dice cuándo se lo vio.
    expect(screen.queryByText(/vencid/i)).toBeNull();

    fireEvent.press(screen.getByText('publish:candidates.isThisOne'));
    expect(onSelect).toHaveBeenCalledWith(candidato);
  });

  it('con candidatos la salida dice "ninguno", no "publicar igual"', () => {
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    expect(screen.getByText('publish:candidates.noneOfThem')).toBeTruthy();
    expect(screen.queryByText('publish:candidates.publishAnyway')).toBeNull();
  });

  // Mismo invariante que el salteo automático, por la vía manual: la salida
  // PUBLICA, y publicar es asíncrono. Sin deshabilitar, dos toques son dos
  // mascotas. `LocationStep` ya protege así su botón de publicar.
  it('mientras publica, la salida no responde', () => {
    const onSkip = jest.fn();
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={jest.fn()}
        onSkip={onSkip}
        isPublishing
      />,
    );

    fireEvent.press(screen.getByText('publish:candidates.noneOfThem'));
    expect(onSkip).not.toHaveBeenCalled();
  });

  // El mismo invariante en su tercera vía, y la única que NADIE toca: la
  // respuesta cambia sola.
  //
  // Con la consulta caída la persona toca "Publicar igual", el alta viaja, y en
  // esa ventana un refetch —el "Reintentar" del ListState, o el reconnect que
  // cablea `utils/onlineStatus`— devuelve `[]`. `sinCandidatos` pasa a true con
  // `yaSalteo` todavía en false, el efecto se enciende, y sale un SEGUNDO alta.
  // El ref cubre el re-render; no cubre el flanco.
  it('con un alta en vuelo, una lista que llega vacía NO dispara el salteo', () => {
    const onSkip = jest.fn();
    const { rerender } = render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={onSkip}
        isPublishing
      />,
    );

    // El refetch aterriza mientras el alta sigue viajando.
    rerender(
      <CandidatesStep
        query={queryStub({ data: [] })}
        onSelect={jest.fn()}
        onSkip={() => onSkip()}
        isPublishing
      />,
    );

    expect(onSkip).not.toHaveBeenCalled();
  });

  // Mientras publica, "es este" tampoco: si no, un toque en cada botón deja una
  // mascota nueva Y un avistamiento sobre la vieja.
  it('mientras publica, "es este" no responde', () => {
    const onSelect = jest.fn();
    render(
      <CandidatesStep
        query={queryStub({ data: [candidato] })}
        onSelect={onSelect}
        onSkip={jest.fn()}
        isPublishing
      />,
    );

    fireEvent.press(screen.getByText('publish:candidates.isThisOne'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  // La fecha sale de `toLocaleDateString`, no de `Intl.RelativeTimeFormat`:
  // Hermes implementa un subconjunto de Intl y este componente corría el
  // constructor en el cuerpo del render, así que su ausencia no degradaba la
  // fecha, reventaba el paso. El test afirma el material —que la fecha se
  // dibujó— y no el nombre del formateador.
  it('dibuja la fecha del avistamiento sin depender de Intl.RelativeTimeFormat', () => {
    // Por el índice y no por la propiedad: para TypeScript `Intl` es de sólo
    // lectura, y borrarla/reponerla directo no compila aunque babel lo permita.
    const intl = Intl as unknown as Record<string, unknown>;
    const rtf = intl.RelativeTimeFormat;
    delete intl.RelativeTimeFormat;
    try {
      render(
        <CandidatesStep
          query={queryStub({ data: [candidato] })}
          onSelect={jest.fn()}
          onSkip={jest.fn()}
        />,
      );
      expect(screen.getByText(/publish:candidates.lastSeenOn/)).toBeTruthy();
    } finally {
      intl.RelativeTimeFormat = rtf;
    }
  });
});

// Espeja los tests de la web: las dos plataformas tienen el mismo componente y
// el mismo comportamiento, y la única forma de que no diverjan en silencio es
// que las dos afirmen lo mismo.
describe('la salida mientras la consulta carga', () => {
  it('no dice "publicar igual" antes de que el chequeo haya contestado', () => {
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isLoading: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(getByText('publish:candidates.publishWithoutWaiting')).toBeTruthy();
  });

  // La mitad que fija la distinción: con la consulta CAÍDA sí corresponde
  // "publicar igual", porque ahí no hay nada que esperar.
  it('con la consulta caída sí dice "publicar igual"', () => {
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(getByText('publish:candidates.publishAnyway')).toBeTruthy();
  });

  // Y sigue sin bloquear.
  it('la salida sigue habilitada mientras carga', () => {
    const onSkip = jest.fn();
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isLoading: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={onSkip}
      />,
    );
    fireEvent.press(getByText('publish:candidates.publishWithoutWaiting'));
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
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isPaused: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(getByText('publish:candidates.publishAnyway')).toBeTruthy();
  });

  // Reintentar después de un error deja `status` en 'error', así que
  // `isLoading` se queda en false mientras la petición está viva — en este
  // deployment, los 30s o más que tarda Render en despertar.
  it('un reintento en vuelo tras un error tampoco dice "publicar igual"', () => {
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isError: true, isFetching: true, data: undefined })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(getByText('publish:candidates.publishWithoutWaiting')).toBeTruthy();
  });

  // Y el contraejemplo que fija el `data == null`: con las tarjetas YA en
  // pantalla, un refetch no cambia lo que la persona tiene delante.
  it('un refetch con datos ya visibles sigue diciendo "ninguno de estos"', () => {
    const { getByText } = render(
      <CandidatesStep
        query={queryStub({ isFetching: true, data: [candidato] })}
        onSelect={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(getByText('publish:candidates.noneOfThem')).toBeTruthy();
  });
});

// El salteo automático NO puede correr con un alta en vuelo, y con "no correr"
// alcanza sólo si además QUEDA consumido.
//
// El tercer render es el que separa SUPRIMIR de DIFERIR: si el guard sale sin
// marcar el ref, cuando la publicación FALLA (`isPublishing` vuelve a false con
// el paso todavía en 'candidates') el efecto se reanuda y dispara un segundo
// `onSkip()` sin que nadie toque nada — encima borrando el error que la persona
// tenía que leer. Si la primera request llegó al server, son dos mascotas.
it('no saltea automáticamente si ya hay un alta en vuelo, ni cuando esa alta falla', () => {
  const onSkip = jest.fn();
  const props = (q: never, pub: boolean) => ({
    query: q,
    onSelect: jest.fn(),
    onSkip,
    isPublishing: pub,
  });

  const { rerender, getByText } = render(
    <CandidatesStep {...props(queryStub({ isLoading: true }), false)} />,
  );

  // La persona toca la salida: el alta arranca.
  fireEvent.press(getByText('publish:candidates.publishWithoutWaiting'));
  expect(onSkip).toHaveBeenCalledTimes(1);

  // La consulta contesta vacío con la publicación todavía en vuelo.
  rerender(<CandidatesStep {...props(queryStub({ data: [] }), true)} />);
  expect(onSkip).toHaveBeenCalledTimes(1);

  // Y el alta FALLA.
  rerender(<CandidatesStep {...props(queryStub({ data: [] }), false)} />);
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
  const onSkip = jest.fn();
  const p = (q: never, pub: boolean) => ({
    query: q,
    onSelect: jest.fn(),
    onSkip,
    isPublishing: pub,
  });

  const { rerender, getByText } = render(
    <CandidatesStep {...p(queryStub({ isLoading: true }), false)} />,
  );
  fireEvent.press(getByText('publish:candidates.publishWithoutWaiting'));
  rerender(<CandidatesStep {...p(queryStub({ isLoading: true }), true)} />);
  rerender(<CandidatesStep {...p(queryStub({ isLoading: true }), false)} />);
  rerender(<CandidatesStep {...p(queryStub({ data: [] }), false)} />);

  expect(onSkip).toHaveBeenCalledTimes(1);
});

// Elegir "es este" también consume el salteo: la persona ya dijo que el animal
// tiene ficha, así que auto-publicar una nueva porque un refetch devolvió []
// crearía exactamente lo que acaba de decir que no hacía falta.
it('elegir un candidato también consume el salteo automático', () => {
  const onSkip = jest.fn();
  const onSelect = jest.fn();

  const { rerender, getByText } = render(
    <CandidatesStep query={queryStub({ data: [candidato] })} onSelect={onSelect} onSkip={onSkip} />,
  );

  fireEvent.press(getByText('publish:candidates.isThisOne'));
  expect(onSelect).toHaveBeenCalledTimes(1);

  rerender(
    <CandidatesStep query={queryStub({ data: [] })} onSelect={onSelect} onSkip={onSkip} />,
  );
  expect(onSkip).not.toHaveBeenCalled();
});

// Si el alta falla y la consulta ya contestó vacío, el paso NO puede
// desaparecer: sin la salida la persona queda con el error y sin forma de
// reintentar desde donde está. Choca con la regla 3 ("nunca bloquea").
it('si el alta falla con la lista vacía, la salida sigue en pantalla', () => {
  const onSkip = jest.fn();
  const p = (q: never, pub: boolean) => ({
    query: q,
    onSelect: jest.fn(),
    onSkip,
    isPublishing: pub,
  });

  const { rerender, getByText, queryByText } = render(
    <CandidatesStep {...p(queryStub({ isLoading: true }), false)} />,
  );
  fireEvent.press(getByText('publish:candidates.publishWithoutWaiting'));

  rerender(<CandidatesStep {...p(queryStub({ data: [] }), true)} />);
  rerender(<CandidatesStep {...p(queryStub({ data: [] }), false)} />);

  // El texto es `noneOfThem`, no `publishAnyway`: una lista vacía SÍ es una
  // respuesta de la consulta. Lo que se afirma acá es que el botón EXISTE, no
  // qué dice.
  expect(queryByText('publish:candidates.noneOfThem')).toBeTruthy();
});

// El contraejemplo que deja vivo el `return null`.
it('sin acción previa y sin candidatos, el paso no renderiza nada', () => {
  const { toJSON } = render(
    <CandidatesStep query={queryStub({ data: [] })} onSelect={jest.fn()} onSkip={jest.fn()} />,
  );
  expect(toJSON()).toBeNull();
});
