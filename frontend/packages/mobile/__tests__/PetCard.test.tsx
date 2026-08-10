import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PetCard } from '../components/PetCard';
import type { Report } from '../../shared/types';

// `t` devuelve la clave, igual que en el resto de los tests de componentes.
// Eso es lo que permite afirmar que el badge SALE de i18n: si alguien vuelve a
// hardcodear "PERDIDO", estos tests se ponen rojos.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
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

  // Los badges salen de i18n (regla #13). Antes estaban hardcodeados en
  // español y estos tests exigían ese hardcodeo, así que blindaban el defecto:
  // un usuario en inglés leía "PERDIDO" y la suite decía que estaba bien.
  it('el badge de lost sale de i18n', () => {
    render(<PetCard report={{ ...baseReport, status: 'lost' }} onPress={() => {}} />);
    expect(screen.getByText('PETS:CARD.LOST')).toBeTruthy();
  });

  it('el badge de found sale de i18n', () => {
    render(<PetCard report={{ ...baseReport, status: 'found' }} onPress={() => {}} />);
    expect(screen.getByText('PETS:CARD.FOUND')).toBeTruthy();
  });

  it('el badge de sighting sale de i18n', () => {
    render(<PetCard report={{ ...baseReport, status: 'sighting' }} onPress={() => {}} />);
    expect(screen.getByText('PETS:CARD.SIGHTING')).toBeTruthy();
  });

  // `adoption` NO es un estado de reporte — ReportStatus sólo admite
  // lost/found/sighting. Llega por la mascota, que es el modo en que el feed
  // de adopción monta este card.
  it('el badge de adoption sale de i18n', () => {
    render(<PetCard pet={{ ...baseReport.pet!, status: 'adoption' }} onPress={() => {}} />);
    expect(screen.getByText('PETS:STATUS.ADOPTION')).toBeTruthy();
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

  it('el texto de mascota sin nombre sale de i18n', () => {
    const reportNoName: Report = {
      ...baseReport,
      pet: { ...baseReport.pet!, name: '' },
    };
    render(<PetCard report={reportNoName} onPress={() => {}} />);
    expect(screen.getByText('pets:card.noName')).toBeTruthy();
  });

  it('llama a onPress cuando se presiona el card', () => {
    const onPress = jest.fn();
    render(<PetCard report={baseReport} onPress={onPress} />);
    fireEvent.press(screen.getByText('Firulais'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
