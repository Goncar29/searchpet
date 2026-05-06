# 🐾 Lost Pets - Encuentra a tu mascota

Aplicación de causa social para ayudar a encontrar mascotas perdidas.
**Sin monetización** — 100% enfocada en ayudar.

---

## 🏗️ Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Mobile** | React Native + Expo |
| **Web** | React + Vite |
| **Backend** | Go + Gin |
| **Base de datos** | PostgreSQL 15 + PostGIS |
| **Imágenes** | Cloudinary |
| **Push** | Firebase Cloud Messaging |
| **Auth** | JWT |

---

## 📁 Estructura del Proyecto

```
lost-pets-project/
├── backend/                          # Go API
│   ├── cmd/server/main.go           # Punto de entrada
│   ├── config/                      # Configuración
│   ├── internal/
│   │   ├── domain/                  # Modelos/Entidades
│   │   ├── repository/             # Acceso a datos (interfaces + impl)
│   │   ├── service/                # Lógica de negocio
│   │   ├── handler/                # HTTP handlers
│   │   ├── dto/                    # Request/Response objects
│   │   ├── middleware/             # Auth, CORS, Logger
│   │   └── event/                  # Event Bus (Observer Pattern)
│   ├── pkg/                        # Paquetes reutilizables
│   │   ├── database/              # Conexión PostgreSQL
│   │   ├── jwt/                   # Generación/validación JWT
│   │   ├── storage/               # Cloudinary
│   │   └── notification/          # Firebase
│   ├── Dockerfile
│   └── go.mod
│
├── frontend/
│   ├── packages/
│   │   ├── mobile/                # React Native (Expo)
│   │   ├── web/                   # React (Vite)
│   │   └── shared/                # Código compartido (TypeScript)
│   │       ├── api/              # Cliente HTTP
│   │       ├── types/            # Interfaces TypeScript
│   │       ├── hooks/            # Custom hooks
│   │       └── utils/            # Utilidades
│
└── docker-compose.yml              # Dev environment
```

---

## 🏛️ Arquitectura: Clean Architecture

```
Handler (HTTP) → Service (Lógica) → Repository (BD) → Model (Entidad)
```

### Patrones de diseño aplicados:
- **Clean Architecture** — Separación por capas
- **Repository Pattern** — Abstracción de datos con interfaces
- **Dependency Injection** — Desacoplamiento en main.go
- **DTO Pattern** — Separar modelos de BD de API
- **Observer/EventBus** — Eventos desacoplados (notificaciones, badges)
- **Strategy Pattern** — Búsqueda flexible (PostGIS, texto, IA)
- **Middleware Pattern** — Auth, CORS, Rate Limiting
- **Singleton** — DB connection, Firebase, Cloudinary

---

## 🚀 Inicio Rápido

### Prerrequisitos
- Go 1.22+
- Docker + Docker Compose
- Node.js 18+ (para frontend)

### 1. Clonar el repo
```bash
git clone https://github.com/tu-usuario/lost-pets.git
cd lost-pets
```

### 2. Levantar servicios con Docker
```bash
docker-compose up -d
```
Esto levanta PostgreSQL + PostGIS en `localhost:5432`

### 3. Configurar backend
```bash
cd backend
cp .env.example .env
# Editar .env con tus valores
go run ./cmd/server
```

### 4. Probar la API
```bash
# Registrar usuario
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456","name":"Test User"}'

# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}'

# Crear mascota (con token)
curl -X POST http://localhost:8080/api/pets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <tu-token>" \
  -d '{"name":"Max","type":"perro","breed":"Labrador","color":"dorado"}'
```

---

## 📡 API Endpoints

### Públicos
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar usuario |
| POST | `/api/auth/login` | Iniciar sesión |
| GET | `/api/stats` | Estadísticas públicas |
| GET | `/api/share/pet/:token` | Ver mascota compartida |

### Protegidos (JWT)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/pets` | Crear mascota |
| GET | `/api/pets/mine` | Mis mascotas |
| GET | `/api/pets/:id` | Detalle de mascota |
| PUT | `/api/pets/:id` | Actualizar mascota |
| DELETE | `/api/pets/:id` | Eliminar mascota |
| GET | `/api/pets/search` | Buscar mascotas |
| POST | `/api/reports` | Crear reporte |
| GET | `/api/reports/nearby` | Reportes cercanos |
| GET | `/api/reports/pet/:petId` | Reportes de mascota |
| POST | `/api/share/generate/:petId` | Generar link |
| POST | `/api/messages` | Enviar mensaje |
| GET | `/api/messages/:userId` | Conversación |

---

## 🗄️ Base de Datos (16 tablas)

**Core:** users, pets, reports, photos, messages, favorites
**Social:** share_links
**Alerts:** location_alerts
**Gamification:** badges, user_points
**Community:** local_groups, group_members, success_stories
**Security:** blocked_users, reports_abuse, shelters

---

## 🤝 Contribuir

Este es un proyecto de causa social. ¡Toda ayuda es bienvenida!

1. Fork el repositorio
2. Crea tu rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Agregar funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

---

## 📋 Roadmap

- [x] MVP: Publicar, mapa, chat, compartir
- [ ] V1.1: Volantes PDF, QR, plantillas WhatsApp
- [ ] V1.2: Filtros avanzados, alertas, búsqueda IA
- [ ] V1.3: Verificación, grupos locales, historias éxito
- [ ] V1.4: Badges, puntos, leaderboard
- [ ] V2.0: Refugios API, veterinarias, SMS, multi-idioma
- [ ] V2.1: Directorio refugios, estadísticas impacto

---

## 📄 Licencia

MIT License — Libre para usar y contribuir.

---

**Hecho con ❤️ para ayudar a encontrar mascotas perdidas**
