import { Logo } from '../components/Logo';

export function DownloadPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="text-center mb-10">
        <Logo className="h-16 w-16 mx-auto mb-4 text-primary" />
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Descargar SearchPet
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          100% gratuita, sin pasar por stores
        </p>
      </div>

      <div className="space-y-4">
        {/* Android APK */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <span className="text-4xl flex-shrink-0" aria-hidden>🤖</span>
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                Android (APK)
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Descargá e instalá directamente en tu teléfono Android.
                No requiere Google Play.
              </p>
              <a
                href="https://github.com/Goncar29/searchpet/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 text-white font-bold px-6 py-3 rounded-lg hover:bg-green-600 transition-colors"
                aria-label="Descargar APK desde GitHub Releases"
              >
                Descargar APK
              </a>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Se descarga desde GitHub Releases — siempre la última versión
              </p>
            </div>
          </div>
        </div>

        {/* PWA */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <span className="text-4xl flex-shrink-0" aria-hidden>🌐</span>
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                Web App (iOS + Android)
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Instalá desde el navegador. Funciona en iOS y Android sin pasar por ningún store.
              </p>
              <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-4 list-none">
                <li>1. Abrí esta página en Safari (iOS) o Chrome (Android)</li>
                <li>2. Tocá el botón compartir ⬆️</li>
                <li>3. Seleccioná "Agregar a pantalla de inicio"</li>
                <li>4. ¡Listo! El ícono queda en tu pantalla de inicio</li>
              </ol>
              <a
                href="/"
                className="inline-flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-lg hover:bg-primary-dark transition-colors"
                aria-label="Abrir Web App"
              >
                Abrir ahora
              </a>
            </div>
          </div>
        </div>

        {/* Expo Go */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start gap-4">
            <span className="text-4xl flex-shrink-0" aria-hidden>📲</span>
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 dark:text-white mb-1">
                Expo Go (Testing)
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Para testers y desarrolladores. Instalá la app y escaneá el QR.
              </p>
              <div className="flex gap-3">
                <a
                  href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label="Expo Go para Android"
                >
                  Android
                </a>
                <span className="text-gray-300" aria-hidden>|</span>
                <a
                  href="https://apps.apple.com/app/expo-go/id982107779"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label="Expo Go para iOS"
                >
                  iOS
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Instrucciones fuentes desconocidas */}
      <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-6">
        <h3 className="font-bold text-gray-900 dark:text-white mb-2">
          Para instalar el APK en Android
        </h3>
        <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-none">
          <li>1. Ir a Ajustes → Seguridad (o Aplicaciones)</li>
          <li>2. Activar "Instalar apps de fuentes desconocidas"</li>
          <li>3. Descargar y abrir el APK</li>
          <li>4. Tocar "Instalar"</li>
        </ol>
      </div>
    </div>
  );
}
