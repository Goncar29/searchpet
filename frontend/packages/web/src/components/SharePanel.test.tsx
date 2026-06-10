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

function mockHtml2Canvas() {
  vi.doMock('html2canvas', () => ({
    default: vi.fn().mockResolvedValue({
      toBlob: (cb: (blob: Blob | null) => void) =>
        cb(new Blob(['fake-png'], { type: 'image/png' })),
    }),
  }));
}

function stubShareApis(overrides: { share?: typeof navigator.share; canShare?: typeof navigator.canShare }) {
  if (overrides.share !== undefined) {
    Object.defineProperty(navigator, 'share', { value: overrides.share, configurable: true });
  }
  if (overrides.canShare !== undefined) {
    Object.defineProperty(navigator, 'canShare', { value: overrides.canShare, configurable: true });
  }
}

describe('SharePanel — Instagram Story share (mobile, file sharing supported)', () => {
  afterEach(() => {
    vi.doUnmock('html2canvas');
    stubShareApis({ share: undefined, canShare: undefined });
    vi.restoreAllMocks();
  });

  it('shares the generated image as a file via the Web Share API', async () => {
    mockHtml2Canvas();
    const shareMock = vi.fn().mockResolvedValue(undefined);
    stubShareApis({ share: shareMock, canShare: vi.fn().mockReturnValue(true) });

    const { getByRole, getAllByRole } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalledTimes(1);
      const arg = shareMock.mock.calls[0][0];
      expect(arg.files).toHaveLength(1);
      expect(arg.files[0]).toBeInstanceOf(File);
      expect(arg.files[0].name).toBe('story-Firulais.png');
      expect(typeof arg.text).toBe('string');
    });
  });
});

describe('SharePanel — Instagram Story share (desktop, no file sharing)', () => {
  afterEach(() => {
    vi.doUnmock('html2canvas');
    stubShareApis({ share: undefined, canShare: undefined });
    vi.restoreAllMocks();
  });

  it('downloads the generated image and shows an inline hint', async () => {
    mockHtml2Canvas();
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { getByRole, getAllByRole, findByText } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    expect(await findByText(/Imagen descargada/i)).toBeTruthy();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

describe('SharePanel — Instagram Story share (user cancels share sheet)', () => {
  afterEach(() => {
    vi.doUnmock('html2canvas');
    stubShareApis({ share: undefined, canShare: undefined });
    vi.restoreAllMocks();
  });

  it('does not fall back to download when the user cancels the share sheet', async () => {
    mockHtml2Canvas();
    const shareMock = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    stubShareApis({ share: shareMock, canShare: vi.fn().mockReturnValue(true) });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { getByRole, getAllByRole, queryByText } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    expect(clickSpy).not.toHaveBeenCalled();
    expect(queryByText(/Imagen descargada/i)).toBeNull();
  });
});
