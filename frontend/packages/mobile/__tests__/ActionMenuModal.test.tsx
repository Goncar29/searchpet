// The action menus (chat ⋮, report reasons, logout confirmation). They replace
// Alert.alert, which on Android shows at most three buttons: the chat ⋮ had
// four (Cancel, View profile, Block, Report) and Report was dropped, and the
// report reasons had six, so most reasons were unreachable.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ActionMenuModal } from '../components/ActionMenuModal';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';

function setup(extra: Partial<React.ComponentProps<typeof ActionMenuModal>> = {}) {
  const onClose = jest.fn();
  const actions = [
    { key: 'a', label: 'Uno', onPress: jest.fn() },
    { key: 'b', label: 'Dos', onPress: jest.fn() },
    { key: 'c', label: 'Tres', onPress: jest.fn(), destructive: true },
    { key: 'd', label: 'Cuatro', onPress: jest.fn() },
    { key: 'e', label: 'Cinco', onPress: jest.fn() },
  ];
  render(
    <ActionMenuModal
      visible
      title="Opciones"
      actions={actions}
      onClose={onClose}
      closeLabel="Cerrar"
      {...extra}
    />,
  );
  return { onClose, actions };
}

describe('ActionMenuModal', () => {
  it('shows the title and every action, more than three at once', () => {
    const { actions } = setup();
    expect(screen.getByText('Opciones')).toBeTruthy();
    for (const a of actions) expect(screen.getByRole('button', { name: a.label })).toBeTruthy();
  });

  it('shows the message under the title when there is one', () => {
    setup({ message: '¿Estás seguro?' });
    expect(screen.getByText('¿Estás seguro?')).toBeTruthy();
  });

  it('pressing an action closes the menu and runs only that action', () => {
    const { onClose, actions } = setup();
    fireEvent.press(screen.getByRole('button', { name: 'Cuatro' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(actions[3].onPress).toHaveBeenCalledTimes(1);
    for (const a of actions) if (a.key !== 'd') expect(a.onPress).not.toHaveBeenCalled();
  });

  it('closes on the X and on the backdrop without running any action', () => {
    const { onClose, actions } = setup();
    fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.press(screen.getByTestId('action-menu-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    for (const a of actions) expect(a.onPress).not.toHaveBeenCalled();
  });

  it('paints a destructive action in the danger color and the rest in the text color', () => {
    setup();
    const color = (label: string) => {
      const style = [screen.getByText(label).props.style].flat(Infinity);
      return Object.assign({}, ...style.filter(Boolean)).color;
    };
    expect([LIGHT_COLORS.danger, DARK_COLORS.danger]).toContain(color('Tres'));
    expect(color('Uno')).not.toBe(color('Tres'));
  });
});
