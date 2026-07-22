import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PetCard } from '../components/PetCard';
import type { Report } from '../../shared/types';

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
    status: 'lost',
    photos: [],
    created_at: new Date().toISOString(),
  },
};

describe('PetCard', () => {
  it('muestra el nombre de la mascota', () => {
    render(<PetCard report={baseReport} onPress={() => {}} />);
    expect(screen.getByText('Firulais')).toBeTruthy();
  });

  it('muestra "PERDIDO" para status lost', () => {
    render(<PetCard report={{ ...baseReport, status: 'lost' }} onPress={() => {}} />);
    expect(screen.getByText('PERDIDO')).toBeTruthy();
  });

  it('muestra "ENCONTRADO" para status found', () => {
    render(<PetCard report={{ ...baseReport, status: 'found' }} onPress={() => {}} />);
    expect(screen.getByText('ENCONTRADO')).toBeTruthy();
  });

  it('muestra "AVISTADO" para status sighting', () => {
    render(<PetCard report={{ ...baseReport, status: 'sighting' }} onPress={() => {}} />);
    expect(screen.getByText('AVISTADO')).toBeTruthy();
  });

  it('muestra el placeholder de marca cuando no hay fotos', () => {
    render(<PetCard report={baseReport} onPress={() => {}} />);
    expect(screen.getByTestId('paw-placeholder')).toBeTruthy();
  });

  it('muestra la descripción de ubicación cuando existe', () => {
    const reportWithLocation = { ...baseReport, location_description: 'Parque Rodó' };
    render(<PetCard report={reportWithLocation} onPress={() => {}} />);
    expect(screen.getByText(/Parque Rodó/)).toBeTruthy();
  });

  it('muestra "Sin nombre" cuando la mascota no tiene nombre', () => {
    const reportNoName: Report = {
      ...baseReport,
      pet: { ...baseReport.pet!, name: '' },
    };
    render(<PetCard report={reportNoName} onPress={() => {}} />);
    expect(screen.getByText('Sin nombre')).toBeTruthy();
  });

  it('llama a onPress cuando se presiona el card', () => {
    const onPress = jest.fn();
    render(<PetCard report={baseReport} onPress={onPress} />);
    fireEvent.press(screen.getByText('Firulais'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
