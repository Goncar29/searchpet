import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthField } from './AuthField';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

function Harness(props: { type?: 'text' | 'password'; error?: string }) {
  const [value, setValue] = useState('');
  return (
    <AuthField
      label="Correo electrónico"
      type={props.type ?? 'text'}
      icon="mail"
      value={value}
      onChange={setValue}
      error={props.error}
    />
  );
}

describe('AuthField', () => {
  // RegisterPage used to render six bare <label>s with no htmlFor next to six
  // <input>s with no id, so the control had no accessible name and clicking the
  // label did nothing. Neither failure is visible on screen or in a screenshot —
  // querying BY THE LABEL is what makes the association observable.
  it('associates the label with the input', () => {
    render(<Harness />);

    const input = screen.getByLabelText('Correo electrónico');

    expect(input.tagName).toBe('INPUT');
  });

  it('unmasks the value and renames the toggle when the password is revealed', () => {
    render(<Harness type="password" />);

    const input = screen.getByLabelText('Correo electrónico');
    expect(input).toHaveProperty('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'auth:showPassword' }));

    // The type has to actually change: keeping type="password" and faking the
    // reveal would leave the browser masking the value.
    expect(input).toHaveProperty('type', 'text');
    // A toggle that keeps announcing "show password" once the password is
    // already showing is worse than no label at all.
    expect(screen.getByRole('button', { name: 'auth:hidePassword' })).toBeTruthy();
  });

  it('points the input at its error message so a screen reader reaches it', () => {
    render(<Harness error="Campo requerido" />);

    const input = screen.getByLabelText('Correo electrónico');
    const describedBy = input.getAttribute('aria-describedby');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('Campo requerido');
  });

  it('renders no toggle for a field that holds no password', () => {
    render(<Harness />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  // The recovery OTP field is the only caller of these two, and it passes them
  // from the page. Dropping either line from the component would leave the code
  // field silently accepting more than six characters and offering a full
  // keyboard on a phone — neither of which shows up as a failure anywhere else.
  it('forwards the numeric keypad and the length cap to the input', () => {
    render(
      <AuthField
        label="Código"
        type="text"
        icon="pin"
        value=""
        onChange={() => {}}
        inputMode="numeric"
        maxLength={6}
      />
    );

    const input = screen.getByLabelText('Código');

    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input).toHaveProperty('maxLength', 6);
  });
});
