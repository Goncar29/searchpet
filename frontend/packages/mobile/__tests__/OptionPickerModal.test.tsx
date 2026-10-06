// The theme and language pickers. They replace Alert.alert, which on Android
// shows at most three buttons (the fourth, Cancel, was dropped) and could not be
// dismissed by tapping outside: the user had to pick something to get out.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { OptionPickerModal } from '../components/OptionPickerModal';

const OPTIONS = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
] as const;

function setup(selected: 'system' | 'light' | 'dark' = 'light') {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  render(
    <OptionPickerModal
      visible
      title="Tema"
      options={[...OPTIONS]}
      selected={selected}
      onSelect={onSelect}
      onClose={onClose}
      closeLabel="Cerrar"
    />,
  );
  return { onSelect, onClose };
}

describe('OptionPickerModal', () => {
  it('shows the title and every option, all three at once', () => {
    setup();
    expect(screen.getByText('Tema')).toBeTruthy();
    for (const o of OPTIONS) expect(screen.getByText(o.label)).toBeTruthy();
  });

  it('marks only the current choice', () => {
    setup('light');
    expect(screen.getByTestId('option-check-light')).toBeTruthy();
    expect(screen.queryByTestId('option-check-dark')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Claro' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('choosing an option selects it and closes', () => {
    const { onSelect, onClose } = setup();
    fireEvent.press(screen.getByText('Oscuro'));
    expect(onSelect).toHaveBeenCalledWith('dark');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close button closes without choosing', () => {
    const { onSelect, onClose } = setup();
    fireEvent.press(screen.getByLabelText('Cerrar'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tapping outside the card closes without choosing', () => {
    const { onSelect, onClose } = setup();
    fireEvent.press(screen.getByTestId('option-picker-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('the Android back button closes it', () => {
    const { onClose } = setup();
    const { Modal } = require('react-native');
    screen.UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
