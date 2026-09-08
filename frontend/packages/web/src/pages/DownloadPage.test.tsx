import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadPage } from './DownloadPage';

// `t` devuelve la clave, como en el resto de los tests de pagina. Eso vuelve a
// este archivo CIEGO a una traduccion faltante o vacia: lo que se afirma aca es
// la ESTRUCTURA (que cada bloque exista y que cada link tenga su etiqueta), no
// el texto. Las traducciones las cubre `i18n/downloadKeys.test.ts`.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

describe('DownloadPage', () => {
  it('renderiza la opción de descarga APK para Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText('android.title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'android.ctaLabel' })).toBeInTheDocument();
  });

  it('renderiza la opción PWA para iOS y Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText('webApp.title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'webApp.ctaLabel' })).toBeInTheDocument();
  });

  it('renderiza la opción Expo Go para testing', () => {
    render(<DownloadPage />);
    expect(screen.getByText('expo.title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'expo.androidLabel' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'expo.iosLabel' })).toBeInTheDocument();
  });

  it('muestra instrucciones para instalar APK en Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText('sideload.title')).toBeInTheDocument();
  });

  // Los cuatro pasos de cada lista: si alguien agrega un `step5` al locale y se
  // olvida de renderizarlo, o borra un `<li>`, esto se cae. La numeracion vive
  // en el markup, asi que se afirma junto al texto.
  it('renderiza los cuatro pasos de cada instructivo, numerados', () => {
    render(<DownloadPage />);
    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByText(`${n}. webApp.step${n}`)).toBeInTheDocument();
      expect(screen.getByText(`${n}. sideload.step${n}`)).toBeInTheDocument();
    }
  });

  // Los destinos externos son el punto de la pagina: si uno se rompe, la pagina
  // no sirve para nada aunque renderice perfecto.
  it('los enlaces apuntan a los destinos correctos', () => {
    render(<DownloadPage />);
    expect(screen.getByRole('link', { name: 'android.ctaLabel' })).toHaveAttribute(
      'href',
      'https://github.com/Goncar29/searchpet/releases/latest'
    );
    expect(screen.getByRole('link', { name: 'expo.androidLabel' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=host.exp.exponent'
    );
    expect(screen.getByRole('link', { name: 'expo.iosLabel' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/expo-go/id982107779'
    );
  });
});
