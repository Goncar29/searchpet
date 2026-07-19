import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import type { Pet } from '@shared/types';
import { AdoptionPetBody } from '../components/AdoptionPetBody';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const authState = { user: null as null | { id: string }, isAuthenticated: false };
jest.mock('../store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));

jest.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

jest.mock('../components/ShareButton', () => ({ ShareButton: () => null }));
jest.mock('../components/PdfFlyerButton', () => ({ PdfFlyerButton: () => null }));

const adoptionPet: Pet = {
  id: 'pet-2',
  owner_id: 'owner-1',
  name: 'Michi',
  type: 'gato',
  color: 'gris',
  status: 'adoption',
  city: 'Montevideo',
  photos: [],
  owner: { id: 'owner-1', name: 'Ana' },
  created_at: new Date().toISOString(),
} as Pet;

beforeEach(() => {
  authState.user = null;
  authState.isAuthenticated = false;
  mockPush.mockClear();
});

describe('AdoptionPetBody', () => {
  it('adopted: shows the success banner and no contact/share', () => {
    const { queryByTestId } = render(<AdoptionPetBody pet={{ ...adoptionPet, status: 'adopted' }} />);
    expect(queryByTestId('adopted-banner')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeNull();
    expect(queryByTestId('message-owner')).toBeNull();
  });

  it('adoption + authed non-owner: shows the message action and share block', () => {
    authState.user = { id: 'other-user' };
    authState.isAuthenticated = true;
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('message-owner')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeTruthy();
  });

  it('adoption + owner viewing own listing: hides the message action', () => {
    authState.user = { id: 'owner-1' };
    authState.isAuthenticated = true;
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('message-owner')).toBeNull();
  });

  it('adoption + logged out: shows the login gate and no share block', () => {
    const { queryByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(queryByTestId('login-gate')).toBeTruthy();
    expect(queryByTestId('share-block')).toBeNull();
  });

  it('adoption: message action navigates to chat with the owner name', () => {
    authState.user = { id: 'other-user' };
    authState.isAuthenticated = true;
    const { getByTestId } = render(<AdoptionPetBody pet={adoptionPet} />);
    fireEvent.press(getByTestId('message-owner'));
    expect(mockPush).toHaveBeenCalledWith('/chat/owner-1?userName=Ana');
  });

  it('adoption: WhatsApp contact only when a phone exists', () => {
    authState.user = { id: 'other' };
    authState.isAuthenticated = true;
    const noPhone = render(<AdoptionPetBody pet={adoptionPet} />);
    expect(noPhone.queryByTestId('whatsapp-contact')).toBeNull();

    const withPhone = render(
      <AdoptionPetBody pet={{ ...adoptionPet, owner: { id: 'owner-1', name: 'Ana', phone: '+59899' } } as Pet} />,
    );
    expect(withPhone.queryByTestId('whatsapp-contact')).toBeTruthy();
  });
});
