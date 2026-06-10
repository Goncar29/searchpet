import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharePanel } from './SharePanel';
import type { Pet, ShareLink } from '@shared/types';

const shareLink: ShareLink = {
  share_token: 'tok123',
  share_url: 'https://searchpet.app/pet/tok123',
};

const mutateAsync = vi.fn().mockResolvedValue(shareLink);

vi.mock('@shared/hooks', () => ({
  useGenerateShareLink: () => ({ mutateAsync, isPending: false }),
}));

const basePet: Pet = {
  id: 'pet-1',
  name: 'Firulais',
  type: 'perro',
  breed: 'Labrador',
  color: 'dorado',
  status: 'lost',
  photos: [{ id: 'ph-1', url: 'https://img.test/dog.jpg', is_primary: true, created_at: '' }],
  created_at: new Date().toISOString(),
};

afterEach(() => {
  mutateAsync.mockClear();
});

describe('SharePanel — Story template', () => {
  it('renders the hidden Story template with pet info and a QR once the share link is ready', async () => {
    const { container, getByRole } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));

    await waitFor(() => {
      const story = container.querySelector('[data-testid="story-template"]') as HTMLElement;
      expect(story).toBeTruthy();
      expect(story.querySelector('h1')?.textContent).toBe('Firulais');
      expect(story.querySelector('img[alt="Firulais"]')).toBeTruthy();
      expect(story.querySelector('canvas')).toBeTruthy();
    });
  });
});
