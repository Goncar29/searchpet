import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PetCard } from '../components/PetCard';
import type { Report, Pet } from '../../shared/types';

// t identity: los asserts verifican QUÉ key i18n se usa por status —
// esto es lo que caza el bug de colapsar stray/registered a "lost".
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const basePet: Pet = {
  id: 'pet-1',
  owner_id: 'user-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'amarillo',
  status: 'lost',
  photos: [],
  created_at: new Date().toISOString(),
};

const baseReport: Report = {
  id: 'report-1',
  pet_id: 'pet-1',
  reporter_id: 'user-1',
  status: 'lost',
  latitude: -34.9011,
  longitude: -56.1645,
  is_verified: false,
  created_at: new Date().toISOString(),
  pet: basePet,
};

describe('PetCard', () => {
  it('muestra el nombre de la mascota', () => {
    render(<PetCard report={baseReport} onPress={() => {}} />);
    expect(screen.getByText('Firulais')).toBeTruthy();
  });

  it('usa la key pets:status.lost para report status lost', () => {
    render(<PetCard report={{ ...baseReport, status: 'lost' }} onPress={() => {}} />);
    expect(screen.getByText('status.lost')).toBeTruthy();
  });

  it('usa la key pets:status.found para report status found', () => {
    render(<PetCard report={{ ...baseReport, status: 'found' }} onPress={() => {}} />);
    expect(screen.getByText('status.found')).toBeTruthy();
  });

  it('usa la key pets:status.sighting para report status sighting', () => {
    render(<PetCard report={{ ...baseReport, status: 'sighting' }} onPress={() => {}} />);
    expect(screen.getByText('status.sighting')).toBeTruthy();
  });

  // Regresión: el feed unificado renderiza SIEMPRE la variante pet — el status
  // de la mascota debe respetarse tal cual, nunca colapsarse a lost/found.
  it('variante pet: una callejera usa la key pets:status.stray (no lost)', () => {
    render(<PetCard pet={{ ...basePet, status: 'stray' }} onPress={() => {}} />);
    expect(screen.getByText('status.stray')).toBeTruthy();
    expect(screen.queryByText('status.lost')).toBeNull();
  });

  it('variante pet: una perdida usa la key pets:status.lost', () => {
    render(<PetCard pet={{ ...basePet, status: 'lost' }} onPress={() => {}} />);
    expect(screen.getByText('status.lost')).toBeTruthy();
  });

  it('variante pet: una encontrada usa la key pets:status.found', () => {
    render(<PetCard pet={{ ...basePet, status: 'found' }} onPress={() => {}} />);
    expect(screen.getByText('status.found')).toBeTruthy();
  });

  it('muestra emoji 🐾 cuando no hay fotos', () => {
    render(<PetCard report={baseReport} onPress={() => {}} />);
    expect(screen.getByText('🐾')).toBeTruthy();
  });

  it('muestra la descripción de ubicación cuando existe', () => {
    const reportWithLocation = { ...baseReport, location_description: 'Parque Rodó' };
    render(<PetCard report={reportWithLocation} onPress={() => {}} />);
    expect(screen.getByText(/Parque Rodó/)).toBeTruthy();
  });

  it('usa la key pets:card.noName cuando la mascota no tiene nombre', () => {
    const reportNoName: Report = {
      ...baseReport,
      pet: { ...basePet, name: '' },
    };
    render(<PetCard report={reportNoName} onPress={() => {}} />);
    expect(screen.getByText('card.noName')).toBeTruthy();
  });

  it('llama a onPress cuando se presiona el card', () => {
    const onPress = jest.fn();
    render(<PetCard report={baseReport} onPress={onPress} />);
    fireEvent.press(screen.getByText('Firulais'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
