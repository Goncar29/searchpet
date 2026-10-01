// Story Detail screen smoke test — like/unlike toggle driven by liked_by_me
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import StoryDetailScreen from '../app/story/[id]';
import { drawnIcons, emojiTexts } from './support/icons';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'story-1' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

jest.mock('../store', () => ({
  useAuthStore: () => ({ isAuthenticated: true }),
}));

const mockUseStory = jest.fn();
const mockLikeMutate = jest.fn();
const mockUnlikeMutate = jest.fn();

jest.mock('@shared/hooks', () => ({
  useStory: (...args: unknown[]) => mockUseStory(...args),
  useLikeStory: () => ({ mutate: mockLikeMutate, isPending: false }),
  useUnlikeStory: () => ({ mutate: mockUnlikeMutate, isPending: false }),
}));

const storyBase = {
  id: 'story-1',
  title: 'Volvió a casa',
  body: 'Una historia hermosa.',
  like_count: 3,
  liked_by_me: false,
  featured: false,
  pet_name: 'Toby',
  user_name: 'Ana',
  created_at: '2026-06-14T00:00:00Z',
};

beforeEach(() => {
  mockLikeMutate.mockClear();
  mockUnlikeMutate.mockClear();
  mockUseStory.mockReturnValue({ data: null, isLoading: true });
});

describe('StoryDetailScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<StoryDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra corazón en outline y dispara like cuando liked_by_me es false', () => {
    mockUseStory.mockReturnValue({ data: { ...storyBase, liked_by_me: false }, isLoading: false });
    const ui = render(<StoryDetailScreen />);
    const { getByTestId } = ui;

    // outline heart on the button, and no filled one
    expect(drawnIcons(ui)).toContain('favorite');
    expect(drawnIcons(ui)).not.toContain('favorite-filled');
    expect(emojiTexts(ui)).toEqual([]);
    fireEvent.press(getByTestId('story-like-button'));
    expect(mockLikeMutate).toHaveBeenCalledWith('story-1');
    expect(mockUnlikeMutate).not.toHaveBeenCalled();
  });

  it('muestra corazón relleno y dispara unlike cuando liked_by_me es true', () => {
    mockUseStory.mockReturnValue({ data: { ...storyBase, liked_by_me: true }, isLoading: false });
    const ui = render(<StoryDetailScreen />);
    const { getByTestId } = ui;

    // filled heart on the button, and no outline one
    expect(drawnIcons(ui)).toContain('favorite-filled');
    expect(drawnIcons(ui)).not.toContain('favorite');
    expect(emojiTexts(ui)).toEqual([]);
    fireEvent.press(getByTestId('story-like-button'));
    expect(mockUnlikeMutate).toHaveBeenCalledWith('story-1');
    expect(mockLikeMutate).not.toHaveBeenCalled();
  });
});
