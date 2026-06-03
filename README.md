# SearchPet — Encuentra a tu mascota

Aplicación de causa social para ayudar a encontrar mascotas perdidas.
**Sin monetización** — 100% enfocada en ayudar.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Mobile** | React Native + Expo 52 |
| **Web** | React + Vite + Tailwind CSS |
| **Backend** | Go 1.22 + Gin |
| **Base de datos** | PostgreSQL 15 + PostGIS |
| **Migraciones** | golang-migrate (SQL) + GORM AutoMigrate |
| **Imágenes** | Cloudinary (signed URLs) |
| **Push** | Firebase Cloud Messaging |
| **Auth** | JWT |
| **Real-time** | WebSocket (Hub propio) |
| **Logging** | Zap (structured) |
| **Package manager** | pnpm 10 |

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
│   ├── ci.yml                       # CI: backend tests + web build + mobile tests
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

- Go 1.22+
- Docker + Docker Compose
- Node.js 24+ (LTS)
- pnpm 10+ (`npm install -g pnpm`)

### 1. Clonar el repo

```bash
git clone https://github.com/Goncar29/searchpet.git
cd searchpet
```

### 2. Levantar servicios con Docker

```bash
docker-compose up -d
```

Levanta PostgreSQL + PostGIS en `localhost:5432`.

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
| GET | `/api/stats` | Estadísticas públicas |
| GET | `/api/pets/search` | Buscar mascotas |
| GET | `/api/pets/:id` | Detalle de mascota |
| GET | `/api/pets/:id/photos` | Fotos de mascota |
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
| POST | `/api/verification/send-email` | Enviar código de verificación email |
| POST | `/api/verification/confirm-email` | Confirmar email |

### Admin

| Método | Ruta | Descripción |
|--------|------|-------------|
| PATCH | `/api/admin/stories/:id/featured` | Destacar historia |
| POST | `/api/groups` | Crear grupo local |
| GET | `/api/abuse-reports` | Ver reportes de abuso |
| PATCH | `/api/admin/abuse-reports/:id/resolve` | Resolver reporte de abuso |
| PATCH | `/api/admin/reports/:id/verify` | Verificar reporte |

---

## Base de Datos (16 tablas)

**Core:** `users`, `pets`, `reports`, `photos`, `messages`, `favorites`  
**Social:** `share_links`, `local_groups`, `group_members`, `success_stories`  
**Alerts:** `location_alerts`  
**Gamification:** `badges`, `user_points`  
**Security:** `blocked_users`, `abuse_reports`  
**Infra:** `shelters`

---

## CI/CD

| Job | Trigger | Qué hace |
|-----|---------|---------|
| `backend-test` | push/PR | `go test ./...` + `go build` con PostgreSQL real |
| `frontend-web` | push/PR | `pnpm audit` + `vitest` + `tsc && vite build` |
| `mobile-test` | push/PR | `jest` con `jest-expo` |
| `deploy-backend` | push a main | Trigger deploy en Render |
| `build-apk` | tag `v*` | Gradle build → GitHub Release |

---

## Roadmap

- [x] MVP: publicar mascotas, mapa, chat, compartir QR
- [x] Real-time: WebSocket con ticket de autenticación
- [x] Infra: SQL migrations, signed URLs, zap logging, FCM gating
- [x] Distribución: APK directo + PWA instalable (sin stores)
- [x] V1.1: volantes PDF, QR code, plantillas WhatsApp, timeline de reportes
- [x] V1.2: filtros avanzados, alertas geográficas, push en reporte cercano
- [x] V1.3: verificación usuarios (email/SMS), grupos locales, historias de éxito, bloqueos
- [x] V1.4: puntos, leaderboard, perfiles públicos, reseñas
- [ ] Pending: badges auto-grant, Redis rate limiting, E2E tests, búsqueda IA server-side
- [ ] V2.0: veterinarias cercanas, multi-SMS alertas, directorio refugios UI

---

## Contribuir

1. Fork el repositorio
2. Creá tu rama (`git checkout -b feature/nombre`)
3. Commit con conventional commits (`feat:`, `fix:`, `docs:`, etc.)
4. Push + Pull Request a `main`

---

**Hecho con ❤️ para ayudar a encontrar mascotas perdidas**
