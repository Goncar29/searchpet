import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PetCard } from '../components/PetCard';
import type { Report } from '../../shared/types';

// El mock resuelve contra los LOCALES REALES, no devolviendo la clave.
//
// Con un mock de identidad el test afirma NOMBRES DE CLAVE, no que resuelvan:
// borrar `pets.card.sighting` dejaría la app mostrando el literal
// "PETS:CARD.SIGHTING" en el badge, con la suite en verde. Y "clave i18n cruda
// en pantalla" es el bug más recurrente de este proyecto (reglas #12 y #21),
// así que es exactamente lo que estos tests tienen que poder ver.
//
// Todo va DENTRO del factory: jest.mock se hoistea y no puede cerrar sobre
// variables del módulo.
//
// El merge replica el de mobile/i18n/index.ts — cada clave de primer nivel es
// un namespace y el separador es `:` (regla #12).
jest.mock('react-i18next', () => {
  const shared = require('../../shared/i18n/locales/es.json');
  const mobile = require('../i18n/locales/es.json');
  const recursos: Record<string, any> = { ...shared, ...mobile };

  const resolver = (clave: string): string => {
    const [ns, resto] = clave.includes(':') ? clave.split(':') : ['translation', clave];
    const valor = resto.split('.').reduce((o: any, p: string) => o?.[p], recursos[ns]);
    return typeof valor === 'string' ? valor : clave;
  };

  return {
    useTranslation: () => ({
      t: (clave: string, opts?: Record<string, unknown>) => {
        const texto = resolver(clave);
        return opts
          ? texto.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? ''))
          : texto;
      },
      i18n: { language: 'es' },
    }),
  };
});

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
    expect(screen.getByText('PERDIDO')).toBeTruthy();
  });

  it('el badge de found sale de i18n', () => {
    render(<PetCard report={{ ...baseReport, status: 'found' }} onPress={() => {}} />);
    expect(screen.getByText('ENCONTRADO')).toBeTruthy();
  });

  it('el badge de sighting sale de i18n', () => {
    render(<PetCard report={{ ...baseReport, status: 'sighting' }} onPress={() => {}} />);
    expect(screen.getByText('AVISTADO')).toBeTruthy();
  });

  // El caso que el arreglo original se salteó: `stray` caía en el default y
  // salía como el enum crudo "STRAY". El feed de búsqueda monta este card con
  // `pet=` y stray está en las allowlists, así que era visible de verdad.
  it('el badge de stray NO muestra el enum crudo', () => {
    render(<PetCard pet={{ ...baseReport.pet!, status: 'stray' }} onPress={() => {}} />);
    expect(screen.queryByText('STRAY')).toBeNull();
    expect(screen.getByText('CALLEJERA')).toBeTruthy();
  });

  // `adoption` NO es un estado de reporte — ReportStatus sólo admite
  // lost/found/sighting. Llega por la mascota, que es el modo en que el feed
  // de adopción monta este card.
  it('el badge de adoption sale de i18n', () => {
    render(<PetCard pet={{ ...baseReport.pet!, status: 'adoption' }} onPress={() => {}} />);
    expect(screen.getByText('EN ADOPCIÓN')).toBeTruthy();
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
    expect(screen.getByText('Sin nombre')).toBeTruthy();
  });

  it('llama a onPress cuando se presiona el card', () => {
    const onPress = jest.fn();
    render(<PetCard report={baseReport} onPress={onPress} />);
    fireEvent.press(screen.getByText('Firulais'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
