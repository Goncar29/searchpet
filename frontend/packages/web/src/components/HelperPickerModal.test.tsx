import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelperPickerModal } from './HelperPickerModal';
import type { HelperCandidate } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  refetch: vi.fn(),
  useHelperCandidates: vi.fn(),
}));

vi.mock('@shared/hooks', () => ({
  useHelperCandidates: mocks.useHelperCandidates,
}));

const ANA: HelperCandidate = { id: 'u-ana', name: 'Ana', profile_photo_url: undefined };
const BETO: HelperCandidate = { id: 'u-beto', name: 'Beto' };

function queryResult(over: Record<string, unknown>) {
  return {
    data: undefined,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
    ...over,
  };
}

function withCandidates(list: HelperCandidate[]) {
  mocks.useHelperCandidates.mockReturnValue(queryResult({ data: list }));
}

function renderModal(props: Partial<React.ComponentProps<typeof HelperPickerModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <HelperPickerModal
      petId="pet-1"
      petName="Firulais"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

const confirmButton = () => screen.getByRole('button', { name: 'common:confirm' });

beforeEach(() => {
  mocks.useHelperCandidates.mockReset();
  mocks.refetch.mockReset();
});

describe('HelperPickerModal — candidate states', () => {
  it('asks the API for the candidates of THIS pet', () => {
    withCandidates([ANA]);
    renderModal();
    expect(mocks.useHelperCandidates).toHaveBeenCalledWith('pet-1', true);
  });

  it('while loading, shows the loading state and keeps confirm disabled', () => {
    mocks.useHelperCandidates.mockReturnValue(queryResult({ isLoading: true, isPending: true, isFetching: true }));
    renderModal();

    expect(screen.getByText('common:loading')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  // Regla #60: una consulta caída NO se pinta como "no hay candidatos". Si lo
  // hiciera, el dueño confirmaría sin poder contestar y el backend lo
  // rechazaría con helper_ids_required, o peor: creería que nadie ayudó.
  it('on error shows the error with retry, NOT the empty case, and confirm stays disabled', () => {
    mocks.useHelperCandidates.mockReturnValue(
      queryResult({ isError: true, error: new Error('boom') }),
    );
    const { onConfirm } = renderModal();

    expect(screen.getByRole('alert')).toHaveTextContent('pets:helpers.loadError');
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common:retry' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('with ZERO candidates it behaves like the plain confirm: enabled, no picker, sends no helper ids', () => {
    withCandidates([]);
    const { onConfirm } = renderModal();

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('pets:detail.markFoundConfirm')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('lists every candidate with a checkbox plus the explicit "nobody" option, nothing preselected', () => {
    withCandidates([ANA, BETO]);
    renderModal();

    expect(screen.getByRole('checkbox', { name: 'Ana' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beto' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'pets:helpers.nobody' })).not.toBeChecked();
  });
});

describe('HelperPickerModal — the owner must answer', () => {
  it('confirm is DISABLED until a helper or "nobody" is chosen', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ana' }));
    expect(confirmButton()).toBeEnabled();
  });

  it('"nobody" is a valid answer and sends an EMPTY list, not undefined', () => {
    withCandidates([ANA]);
    const { onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('checkbox', { name: 'pets:helpers.nobody' }));
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('selecting people sends exactly their ids', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Beto' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ana' }));
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith(['u-ana', 'u-beto']);
  });

  it('"nobody" and the checkboxes are mutually exclusive, in both directions', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();
    const nobody = screen.getByRole('checkbox', { name: 'pets:helpers.nobody' });
    const ana = screen.getByRole('checkbox', { name: 'Ana' });

    fireEvent.click(ana);
    fireEvent.click(nobody);
    expect(nobody).toBeChecked();
    expect(ana).not.toBeChecked();

    fireEvent.click(ana);
    expect(ana).toBeChecked();
    expect(nobody).not.toBeChecked();

    // Y lo que viaja es lo que se ve: Ana sola, no [] ni Ana + nadie.
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(['u-ana']);
  });

  it('unchecking the only helper un-answers the question', () => {
    withCandidates([ANA]);
    renderModal();

    const ana = screen.getByRole('checkbox', { name: 'Ana' });
    fireEvent.click(ana);
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(ana);
    expect(confirmButton()).toBeDisabled();
  });
});

describe('HelperPickerModal — mutation feedback', () => {
  it('renders the mapped API error and re-reads the candidates (the list may have changed)', () => {
    withCandidates([]);
    renderModal({ error: 'errors:helper_ids_required' });

    expect(screen.getByRole('alert')).toHaveTextContent('errors:helper_ids_required');
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('while the mutation runs, both buttons are disabled', () => {
    withCandidates([]);
    renderModal({ loading: true });

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeDisabled();
  });

  it('cancel calls onCancel without answering', () => {
    withCandidates([ANA]);
    const { onCancel, onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
