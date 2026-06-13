// SuccessStep smoke test
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SuccessStep } from '../components/publish/SuccessStep';
import type { Pet } from '../../shared/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: 'es', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const mockPet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  status: 'stray',
  photos: [],
} as Pet;

jest.mock('../components/ShareButton', () => ({
  ShareButton: () => null,
}));

const mockMutateAsync = jest.fn().mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });

jest.mock('@shared/hooks', () => ({
  useUploadPhotoNative: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

describe('SuccessStep', () => {
  beforeEach(() => {
    mockMutateAsync.mockClear();
    mockMutateAsync.mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' });
  });

  it('shows the lost success title and pet name', () => {
    render(
      <SuccessStep
        pet={{ ...mockPet, status: 'lost' }}
        intent="lost"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
        onGoToFeed={jest.fn()}
      />,
    );

    expect(screen.getByText('publish:success.lostTitle')).toBeTruthy();
    expect(screen.getByText('Firulais')).toBeTruthy();
  });

  it('shows the retry section when there are failed photo indexes', () => {
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[1]}
        photoUris={['file:///a.jpg', 'file:///b.jpg']}
        onRetryComplete={jest.fn()}
        onGoToFeed={jest.fn()}
      />,
    );

    expect(screen.getByText('publish:success.strayTitle')).toBeTruthy();
    expect(screen.getByText('publish:success.photoRetryAction')).toBeTruthy();
  });

  it('calls onGoToFeed when "go to feed" is pressed', () => {
    const onGoToFeed = jest.fn();
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
        onGoToFeed={onGoToFeed}
      />,
    );

    fireEvent.press(screen.getByText('publish:success.goToFeed'));
    expect(onGoToFeed).toHaveBeenCalled();
  });

  it('retries failed photo uploads and reports the still-failed indexes', async () => {
    mockMutateAsync.mockImplementation(({ uri }: { petId: string; uri: string }) => {
      if (uri === 'file:///a.jpg') return Promise.resolve({ id: 'photo-a', url: 'https://x/a.jpg' });
      return Promise.reject(new Error('upload failed'));
    });

    const onRetryComplete = jest.fn();
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[0, 1]}
        photoUris={['file:///a.jpg', 'file:///b.jpg']}
        onRetryComplete={onRetryComplete}
        onGoToFeed={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('publish:success.photoRetryAction'));
    });

    await waitFor(() => expect(onRetryComplete).toHaveBeenCalledWith([1]));

    expect(mockMutateAsync).toHaveBeenCalledWith({ petId: mockPet.id, uri: 'file:///a.jpg' });
    expect(mockMutateAsync).toHaveBeenCalledWith({ petId: mockPet.id, uri: 'file:///b.jpg' });
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });
});
