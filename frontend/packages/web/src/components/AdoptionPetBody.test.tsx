import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${opts.name}` : key),
    i18n: { language: 'es' },
  }),
}));

const authState = { user: undefined as undefined | { id: string }, isAuthenticated: false };
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

vi.mock('./SharePanel', () => ({ SharePanel: () => <div data-testid="share-panel" /> }));
vi.mock('./PdfFlyerButton', () => ({ PdfFlyerButton: () => <div data-testid="flyer" /> }));
vi.mock('./RevealContact', () => ({ RevealContact: () => <div data-testid="reveal-contact" /> }));

import { AdoptionPetBody } from './AdoptionPetBody';

const adoptionPet: Pet = {
  id: 'pet-2',
  owner_id: 'owner-1',
  name: 'Michi',
  type: 'gato',
  color: 'gris',
  status: 'adoption',
  city: 'Montevideo',
  photos: [],
  owner: { id: 'owner-1', name: 'Ana', is_verified: false },
  created_at: new Date().toISOString(),
};

const renderBody = (pet: Pet) =>
  render(<MemoryRouter><AdoptionPetBody pet={pet} /></MemoryRouter>);

beforeEach(() => {
  authState.user = undefined;
  authState.isAuthenticated = false;
});

describe('AdoptionPetBody', () => {
  it('adopted: shows the success banner and NO contact/share', () => {
    renderBody({ ...adoptionPet, status: 'adopted' });
    expect(screen.getByTestId('adopted-banner')).toBeTruthy();
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.queryByText(/pets:detail.sendMessage/)).toBeNull();
  });

  it('adoption + authed non-owner: shows message link and share', () => {
    authState.user = { id: 'other-user' };
    authState.isAuthenticated = true;
    renderBody(adoptionPet);
    const link = screen.getByText(/pets:detail.sendMessage/).closest('a');
    expect(link?.getAttribute('href')).toBe('/messages/owner-1');
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('adoption + owner viewing own listing: hides the message button', () => {
    authState.user = { id: 'owner-1' };
    authState.isAuthenticated = true;
    renderBody(adoptionPet);
    expect(screen.queryByText(/pets:detail.sendMessage/)).toBeNull();
  });

  it('adoption + logged out: shows login gate and NO share', () => {
    renderBody(adoptionPet);
    expect(screen.getByText(/pets:detail.loginToContact/)).toBeTruthy();
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('adoption: reveal-contact only when a phone exists', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'other' };
    const { rerender } = renderBody(adoptionPet);
    expect(screen.queryByTestId('reveal-contact')).toBeNull();
    rerender(
      <MemoryRouter>
        <AdoptionPetBody pet={{ ...adoptionPet, owner: { id: 'owner-1', name: 'Ana', phone: '+59899', is_verified: false } }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('reveal-contact')).toBeTruthy();
  });

  it('never renders lost-pet scaffolding', () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'other' };
    renderBody(adoptionPet);
    expect(screen.queryByText(/pets:detail.addReport/)).toBeNull();
    expect(screen.queryByText(/pets:detail.timeline/)).toBeNull();
  });
});
