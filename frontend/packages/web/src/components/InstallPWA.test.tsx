import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InstallPWA } from './InstallPWA';

// `t` returns the key, as in the other component tests: this file asserts that
// every visible string comes from a translation, and `usedKeysExist.test.ts`
// checks those keys exist. The banner used to hardcode Spanish, so English and
// Portuguese users saw "Instalar" / "Ahora no".
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('InstallPWA', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('no renderiza nada si no hay evento beforeinstallprompt', () => {
    const { container } = render(<InstallPWA />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza el banner cuando se dispara beforeinstallprompt', async () => {
    render(<InstallPWA />);
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockUserChoice = Promise.resolve({ outcome: 'accepted' as const });
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: mockPrompt, userChoice: mockUserChoice });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(screen.getByText('installBanner.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'installBanner.install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'installBanner.dismiss' })).toBeInTheDocument();
  });

  it('oculta el banner al tocar "Ahora no"', async () => {
    render(<InstallPWA />);
    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    await act(async () => {
      window.dispatchEvent(event);
    });
    fireEvent.click(screen.getByRole('button', { name: 'installBanner.dismiss' }));
    expect(screen.queryByText('installBanner.title')).not.toBeInTheDocument();
  });

  it('no renderiza si la app ya está instalada (standalone mode)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const { container } = render(<InstallPWA />);
    expect(container.firstChild).toBeNull();
  });
});
