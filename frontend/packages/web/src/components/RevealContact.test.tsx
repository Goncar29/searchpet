import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealContact } from './RevealContact';
import type { Pet } from '@shared/types';

vi.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: (phone: string) => `https://wa.me/${phone}`,
}));

const pet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  status: 'lost',
  photos: [],
  created_at: new Date().toISOString(),
};

describe('RevealContact — anti-scraping reveal-on-click', () => {
  it('hides the phone number and the wa.me link until the user clicks reveal', () => {
    const { container } = render(
      <RevealContact phone="+59899123456" pet={pet} revealLabel="Ver teléfono" contactLabel="Contactar por WhatsApp" />
    );

    // Before reveal: neither the number nor any wa.me href is in the DOM.
    expect(screen.queryByText(/\+59899123456/)).toBeNull();
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull();
    expect(screen.getByRole('button', { name: /ver teléfono/i })).toBeInTheDocument();
  });

  it('reveals the phone number and a WhatsApp link on click', () => {
    const { container } = render(
      <RevealContact phone="+59899123456" pet={pet} revealLabel="Ver teléfono" contactLabel="Contactar por WhatsApp" />
    );

    fireEvent.click(screen.getByRole('button', { name: /ver teléfono/i }));

    expect(screen.getByText(/\+59899123456/)).toBeInTheDocument();
    const link = container.querySelector('a[href*="wa.me"]');
    expect(link).toHaveAttribute('href', 'https://wa.me/+59899123456');
  });
});
