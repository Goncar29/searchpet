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

  it('con la mutación en error, muestra el mensaje resuelto por getErrorMessage', () => {
    mockCreateStory.isError = true;
    mockCreateStory.error = new ApiError('validation_error', 400, 'body: cannot be blank');

    render(<CreateStoryScreen />);

    // No hay instancia real de i18next en este arnés (NO_I18NEXT_INSTANCE),
    // así que getErrorMessage cae siempre en su fallback traducido — lo que
    // importa acá es que NO sea el string crudo de arriba.
    expect(screen.getByText('errors:unknown_error')).toBeTruthy();
  });

  it('sin error, no muestra ningún banner', () => {
    render(<CreateStoryScreen />);
    expect(screen.queryByText('errors:unknown_error')).toBeNull();
  });
});
