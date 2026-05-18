# 🚀 Guía de Deploy - SearchPet

## Deploy Gratuito (100% sin costo)

---

## 1. Backend (Railway)

### Setup
1. Ir a [railway.app](https://railway.app) y crear cuenta con GitHub
2. Crear nuevo proyecto → Deploy from GitHub repo
3. Seleccionar el repo de SearchPet
4. Railway detecta el Dockerfile automáticamente

### Variables de entorno en Railway
```
PORT=8080
ENVIRONMENT=production
DATABASE_URL=<se genera automáticamente con PostgreSQL plugin>
JWT_SECRET=<generar un secret fuerte>
APP_URL=https://tu-app.railway.app
CLOUDINARY_URL=<tu URL de Cloudinary>
FIREBASE_KEY=<tu key de Firebase>
```

### Agregar PostgreSQL + PostGIS
1. En Railway dashboard → New → Database → PostgreSQL
2. Instalar PostGIS:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```
3. Copiar la `DATABASE_URL` a las variables del servicio

### Costo: $0 (plan free $5/mes en créditos)

---

## 2. Web (Vercel)

### Setup
1. Ir a [vercel.com](https://vercel.com) y conectar GitHub
2. Importar el repo
3. Configurar:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend/packages/web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### Variables de entorno en Vercel
```
VITE_API_URL=https://tu-backend.railway.app
```

### Costo: $0 (plan Hobby gratuito)

---

## 3. Base de Datos (Supabase - alternativa)

Si prefieres Supabase en lugar de Railway PostgreSQL:

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

- **Gratuito**: usar subdominios de Railway/Vercel
  - `searchpet.railway.app`
  - `searchpet.vercel.app`

- **Propio** (~$10/año):
  - Comprar en Namecheap/Cloudflare
  - Configurar DNS en Vercel/Railway

---

## Resumen de Costos

| Servicio | Proveedor | Costo |
|----------|-----------|-------|
| Backend | Railway | $0 |
| Web | Vercel | $0 |
| BD | Railway/Supabase | $0 |
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
