import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadPage } from './DownloadPage';

describe('DownloadPage', () => {
  it('renderiza la opción de descarga APK para Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText(/Android \(APK\)/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /descargar apk/i })).toBeInTheDocument();
  });

  it('renderiza la opción PWA para iOS y Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText(/Web App/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir web app/i })).toBeInTheDocument();
  });

  it('renderiza la opción Expo Go para testing', () => {
    render(<DownloadPage />);
    expect(screen.getByText(/Expo Go/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /expo go para android/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /expo go para ios/i })).toBeInTheDocument();
  });

  it('muestra instrucciones para instalar APK en Android', () => {
    render(<DownloadPage />);
    expect(screen.getByText(/fuentes desconocidas/i)).toBeInTheDocument();
  });
});
