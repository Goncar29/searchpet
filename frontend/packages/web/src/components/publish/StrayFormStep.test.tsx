import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrayFormStep } from './StrayFormStep';
import type { StrayFormState } from '../../pages/PublishWizardPage';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    // Una clave que YA trae namespace explicito ("pets:create.gender") se
    // devuelve tal cual, como hace i18next: el default solo aplica cuando la
    // clave no lo declara. Sin esto el mock producia "pets:pets:create.gender".
    t: (key: string) => (key.includes(':') ? key : `${Array.isArray(ns) ? ns[0] : ns}:${key}`),
    i18n: { language: 'es' },
  }),
}));

const baseValue: StrayFormState = {
  type: 'perro',
  breed: '',
  color: '',
  description: '',
  photos: [],
  contactPublic: false,
  identity: { gender: '', birth: { year: '', month: '', day: '' } },
};

describe('StrayFormStep — reporter contact opt-in', () => {
  it('toggling the contact checkbox reports contactPublic=true', () => {
    const onChange = vi.fn();
    render(<StrayFormStep value={baseValue} onChange={onChange} onNext={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ contactPublic: true })
    );
  });

  it('renders the checkbox unchecked when contactPublic is false', () => {
    render(<StrayFormStep value={baseValue} onChange={vi.fn()} onNext={vi.fn()} />);

    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

// Quien reporta una callejera la encontro en la calle: el sexo lo puede VER, la
// fecha de nacimiento no la puede saber. Ofrecerle un selector de anio lo
// invitaria a inventar un dato, y la precision existe justamente para que nadie
// tenga que fabricar certeza. Este test fija esa distincion.
describe('StrayFormStep — senias', () => {
  it('pide el sexo pero NO la fecha de nacimiento', () => {
    render(<StrayFormStep value={baseValue} onChange={vi.fn()} onNext={vi.fn()} />);

    expect(screen.getByLabelText('pets:create.gender')).toBeTruthy();
    expect(screen.queryByLabelText('pets:create.birthYear')).toBeNull();
    expect(screen.queryByLabelText('pets:create.birthMonth')).toBeNull();
  });

  it('elegir el sexo lo reporta hacia arriba', () => {
    const onChange = vi.fn();
    render(<StrayFormStep value={baseValue} onChange={onChange} onNext={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('pets:create.gender'), { target: { value: 'female' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ gender: 'female' }) })
    );
  });
});
