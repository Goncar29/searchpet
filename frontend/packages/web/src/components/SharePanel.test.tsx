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
// El resolver del modo inline es OTRO a propósito: pega al endpoint idempotente
// en vez de al protegido, que inserta una fila y otorga puntos. Se mockea
// aparte justamente para poder afirmar cuál de los dos se usó.
const autoMutateAsync = vi.fn().mockResolvedValue(shareLink);
const autoPending = { value: false };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${opts.name}` : key),
    i18n: { language: 'es' },
  }),
}));

vi.mock('@shared/hooks', () => ({
  useShareLink: () => ({ mutateAsync, isPending: false }),
  useAutoShareLink: () => ({ mutateAsync: autoMutateAsync, isPending: autoPending.value }),
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
  autoMutateAsync.mockClear();
  autoMutateAsync.mockResolvedValue(shareLink);
  autoPending.value = false;
});

describe('SharePanel — Story template', () => {
  it('renders the hidden Story template with pet info and a QR once the share link is ready', async () => {
    const { container, getByRole } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /pets:share.button/i }));

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

    await userEvent.click(getByRole('button', { name: /pets:share.button/i }));
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

    await userEvent.click(getByRole('button', { name: /pets:share.button/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    expect(await findByText(/pets:share.storyDownloaded/i)).toBeTruthy();
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

    await userEvent.click(getByRole('button', { name: /pets:share.button/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    expect(clickSpy).not.toHaveBeenCalled();
    expect(queryByText(/pets:share.storyDownloaded/i)).toBeNull();
  });
});

describe('SharePanel — adoption poster header', () => {
  it('shows EN ADOPCIÓN in the story template for adoption pets', () => {
    const { container } = render(
      <SharePanel petId="pet-2" petName="Michi" pet={{ ...basePet, name: 'Michi', status: 'adoption' }} />
    );
    expect(container.textContent).toContain('¡EN ADOPCIÓN!');
    expect(container.textContent).not.toContain('¡MASCOTA PERDIDA!');
  });
});

describe('SharePanel — the story template is invisible to assistive tech', () => {
  it('keeps the offscreen story template out of the accessibility tree', () => {
    const { getByTestId } = render(
      <SharePanel petId="pet-3" petName="Firulais" pet={basePet} />
    );

    const template = getByTestId('story-template');

    // `top: -9999px` only moves it out of view. Without aria-hidden a screen
    // reader still reads the whole template — including an <h1> with the pet
    // name — as content the user cannot see or act on.
    expect(template).toHaveAttribute('aria-hidden', 'true');
    expect(template.querySelector('h1')).not.toBeNull();
  });
});

describe('SharePanel — modo inline', () => {
  it('resuelve el link por el endpoint idempotente, nunca por el que otorga puntos', async () => {
    render(<SharePanel petId="pet-1" petName="Firulais" pet={basePet} inline />);

    await waitFor(() => expect(autoMutateAsync).toHaveBeenCalledWith({ petID: 'pet-1' }));

    // El protegido siempre INSERTA una fila y publica `share.created` (+2
    // puntos). Llamarlo desde un efecto de montaje acreditaba un compartir que
    // nunca ocurrió, una vez por publicación.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('ante un fallo avisa y deja reintentar, en vez de quedar mudo', async () => {
    autoMutateAsync.mockRejectedValueOnce(new Error('502 cold start'));

    const { getByText, queryByText } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} inline />
    );

    // Sin esto el panel quedaba MUERTO en silencio: en inline no se renderiza
    // el botón —único spinner y único reintento—, así que los cuatro botones de
    // plataforma quedaban deshabilitados para siempre sin un solo cartel.
    await waitFor(() => expect(getByText('pets:share.loadError')).toBeInTheDocument());

    await userEvent.click(getByText('pets:share.retry'));

    await waitFor(() => expect(autoMutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryByText('pets:share.loadError')).toBeNull());
  });
});
