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
    isPending: false,
    isPaused: false,
    isError: false,
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
});
