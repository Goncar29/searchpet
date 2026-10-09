// showAlert + AlertHost replace Alert.alert across the app: the native dialog
// ignored the theme and, on Android, showed at most three buttons. The host
// draws the same card as the menus (ModalCard).
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { AlertHost } from '../components/AlertHost';
import { showAlert, resetAlerts } from '../components/appAlert';

beforeEach(() => {
  // i18next is not initialised in this harness; echo the key instead.
  jest.spyOn(require('i18next'), 't').mockImplementation((k: unknown) => k as string);
  resetAlerts();
});

afterEach(() => jest.restoreAllMocks());

function show(...args: Parameters<typeof showAlert>) {
  act(() => showAlert(...args));
}

describe('AlertHost', () => {
  it('shows nothing until an alert is raised', () => {
    render(<AlertHost />);
    expect(screen.queryByRole('header')).toBeNull();
  });

  it('a notice without buttons shows its title, message and a single OK that closes it', () => {
    render(<AlertHost />);
    show('Denuncia enviada', 'Gracias por avisar');
    expect(screen.getByText('Denuncia enviada')).toBeTruthy();
    expect(screen.getByText('Gracias por avisar')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'common:ok' }));
    expect(screen.queryByText('Denuncia enviada')).toBeNull();
  });

  it('shows every non-cancel button, more than three at once, and runs only the pressed one', () => {
    render(<AlertHost />);
    const buttons = ['Uno', 'Dos', 'Tres', 'Cuatro'].map((text) => ({ text, onPress: jest.fn() }));
    show('Opciones', '', [{ text: 'Cancelar', style: 'cancel' }, ...buttons]);
    for (const b of buttons) expect(screen.getByRole('button', { name: b.text })).toBeTruthy();
    // Cancel is the X, the backdrop and the back button, not a row.
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Tres' }));
    expect(buttons[2].onPress).toHaveBeenCalledTimes(1);
    for (const b of buttons) if (b.text !== 'Tres') expect(b.onPress).not.toHaveBeenCalled();
    expect(screen.queryByText('Opciones')).toBeNull();
  });

  it('closing with the X runs the cancel button, not the others', () => {
    render(<AlertHost />);
    const cancel = jest.fn();
    const del = jest.fn();
    show('¿Borrar?', undefined, [
      { text: 'Cancelar', style: 'cancel', onPress: cancel },
      { text: 'Borrar', style: 'destructive', onPress: del },
    ]);
    fireEvent.press(screen.getByRole('button', { name: 'common:close' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByText('¿Borrar?')).toBeNull();
  });

  it('closing a one-button notice runs that button, so a flow that navigates on OK cannot get stuck', () => {
    render(<AlertHost />);
    const goToLogin = jest.fn();
    show('Cuenta creada', 'Ya podés entrar', [{ text: 'OK', onPress: goToLogin }]);
    fireEvent.press(screen.getByTestId('app-alert-backdrop'));
    expect(goToLogin).toHaveBeenCalledTimes(1);
  });

  it('a notice whose only button is a cancel shows that button and runs it', () => {
    render(<AlertHost />);
    const done = jest.fn();
    show('Listo', undefined, [{ text: 'Entendido', style: 'cancel', onPress: done }]);
    fireEvent.press(screen.getByRole('button', { name: 'Entendido' }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('paints a destructive button in the danger color and the rest in the text color', () => {
    const { LIGHT_COLORS } = require('../constants');
    render(<AlertHost />);
    show('¿Borrar?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Archivar' },
      { text: 'Borrar', style: 'destructive' },
    ]);
    const colorOf = (label: string) =>
      [screen.getByText(label).props.style].flat(Infinity).reduce((acc, s) => ({ ...acc, ...(s || {}) }), {}).color;
    expect(colorOf('Borrar')).toBe(LIGHT_COLORS.danger);
    expect(colorOf('Archivar')).toBe(LIGHT_COLORS.textPrimary);
  });

  it('closing a menu without a cancel button runs nothing', () => {
    render(<AlertHost />);
    const a = jest.fn();
    const b = jest.fn();
    show('Buscar por foto', undefined, [
      { text: 'Cámara', onPress: a },
      { text: 'Galería', onPress: b },
    ]);
    fireEvent.press(screen.getByRole('button', { name: 'common:close' }));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(screen.queryByText('Buscar por foto')).toBeNull();
  });

  it('an alert raised while another is open waits its turn instead of replacing it', () => {
    render(<AlertHost />);
    show('Primero');
    show('Segundo');
    expect(screen.getByText('Primero')).toBeTruthy();
    expect(screen.queryByText('Segundo')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'common:ok' }));
    expect(screen.getByText('Segundo')).toBeTruthy();
  });

  it('an alert raised from a button press shows after the current one closes', () => {
    render(<AlertHost />);
    show('¿Bloquear?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Bloquear', onPress: () => showAlert('Usuario bloqueado') },
    ]);
    fireEvent.press(screen.getByRole('button', { name: 'Bloquear' }));
    expect(screen.queryByText('¿Bloquear?')).toBeNull();
    expect(screen.getByText('Usuario bloqueado')).toBeTruthy();
  });
});
