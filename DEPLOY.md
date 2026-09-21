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
# La base NO es de Render — es Neon. Ver la sección 3.
DATABASE_URL=<connection string de Neon, host DIRECTO, sslmode=require>
JWT_SECRET=<generar un secret fuerte>
# APP_URL debe ser el dominio del FRONTEND (Vercel), NO el del backend.
# Los share links se arman como APP_URL/share/:token y ese path lo sirve la
# función serverless de Vercel (api/share.js), que emite los OG tags (preview
# con foto de la mascota). Si apunta a onrender.com, el crawler recibe un 404
# sin OG tags y el preview sale vacío.
APP_URL=https://searchpet.vercel.app
CORS_ALLOWED_ORIGINS=https://searchpet.vercel.app
CLOUDINARY_CLOUD_NAME=<tu cloud name>
CLOUDINARY_API_KEY=<tu api key>
CLOUDINARY_API_SECRET=<tu api secret>
FIREBASE_KEY=<tu key JSON de Firebase>
# Email (OTP de verificación y de recuperación de contraseña)
BREVO_API_KEY=<API key xkeysib-..., NO una SMTP key>
MAIL_FROM_EMAIL=<el single sender verificado en Brevo>
# Búsqueda por imagen
JINA_API_KEY=<key del free tier de Jina>
# Google Sign-In (web y Android comparten el client id WEB como audiencia)
GOOGLE_CLIENT_ID=<client id web de Google Cloud>
# Opcionales / gateados — ver docs/github-secrets.md
OPS_STATUS_TOKEN=<gatea GET /api/ops/quota; vacía = 404 a todo>
REDIS_URL=<sólo si corrés múltiples instancias; ver sección 8>
```

**Si `BREVO_API_KEY` o `MAIL_FROM_EMAIL` faltan, el mailer cae en un noop
silencioso** y el OTP no se envía nunca, sin ningún error visible. Fue un bug
real en producción.

### Trigger de deploy (CI)

El workflow `ci.yml` dispara el deploy hook de Render al pushear a `main`,
**después** de que pasen los cuatro jobs de test.

**El Auto-Deploy por commit del servicio está APAGADO a propósito**
(`autoDeployTrigger: "off"`), y el sentido importa: se apaga el autoDeploy y se
conserva el hook, nunca al revés. El hook corre después de los tests; el
autoDeploy por commit no espera nada. Con los dos prendidos, cada push
deployaba **dos veces** y el segundo deploy pisaba al primero.

> El MCP de Render no expone cambiar `autoDeploy` de un servicio existente —
> hay que ir al dashboard.

### Costo: $0 (plan free)

El servicio free se duerme tras 15 minutos de inactividad. Lo mantiene despierto
un monitor de UptimeRobot que pega a `/health` cada 300 s.

> **No uses un cron de GitHub Actions para esto.** Se probó: `*/5` disparaba
> cada **29,7 min en promedio, con huecos de hasta 49,7** — todos por encima del
> spin-down de 15 min, o sea que no evitaba un solo cold start. El workflow se
> borró en el PR #172.

---

## 1.b Monitoreo — y por qué el intervalo NO es libre

Hay dos endpoints de salud y son **deliberadamente distintos**:

| Ruta | Qué responde | Para qué |
|------|--------------|----------|
| `GET /health` | 200 siempre, sin tocar ninguna dependencia | ¿El proceso está vivo? |
| `GET /health/ready` | `SELECT 1` con timeout de 2 s; **503** si la base no contesta | ¿La base contesta? |

**No las fusiones.** Juntarlas destruye la distinción entre "el proceso murió" y
"la base no contesta", que son dos fallas con respuestas opuestas. Hay un test
e2e que lo obliga (`TestHealthReady_HealthSigueTontoConLaBaseCaida`).

**El intervalo del poll lo fija el presupuesto de compute, no las ganas de
enterarte rápido.** Neon cobra por **tiempo despierto**: cada consulta despierta
el compute y lo sostiene 5 minutos más. Un monitor cada 300 s mantiene la base
despierta 24/7 y funde la cuota mensual sin un solo usuario — pasó de verdad en
agosto de 2026, con dos monitores consumiendo el 98% del mes.

Los tres monitores que tocan la base corren a **21600 s (6 h)**. El precio está
pagado a conciencia: **detectar una base caída puede tardar hasta 6 horas.**

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

## 3. Base de Datos (Neon) ← PRODUCCIÓN ACTUAL

**La base NO está en Render.** Se migró a [Neon](https://neon.tech) el
2026-06-16, y el motivo es terminante: **la PostgreSQL free de Render se
suspende a los 30 días.** La de Neon no expira.

### Setup

1. Crear proyecto en Neon (trae PostGIS y pgvector disponibles).
2. Copiar el connection string.
3. Pegarlo como `DATABASE_URL` en el Web Service de Render.

Las extensiones y el schema **no se crean a mano**: el backend los arma solo al
deployar (AutoMigrate + migraciones SQL, que incluyen PostGIS, pgvector y el
seed de refugios).

### El formato del `DATABASE_URL` no es negociable

Tiene que usar el host **directo** (sin `-pooler`), `sslmode=require` y **SIN**
`channel_binding`:

```
postgres://<user>:<pass>@ep-xxxx.<region>.aws.neon.tech/<db>?sslmode=require
```

**Por qué tanta precisión:** el backend usa **dos drivers sobre la misma URL**.
GORM en runtime (`pgx/v5`) tolera cualquier variante, pero golang-migrate
(`lib/pq`) rompe con el pooler PgBouncer por los advisory locks **y** rechaza
`channel_binding`. Con la URL equivocada, el servidor no arranca.

### Neon es el techo del proyecto, y cobra por TIEMPO DESPIERTO

El free da **100 CU-hours por proyecto**, que a 0,25 CU (el mínimo) son **400
horas de compute** contra las ~730 que tiene un mes. O sea: **la base no puede
estar despierta todo el mes.** Autosuspende a los 5 minutos de inactividad.

La consecuencia es contraintuitiva y conviene entenderla antes de tocar nada:
dos visitantes simultáneos cuestan lo mismo que uno, y una visita sola cuesta 5
minutos enteros aunque dure 20 segundos. **La concentración es gratis; la
dispersión es la que mata.**

Cuando entre tráfico real, la palanca para subir el techo **no es optimizar
queries: es reducir las horas en que la base está despierta.**

### Costo: $0 (free, no expira)

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

## 6. Mobile App — el APK lo construye GitHub Actions, NO EAS

**No se publica en Play Store ni App Store.** La distribución es el APK directo
(más la PWA instalable desde la web).

| Camino | Quién lo construye | Para qué |
|--------|-------------------|----------|
| **Release** | `build-apk.yml` en GitHub Actions: `expo prebuild` + `./gradlew assembleRelease`, firmado con el keystore del secret | El APK que se distribuye |
| **Dev build** | EAS (`eas build --profile development`) | Desarrollo con dev client |

Se dispara pusheando un tag `v*`, y publica el APK en una GitHub Release.

### Tres consecuencias de que sea así

1. **Toda variable `EXPO_PUBLIC_*` que necesite el APK distribuido va en
   `build-apk.yml`.** Ponerla sólo en `eas.json` no alcanza.
2. **Hay dos keystores distintos**, y cada uno necesita su propio OAuth client
   de Android en Google Cloud con package `com.searchpet.app`: el de
   development (EAS) y el de production (CI).
3. **El keystore de release existe sólo dentro de un secret de GitHub**, que no
   se puede leer de vuelta. Si se pierde, la app nunca más se actualiza con la
   misma firma.

Los secrets están documentados en [`docs/github-secrets.md`](docs/github-secrets.md).

### Dev builds: las `EXPO_PUBLIC_*` salen del `.env` local

Un build con `developmentClient: true` **no empaqueta el JS** — lo sirve Metro
desde tu máquina, así que babel lee `mobile/.env` al bundlear. El bloque `env`
del perfil `development` en `eas.json` sólo afecta la cáscara nativa.

Si probás en el celular y la app le pega a la API equivocada, mirá el `.env`, no
`eas.json`. Y en un device `localhost` es el celular: para un backend local va
la IP de LAN.

### La config del build nativo va en `app.json`, nunca parcheada en el workflow

Si te ves escribiendo un `sed` sobre un archivo que generó `expo prebuild`,
pará: hay un config plugin que lo hace bien. Un `sed` en `build-apk.yml` sólo
corre en CI, así que el pipeline del APK compila y EAS no — y nadie se entera.

Para verificar antes de encolar un build (30 segundos contra ~50 min de cola):

```bash
npx expo prebuild --platform android --clean --no-install
# y leer android/gradle.properties y android/build.gradle
```

### Costo: $0 (GitHub Actions free en repo público; EAS free: 30 builds/mes)

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

| Servicio | Proveedor | Plan | Límite real |
|----------|-----------|------|-------------|
| Backend | **Render** | Free | 750 instance-hours **por workspace**, duerme a los 15 min |
| BD + PostGIS + pgvector | **Neon** | Free | **100 CU-hours** — el techo del proyecto |
| Web | Vercel | Hobby | Ilimitado |
| Imágenes | Cloudinary | Free | 25 créditos/mes; el cuello es **bandwidth**, no uploads |
| Email (OTP) | Brevo | Free | **300 mails/día**, repartidos entre dos canales |
| Push | Firebase FCM | Spark | Ilimitado |
| Búsqueda por imagen | Jina AI | Free | 10M tokens |
| APK release | GitHub Actions | Free | 2000 min/mes (repo público) |
| Dev builds | Expo EAS | Free | 30 builds/mes |
| **Total** | | | **$0/mes** |

**El que se agota primero es Neon**, y no por tráfico sino por horas despierto —
ver la sección 3. Cloudinary dejó de ser el techo cuando todos los consumidores
pasaron a pedir miniaturas: una sesión bajó de ~4,3 MB a ~647 KB, o sea de ~165
a ~1.100 sesiones/día.

> **Sin monetización, sin excepciones.** Es lo que sacó a Twilio del proyecto:
> el SMS cuesta plata por mensaje, así que se quitó entero (alertas **y** OTP) y
> la verificación quedó sólo por email. Las alertas de ubicación viajan por push,
> que es gratis e ilimitado.

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
