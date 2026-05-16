import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setIsVisible(false);
    setInstallPrompt(null);
  };

  if (!isVisible || isInstalled) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-4 z-50 flex items-center gap-4">
      <span className="text-3xl flex-shrink-0" aria-hidden>🐾</span>
      <div className="flex-1">
        <p className="font-bold text-gray-900 dark:text-white text-sm">Instalar SearchPet</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Agregar a tu pantalla de inicio. Sin stores, gratis.
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => setIsVisible(false)}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2"
          aria-label="Ahora no"
        >
          Ahora no
        </button>
        <button
          onClick={handleInstall}
          className="text-xs bg-primary text-white font-bold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
          aria-label="Instalar"
        >
          Instalar
        </button>
      </div>
    </div>
  );
}
