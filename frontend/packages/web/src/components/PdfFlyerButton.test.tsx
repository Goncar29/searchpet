import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PdfFlyerButton } from './PdfFlyerButton';
import type { Pet } from '@shared/types';

vi.mock('@shared/hooks', () => ({
  useShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const basePet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'dorado',
  status: 'lost',
  photos: [{ id: 'ph-1', url: 'https://img.test/dog.jpg', is_primary: true, created_at: '' }],
  created_at: new Date().toISOString(),
};

describe('PdfFlyerButton', () => {
  it('renders a full-width 4:3 photo banner above the title and table', () => {
    const { container } = render(<PdfFlyerButton pet={basePet} />);
    const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    const img = hidden.querySelector('img[alt="Firulais"]') as HTMLImageElement;
    const title = hidden.querySelector('h1');

    expect(img).toBeTruthy();
    expect(img.style.objectFit).toBe('contain');
    expect(title?.textContent).toBe('Firulais');

    const bannerWrapper = img.parentElement as HTMLElement;
    expect(bannerWrapper.style.height).toBe('536px');

    // El banner debe aparecer antes que el título en el DOM
    const position = img.compareDocumentPosition(title!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the paw placeholder in the banner when there is no photo', () => {
    const petWithoutPhoto: Pet = { ...basePet, photos: [] };
    const { container, getByLabelText } = render(<PdfFlyerButton pet={petWithoutPhoto} />);
    const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    expect(getByLabelText('SearchPet')).toBeInTheDocument();
    expect(hidden.querySelector('img[alt="Firulais"]')).toBeNull();
  });
});

describe('PdfFlyerButton — adoption framing', () => {
  it('renders EN ADOPCIÓN header and the city row for adoption pets', () => {
    const adoptionPet: Pet = { ...basePet, status: 'adoption', city: 'Montevideo' };
    const { container } = render(<PdfFlyerButton pet={adoptionPet} />);
    expect(container.textContent).toContain('¡EN ADOPCIÓN!');
    expect(container.textContent).toContain('Montevideo');
    expect(container.textContent).not.toContain('¡MASCOTA PERDIDA!');
  });

  it('keeps the lost header for lost pets', () => {
    const { container } = render(<PdfFlyerButton pet={{ ...basePet, status: 'lost', city: undefined }} />);
    expect(container.textContent).toContain('¡MASCOTA PERDIDA!');
  });
});
