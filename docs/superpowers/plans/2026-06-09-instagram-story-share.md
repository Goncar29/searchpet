# Instagram Story Share + Flyer Photo Banner Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken "Instagram" share button on web with a flow that
generates a 9:16 Story image (pet photo + key data + QR linking to the pet's
public page) and shares it via the Web Share API on mobile or downloads it on
desktop, while also redesigning the existing PDF flyer's photo to a larger
4:3 banner that never crops the pet.

**Architecture:** Extract a small shared `PhotoBanner` component (4:3 box,
`object-fit: contain`, white background — the "format convention" from the
design doc) used by both `PdfFlyerButton` (A4 flyer) and `SharePanel`
(Instagram Story image). `SharePanel` gets a new hidden 9:16 template
captured via `html2canvas` (same dynamic-import pattern as the PDF flyer),
converted to a PNG `Blob`/`File` and shared via `navigator.share({ files })`
when supported, or downloaded with an inline hint otherwise.

**Tech Stack:** React + TypeScript, Vite, Vitest + Testing Library (jsdom),
`html2canvas`, `qrcode.react`.

Spec: `docs/superpowers/specs/2026-06-09-instagram-story-share-design.md`

---

## Task 1: `PhotoBanner` shared component

**Files:**
- Create: `frontend/packages/web/src/components/PhotoBanner.tsx`
- Test: `frontend/packages/web/src/components/PhotoBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/packages/web/src/components/PhotoBanner.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PhotoBanner } from './PhotoBanner';

describe('PhotoBanner', () => {
  it('renders the photo filling the banner with object-fit contain', () => {
    const { container } = render(
      <PhotoBanner photoUrl="https://img.test/dog.jpg" petName="Firulais" heightPx={400} />
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe('400px');

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://img.test/dog.jpg');
    expect(img.alt).toBe('Firulais');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
  });

  it('shows a 🐾 placeholder when there is no photo', () => {
    const { container, getByText } = render(
      <PhotoBanner petName="Firulais" heightPx={400} />
    );

    expect(getByText('🐾')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/PhotoBanner.test.tsx`
Expected: FAIL with "Failed to resolve import './PhotoBanner'" (module doesn't exist)

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/packages/web/src/components/PhotoBanner.tsx
// ============================================================
// SearchPet — PhotoBanner (Web only)
// Caja de foto con relación de aspecto 4:3, object-fit: contain
// sobre fondo blanco. "Formato clave" compartido por el flyer PDF
// y la imagen de Instagram Story: la foto nunca se recorta, sea
// cual sea su orientación original.
// ============================================================

interface PhotoBannerProps {
  photoUrl?: string;
  petName: string;
  heightPx: number;
}

export function PhotoBanner({ photoUrl, petName, heightPx }: PhotoBannerProps) {
  return (
    <div
      style={{
        width: '100%',
        height: `${heightPx}px`,
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={petName}
          crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: '80px' }}>🐾</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/PhotoBanner.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/PhotoBanner.tsx frontend/packages/web/src/components/PhotoBanner.test.tsx
git commit -m "feat(web): add PhotoBanner component for 4:3 contain photo format"
```

---

## Task 2: Redesign `PdfFlyerButton` — full-width 4:3 photo banner

**Files:**
- Modify: `frontend/packages/web/src/components/PdfFlyerButton.tsx:1-19` (import) and `:188-258` (layout block)
- Test: `frontend/packages/web/src/components/PdfFlyerButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/packages/web/src/components/PdfFlyerButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PdfFlyerButton } from './PdfFlyerButton';
import type { Pet } from '@shared/types';

vi.mock('@shared/hooks', () => ({
  useGenerateShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe('PdfFlyerButton', () => {
  it('renders a full-width 4:3 photo banner above the title and table', () => {
    const { container } = render(<PdfFlyerButton pet={basePet} />);
    const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    const img = hidden.querySelector('img[alt="Firulais"]') as HTMLImageElement;
    const title = hidden.querySelector('h1');

    expect(img).toBeTruthy();
    expect(img.style.objectFit).toBe('contain');
    expect(title?.textContent).toBe('Firulais');

    const bannerWrapper = img.parentElement as HTMLElement;
    expect(bannerWrapper.style.height).toBe('536px');

    // El banner debe aparecer antes que el título en el DOM
    const position = img.compareDocumentPosition(title!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the 🐾 placeholder in the banner when there is no photo', () => {
    const petWithoutPhoto: Pet = { ...basePet, photos: [] };
    const { container, getByText } = render(<PdfFlyerButton pet={petWithoutPhoto} />);
    const hidden = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    expect(getByText('🐾')).toBeInTheDocument();
    expect(hidden.querySelector('img[alt="Firulais"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/PdfFlyerButton.test.tsx`
Expected: FAIL — banner wrapper height is not `536px` (current layout uses a
220x220 box) and/or the photo `<img>` is not before `<h1>` in the same way.

- [ ] **Step 3: Update `PdfFlyerButton.tsx`**

Add the import (near the top, with the other imports):

```tsx
import { PhotoBanner } from './PhotoBanner';
```

Replace the entire "Contenido principal — foto a la izquierda, datos a la
derecha" block (the `<div style={{ display: 'flex', gap: '24px', ... }}>...</div>`
that currently contains the 220x220 photo box and the title+table) with:

```tsx
        {/* Foto banner — ancho completo, 4:3, object-fit: contain (no recorta la mascota) */}
        <div style={{ marginBottom: '24px' }}>
          <PhotoBanner photoUrl={primaryPhoto?.url} petName={pet.name} heightPx={536} />
        </div>

        {/* Título + datos */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#111827', margin: '0 0 16px 0' }}>
            {pet.name}
          </h1>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
            <tbody>
              {pet.type && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px', width: '100px' }}>Tipo:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.type}</td>
                </tr>
              )}
              {pet.breed && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Raza:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.breed}</td>
                </tr>
              )}
              {pet.color && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Color:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{pet.color}</td>
                </tr>
              )}
              {lastSeenDate && (
                <tr>
                  <td style={{ color: '#6b7280', paddingBottom: '8px', paddingRight: '12px' }}>Visto:</td>
                  <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '8px' }}>{lastSeenDate}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
```

`heightPx={536}` comes from the A4 template's content width: 794px container
width minus 40px padding on each side = 714px; at 4:3 that's `714 * 3/4 = 535.5`,
rounded to 536.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/PdfFlyerButton.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full web test suite to check for regressions**

Run: `pnpm --filter web exec vitest run src/pages/PetDetailPage.test.tsx`
Expected: PASS (PdfFlyerButton is mocked there, so no layout assertions break)

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/PdfFlyerButton.tsx frontend/packages/web/src/components/PdfFlyerButton.test.tsx
git commit -m "feat(web): redesign PDF flyer with full-width 4:3 photo banner"
```

---

## Task 3: `SharePanel` — hidden 9:16 Story template

**Files:**
- Modify: `frontend/packages/web/src/components/SharePanel.tsx`
- Test: `frontend/packages/web/src/components/SharePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/packages/web/src/components/SharePanel.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: FAIL — `[data-testid="story-template"]` doesn't exist yet

- [ ] **Step 3: Update `SharePanel.tsx`**

Add the import:

```tsx
import { PhotoBanner } from './PhotoBanner';
```

After the `qrContainerRef` declaration, compute the primary photo (same
pattern as `PdfFlyerButton`):

```tsx
  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];
```

Add a ref for the Story template, right after `qrContainerRef`:

```tsx
  // Ref al div oculto con el template de la imagen para Instagram Story
  const storyRef = useRef<HTMLDivElement | null>(null);
```

At the end of the component's JSX, just before the final closing `</div>` of
the root `<div className="relative">`, add the hidden Story template:

```tsx
      {/* Plantilla oculta para generar la imagen de Instagram Story (9:16) */}
      <div
        ref={storyRef}
        data-testid="story-template"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '540px',
          height: '960px',
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          padding: '24px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
        aria-hidden="true"
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div
            style={{
              backgroundColor: pet.status === 'found' ? '#22c55e' : '#ef4444',
              color: '#ffffff',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '22px',
              fontWeight: '800',
              letterSpacing: '2px',
              display: 'inline-block',
            }}
          >
            {pet.status === 'found' ? '¡MASCOTA ENCONTRADA!' : '¡MASCOTA PERDIDA!'}
          </div>
        </div>

        {/* Foto banner — mismo formato 4:3 contain del flyer */}
        <div style={{ marginBottom: '16px' }}>
          <PhotoBanner photoUrl={primaryPhoto?.url} petName={pet.name} heightPx={369} />
        </div>

        {/* Título + datos clave */}
        <h1 style={{ fontSize: '36px', fontWeight: '800', color: '#111827', margin: '0 0 12px 0', textAlign: 'center' }}>
          {pet.name}
        </h1>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '20px' }}>
          <tbody>
            {pet.type && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px', width: '140px' }}>Tipo:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.type}</td>
              </tr>
            )}
            {pet.breed && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px' }}>Raza:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.breed}</td>
              </tr>
            )}
            {pet.color && (
              <tr>
                <td style={{ color: '#6b7280', paddingBottom: '6px', paddingRight: '12px' }}>Color:</td>
                <td style={{ fontWeight: '600', color: '#111827', paddingBottom: '6px' }}>{pet.color}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ flex: 1 }} />

        {/* Footer QR */}
        {shareLink?.share_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderTop: '2px solid #e5e7eb', paddingTop: '16px' }}>
            <div style={{ flexShrink: 0 }}>
              <QRCodeCanvas value={shareLink.share_url} size={100} level="M" />
            </div>
            <div>
              <p style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0 0 4px 0' }}>
                Escaneá para ayudar
              </p>
              <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
                searchpet.app · Reuniendo familias
              </p>
            </div>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/SharePanel.tsx frontend/packages/web/src/components/SharePanel.test.tsx
git commit -m "feat(web): add hidden 9:16 Story template to SharePanel"
```

---

## Task 4: Generate the Story image and share it as a file (mobile)

**Files:**
- Modify: `frontend/packages/web/src/components/SharePanel.tsx`
- Test: `frontend/packages/web/src/components/SharePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `SharePanel.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: FAIL — clicking the Instagram button still runs the old
`navigator.share({ url, text })` (no `files`) logic, so `arg.files` is
`undefined`.

- [ ] **Step 3: Update `SharePanel.tsx`**

Add the new state next to the existing `useState` declarations:

```tsx
  const [isSharingStory, setIsSharingStory] = useState(false);
```

Add these functions after `handleOpen` (before `handlePlatform`):

```tsx
  // Genera la imagen de Story (PNG) a partir del template oculto
  async function generateStoryBlob(): Promise<Blob | null> {
    if (!storyRef.current) return null;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(storyRef.current, {
        useCORS: true,
        allowTaint: false,
        scale: 2,
        logging: false,
      });
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      );
    } catch {
      return null;
    }
  }

  const handleInstagramStory = async () => {
    if (!shareLink || isSharingStory) return;
    setIsSharingStory(true);

    try {
      const blob = await generateStoryBlob();

      if (!blob) {
        // No se pudo generar la imagen — compartimos el link como antes
        if (navigator.share) {
          await navigator.share({ url: shareLink.share_url, text: message }).catch(() => {});
        } else {
          window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const file = new File([blob], `story-${petName}.png`, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message });
        return;
      }
    } finally {
      setIsSharingStory(false);
    }
  };
```

Replace the body of `handlePlatform`'s `instagram` branch:

```tsx
    if (platform.key === 'instagram') {
      // Instagram has no web share URL — use the Web Share API (shows native
      // share sheet on mobile, which includes Instagram if installed).
      if (navigator.share) {
        navigator.share({ url: shareLink.share_url, text: message }).catch(() => {});
      } else {
        window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
      }
      return;
    }
```

with:

```tsx
    if (platform.key === 'instagram') {
      handleInstagramStory();
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/SharePanel.tsx frontend/packages/web/src/components/SharePanel.test.tsx
git commit -m "feat(web): generate Story image and share as file via Web Share API"
```

---

## Task 5: Desktop download fallback + cancel handling

**Files:**
- Modify: `frontend/packages/web/src/components/SharePanel.tsx`
- Test: `frontend/packages/web/src/components/SharePanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `SharePanel.test.tsx`:

```tsx
describe('SharePanel — Instagram Story share (desktop, no file sharing)', () => {
  afterEach(() => {
    vi.doUnmock('html2canvas');
    stubShareApis({ share: undefined, canShare: undefined });
    vi.restoreAllMocks();
  });

  it('downloads the image and shows a hint when file sharing is not supported', async () => {
    mockHtml2Canvas();
    stubShareApis({ share: undefined, canShare: undefined });

    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { getByRole, getAllByRole, findByText } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    expect(await findByText(/Imagen descargada/i)).toBeInTheDocument();
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

  it('does nothing when the user cancels the native share sheet', async () => {
    mockHtml2Canvas();
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const shareMock = vi.fn().mockRejectedValue(abortError);
    stubShareApis({ share: shareMock, canShare: vi.fn().mockReturnValue(true) });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { getByRole, getAllByRole, queryByText } = render(
      <SharePanel petId="pet-1" petName="Firulais" pet={basePet} />
    );

    await userEvent.click(getByRole('button', { name: /compartir/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const instagramButton = getAllByRole('button', { name: /instagram/i })[0];
    await userEvent.click(instagramButton);

    await waitFor(() => expect(shareMock).toHaveBeenCalled());
    expect(clickSpy).not.toHaveBeenCalled();
    expect(queryByText(/Imagen descargada/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: FAIL —
- Desktop test: no download is triggered and no "Imagen descargada" text exists
- Cancel test: `shareMock` rejects with `AbortError`, which currently
  propagates uncaught from `handleInstagramStory` (no try/catch around
  `navigator.share`)

- [ ] **Step 3: Update `SharePanel.tsx`**

Add the new state next to `isSharingStory`:

```tsx
  const [storyMessage, setStoryMessage] = useState<string | null>(null);
```

Add this function after `generateStoryBlob`:

```tsx
  function downloadStoryImage(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-${petName}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }
```

Replace the body of `handleInstagramStory` with the full version that handles
the desktop fallback and the `AbortError` cancel case:

```tsx
  const handleInstagramStory = async () => {
    if (!shareLink || isSharingStory) return;
    setIsSharingStory(true);

    try {
      const blob = await generateStoryBlob();

      if (!blob) {
        // No se pudo generar la imagen — compartimos el link como antes
        if (navigator.share) {
          await navigator.share({ url: shareLink.share_url, text: message }).catch(() => {});
        } else {
          window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const file = new File([blob], `story-${petName}.png`, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: message });
          return;
        } catch (err) {
          if ((err as DOMException).name === 'AbortError') return;
        }
      }

      downloadStoryImage(blob);
      setStoryMessage('Imagen descargada — subila como Historia desde tu celular 📲');
      setTimeout(() => setStoryMessage(null), 4000);
    } finally {
      setIsSharingStory(false);
    }
  };
```

Show the inline message — add this block right after the existing `{copied && (...)}` block near the end of the panel JSX:

```tsx
            {storyMessage && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2 text-center">
                {storyMessage}
              </p>
            )}
```

Finally, disable the Instagram button while sharing — update the platform
buttons' `disabled` prop:

```tsx
                  disabled={!shareLink || (p.key === 'instagram' && isSharingStory)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/components/SharePanel.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/SharePanel.tsx frontend/packages/web/src/components/SharePanel.test.tsx
git commit -m "feat(web): add desktop download fallback and cancel handling for Story share"
```

---

## Task 6: Full regression check + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter web test:run`
Expected: All tests PASS, including
`src/components/PhotoBanner.test.tsx`,
`src/components/PdfFlyerButton.test.tsx`,
`src/components/SharePanel.test.tsx`, and
`src/pages/PetDetailPage.test.tsx`.

- [ ] **Step 2: Manual check — PDF flyer**

Run: `pnpm --filter web dev`

Open a pet detail page with a **landscape** photo and one with a **portrait**
photo, click "Descargar volante", and confirm in both PDFs:
- The photo banner spans the full content width, ~536px tall on the rendered
  A4, and shows the whole pet (no cropping) with white bars filling any
  leftover space
- Title, data table, description, and QR/footer appear below the photo, in
  the same order/content as before

- [ ] **Step 3: Manual check — Instagram Story (desktop)**

In a desktop browser, open a pet detail page, click "Compartir" → "Instagram".
Confirm:
- A PNG named `story-<PetName>.png` downloads
- The inline message "Imagen descargada — subila como Historia desde tu
  celular 📲" appears for a few seconds
- Opening the downloaded PNG shows: status badge, the pet photo (uncropped,
  white background if needed), name + type/breed/color, and a QR code that
  points to the pet's `SharedPetPage`

- [ ] **Step 4: Manual check — Instagram Story (mobile, if available)**

On an Android phone with Chrome, repeat the same flow. Confirm the native
share sheet opens with the generated image attached, and Instagram (Stories)
appears as a target.

- [ ] **Step 5: Update CLAUDE.md gaps table**

In `CLAUDE.md`, under "Gaps Conocidos", add a row noting the Instagram Story
share + flyer photo banner redesign is done, referencing this plan and the
design doc.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Instagram Story share + flyer redesign as done"
```
