import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PetCardWeb } from './PetCardWeb';
import type { Report } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
    i18n: { language: 'es' },
  }),
}));

const baseReport: Report = {
  id: 'report-1',
  pet_id: 'pet-1',
  reporter_id: 'user-1',
  status: 'lost',
  latitude: -34.9011,
  longitude: -56.1645,
  is_verified: false,
  created_at: new Date().toISOString(),
  pet: {
    id: 'pet-1',
    owner_id: 'user-1',
    name: 'Firulais',
    type: 'perro',
    breed: 'Labrador',
    color: 'amarillo',
    status: 'active',
    photos: [],
    created_at: new Date().toISOString(),
  },
};

function renderCard(report: Report) {
  return render(
    <MemoryRouter>
      <PetCardWeb report={report} />
    </MemoryRouter>
  );
}

describe('PetCardWeb', () => {
  it('muestra el nombre de la mascota', () => {
    renderCard(baseReport);
    expect(screen.getByText('Firulais')).toBeInTheDocument();
  });

  it('muestra badge "lost" para status perdido', () => {
    renderCard({ ...baseReport, status: 'lost' });
    // El componente llama .toUpperCase() sobre la clave de traducción
    expect(screen.getByText('PETS:CARD.LOST')).toBeInTheDocument();
  });

  it('muestra badge "found" para status encontrado', () => {
    renderCard({ ...baseReport, status: 'found' });
    expect(screen.getByText('PETS:CARD.FOUND')).toBeInTheDocument();
  });

  it('muestra badge "sighting" para avistamiento', () => {
    renderCard({ ...baseReport, status: 'sighting' });
    expect(screen.getByText('PETS:CARD.SIGHTING')).toBeInTheDocument();
  });

  it('muestra placeholder 🐾 cuando no hay fotos', () => {
    renderCard(baseReport); // photos: []
    expect(screen.getByText('🐾')).toBeInTheDocument();
  });

  it('muestra imagen cuando hay foto principal', () => {
    const reportWithPhoto: Report = {
      ...baseReport,
      pet: {
        ...baseReport.pet!,
        photos: [{ id: 'ph-1', url: 'https://img.test/dog.jpg', is_primary: true, created_at: '' }],
      },
    };
    renderCard(reportWithPhoto);
    const img = screen.getByRole('img', { name: /firulais/i });
    expect(img).toHaveAttribute('src', 'https://img.test/dog.jpg');
  });

  it('muestra descripción de ubicación cuando existe', () => {
    const reportWithLocation: Report = { ...baseReport, location_description: 'Parque Rodó' };
    renderCard(reportWithLocation);
    expect(screen.getByText(/Parque Rodó/)).toBeInTheDocument();
  });

  it('el card linkea al detalle de la mascota', () => {
    renderCard(baseReport);
    const links = screen.getAllByRole('link');
    const detailLink = links.find(l => l.getAttribute('href') === '/pets/pet-1');
    expect(detailLink).toBeTruthy();
  });
});
