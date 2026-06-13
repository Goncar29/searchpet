// SuccessStep smoke test
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
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

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@shared/hooks', () => ({
  useUploadPhotoNative: () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'photo-1', url: 'https://x/photo-1.jpg' }), isPending: false }),
}));

describe('SuccessStep', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('shows the lost success title and pet name', () => {
    render(
      <SuccessStep
        pet={{ ...mockPet, status: 'lost' }}
        intent="lost"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
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
      />,
    );

    expect(screen.getByText('publish:success.strayTitle')).toBeTruthy();
    expect(screen.getByText('publish:success.photoRetryAction')).toBeTruthy();
  });

  it('navigates to the feed when "go to feed" is pressed', () => {
    render(
      <SuccessStep
        pet={mockPet}
        intent="stray"
        failedPhotoIndexes={[]}
        photoUris={[]}
        onRetryComplete={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByText('publish:success.goToFeed'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
