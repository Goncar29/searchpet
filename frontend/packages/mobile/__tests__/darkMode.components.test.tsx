// S3 + S6: shared components follow the active theme, and light mode paints
// exactly the values it painted before the migration.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { DARK_COLORS, LIGHT_COLORS } from '../constants';
import { useThemeStore } from '../store/theme';
import { PetCard } from '../components/PetCard';
import { ListState } from '../components/list/ListState';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Pet } from '../../shared/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

const pet: Pet = {
  id: 'pet-1',
  owner_id: 'user-1',
  name: 'Firulais',
  type: 'perro',
  status: 'lost',
  created_at: new Date().toISOString(),
} as Pet;

function flat(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as any) ?? {};
}

function renderCard() {
  render(<PetCard pet={pet} onPress={() => {}} />);
  const root = screen.toJSON() as unknown as { props: { style?: unknown } };
  return { card: flat(root), name: flat(screen.getByText('Firulais')) };
}

describe('PetCard follows the theme', () => {
  afterEach(() => useThemeStore.setState({ preference: 'system', userChose: false }));

  it('dark paints the card on the dark surface with light text', () => {
    useThemeStore.setState({ preference: 'dark', userChose: true });
    const { card, name } = renderCard();
    expect(card.backgroundColor).toBe(DARK_COLORS.card);
    expect(name.color).toBe(DARK_COLORS.textPrimary);
  });

  it('light keeps the values it had before the migration', () => {
    useThemeStore.setState({ preference: 'light', userChose: true });
    const { card, name } = renderCard();
    expect(card.backgroundColor).toBe('#FFFFFF');
    expect(name.color).toBe(LIGHT_COLORS.textPrimary);
  });

  it('the status badge text stays white on its brand color in dark', () => {
    useThemeStore.setState({ preference: 'dark', userChose: true });
    render(<PetCard pet={pet} onPress={() => {}} />);
    expect(flat(screen.getByText('PETS:CARD.LOST')).color).toBe('#FFFFFF');
  });
});

describe('ListState follows the theme', () => {
  afterEach(() => useThemeStore.setState({ preference: 'system', userChose: false }));

  it('dark paints the error title with the dark text color', () => {
    useThemeStore.setState({ preference: 'dark', userChose: true });
    render(
      <ListState
        query={{ isLoading: false, isError: true, isPaused: false, data: undefined, refetch: jest.fn() } as unknown as UseQueryResult<string[]>}
        errorTitle="boom"
        loading={null}
      >
        {() => null}
      </ListState>,
    );
    expect(flat(screen.getByText('boom')).color).toBe(DARK_COLORS.textPrimary);
  });
});
