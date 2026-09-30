// Create Success Story screen — the mutation error banner shows a translated
// message, never the raw `err.message` from the API response. Rule #11.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import CreateStoryScreen from '../app/story/create';
import { ApiError } from '../../shared/api/client';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ petId: 'pet-1' }),
}));

// Resolves against the REAL locale JSONs (same approach as PetCard.test.tsx),
// not an identity/passthrough mock. That's what lets these tests actually
// distinguish "known ApiError code translates via errors:<code>" from
// "unknown code falls back to fallbackKey" — an identity mock returns the
// key unchanged for BOTH cases, which can't prove getErrorMessage's
// fallbackKey (suggestion 3) is wired correctly.
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
      t: (clave: string) => resolver(clave),
    }),
  };
});

const mockCreateStory: {
  mutate: jest.Mock;
  isPending: boolean;
  isError: boolean;
  error: unknown;
} = { mutate: jest.fn(), isPending: false, isError: false, error: undefined };

jest.mock('../../shared/hooks', () => ({
  useCreateStory: () => mockCreateStory,
}));

beforeEach(() => {
  mockCreateStory.mutate.mockClear();
  mockCreateStory.isPending = false;
  mockCreateStory.isError = false;
  mockCreateStory.error = undefined;
});

describe('CreateStoryScreen — el banner de error usa el mensaje traducido, no err.message crudo', () => {
  it('con la mutación en error, no muestra el mensaje crudo del servidor', () => {
    mockCreateStory.isError = true;
    mockCreateStory.error = new ApiError('validation_error', 400, 'body: cannot be blank');

    render(<CreateStoryScreen />);

    expect(screen.queryByText('body: cannot be blank')).toBeNull();
  });

  // Suggestion 3: getErrorMessage's fallbackKey is 'story:submitError' here,
  // but a KNOWN ApiError code still wins — it resolves via errors:<code>
  // before fallbackKey is ever consulted.
  it('con un código de error conocido, muestra su mensaje de errors:<code>, no el fallback de story', () => {
    mockCreateStory.isError = true;
    mockCreateStory.error = new ApiError('invalid_credentials', 401, 'credenciales inválidas');

    render(<CreateStoryScreen />);

    expect(screen.getByText('Email o contraseña incorrectos')).toBeTruthy();
    expect(screen.queryByText('No se pudo publicar la historia')).toBeNull();
  });

  // The regressed case from commit 7857ee03: before suggestion 3,
  // getErrorMessage's fallback was hardcoded to errors:unknown_error, so an
  // unmapped code showed a generic message and left story:submitError
  // orphaned. Now it falls back to the given fallbackKey instead.
  it('con un código de error NO mapeado, muestra story:submitError, no el genérico errors:unknown_error', () => {
    mockCreateStory.isError = true;
    mockCreateStory.error = new ApiError('some_unmapped_code', 500, 'raw message');

    render(<CreateStoryScreen />);

    expect(screen.getByText('No se pudo publicar la historia')).toBeTruthy();
    expect(screen.queryByText('Ocurrió un error inesperado. Por favor intentá de nuevo')).toBeNull();
  });

  it('sin error, no muestra ningún banner', () => {
    render(<CreateStoryScreen />);
    expect(screen.queryByText('No se pudo publicar la historia')).toBeNull();
  });
});
