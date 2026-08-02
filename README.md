# SearchPet — Encuentra a tu mascota

Aplicación de causa social para ayudar a encontrar mascotas perdidas.
**Sin monetización** — 100% enfocada en ayudar.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Mobile** | React Native + Expo 52 |
| **Web** | React + Vite + Tailwind CSS |
| **Backend** | Go 1.25 + Gin |
| **Base de datos** | PostgreSQL 15 + PostGIS |
| **Migraciones** | golang-migrate (SQL) + GORM AutoMigrate |
| **Imágenes** | Cloudinary (signed URLs) |
| **Push** | Firebase Cloud Messaging |
| **Email** | Brevo (OTP de verificación y recuperación) |
| **Auth** | JWT + Google Sign-In (web y Android) |
| **Búsqueda por imagen** | pgvector + Jina CLIP (`jina-clip-v2`) |
| **Rate limiting** | In-memory o Redis (pluggable) |
| **Real-time** | WebSocket (Hub propio) |
| **Logging** | Zap (structured) |
| **Package manager** | pnpm 11 |

---

## Estructura del Proyecto

```
searchpet/
├── backend/
│   ├── cmd/server/main.go           # Punto de entrada + DI
│   ├── config/                      # Variables de entorno
│   ├── internal/
│   │   ├── domain/                  # Modelos + errores de dominio
│   │   ├── repository/              # Interfaces + implementaciones (GORM)
│   │   ├── service/                 # Lógica de negocio
│   │   ├── handler/                 # HTTP handlers (Gin)
│   │   ├── dto/                     # Request/Response objects
│   │   ├── middleware/              # Auth JWT, CORS, Rate Limit, Logger
│   │   ├── event/                   # Event Bus (Observer Pattern)
│   │   └── websocket/               # Hub + TicketStore + PresenceChecker
│   ├── migrations/                  # SQL migrations (golang-migrate)
│   ├── pkg/
│   │   ├── database/               # Conexión PostgreSQL
│   │   ├── jwt/                    # Generación/validación JWT
│   │   ├── logger/                 # Zap singleton
│   │   ├── storage/                # Cloudinary
│   │   └── notification/           # Firebase FCM
│   ├── tests/                      # Tests de integración + unit tests
│   ├── .env.example
│   ├── Dockerfile
│   └── go.mod
│
├── frontend/
│   └── packages/
│       ├── mobile/                  # React Native (Expo)
│       ├── web/                     # React (Vite)
│       └── shared/                  # Código compartido (TypeScript)
│           ├── api/                 # Cliente HTTP
│           ├── types/               # Interfaces TypeScript
│           ├── hooks/               # Custom hooks (React Query)
│           └── utils/               # Utilidades
│
├── .github/workflows/
│   ├── ci.yml                       # CI: backend + web + mobile tests, e2e, deploy Render
│   └── build-apk.yml               # APK build + GitHub Release (tags v*)
│
└── docker-compose.yml               # Dev environment (PostgreSQL + PostGIS)
```

---

## Arquitectura: Clean Architecture

```
Handler (HTTP/WS) → Service (Lógica) → Repository (BD) → Domain (Entidad)
```

### Patrones aplicados

- **Clean Architecture** — separación por capas, dependencias hacia adentro
- **Repository Pattern** — abstracción de datos con interfaces
- **Dependency Injection** — desacoplamiento en `main.go`
- **DTO Pattern** — modelos de BD separados de la API
- **Observer / EventBus** — notificaciones y badges desacoplados
- **WebSocket Hub** — canal broadcast con ticket de autenticación
- **Middleware Pattern** — Auth, CORS, Rate Limiting, Zap Logger
- **Singleton** — DB, Firebase, Cloudinary, Logger

---

## Inicio Rápido

### Prerrequisitos

- Go 1.25+ (ver `backend/go.mod`)
- Docker + Docker Compose
- Node.js 24+ (LTS)
- pnpm 11+ (`npm install -g pnpm`)

### 1. Clonar el repo

```bash
git clone https://github.com/Goncar29/searchpet.git
cd searchpet
```

### 2. Levantar servicios con Docker

```bash
docker-compose up -d
```

Levanta PostgreSQL + PostGIS en `localhost:5433` (el contenedor escucha en 5432; el
puerto publicado en tu máquina es **5433**, para no chocar con un Postgres local).

### 3. Configurar backend

```bash
cd backend
cp .env.example .env
# Editar .env con tus valores (ver .env.example para descripción de cada variable)
go run ./cmd/server
```

### 4. Frontend web

```bash
cd frontend/packages/web
pnpm install
pnpm run dev
```

### 5. Frontend mobile

```bash
cd frontend/packages/mobile
pnpm install
pnpm start
```

---

## API Endpoints

### Públicos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/ws` | Conexión WebSocket |
| POST | `/api/auth/register` | Registrar usuario |
| POST | `/api/auth/login` | Iniciar sesión |
| POST | `/api/auth/google` | Login/alta con Google (ID token verificado server-side) |
| POST | `/api/auth/password/forgot` | Pedir OTP de recuperación (siempre 200, anti-enumeración) |
| POST | `/api/auth/password/reset` | Canjear el OTP por una contraseña nueva |
| GET | `/api/stats` | Estadísticas públicas |
| GET | `/api/pets/search` | Buscar mascotas |
| GET | `/api/pets/:id` | Detalle de mascota |
| GET | `/api/pets/:id/photos` | Fotos de mascota |
| GET | `/api/adoptions` | Mascotas en adopción |
| GET | `/api/vets/nearby` | Veterinarias cercanas (PostGIS, datos de OpenStreetMap) |
| GET | `/api/reports/nearby` | Reportes cercanos (PostGIS) |
| GET | `/api/reports/pet/:petId` | Reportes de una mascota |
| GET | `/api/reports/:id` | Detalle de reporte |
| GET | `/api/share/pet/:token` | Ver mascota compartida |
| POST | `/api/share/pet/:token/contact` | Registrar contacto vía QR |
| GET | `/api/shelters` | Listar refugios |
| GET | `/api/shelters/:id` | Detalle de refugio |
| GET | `/api/users/:id/profile` | Perfil público |
| GET | `/api/leaderboard` | Leaderboard |
| GET | `/api/users/:id/reviews` | Reseñas de usuario |
| GET | `/api/groups` | Listar grupos locales |
| GET | `/api/groups/:id` | Detalle de grupo |
| GET | `/api/groups/:id/members` | Miembros del grupo |

### Protegidos (JWT)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/auth/me` | Perfil propio |
| PUT | `/api/auth/me` | Actualizar perfil |
| POST | `/api/auth/me/photo` | Subir foto de perfil |
| PUT | `/api/users/me/preferences` | Actualizar preferencias |
| POST | `/api/pets` | Crear mascota |
| GET | `/api/pets/mine` | Mis mascotas |
| PUT | `/api/pets/:id` | Actualizar mascota |
| DELETE | `/api/pets/:id` | Eliminar mascota |
| PATCH | `/api/pets/:id/found` | Marcar como encontrada |
| POST | `/api/pets/:id/publish-lost` | Publicar una mascota registrada como perdida |
| POST | `/api/pets/search/image` | Búsqueda por imagen (pgvector + CLIP) |
| POST | `/api/pets/:id/photos` | Subir foto de mascota |
| DELETE | `/api/pets/:id/photos/:photoId` | Eliminar foto |
| POST | `/api/reports` | Crear reporte |
| POST | `/api/messages` | Enviar mensaje |
| GET | `/api/messages` | Listar conversaciones |
| GET | `/api/messages/:userId` | Conversación con usuario |
| PATCH | `/api/messages/:id/read` | Marcar mensajes como leídos |
| GET | `/api/messages/photo-url/:messageId` | URL firmada de foto en mensaje |
| POST | `/api/ws/ticket` | Obtener ticket WebSocket |
| POST | `/api/share/generate/:petId` | Generar link compartible |
| POST | `/api/devices/token` | Registrar token FCM |
| DELETE | `/api/devices/:token` | Eliminar token FCM |
| POST | `/api/alerts` | Crear alerta de zona |
| GET | `/api/alerts` | Mis alertas |
| PUT | `/api/alerts/:id` | Actualizar alerta |
| DELETE | `/api/alerts/:id` | Eliminar alerta |
| POST | `/api/users/:id/block` | Bloquear usuario |
| DELETE | `/api/users/:id/block` | Desbloquear usuario |
| GET | `/api/users/blocked` | Usuarios bloqueados |
| POST | `/api/stories` | Publicar historia de éxito |
| GET | `/api/stories` | Listar historias |
| POST | `/api/stories/:id/like` | Dar like a historia |
| POST | `/api/groups/:id/join` | Unirse a grupo |
| DELETE | `/api/groups/:id/leave` | Salir de grupo |
| GET | `/api/users/me/badges` | Mis badges |
| POST | `/api/users/:id/reviews` | Reseñar a usuario |
| POST | `/api/verification/send-email` | Enviar código de verificación email (5/min por IP + cupo diario) |
| POST | `/api/verification/confirm-email` | Confirmar email |
| GET | `/api/verification/status` | Estado de verificación de la cuenta |
| GET | `/api/foster-homes` | Listar casas de acogida |
| POST | `/api/foster-homes` | Registrar casa de acogida propia |

### Admin

| Método | Ruta | Descripción |
|--------|------|-------------|
| PATCH | `/api/admin/stories/:id/featured` | Destacar historia |
| POST | `/api/groups` | Crear grupo local |
| GET | `/api/abuse-reports` | Ver reportes de abuso |
| PATCH | `/api/admin/abuse-reports/:id/resolve` | Resolver reporte de abuso |
| PATCH | `/api/admin/reports/:id/verify` | Verificar reporte |
| PATCH | `/api/admin/users/:id/ban` | Banear / desbanear usuario |
| POST | `/api/admin/users/admin-role` | Otorgar o revocar admin por email (auditado) |
| GET | `/api/admin/role-changes` | Historial de cambios de rol |
| GET | `/api/stats/impact/monthly` | Métricas de impacto mensuales |
| GET | `/api/foster-homes/pending` | Cola de moderación de casas de acogida |
| GET | `/api/admin/shelters/pending` | Cola de moderación de refugios |

> Esta tabla es un resumen, no un inventario. La fuente de verdad es
> `backend/internal/app/router.go`.

---

## Base de Datos (29 tablas)

**Core:** `users`, `pets`, `reports`, `photos`, `messages`, `search_episodes`, `platform_events`  
**Social:** `share_links`, `local_groups`, `group_members`, `success_stories`, `story_likes`, `user_reviews`  
**Alerts:** `location_alerts`, `device_tokens`  
**Gamification:** `badges`, `user_points`  
**Security:** `blocked_users`, `report_abuses`, `verification_tokens`, `admin_audit_logs`, `conversation_hides`  
**Refugios y acogida:** `shelters`, `foster_homes`, `foster_home_photos`, `foster_home_moderation_logs`, `foster_home_change_logs`  
**Infra:** `vets` (PostGIS, importadas de OpenStreetMap)  
**IA:** `pet_embeddings` (pgvector, solo via migración SQL — no AutoMigrate)

> La lista canónica de los 28 modelos que pasan por AutoMigrate es
> `backend/pkg/database/postgres.go` → `var Models`. `pet_embeddings` es la
> excepción deliberada: su tabla la crea sólo la migración `000009`. Un modelo
> que falte en ese slice es una tabla que **nunca se crea en producción**.

---

## CI/CD

| Job | Trigger | Qué hace |
|-----|---------|---------|
| `backend-test` | push a main/develop, **todo PR** | `go test ./...` + `go build` con PostgreSQL real |
| `frontend-web` | push a main/develop, **todo PR** | `pnpm audit` + `vitest` + `tsc && vite build` |
| `mobile-test` | push a main/develop, **todo PR** | `jest` con `jest-expo` |
| `e2e-web` | push a main, **todo PR** | Playwright + Go flow tests contra backend real |
| `deploy-backend` | push a main | Trigger deploy en Render, tras los 4 jobs |
| `build-apk` | tag `v*` | Gradle build → GitHub Release |

**El trigger `pull_request` no filtra por rama base a propósito.** Con
`branches: [main]`, un PR stackeado sobre otra rama no ejecutaba un solo job y
los únicos checks verdes eran los de Vercel, que sólo dicen que el preview
deployó — se lee como "suite verde" sin serlo. Listar las ramas base a mano
tampoco sirve: hay que acordarse por cada stack, y olvidarse falla en silencio.

El deploy no corre riesgo por eso: `deploy-backend` exige
`github.ref == 'refs/heads/main'`, y en un evento `pull_request` ese ref es
`refs/pull/<n>/merge`. Además depende de los cuatro jobs de test, así que un
rojo en cualquiera frena el deploy a producción.

---

## Roadmap

- [x] MVP: publicar mascotas, mapa, chat, compartir QR
- [x] Real-time: WebSocket con ticket de autenticación
- [x] Infra: SQL migrations, signed URLs, zap logging, FCM gating
- [x] Distribución: APK directo + PWA instalable (sin stores)
- [x] V1.1: volantes PDF, QR code, plantillas WhatsApp, timeline de reportes
- [x] V1.2: filtros avanzados, alertas geográficas, push en reporte cercano
- [x] V1.3: verificación de usuarios por email, grupos locales, historias de éxito, bloqueos
- [x] V1.4: puntos, leaderboard, perfiles públicos, reseñas
- [x] Redis rate limiting, E2E tests (Playwright + Go), búsqueda IA server-side (pgvector + CLIP), UI refugios
- [x] Multi-idioma (es, en, pt) en mobile + web
- [x] V2.0: veterinarias cercanas (OpenStreetMap + PostGIS), Google Sign-In (web + Android)
- [x] Casas de acogida con flujo de moderación
- [x] Recuperación de contraseña por OTP, con cupo diario por cuenta y por canal
- [ ] Analytics dashboard público (hoy sólo existe la versión admin)

**No va a haber notificaciones por SMS.** Se retiraron del roadmap: mandar SMS
cuesta plata por mensaje y el proyecto es $0/mes sin excepciones. Las alertas de
ubicación viajan por push (FCM, gratis e ilimitado), que cubre el caso de uso.
La verificación por SMS también se quitó, y con ella la única dependencia paga
que tenía el proyecto.

---

## Contribuir

1. Fork el repositorio
2. Creá tu rama (`git checkout -b feature/nombre`)
3. Commit con conventional commits (`feat:`, `fix:`, `docs:`, etc.)
4. Push + Pull Request a `main`

---

**Hecho con ❤️ para ayudar a encontrar mascotas perdidas**
