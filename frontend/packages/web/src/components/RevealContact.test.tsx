import { describe, it, expect, vi, afterEach } from 'vitest';
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

const labels = {
  revealLabel: 'Ver teléfono',
  contactLabel: 'Contactar por WhatsApp',
  callLabel: 'Llamar',
  copyLabel: 'Copiar número',
  copiedLabel: '¡Copiado!',
};

function renderReveal() {
  return render(<RevealContact phone="+59899123456" pet={pet} {...labels} />);
}

describe('RevealContact — anti-scraping reveal-on-click', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the phone number and the wa.me link until the user clicks reveal', () => {
    const { container } = renderReveal();

    // Before reveal: neither the number nor any wa.me href is in the DOM.
    expect(screen.queryByText(/\+59899123456/)).toBeNull();
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.getByRole('button', { name: /ver teléfono/i })).toBeInTheDocument();
  });

  it('reveals the phone number and a WhatsApp link on click', () => {
    const { container } = renderReveal();

    fireEvent.click(screen.getByRole('button', { name: /ver teléfono/i }));

    expect(screen.getByText(/\+59899123456/)).toBeInTheDocument();
    const link = container.querySelector('a[href*="wa.me"]');
    expect(link).toHaveAttribute('href', 'https://wa.me/+59899123456');
  });

  it('reveals a tappable Call (tel:) link with the phone number', () => {
    const { container } = renderReveal();

    fireEvent.click(screen.getByRole('button', { name: /ver teléfono/i }));

    const tel = container.querySelector('a[href^="tel:"]');
    expect(tel).toHaveAttribute('href', 'tel:+59899123456');
  });

  it('copies the number to the clipboard and shows copied feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderReveal();
    fireEvent.click(screen.getByRole('button', { name: /ver teléfono/i }));

    fireEvent.click(screen.getByRole('button', { name: /copiar número/i }));

    expect(writeText).toHaveBeenCalledWith('+59899123456');
    expect(await screen.findByText(/copiado/i)).toBeInTheDocument();
  });
});
