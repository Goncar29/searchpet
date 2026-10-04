import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { HelperPickerModal } from '../components/HelperPickerModal';
import type { HelperCandidate } from '../../shared/types';

const mockRefetch = jest.fn();
const mockUseHelperCandidates = jest.fn();

jest.mock('@shared/hooks', () => ({
  useHelperCandidates: (...args: unknown[]) => mockUseHelperCandidates(...args),
}));

const ANA: HelperCandidate = { id: 'u-ana', name: 'Ana' };
const BETO: HelperCandidate = {
  id: 'u-beto',
  name: 'Beto',
  profile_photo_url: 'https://res.cloudinary.com/x/image/upload/v1/beto.jpg',
};

function queryResult(over: Record<string, unknown>) {
  return {
    data: undefined,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    ...over,
  };
}

function withCandidates(list: HelperCandidate[]) {
  mockUseHelperCandidates.mockReturnValue(queryResult({ data: list }));
}

function renderModal(props: Partial<React.ComponentProps<typeof HelperPickerModal>> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
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

const confirmButton = () => screen.getByText('common:confirm');
const press = (text: string) => fireEvent.press(screen.getByText(text));

beforeEach(() => {
  mockUseHelperCandidates.mockReset();
  mockRefetch.mockReset();
});

describe('HelperPickerModal — states of the candidates query', () => {
  it('shows a loading indicator and keeps Confirm disabled while loading', () => {
    mockUseHelperCandidates.mockReturnValue(queryResult({ isLoading: true, isPending: true }));
    const { onConfirm } = renderModal();

    expect(screen.getByText('common:loading')).toBeTruthy();
    fireEvent.press(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a failed query shows the error with a retry, NOT the plain confirm (rule #60)', () => {
    mockUseHelperCandidates.mockReturnValue(queryResult({ isError: true }));
    const { onConfirm } = renderModal();

    expect(screen.getByText('pets:helpers.loadError')).toBeTruthy();
    // The zero-candidates copy must not appear: we do not know that.
    expect(screen.queryByText('pets:detail.markFoundConfirm')).toBeNull();
    fireEvent.press(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    press('common:retry');
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('with zero candidates it is a plain confirmation and sends no helper ids', () => {
    withCandidates([]);
    const { onConfirm } = renderModal();

    expect(screen.getByText('pets:detail.markFoundConfirm')).toBeTruthy();
    expect(screen.queryByText('pets:helpers.nobody')).toBeNull();
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('lists the candidates and the explicit "nobody" option, with nothing preselected', () => {
    withCandidates([ANA, BETO]);
    renderModal();

    expect(screen.getByText('pets:helpers.title')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Ana' }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Beto' }).props.accessibilityState.checked).toBe(false);
    expect(
      screen.getByRole('checkbox', { name: 'pets:helpers.nobody' }).props.accessibilityState.checked,
    ).toBe(false);
  });

  it('draws the Cloudinary thumbnail when there is a photo and the initial when there is not', () => {
    withCandidates([ANA, BETO]);
    renderModal();

    expect(screen.getByText('A')).toBeTruthy();
    const images = screen.UNSAFE_getAllByType(require('react-native').Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.source.uri).toContain('/upload/');
    expect(images[0].props.source.uri).toContain('c_lfill');
  });
});

describe('HelperPickerModal — answering', () => {
  it('Confirm is disabled until the owner answers', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    fireEvent.press(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'common:confirm' }).props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('"nobody" sends an empty array', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    press('pets:helpers.nobody');
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('sends exactly the selected ids', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    press('Ana');
    press('Beto');
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(['u-ana', 'u-beto']);
  });

  it('unticking the only selection disables Confirm again', () => {
    withCandidates([ANA]);
    const { onConfirm } = renderModal();

    press('Ana');
    press('Ana');
    fireEvent.press(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"nobody" and a person are mutually exclusive, in both directions', () => {
    withCandidates([ANA, BETO]);
    const { onConfirm } = renderModal();

    press('Ana');
    press('pets:helpers.nobody');
    expect(screen.getByRole('checkbox', { name: 'Ana' }).props.accessibilityState.checked).toBe(false);
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenLastCalledWith([]);

    press('Beto');
    expect(
      screen.getByRole('checkbox', { name: 'pets:helpers.nobody' }).props.accessibilityState.checked,
    ).toBe(false);
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenLastCalledWith(['u-beto']);
  });

  it('cancel calls onCancel', () => {
    withCandidates([ANA]);
    const { onCancel } = renderModal();
    press('common:cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('HelperPickerModal — mutation feedback', () => {
  it('renders the error it is given, keeps the selection and re-reads the candidates', () => {
    withCandidates([ANA, BETO]);
    renderModal({ error: 'errors:invalid_helpers' });

    expect(screen.getByText('errors:invalid_helpers')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Ana' })).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('keeps the selection when the error arrives after the owner chose', () => {
    withCandidates([ANA, BETO]);
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const ui = (error: string | null) => (
      <HelperPickerModal
        petId="pet-1"
        petName="Firulais"
        error={error}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    const view = render(ui(null));
    press('Ana');
    view.rerender(ui('errors:invalid_helpers'));

    expect(screen.getByRole('checkbox', { name: 'Ana' }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(['u-ana']);
  });

  it('while the mutation runs Confirm cannot be pressed twice', () => {
    withCandidates([ANA]);
    const { onConfirm } = renderModal({ loading: true });

    // Loading swaps the label for a spinner; the button itself is disabled.
    expect(screen.queryByText('common:confirm')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
