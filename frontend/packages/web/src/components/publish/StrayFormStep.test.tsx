import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrayFormStep } from './StrayFormStep';
import type { StrayFormState } from '../../pages/PublishWizardPage';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    t: (key: string) => `${Array.isArray(ns) ? ns[0] : ns}:${key}`,
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
