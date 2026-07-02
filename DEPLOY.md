# 🚀 Guía de Deploy - SearchPet

## Deploy Gratuito (100% sin costo)

---

## 1. Backend (Render) ← PRODUCCIÓN ACTUAL

### Setup
1. Ir a [render.com](https://render.com) y crear cuenta con GitHub
2. New → Web Service → conectar repo SearchPet
3. Render detecta el Dockerfile automáticamente

### Variables de entorno en Render
```
PORT=8080
ENVIRONMENT=production
DATABASE_URL=<se genera automáticamente con PostgreSQL de Render>
JWT_SECRET=<generar un secret fuerte>
# APP_URL debe ser el dominio del FRONTEND (Vercel), NO el del backend.
# Los share links se arman como APP_URL/share/:token y ese path lo sirve la
# función serverless de Vercel (api/share.js), que emite los OG tags (preview
# con foto de la mascota). Si apunta a onrender.com, el crawler recibe un 404
# sin OG tags y el preview sale vacío.
APP_URL=https://searchpet.vercel.app
CLOUDINARY_CLOUD_NAME=<tu cloud name>
CLOUDINARY_API_KEY=<tu api key>
CLOUDINARY_API_SECRET=<tu api secret>
FIREBASE_KEY=<tu key JSON de Firebase>
CORS_ALLOWED_ORIGINS=https://searchpet.vercel.app
```

### Agregar PostgreSQL + PostGIS
1. En Render dashboard → New → PostgreSQL
2. Conectar a tu Web Service vía `DATABASE_URL`
3. Instalar PostGIS (solo primera vez):
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

### Trigger de deploy manual (CI)
El workflow `ci.yml` hace trigger automático en Render al pushear a `main` via webhook.

### Costo: $0 (plan free — se duerme tras 15 min de inactividad)

---

## 2. Web (Vercel)

### Setup
1. Ir a [vercel.com](https://vercel.com) y conectar GitHub
2. Importar el repo
3. Configurar:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend/packages/web`
   - **Build Command**: `pnpm build`
   - **Output Directory**: `dist`

### Variables de entorno en Vercel
```
VITE_API_URL=https://tu-backend.onrender.com
```

### Security headers (CSP)
Los headers de seguridad (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) se sirven desde el bloque `headers` de `frontend/packages/web/vercel.json` — no hay nada que configurar en el dashboard de Vercel.

**Importante:** el `connect-src` de la CSP tiene hardcodeado el host del backend. Si cambiás `VITE_API_URL`, actualizá también `vercel.json` (las entradas `https://` y `wss://` del backend) o los fetch y el WebSocket quedan bloqueados en prod. Ver regla #23 de `CLAUDE.md`.

### Costo: $0 (plan Hobby gratuito)

---

## 3. Base de Datos (Supabase - alternativa)

Si prefieres Supabase en lugar de Render PostgreSQL:

1. Ir a [supabase.com](https://supabase.com)
2. Crear proyecto → Obtener connection string
3. Habilitar PostGIS:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
4. Usar la URL en `DATABASE_URL`

### Costo: $0 (500 MB gratis)

---

## 4. Imágenes (Cloudinary)

1. Ir a [cloudinary.com](https://cloudinary.com) y crear cuenta
2. Copiar la `CLOUDINARY_URL` del dashboard
3. Agregar a variables de entorno del backend

### Costo: $0 (25 créditos/mes gratis)

---

## 5. Push Notifications (Firebase)

1. Ir a [console.firebase.google.com](https://console.firebase.google.com)
2. Crear proyecto
3. Configurar Cloud Messaging
4. Descargar `google-services.json` (Android) y `GoogleService-Info.plist` (iOS)
5. Agregar `FIREBASE_KEY` a las variables del backend

### Secretos de GitHub requeridos para builds móviles

Los archivos de configuración de Firebase NO están commiteados al repo (están en `.gitignore`).
El workflow de CI los inyecta desde secretos de GitHub en cada build.

**Cómo agregar los secretos:**
1. Ir a **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Contenido | Cómo obtenerlo |
|--------|-----------|----------------|
| `GOOGLE_SERVICES_JSON` | Contenido completo del archivo `google-services.json` (Android) | Firebase Console → Project Settings → Your apps → Android app → Download google-services.json → copiar todo el contenido del archivo |
| `GOOGLE_SERVICE_INFO_PLIST` | Contenido completo del archivo `GoogleService-Info.plist` (iOS) | Firebase Console → Project Settings → Your apps → iOS app → Download GoogleService-Info.plist → copiar todo el contenido del archivo |

> **Nota**: `GOOGLE_SERVICE_INFO_PLIST` es para builds iOS vía EAS — está documentado aquí para cuando se agreguen builds de iOS al pipeline. El workflow actual (`build-apk.yml`) solo inyecta `GOOGLE_SERVICES_JSON`.

**Si el secreto no está configurado**, el workflow falla con:
```
Error: GOOGLE_SERVICES_JSON secret is not set
```

### Costo: $0 (FCM es gratuito)

---

## 6. Mobile App (Expo)

### Build
```bash
cd frontend/packages/mobile
npx eas build --platform android  # APK/AAB
npx eas build --platform ios      # IPA
```

### Publicar
```bash
# Play Store
npx eas submit --platform android

# App Store
npx eas submit --platform ios
```

### Costo: $0 (Expo free tier: 30 builds/mes)

---

## 7. Dominio (opcional)

- **Gratuito**: usar subdominios de Render/Vercel
  - `searchpet.onrender.com`
  - `searchpet.vercel.app`

- **Propio** (~$10/año):
  - Comprar en Namecheap/Cloudflare
  - Configurar DNS en Vercel/Render

---

## 8. Redis — Rate Limiting Distribuido (opcional)

Por defecto el backend usa un rate limiter in-memory, que funciona correctamente
en instancias únicas. Si desplegás múltiples instancias, configurá Redis para
compartir el estado del rate limit.

### Render (plan gratuito)

1. En Render dashboard → New → Redis
2. Seleccionar plan **Free** (25 MB, suficiente para rate limiting)
3. Copiar la **Internal Redis URL** (formato `redis://red-xxx:6379`)
4. Agregar a las variables de entorno del Web Service:

```
REDIS_URL=redis://red-xxx:6379
```

### Alternativas gratuitas

| Proveedor | Plan gratuito | Límite |
|-----------|---------------|--------|
| **Upstash** | Free | 10.000 req/día, 256 MB |
| **Railway** | Hobby | $5 créditos/mes |

### Comportamiento sin Redis

Cuando `REDIS_URL` no está configurado, el servidor arranca con el store
in-memory y loguea:

```
Rate limiter: in-memory
```

Esto es comportamiento esperado y seguro para instancias únicas.

### Costo: $0 (Render free Redis)

---

## Resumen de Costos

| Servicio | Proveedor | Costo |
|----------|-----------|-------|
| Backend | **Render** | $0 |
| Web | Vercel | $0 |
| BD | **Render** PostgreSQL | $0 |
| Imágenes | Cloudinary | $0 |
| Push | Firebase | $0 |
| App builds | Expo EAS | $0 |
| CI/CD | GitHub Actions | $0 |
| **Total** | | **$0/mes** |

---

## Comandos útiles

```bash
# Setup inicial
make setup

# Desarrollo local
make dev        # Levantar PostgreSQL
make backend    # Iniciar Go API
make web        # Iniciar React Web
make mobile     # Iniciar Expo

# Tests
make test

# Deploy
make deploy-backend
make deploy-web
```
