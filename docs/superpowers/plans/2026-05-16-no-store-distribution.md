# No-Store Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribuir SearchPet en Android (APK directo), iOS (PWA instalable) y testing (Expo Go) sin pasar por Google Play ni App Store — costo $0.

**Architecture:** Tres canales complementarios: (1) APK generado con EAS Build descargable desde la web, (2) PWA instalable desde el navegador con service worker + manifest, (3) Expo Go para testing via QR. El CI/CD genera el APK automáticamente con cada tag de GitHub Release.

**Tech Stack:** Expo SDK 52, EAS CLI, Vite PWA (manual — sin vite-plugin-pwa), Tailwind v4 (`@theme` tokens), GitHub Actions, Vitest + Testing Library para tests de componentes.

---

## File Map

### Archivos CREADOS

| Archivo | Responsabilidad |
|---------|----------------|
| `frontend/packages/mobile/eas.json` | Config EAS Build — `buildType: "apk"` es la clave |
| `frontend/packages/mobile/scripts/build-apk-eas.sh` | Script helper para build manual con EAS |
| `frontend/packages/web/public/manifest.json` | PWA manifest — ícono, nombre, colores, shortcuts |
| `frontend/packages/web/public/sw.js` | Service Worker — cache, offline fallback, push |
| `frontend/packages/web/public/icons/icon.png` | Ícono copiado desde mobile assets (placeholder MVP) |
| `frontend/packages/web/src/components/InstallPWA.tsx` | Banner "Instalar app" (Android/Chrome only) |
| `frontend/packages/web/src/components/InstallPWA.test.tsx` | Tests del banner |
| `frontend/packages/web/src/pages/DownloadPage.tsx` | Página /descargar — APK + PWA + Expo Go |
| `frontend/packages/web/src/pages/DownloadPage.test.tsx` | Tests de la página |
| `.github/workflows/build-apk.yml` | CI/CD — genera APK con cada tag + GitHub Release |
| `docs/github-secrets.md` | Instrucciones para configurar secrets del keystore |

### Archivos MODIFICADOS

| Archivo | Qué cambia |
|---------|-----------|
| `frontend/packages/mobile/package.json` | Agrega `start:tunnel` y `start:qr` scripts |
| `frontend/packages/mobile/app.json` | Agrega `versionCode: 1` en android |
| `frontend/packages/web/index.html` | Meta tags PWA (manifest, theme-color, apple) |
| `frontend/packages/web/src/main.tsx` | Registra el service worker |
| `frontend/packages/web/src/App.tsx` | Agrega ruta `/descargar` + `<InstallPWA />` |

---

## Task 1: Mobile — Scripts de Expo Go + EAS config

**Files:**
- Modify: `frontend/packages/mobile/package.json`
- Modify: `frontend/packages/mobile/app.json`
- Create: `frontend/packages/mobile/eas.json`
- Create: `frontend/packages/mobile/scripts/build-apk-eas.sh`

- [ ] **Step 1.1: Agregar scripts de tunnel en package.json**

Abrir `frontend/packages/mobile/package.json` y reemplazar el bloque `"scripts"` por:

```json
"scripts": {
  "start": "expo start",
  "start:tunnel": "expo start --tunnel",
  "start:qr": "expo start --tunnel --qr",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "lint": "eslint .",
  "test": "jest --watchAll",
  "test:run": "jest --watchAll=false"
},
```

- [ ] **Step 1.2: Agregar versionCode en app.json**

En `frontend/packages/mobile/app.json`, dentro del objeto `"android"`, agregar `"versionCode": 1` después de `"package"`:

```json
"android": {
  "adaptiveIcon": {
    "foregroundImage": "./assets/images/adaptive-icon.png",
    "backgroundColor": "#FF6B35"
  },
  "package": "com.searchpet.app",
  "versionCode": 1,
  "permissions": [
    "ACCESS_FINE_LOCATION",
    "ACCESS_COARSE_LOCATION",
    "CAMERA",
    "READ_EXTERNAL_STORAGE",
    "POST_NOTIFICATIONS"
  ]
},
```

- [ ] **Step 1.3: Crear eas.json**

Crear `frontend/packages/mobile/eas.json`:

```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": true
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

> **IMPORTANTE:** `buildType: "apk"` es lo que diferencia APK (instalable directo) de AAB (solo Play Store). Sin esto el build no sirve para distribución directa.

- [ ] **Step 1.4: Crear script helper de build EAS**

Crear `frontend/packages/mobile/scripts/build-apk-eas.sh`:

```bash
#!/bin/bash
# Genera APK usando Expo EAS en la nube.
# Requiere: cuenta gratuita en expo.dev (30 builds/mes gratis)

set -e
echo "Generando APK con EAS Build..."

cd "$(dirname "$0")/.."

# Instalar EAS CLI si no está
command -v eas >/dev/null 2>&1 || npm install -g eas-cli

# Login
echo "Iniciando sesión en Expo (abre el browser)..."
eas login

# Configurar proyecto (solo primera vez — linkea con expo.dev)
eas build:configure

# Generar APK con perfil preview
echo "Iniciando build en la nube..."
eas build \
  --platform android \
  --profile preview \
  --non-interactive

echo ""
echo "Build iniciado. Recibirás email cuando esté listo."
echo "También en: https://expo.dev/accounts/[tu-usuario]/projects"
```

```bash
chmod +x frontend/packages/mobile/scripts/build-apk-eas.sh
```

- [ ] **Step 1.5: Verificar y commitear**

Verificar que el JSON es válido:
```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/packages/mobile/eas.json', 'utf8')); console.log('eas.json OK')"
node -e "JSON.parse(require('fs').readFileSync('frontend/packages/mobile/app.json', 'utf8')); console.log('app.json OK')"
node -e "JSON.parse(require('fs').readFileSync('frontend/packages/mobile/package.json', 'utf8')); console.log('package.json OK')"
```

Expected: `eas.json OK`, `app.json OK`, `package.json OK`

```bash
git add frontend/packages/mobile/eas.json \
        frontend/packages/mobile/app.json \
        frontend/packages/mobile/package.json \
        frontend/packages/mobile/scripts/build-apk-eas.sh
git commit -m "feat(mobile): add EAS APK build config and tunnel scripts"
```

---

## Task 2: PWA — Ícono + Manifest

**Files:**
- Create: `frontend/packages/web/public/icons/icon.png`
- Create: `frontend/packages/web/public/manifest.json`

- [ ] **Step 2.1: Copiar ícono existente para PWA**

El ícono de la app mobile ya existe. Para MVP, usamos el mismo para la PWA:

```bash
mkdir -p frontend/packages/web/public/icons
cp frontend/packages/mobile/assets/images/icon.png \
   frontend/packages/web/public/icons/icon.png
```

> **Nota MVP:** Este ícono se usa para todos los tamaños declarados en el manifest. Para producción real, generar íconos correctamente con https://realfavicongenerator.net o `sharp`. Por ahora el navegador escala automáticamente.

- [ ] **Step 2.2: Crear manifest.json**

Crear `frontend/packages/web/public/manifest.json`:

```json
{
  "name": "SearchPet - Encuentra mascotas perdidas",
  "short_name": "SearchPet",
  "description": "Plataforma gratuita para encontrar mascotas perdidas. Publica, busca en el mapa y comparte en redes sociales.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#FFFFFF",
  "theme_color": "#FF6B35",
  "lang": "es",
  "categories": ["social", "utilities"],
  "icons": [
    {
      "src": "/icons/icon.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ],
  "shortcuts": [
    {
      "name": "Ver mapa",
      "short_name": "Mapa",
      "url": "/map",
      "icons": [{ "src": "/icons/icon.png", "sizes": "192x192" }]
    },
    {
      "name": "Publicar mascota",
      "short_name": "Publicar",
      "url": "/pets/create",
      "icons": [{ "src": "/icons/icon.png", "sizes": "192x192" }]
    }
  ]
}
```

- [ ] **Step 2.3: Verificar JSON válido y commitear**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/packages/web/public/manifest.json', 'utf8')); console.log('manifest.json OK')"
```

Expected: `manifest.json OK`

```bash
git add frontend/packages/web/public/manifest.json \
        frontend/packages/web/public/icons/
git commit -m "feat(pwa): add web app manifest and icon"
```

---

## Task 3: PWA — Service Worker

**Files:**
- Create: `frontend/packages/web/public/sw.js`

- [ ] **Step 3.1: Crear el service worker**

Crear `frontend/packages/web/public/sw.js`:

```javascript
// SearchPet Service Worker v1
// Estrategia: Network first, cache fallback para assets estáticos.
// Las llamadas a /api/ NUNCA se cachean.

const CACHE_NAME = 'searchpet-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// Instalar: cachear assets base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback a cache
self.addEventListener('fetch', (event) => {
  // Nunca interceptar llamadas a la API — siempre deben ir al servidor
  if (event.request.url.includes('/api/')) return;

  // Solo cachear GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cachear respuestas exitosas de assets estáticos
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Sin red: servir desde cache, fallback a index.html para SPA routing
        caches.match(event.request).then(
          (cached) => cached || caches.match('/index.html')
        )
      )
  );
});

// Push notifications básicas (cuando FCM esté integrado, este handler
// convive con firebase-messaging-sw.js que maneja el scope /firebase-cloud-messaging-push-scope)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'SearchPet', {
      body: data.body || '¡Hay una mascota perdida cerca de ti!',
      icon: '/icons/icon.png',
      badge: '/icons/icon.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: [
        { action: 'view', title: 'Ver mascota' },
        { action: 'close', title: 'Cerrar' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
```

- [ ] **Step 3.2: Commitear**

```bash
git add frontend/packages/web/public/sw.js
git commit -m "feat(pwa): add service worker with network-first caching strategy"
```

---

## Task 4: PWA — Wiring en index.html y main.tsx

**Files:**
- Modify: `frontend/packages/web/index.html`
- Modify: `frontend/packages/web/src/main.tsx`

- [ ] **Step 4.1: Agregar meta tags PWA en index.html**

En `frontend/packages/web/index.html`, dentro de `<head>`, agregar después de la línea del `<link rel="icon">`:

```html
<!-- PWA -->
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#FF6B35" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="SearchPet" />
<link rel="apple-touch-icon" sizes="192x192" href="/icons/icon.png" />
<!-- Open Graph actualizado con ícono -->
<meta property="og:image" content="/icons/icon.png" />
```

El `<head>` completo debe quedar:

```html
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <!-- PWA -->
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#FF6B35" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="SearchPet" />
  <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon.png" />
  <meta property="og:image" content="/icons/icon.png" />
  <!-- Viewport y descripción -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="SearchPet - Ayuda a encontrar mascotas perdidas. Publica, busca y comparte reportes de mascotas." />
  <meta property="og:title" content="SearchPet - Encuentra mascotas perdidas" />
  <meta property="og:description" content="Plataforma gratuita para encontrar mascotas perdidas. Publica, busca en el mapa y comparte en redes sociales." />
  <meta property="og:type" content="website" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <title>SearchPet - Encuentra mascotas perdidas</title>
</head>
```

- [ ] **Step 4.2: Registrar service worker en main.tsx**

En `frontend/packages/web/src/main.tsx`, agregar al final del archivo (después del `ReactDOM.createRoot(...).render(...)`):

```typescript
// Registrar Service Worker para PWA (solo en producción o localhost)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] Registrado:', reg.scope))
      .catch((err) => console.error('[SW] Error al registrar:', err));
  });
}
```

- [ ] **Step 4.3: Commitear**

```bash
git add frontend/packages/web/index.html \
        frontend/packages/web/src/main.tsx
git commit -m "feat(pwa): wire manifest and service worker registration"
```

---

## Task 5: PWA — Componente InstallPWA

**Files:**
- Create: `frontend/packages/web/src/components/InstallPWA.tsx`
- Create: `frontend/packages/web/src/components/InstallPWA.test.tsx`

- [ ] **Step 5.1: Escribir el test primero**

Crear `frontend/packages/web/src/components/InstallPWA.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InstallPWA } from './InstallPWA';

describe('InstallPWA', () => {
  beforeEach(() => {
    // Resetear matchMedia mock
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, // No está instalada
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

  it('renderiza el banner cuando se dispara beforeinstallprompt', () => {
    render(<InstallPWA />);

    // Simular el evento del navegador
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockUserChoice = Promise.resolve({ outcome: 'accepted' as const });
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: mockPrompt, userChoice: mockUserChoice });
    window.dispatchEvent(event);

    expect(screen.getByText('Instalar SearchPet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /instalar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ahora no/i })).toBeInTheDocument();
  });

  it('oculta el banner al tocar "Ahora no"', () => {
    render(<InstallPWA />);

    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    window.dispatchEvent(event);

    fireEvent.click(screen.getByRole('button', { name: /ahora no/i }));
    expect(screen.queryByText('Instalar SearchPet')).not.toBeInTheDocument();
  });

  it('no renderiza si la app ya está instalada (standalone mode)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)', // Está instalada
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const { container } = render(<InstallPWA />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 5.2: Correr el test para verificar que falla**

```bash
cd frontend/packages/web && npx vitest run src/components/InstallPWA.test.tsx
```

Expected: FAIL con `Cannot find module './InstallPWA'`

- [ ] **Step 5.3: Crear el componente**

Crear `frontend/packages/web/src/components/InstallPWA.tsx`:

```typescript
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
    // Si ya está corriendo como PWA instalada, no mostrar nada
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
```

- [ ] **Step 5.4: Correr el test para verificar que pasa**

```bash
cd frontend/packages/web && npx vitest run src/components/InstallPWA.test.tsx
```

Expected: 4 tests PASS

- [ ] **Step 5.5: Commitear**

```bash
git add frontend/packages/web/src/components/InstallPWA.tsx \
        frontend/packages/web/src/components/InstallPWA.test.tsx
git commit -m "feat(pwa): add InstallPWA banner component with tests"
```

---

## Task 6: Web — DownloadPage + ruta + InstallPWA en App

**Files:**
- Create: `frontend/packages/web/src/pages/DownloadPage.tsx`
- Create: `frontend/packages/web/src/pages/DownloadPage.test.tsx`
- Modify: `frontend/packages/web/src/App.tsx`

- [ ] **Step 6.1: Escribir test de DownloadPage primero**

Crear `frontend/packages/web/src/pages/DownloadPage.test.tsx`:

```typescript
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
```

- [ ] **Step 6.2: Correr el test para verificar que falla**

```bash
cd frontend/packages/web && npx vitest run src/pages/DownloadPage.test.tsx
```

Expected: FAIL con `Cannot find module './DownloadPage'`

- [ ] **Step 6.3: Crear DownloadPage**

Crear `frontend/packages/web/src/pages/DownloadPage.tsx`:

```typescript
export function DownloadPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="text-center mb-10">
        <p className="text-6xl mb-4" aria-hidden>🐾</p>
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
                href="/downloads/SearchPet.apk"
                download
                className="inline-flex items-center gap-2 bg-green-500 text-white font-bold px-6 py-3 rounded-lg hover:bg-green-600 transition-colors"
                aria-label="Descargar APK"
              >
                Descargar APK
              </a>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Versión 1.0.0
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
                Abrir Web App
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
                Para testers y desarrolladores. Instalá Expo Go y escaneá el QR.
              </p>
              <div className="flex gap-3">
                <a
                  href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label="Expo Go para Android"
                >
                  Expo Go para Android
                </a>
                <span className="text-gray-300" aria-hidden>|</span>
                <a
                  href="https://apps.apple.com/app/expo-go/id982107779"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary font-semibold hover:underline"
                  aria-label="Expo Go para iOS"
                >
                  Expo Go para iOS
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
```

- [ ] **Step 6.4: Correr tests para verificar que pasan**

```bash
cd frontend/packages/web && npx vitest run src/pages/DownloadPage.test.tsx
```

Expected: 4 tests PASS

- [ ] **Step 6.5: Agregar ruta /descargar e InstallPWA en App.tsx**

En `frontend/packages/web/src/App.tsx`:

1. Agregar los imports al inicio:
```typescript
import { InstallPWA } from './components/InstallPWA';
import { DownloadPage } from './pages/DownloadPage';
```

2. Agregar la ruta `/descargar` dentro del bloque de rutas públicas (con `<MainLayout>`):
```typescript
<Route path="/descargar" element={<DownloadPage />} />
```

3. Agregar `<InstallPWA />` justo antes del cierre `</Routes>`:
```typescript
    </Routes>
    <InstallPWA />
```

El `App.tsx` completo debe quedar:

```typescript
import { Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { InstallPWA } from './components/InstallPWA';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { PetDetailPage } from './pages/PetDetailPage';
import { SharedPetPage } from './pages/SharedPetPage';
import { SheltersPage } from './pages/SheltersPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CreatePetPage } from './pages/CreatePetPage';
import { EditPetPage } from './pages/EditPetPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyPetsPage } from './pages/MyPetsPage';
import { CreateReportPage } from './pages/CreateReportPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { DownloadPage } from './pages/DownloadPage';

export default function App() {
  return (
    <>
      <Routes>
        {/* Rutas con layout */}
        <Route element={<MainLayout />}>
          {/* Rutas públicas */}
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/pets/:id" element={<PetDetailPage />} />
          <Route path="/shelters" element={<SheltersPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/users/:id" element={<UserProfilePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/descargar" element={<DownloadPage />} />

          {/* Rutas protegidas (requieren autenticación) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/pets/create" element={<CreatePetPage />} />
            <Route path="/pets/:id/edit" element={<EditPetPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/pets/mine" element={<MyPetsPage />} />
            <Route path="/reports/create" element={<CreateReportPage />} />
          </Route>
        </Route>

        {/* Landing page compartida (sin layout) */}
        <Route path="/pet/:token" element={<SharedPetPage />} />
      </Routes>
      <InstallPWA />
    </>
  );
}
```

- [ ] **Step 6.6: Commitear**

```bash
git add frontend/packages/web/src/pages/DownloadPage.tsx \
        frontend/packages/web/src/pages/DownloadPage.test.tsx \
        frontend/packages/web/src/App.tsx
git commit -m "feat(web): add /descargar page and InstallPWA banner"
```

---

## Task 7: CI/CD — GitHub Action para APK automático

**Files:**
- Create: `.github/workflows/build-apk.yml`
- Create: `docs/github-secrets.md`

- [ ] **Step 7.1: Crear el workflow**

Crear `.github/workflows/build-apk.yml`:

```yaml
name: Build APK

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (ej: 1.0.0)'
        required: true
        default: '1.0.0'

jobs:
  build-apk:
    name: Build Android APK
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/packages/mobile/package-lock.json

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install dependencies
        working-directory: frontend/packages/mobile
        run: npm install

      - name: Generate native Android project
        working-directory: frontend/packages/mobile
        run: npx expo prebuild --platform android --clean
        env:
          EXPO_PUBLIC_API_URL: ${{ secrets.API_URL }}

      # CRÍTICO: inyectar firma en build.gradle DESPUÉS del prebuild
      # (prebuild regenera android/ desde cero cada vez)
      - name: Configure signing
        working-directory: frontend/packages/mobile/android
        run: |
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > app/searchpet.keystore
          cat >> app/build.gradle << 'EOF'

          android.signingConfigs {
            release {
              storeFile file("searchpet.keystore")
              storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
              keyAlias System.getenv("ANDROID_KEY_ALIAS")
              keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
          }
          android.buildTypes.release.signingConfig android.signingConfigs.release
          EOF

      - name: Build APK
        working-directory: frontend/packages/mobile/android
        run: ./gradlew assembleRelease
        env:
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}

      - name: Rename APK
        run: |
          TAG="${{ github.ref_name }}"
          VERSION="${{ inputs.version }}"
          LABEL="${TAG:-v${VERSION}}"
          mv frontend/packages/mobile/android/app/build/outputs/apk/release/app-release.apk \
             "SearchPet-${LABEL}.apk"

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: SearchPet-APK
          path: SearchPet-*.apk
          retention-days: 30

      - name: Create GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: SearchPet-*.apk
          body: |
            ## SearchPet ${{ github.ref_name }}

            ### Instalar en Android
            1. Descargar `SearchPet-${{ github.ref_name }}.apk`
            2. Abrir el archivo en tu teléfono
            3. Si aparece advertencia, tocar "Instalar de todas formas"
            4. Si es la primera vez: Ajustes → Seguridad → Activar "Fuentes desconocidas"

            ### Instalar en iOS / Todos los dispositivos
            Usá la web app: https://searchpet.vercel.app/descargar
          draft: false
          prerelease: false
```

- [ ] **Step 7.2: Documentar los secrets necesarios**

Crear `docs/github-secrets.md`:

```markdown
# GitHub Secrets para CI/CD — APK Build

Configurar en: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Descripción | Ejemplo |
|--------|-------------|---------|
| `API_URL` | URL del backend en Railway | `https://searchpet.railway.app` |
| `ANDROID_KEYSTORE_BASE64` | Keystore en base64 (ver paso de generación abajo) | `MIIKDgIBAz...` |
| `ANDROID_KEYSTORE_PASSWORD` | Contraseña del keystore | `mi-password-seguro` |
| `ANDROID_KEY_ALIAS` | Alias de la signing key | `searchpet` |
| `ANDROID_KEY_PASSWORD` | Contraseña de la key (puede ser igual al keystore) | `mi-password-seguro` |

## Generar Keystore (solo se hace UNA vez)

```bash
keytool -genkey -v \
  -keystore searchpet.keystore \
  -alias searchpet \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=SearchPet, OU=Mobile, O=SearchPet, L=Montevideo, ST=Uruguay, C=UY"
```

Cuando pida contraseña: elegí una y guardala — es `ANDROID_KEYSTORE_PASSWORD` y `ANDROID_KEY_PASSWORD`.

## Convertir a base64 para el secret

```bash
# En Linux/Mac:
base64 searchpet.keystore | tr -d '\n'

# En Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("searchpet.keystore"))
```

Copiar el output completo → GitHub Secret `ANDROID_KEYSTORE_BASE64`.

## IMPORTANTE: Guardar el keystore

Guardar `searchpet.keystore` en un lugar seguro (no commitearlo al repo).
Si se pierde, no se puede actualizar el APK firmado con el mismo certificado.
```

- [ ] **Step 7.3: Commitear**

```bash
git add .github/workflows/build-apk.yml \
        docs/github-secrets.md
git commit -m "feat(ci): add GitHub Actions workflow for automatic APK build"
```

---

## Self-Review

### Spec coverage

| Requerimiento del apk.md | Task que lo implementa |
|---|---|
| Scripts tunnel Expo Go | Task 1 ✅ |
| eas.json con buildType apk | Task 1 ✅ |
| PWA manifest.json | Task 2 ✅ |
| Service Worker | Task 3 ✅ |
| Meta tags HTML + registro SW | Task 4 ✅ |
| Banner InstallPWA | Task 5 ✅ |
| Página /descargar | Task 6 ✅ |
| CI/CD GitHub Actions + firma | Task 7 ✅ |
| Documentación secrets | Task 7 ✅ |
| Notificaciones Expo Push | Excluido — `expo-notifications` ya está instalado y la integración real requiere un backend endpoint separado. Se deja para cuando el backend lo implemente. |

### Placeholders verificados

- Todos los pasos tienen código completo
- No hay "TBD" ni "implementar después"
- Las rutas son exactas en todos los pasos
- Los nombres de componentes son consistentes entre tasks

### Type consistency

- `InstallPWA` exportado y referenciado igual en App.tsx
- `DownloadPage` exportado y referenciado igual en App.tsx
- `BeforeInstallPromptEvent` definido en el componente y usado solo en él
```
