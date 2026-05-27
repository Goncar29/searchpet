# Guía de Go — SearchPet Backend

Una guía práctica y pedagógica de cómo funciona Go en este proyecto. Diseñada para alguien que viene de JavaScript y quiere entender Go de verdad, no solo copiar código.

---

## Tabla de contenidos — Parte 1: Arquitectura

1. [Conceptos clave de Go que vas a ver acá](#1-conceptos-clave-de-go-que-vas-a-ver-acá)
2. [Cómo está organizado el proyecto](#2-cómo-está-organizado-el-proyecto)
3. [El ciclo de vida de un request](#3-el-ciclo-de-vida-de-un-request)
4. [Capa por capa: Domain → Repository → Service → Handler](#4-capa-por-capa)
5. [Dependency Injection manual](#5-dependency-injection-manual)
6. [Config y variables de entorno](#6-config-y-variables-de-entorno)
7. [Middleware](#7-middleware)
8. [Event Bus](#8-event-bus)
9. [Paquetes de soporte (pkg/)](#9-paquetes-de-soporte-pkg)
10. [Errores en Go](#10-errores-en-go)
11. [Tabla de rutas](#11-tabla-de-rutas)

---

## 1. Conceptos clave de Go que vas a ver acá

### Structs (las "clases" de Go)

Go no tiene clases. En cambio usa `struct` — una colección de campos tipados. Es lo más cercano a un objeto.

```go
// Esto es como un objeto en JS, pero tipado y sin métodos propios (todavía)
type Pet struct {
    ID      uuid.UUID
    Name    string
    Status  string
}
```

### Métodos sobre structs

Los métodos no van adentro del struct, van afuera con un "receiver":

```go
// En JS: class PetService { createPet() {} }
// En Go: la función "pertenece" a petService con un receiver
func (s *petService) CreatePet(ownerID string) (*domain.Pet, error) {
    // s es el equivalente al "this" de JS
}
```

El `*` antes de `petService` significa que es un **puntero** (ver más abajo).

### Interfaces

Una interface define QUÉ puede hacer algo, no CÓMO. En Go las interfaces se satisfacen **implícitamente** — no hay `implements`.

```go
// Cualquier cosa que tenga estos métodos ES un PetRepository, automáticamente
type PetRepository interface {
    Create(pet *domain.Pet) error
    FindByID(id string) (*domain.Pet, error)
}
```

Esto es la base del dependency injection en Go.

### Punteros (`*` y `&`)

Go te obliga a pensar en si pasás una copia o una referencia.

```go
pet := domain.Pet{Name: "Rex"}  // valor (copia)
ptr := &pet                      // puntero (referencia a pet)

// Con * accedés al valor apuntado
fmt.Println(*ptr) // imprime pet
```

En este proyecto vas a ver `*domain.Pet` por todos lados — significa "puntero a un Pet". Se usa porque:
- Podés devolver `nil` cuando algo no se encontró
- No copiás toda la estructura en cada función call

### Error handling

Go no tiene try/catch. Las funciones devuelven errores como segundo valor:

```go
pet, err := repo.FindByID(id)
if err != nil {
    // Algo salió mal — manejalo acá
    return nil, err
}
// Si llegamos acá, pet es válido
```

### Packages

Todo archivo Go pertenece a un package. El nombre del package va al principio del archivo:

```go
package handler
```

Para usar código de otro package:

```go
import "searchpet/internal/domain"

// Después usás domain.Pet, domain.ErrNotFound, etc.
```

---

## 2. Cómo está organizado el proyecto

```
backend/
├── cmd/server/
│   └── main.go              # Punto de entrada — arranca todo
├── config/
│   └── config.go            # Lee variables de entorno
├── internal/                # Código privado de la app (Go no te deja importarlo desde afuera)
│   ├── domain/              # Las entidades y errores del negocio
│   │   ├── models.go        # Pet, User, Report, Message, etc.
│   │   └── errors.go        # ErrPetNotFound, ErrForbidden, etc.
│   ├── dto/                 # Lo que el frontend recibe/envía (no los models directos)
│   ├── handler/             # Recibe HTTP requests, llama al service
│   ├── service/             # Lógica de negocio — el corazón
│   ├── repository/          # Habla con la base de datos
│   ├── middleware/          # Intercepta requests (auth, CORS)
│   └── event/               # Sistema de eventos interno
├── pkg/                     # Utilidades reutilizables
│   ├── database/            # Conexión PostgreSQL
│   ├── jwt/                 # Crear y validar tokens
│   ├── notification/        # Firebase FCM
│   └── storage/             # Cloudinary (fotos)
├── go.mod                   # Como package.json — lista dependencias
└── go.sum                   # Como package-lock.json — checksums exactos
```

### La regla del `internal/`

En Go, todo lo que está en `internal/` **solo puede ser importado por código del mismo módulo**. Es una restricción del compilador, no una convención. Protege la implementación de ser usada desde afuera.

---

## 3. El ciclo de vida de un request

Tomemos `POST /api/pets` como ejemplo:

```
1. Cliente HTTP envía: POST /api/pets + { name: "Rex", type: "perro" }

2. Gin Router recibe el request
      ↓
3. Middleware Auth
   - Lee el header "Authorization: Bearer <token>"
   - Valida el JWT con pkg/jwt
   - Guarda userID en el contexto de Gin
      ↓
4. PetHandler.CreatePet(c *gin.Context)
   - Lee userID del contexto
   - Parsea el JSON del body a CreatePetRequest
   - Llama a petService.CreatePet(userID, req)
      ↓
5. petService.CreatePet()
   - Valida y construye un domain.Pet
   - Llama a petRepo.Create(pet)
      ↓
6. PostgresPetRepository.Create(pet)
   - Ejecuta INSERT en PostgreSQL via GORM
      ↓
7. La respuesta sube por las capas:
   - repo devuelve *domain.Pet (o error)
   - service devuelve *domain.Pet (o error)
   - handler convierte a DTO con dto.ToPetResponse(pet)
   - handler responde: c.JSON(201, petResponse)

8. Cliente recibe: 201 Created + { id: "...", name: "Rex", ... }
```

Cada capa **solo conoce la de abajo** — el handler no sabe de SQL, el repo no sabe de HTTP.

---

## 4. Capa por capa

### Domain — `internal/domain/`

Las entidades del negocio. No dependen de nada (ni de la DB, ni de HTTP). Son el vocabulario del sistema.

```go
// internal/domain/models.go
type Pet struct {
    ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    OwnerID     uuid.UUID `gorm:"type:uuid;not null;index" json:"owner_id"`
    Name        string    `gorm:"not null;size:100" json:"name"`
    Type        string    `gorm:"not null;size:50" json:"type"`
    Status      string    `gorm:"size:50;default:'active';index" json:"status"`
    CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`

    // Relaciones — GORM las popula con Preload()
    Owner   User     `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
    Photos  []Photo  `gorm:"foreignKey:PetID" json:"photos,omitempty"`
}
```

Las tags `` `gorm:"..."` `` le dicen a GORM cómo mapear a SQL. Las tags `` `json:"..."` `` controlan la serialización a JSON.

Los errores del dominio están en `errors.go`:

```go
// internal/domain/errors.go
var (
    ErrPetNotFound = errors.New("mascota no encontrada")
    ErrForbidden   = errors.New("no autorizado para esta acción")
    ErrInvalidInput = errors.New("datos inválidos")
)
```

---

### Repository — `internal/repository/`

**Interface** (el contrato, qué puede hacer):

```go
// internal/repository/interfaces.go
type PetRepository interface {
    Create(pet *domain.Pet) error
    FindByID(id string) (*domain.Pet, error)
    FindByOwnerID(ownerID string) ([]domain.Pet, error)
    Update(pet *domain.Pet) error
    Delete(id string) error
}
```

**Implementación** (el cómo — habla con PostgreSQL):

```go
// internal/repository/pet_repository.go
type PostgresPetRepository struct {
    db *gorm.DB
}

func NewPetRepository(db *gorm.DB) PetRepository {
    return &PostgresPetRepository{db: db}
}

func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
    var pet domain.Pet
    err := r.db.Preload("Owner").Preload("Photos").
        Where("id = ?", id).
        First(&pet).Error

    if err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, domain.ErrPetNotFound  // Convierte el error de GORM a error de dominio
        }
        return nil, err
    }
    return &pet, nil
}
```

> **Por qué interfaces?** El service usa `PetRepository` (la interface), no `PostgresPetRepository` (la implementación). Esto permite testear con un mock sin tocar la DB real.

---

### Service — `internal/service/`

Contiene la lógica de negocio. Recibe requests, valida, llama al repo.

```go
// internal/service/pet_service.go
type petService struct {
    repo repository.PetRepository  // Interface, no la implementación concreta
}

func NewPetService(repo repository.PetRepository) PetService {
    return &petService{repo: repo}
}

// CreatePetRequest — lo que el frontend envía
type CreatePetRequest struct {
    Name        string `json:"name" binding:"required"`
    Type        string `json:"type" binding:"required"`
    Breed       string `json:"breed"`
    Description string `json:"description"`
}

func (s *petService) CreatePet(ownerID string, req CreatePetRequest) (*domain.Pet, error) {
    ownerUUID, err := uuid.Parse(ownerID)
    if err != nil {
        return nil, domain.ErrInvalidInput
    }

    pet := &domain.Pet{
        OwnerID: ownerUUID,
        Name:    req.Name,
        Type:    req.Type,
        Breed:   req.Breed,
        Status:  "active",
    }

    if err := s.repo.Create(pet); err != nil {
        return nil, err
    }

    return s.repo.FindByID(pet.ID.String())  // Devuelve el pet con datos completos
}
```

---

### Handler — `internal/handler/`

Traduce entre HTTP y el mundo Go. Solo sabe de: contexto Gin, DTOs, y el service.

```go
// internal/handler/pet_handler.go
type PetHandler struct {
    petService service.PetService
}

func NewPetHandler(petService service.PetService) *PetHandler {
    return &PetHandler{petService: petService}
}

func (h *PetHandler) CreatePet(c *gin.Context) {
    // 1. Obtener el userID del contexto (lo puso el middleware Auth)
    ownerID := getUserID(c)

    // 2. Parsear el body JSON
    var req service.CreatePetRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return  // En Go no hay early return automático — hay que hacerlo explícito
    }

    // 3. Llamar al service
    pet, err := h.petService.CreatePet(ownerID, req)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
        return
    }

    // 4. Responder con DTO (no el modelo de dominio directamente)
    c.JSON(http.StatusCreated, dto.ToPetResponse(pet))
}
```

### DTO — `internal/dto/`

Los DTOs controlan qué campos llegan al cliente. Evitás exponer campos internos o sensibles.

```go
// internal/dto/pet_dto.go
type PetResponse struct {
    ID          uuid.UUID `json:"id"`
    Name        string    `json:"name"`
    Type        string    `json:"type"`
    Status      string    `json:"status"`
    // No incluye campos internos como deleted_at, etc.
}

func ToPetResponse(pet *domain.Pet) PetResponse {
    return PetResponse{
        ID:     pet.ID,
        Name:   pet.Name,
        Type:   pet.Type,
        Status: pet.Status,
    }
}
```

---

## 5. Dependency Injection manual

En `cmd/server/main.go` todo se conecta. Go no tiene un framework de DI — se hace a mano, de abajo hacia arriba:

```go
func main() {
    // 1. Config
    cfg := config.Load()

    // 2. Infraestructura
    db, _ := database.Connect(cfg.DatabaseURL)
    bus := event.NewEventBus()

    // 3. Repositories (necesitan db)
    petRepo     := repository.NewPetRepository(db)
    userRepo    := repository.NewUserRepository(db)
    messageRepo := repository.NewMessageRepository(db)
    // ... más repos

    // 4. Services (necesitan repos y/o bus)
    petService     := service.NewPetService(petRepo)
    authService    := service.NewAuthService(userRepo, cfg.JWTSecret)
    messageService := service.NewMessageService(messageRepo, bus)

    // NotificationService escucha el bus y manda push notifications
    notifService := service.NewNotificationService(bus, firebaseClient, deviceTokenRepo)
    notifService.Subscribe()

    // 5. Handlers (necesitan services)
    petHandler  := handler.NewPetHandler(petService)
    authHandler := handler.NewAuthHandler(authService)

    // 6. Router
    r := gin.Default()
    r.Use(middleware.CORS())

    public := r.Group("/api")
    {
        public.GET("/pets/:id", petHandler.GetPet)
        public.POST("/auth/register", authHandler.Register)
        public.POST("/auth/login", authHandler.Login)
    }

    protected := r.Group("/api")
    protected.Use(middleware.Auth(cfg.JWTSecret))
    {
        protected.POST("/pets", petHandler.CreatePet)
        protected.GET("/pets/mine", petHandler.GetMyPets)
    }

    r.Run(":" + cfg.Port)
}
```

Todo el grafo de dependencias se ensambla acá. Cada constructor recibe lo que necesita — ninguna capa busca sus dependencias sola.

---

## 6. Config y variables de entorno

```go
// config/config.go
type Config struct {
    Port                string
    DatabaseURL         string
    JWTSecret           string
    CloudinaryCloudName string
    CloudinaryAPIKey    string
    CloudinaryAPISecret string
    FirebaseKey         string
    AppURL              string
    Environment         string
}

func Load() *Config {
    godotenv.Load()  // Lee .env si existe, sino usa variables del sistema

    return &Config{
        Port:        getEnv("PORT", "8080"),  // Segundo arg = valor por defecto
        DatabaseURL: getEnv("DATABASE_URL", "postgres://..."),
        JWTSecret:   getEnv("JWT_SECRET", "change-in-production"),
        // ...
    }
}
```

El archivo `.env` va en gitignore. `.env.example` existe como plantilla:

```
PORT=8080
ENVIRONMENT=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/searchpet?sslmode=disable
JWT_SECRET=dev-secret-change-in-production
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
FIREBASE_KEY=
APP_URL=http://localhost:8080
```

---

## 7. Middleware

Un middleware en Gin es una función que intercepta el request antes (o después) de que llegue al handler.

### Auth middleware

```go
// internal/middleware/auth.go
func Auth(secretKey string) gin.HandlerFunc {
    return func(c *gin.Context) {
        // 1. Leer el token del header
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.AbortWithStatusJSON(401, gin.H{"error": "token requerido"})
            return  // c.Abort() corta la cadena — el handler no se ejecuta
        }

        // "Bearer <token>" → ["Bearer", "<token>"]
        parts := strings.SplitN(authHeader, " ", 2)
        if len(parts) != 2 || parts[0] != "Bearer" {
            c.AbortWithStatusJSON(401, gin.H{"error": "formato inválido"})
            return
        }

        // 2. Validar el JWT
        userID, err := jwt.ValidateToken(parts[1], secretKey)
        if err != nil {
            c.AbortWithStatusJSON(401, gin.H{"error": "token inválido"})
            return
        }

        // 3. Guardar el userID en el contexto para los handlers
        c.Set("userID", userID)

        // 4. Continuar con el siguiente handler
        c.Next()
    }
}
```

En los handlers, el userID se recupera así:

```go
// internal/handler/helpers.go
func getUserID(c *gin.Context) string {
    return c.GetString("userID")
}
```

---

## 8. Event Bus

El Event Bus es un sistema de pub/sub **in-process** (no necesita Kafka ni RabbitMQ). Permite desacoplar código: el ReportService no necesita saber nada de NotificationService.

```go
// internal/event/event_bus.go

// Nombres de eventos — constantes para no typosear strings
const (
    EventReportCreated = "report.created"
    EventMessageSent   = "message.sent"
)

// Payloads — qué datos viajan con cada evento
type ReportCreatedEvent struct {
    ReportID string
    PetID    string
    UserID   string
    Lat, Lng float64
}

// Publish — dispara el evento a todos los subscribers (en goroutines separadas)
func (eb *EventBus) Publish(event string, payload interface{}) {
    eb.mu.RLock()
    handlers := eb.subscribers[event]
    eb.mu.RUnlock()

    for _, h := range handlers {
        h := h  // importante: captura la variable para la goroutine
        go func() {
            defer func() { recover() }()  // no crashea el server si un handler falla
            h(payload)
        }()
    }
}
```

Cómo se usa:

```go
// En report_service.go — publica el evento
bus.Publish(event.EventReportCreated, event.ReportCreatedEvent{
    ReportID: report.ID.String(),
    PetID:    report.PetID.String(),
})

// En notification_service.go — escucha y manda push
func (s *notificationService) Subscribe() {
    s.bus.Subscribe(event.EventReportCreated, func(payload interface{}) {
        evt := payload.(event.ReportCreatedEvent)
        s.sendPushToOwner(evt.PetID)
    })
}
```

---

## 9. Paquetes de soporte (pkg/)

Wrappers sobre librerías externas. Cada uno encapsula la complejidad de la librería.

### JWT (`pkg/jwt/`)

```go
// Crear token al hacer login
token, err := jwt.CreateToken(userID.String(), secretKey)

// Validar token en el middleware
userID, err := jwt.ValidateToken(tokenString, secretKey)
```

### Database (`pkg/database/`)

```go
db, err := database.Connect(cfg.DatabaseURL)
// Internamente: abre conexión GORM + corre AutoMigrate con todos los modelos
```

### Storage — Cloudinary (`pkg/storage/`)

```go
client := storage.NewCloudinaryClient(cloudName, apiKey, apiSecret)
url, err := client.Upload(ctx, fileData, "pets")
```

### Notifications — Firebase (`pkg/notification/`)

```go
client := notification.NewFirebaseClient(ctx, credentialsJSON)
err := client.Send(ctx, deviceToken, title, body)
```

---

## 10. Errores en Go

### El patrón básico

```go
// Las funciones devuelven (resultado, error)
pet, err := service.CreatePet(ownerID, req)
if err != nil {
    // Manejo de error
    return nil, err  // propagar, o
    // c.JSON(500, ...)  // responder al cliente
}
// Si llegamos acá, pet es válido
```

### Errores centinela

En este proyecto, los errores de dominio son variables globales que podés comparar:

```go
// internal/domain/errors.go
var ErrPetNotFound = errors.New("mascota no encontrada")

// En el handler
if errors.Is(err, domain.ErrPetNotFound) {
    c.JSON(404, gin.H{"error": "mascota no encontrada"})
    return
}
```

### Wrap de errores

Para agregar contexto sin perder el error original:

```go
return nil, fmt.Errorf("error conectando a PostgreSQL: %w", err)
//                                                        ^ wrap — %w en vez de %s
```

---

## 11. Tabla de rutas

### Rutas públicas (sin auth)

| Método | Ruta | Handler |
|--------|------|---------|
| `POST` | `/api/auth/register` | AuthHandler.Register |
| `POST` | `/api/auth/login` | AuthHandler.Login |
| `GET` | `/api/pets/:id` | PetHandler.GetPet |
| `GET` | `/api/reports/nearby` | ReportHandler.GetNearbyReports |
| `GET` | `/api/reports/:id` | ReportHandler.GetReport |
| `GET` | `/api/share/:token` | ShareHandler.GetByToken |
| `GET` | `/api/shelters` | ShelterHandler.List |
| `GET` | `/api/shelters/:id` | ShelterHandler.GetByID |
| `GET` | `/api/stats` | StatsHandler.GetStats |

### Rutas protegidas (requieren JWT)

| Método | Ruta | Handler |
|--------|------|---------|
| `GET` | `/api/auth/me` | AuthHandler.Me |
| `POST` | `/api/pets` | PetHandler.CreatePet |
| `GET` | `/api/pets/mine` | PetHandler.GetMyPets |
| `PUT` | `/api/pets/:id` | PetHandler.UpdatePet |
| `DELETE` | `/api/pets/:id` | PetHandler.DeletePet |
| `POST` | `/api/reports` | ReportHandler.CreateReport |
| `POST` | `/api/pets/:petId/photos` | PhotoHandler.UploadPhoto |
| `POST` | `/api/messages` | MessageHandler.SendMessage |
| `GET` | `/api/messages` | MessageHandler.GetConversations |
| `GET` | `/api/messages/:userId` | MessageHandler.GetMessages |
| `PATCH` | `/api/messages/:id/read` | MessageHandler.MarkAsRead |
| `POST` | `/api/share/:petId` | ShareHandler.CreateShareLink |
| `POST` | `/api/devices/token` | DeviceHandler.RegisterToken |

---

## Resumen — El flujo completo en una línea

```
Request → Router → [Middleware] → Handler → Service → Repository → PostgreSQL
                                     ↓          ↓
                                    DTO      EventBus → NotificationService → Firebase
```

Cada capa tiene una responsabilidad única. Cada dependencia se inyecta por constructor. Cada error se devuelve como valor — nunca se esconde.

Eso es Go.

---
---

# Parte 2: El lenguaje Go para novatos

Una introducción al lenguaje Go desde cero, con cada ejemplo sacado del código real de este proyecto. Si venís de JavaScript, vas a ver las diferencias marcadas explícitamente.

---

## Tabla de contenidos — Parte 2

1. [El archivo Go — estructura básica](#p2-1-el-archivo-go)
2. [Variables](#p2-2-variables)
3. [Tipos de datos básicos](#p2-3-tipos-de-datos-básicos)
4. [Zero values — el valor por defecto](#p2-4-zero-values)
5. [Constantes](#p2-5-constantes)
6. [Punteros](#p2-6-punteros)
7. [Structs](#p2-7-structs)
8. [Struct tags](#p2-8-struct-tags)
9. [Slices (los arrays de Go)](#p2-9-slices)
10. [Maps](#p2-10-maps)
11. [Funciones](#p2-11-funciones)
12. [Métodos y receivers](#p2-12-métodos-y-receivers)
13. [Interfaces](#p2-13-interfaces)
14. [Control de flujo](#p2-14-control-de-flujo)
15. [Error handling](#p2-15-error-handling)
16. [defer](#p2-16-defer)
17. [Goroutines y concurrencia básica](#p2-17-goroutines-y-concurrencia-básica)
18. [Packages e imports](#p2-18-packages-e-imports)
19. [Type assertions](#p2-19-type-assertions)
20. [Nil en Go](#p2-20-nil-en-go)

---

## P2-1. El archivo Go

Todo archivo Go tiene esta estructura. Sin excepciones.

```go
package handler          // 1. A qué package pertenece este archivo

import (                 // 2. Qué packages externos usa
    "net/http"
    "github.com/gin-gonic/gin"
    "lost-pets/internal/domain"
)

// 3. El código — funciones, tipos, variables
type PetHandler struct {
    petService service.PetService
}
```

**Diferencia con JS**: En Go no hay `export`. Lo que empieza con **mayúscula** es público (`PetHandler`, `CreatePet`). Lo que empieza con **minúscula** es privado al package (`petService`, `getUserID`). El compilador lo enforcea — no es una convención, es una regla.

```go
// Público — visible desde otros packages
type PetHandler struct { ... }
func (h *PetHandler) CreatePet(c *gin.Context) { ... }

// Privado — solo visible dentro del package handler
type petService struct { ... }
func getUserID(c *gin.Context) string { ... }
```

En el proyecto lo ves constantemente:
- `domain.Pet` → struct público, cualquier package lo puede usar
- `petService` → struct privado, solo el package `service` lo conoce
- `NewPetService()` → función pública que devuelve la interface (no el struct privado)

---

## P2-2. Variables

Go tiene dos formas de declarar variables. Ambas las vas a ver en el proyecto.

### Forma larga — `var`

```go
// var nombre tipo = valor
var port string = "8080"
var count int = 0
var found bool = false

// Sin valor inicial — Go asigna el zero value del tipo
var name string   // "" (string vacío)
var age  int      // 0
var active bool   // false
```

### Forma corta — `:=` (la más común)

```go
// nombre := valor  — Go infiere el tipo automáticamente
port := "8080"
count := 0
found := false

// Con funciones que devuelven valores
pet, err := repo.FindByID(id)
cfg := config.Load()
```

**La diferencia clave**: `:=` solo funciona **dentro de funciones**. Para variables a nivel de package hay que usar `var`.

```go
// ✅ A nivel de package — var obligatorio
var ErrPetNotFound = errors.New("mascota no encontrada")

// ✅ Dentro de una función — := preferido
func (s *petService) CreatePet(ownerID string, req CreatePetRequest) (*domain.Pet, error) {
    ownerUUID, err := uuid.Parse(ownerID)  // := acá
    pet := &domain.Pet{ ... }              // := acá también
}
```

### Múltiples variables a la vez

```go
// Declarar varias juntas con var
var (
    ErrPetNotFound    = errors.New("mascota no encontrada")
    ErrForbidden      = errors.New("acceso prohibido")
    ErrInvalidInput   = errors.New("datos inválidos")
)
```

Exactamente como lo hace `internal/domain/errors.go` — todas las variables de error en un bloque `var (...)`.

### Descarte con `_`

Cuando una función devuelve algo que no necesitás, usás `_` para ignorarlo:

```go
// NewFavoriteRepository devuelve el repo pero acá no lo usamos
_ = repository.NewFavoriteRepository(db)

// En JWT, ignoramos el token completo y solo queremos el userID
userID, _ := jwt.ValidateToken(tokenString, secretKey)
// ⚠️ Cuidado: ignorar el error así es casi siempre un error de diseño
```

---

## P2-3. Tipos de datos básicos

### Tipos numéricos

```go
// Enteros
var i int     = 42      // tamaño depende de la plataforma (64-bit en sistemas modernos)
var i8 int8   = 127     // -128 a 127
var i64 int64 = 9999999 // útil para IDs grandes, timestamps

// Enteros sin signo (solo positivos)
var u uint   = 100
var u32 uint32 = 65535

// Punto flotante
var lat float64 = -34.603722   // usado en Report.Latitude
var lng float32 = -58.381592   // menos precisión, menos memoria
```

En este proyecto:

```go
// internal/domain/models.go
type User struct {
    Latitude  *float64 `gorm:"type:decimal(10,8)" json:"latitude,omitempty"`
    Longitude *float64 `gorm:"type:decimal(11,8)" json:"longitude,omitempty"`
}

type Report struct {
    Latitude  float64 `gorm:"type:decimal(10,8);not null" json:"latitude"`
    Longitude float64 `gorm:"type:decimal(11,8);not null" json:"longitude"`
}
```

`float64` para coordenadas GPS porque necesitás 8 decimales de precisión (~1mm exactitud).

### Strings

```go
var name string = "Rex"
name := "Rex"

// Concatenar
greeting := "Hola, " + name

// Longitud (en bytes, no caracteres — importante con UTF-8)
len("Rex")   // 3
len("Ñoño")  // 6 (ñ ocupa 2 bytes en UTF-8)

// Strings son inmutables — no podés hacer name[0] = 'r'
```

En el proyecto los strings son ubicuos — IDs, nombres, emails, URLs:

```go
type Pet struct {
    Name        string `gorm:"not null;size:100" json:"name"`
    Type        string `gorm:"not null;size:50" json:"type"`   // "perro", "gato"
    Status      string `gorm:"size:50;default:'active'" json:"status"`
}
```

### Booleanos

```go
var isVerified bool = false
active := true

// Operadores: && (AND), || (OR), ! (NOT)
if pet.IsVerified && !user.IsBanned {
    // ...
}
```

En el proyecto:

```go
type User struct {
    IsVerified bool `gorm:"default:false" json:"is_verified"`
    IsBanned   bool `gorm:"default:false" json:"is_banned"`
}

type Message struct {
    IsRead bool `gorm:"default:false;index" json:"is_read"`
}
```

### byte y rune

```go
var b byte = 'A'    // byte = uint8 — un byte individual
var r rune = 'Ñ'    // rune = int32 — un carácter Unicode completo
```

Los vas a ver poco en el proyecto directamente, pero los usás implícitamente al trabajar con strings.

---

## P2-4. Zero values

Esta es una de las cosas más importantes de Go y menos obvia si venís de JS.

En Go, **toda variable tiene un valor por defecto** cuando se declara sin inicializar. No existe el `undefined`. No existe el "variable declarada pero sin valor".

| Tipo | Zero value |
|------|------------|
| `int`, `int64`, `float64` | `0` |
| `string` | `""` (string vacío) |
| `bool` | `false` |
| `*T` (puntero) | `nil` |
| `[]T` (slice) | `nil` |
| `map[K]V` | `nil` |
| `interface{}` | `nil` |
| `struct` | todos sus campos en zero value |

En el proyecto, GORM aprovecha los zero values de Go para los defaults de la DB:

```go
type Pet struct {
    Status string `gorm:"size:50;default:'active'"` // default en DB
}

// Cuando hacés:
pet := &domain.Pet{
    Name: "Rex",
    // Status no se inicializa — queda ""
}
// PERO GORM usa el default de la DB al insertar, así que en DB queda "active"
```

```go
// En GetMyPets — si no hay mascotas, pets es nil (zero value de []domain.Pet)
func (r *PostgresPetRepository) FindByOwnerID(ownerID string) ([]domain.Pet, error) {
    var pets []domain.Pet  // pets = nil acá
    err := r.db.Find(&pets).Error
    return pets, err       // si no hay resultados, devuelve slice vacío, no nil
}
```

---

## P2-5. Constantes

Las constantes son valores que no cambian en tiempo de compilación.

```go
// Constante simple
const tokenDuration = 72 * time.Hour  // pkg/jwt/jwt.go

// Grupo de constantes — como un enum de JS
const (
    EventReportCreated = "report.created"   // internal/event/event_bus.go
    EventMessageSent   = "message.sent"
)
```

**Diferencia con variables**: las constantes se evalúan en tiempo de compilación. No podés usar funciones en su valor. Son inmutables — el compilador te lo impide.

```go
// ✅ Válido
const maxFileSize = 5 * 1024 * 1024  // 5 MB en bytes

// ❌ No válido — uuid.New() es una función, no se puede usar en const
const defaultID = uuid.New()  // ERROR de compilación
```

---

## P2-6. Punteros

Los punteros son probablemente lo más confuso para alguien que viene de JS. Pero en Go son esenciales.

### El concepto

Cuando declarás una variable, Go la guarda en algún lugar de la memoria. Un **puntero** es simplemente la **dirección de memoria** de esa variable.

```go
name := "Rex"       // Variable con valor "Rex"
ptr := &name        // ptr tiene la DIRECCIÓN de name (no el valor)

fmt.Println(name)   // "Rex"   — el valor
fmt.Println(ptr)    // 0xc000... — la dirección de memoria
fmt.Println(*ptr)   // "Rex"   — el valor al que apunta ptr (dereference)

*ptr = "Max"        // Cambiás el valor original a través del puntero
fmt.Println(name)   // "Max"   — name cambió!
```

### `&` y `*`

| Símbolo | Qué hace | Ejemplo |
|---------|----------|---------|
| `&x` | Devuelve la **dirección** de x | `ptr := &pet` |
| `*T` | Tipo "puntero a T" | `func foo(p *domain.Pet)` |
| `*p` | Accede al **valor** que apunta p | `fmt.Println(*ptr)` |

### Por qué usamos punteros en este proyecto

**1. Para poder devolver `nil`** cuando algo no existe:

```go
// Sin puntero — tendrías que devolver un Pet vacío, no hay forma de indicar "no existe"
func FindByID(id string) (domain.Pet, error) { ... }

// Con puntero — nil significa "no encontré nada"
func FindByID(id string) (*domain.Pet, error) {
    // ...
    if notFound {
        return nil, domain.ErrPetNotFound
    }
    return &pet, nil
}
```

**2. Para no copiar structs grandes** en cada llamada:

```go
// ❌ Copia todo el struct Pet (varios campos) en cada llamada
func (s *petService) CreatePet(req CreatePetRequest) (domain.Pet, error)

// ✅ Pasa solo la dirección (8 bytes en 64-bit), no el struct completo
func (s *petService) CreatePet(req CreatePetRequest) (*domain.Pet, error)
```

**3. Para que los métodos puedan modificar el struct:**

```go
// Sin puntero — trabaja con una COPIA del struct, los cambios no persisten
func (s petService) CreatePet() { s.repo = nil  // solo modifica la copia }

// Con puntero — trabaja con el struct REAL, los cambios persisten
func (s *petService) CreatePet() { s.repo = nil  // modifica el original }
```

### Punteros opcionales en models

En el proyecto, los campos opcionales usan `*tipo` para poder ser `nil`:

```go
type Pet struct {
    MicrochipID *string    `json:"microchip_id,omitempty"` // puede no tener microchip
}

type User struct {
    Latitude  *float64    `json:"latitude,omitempty"` // puede no tener ubicación
    Longitude *float64    `json:"longitude,omitempty"`
}

type Report struct {
    VerifiedBy  *uuid.UUID  `json:"verified_by,omitempty"` // puede no estar verificado
    VerifiedAt  *time.Time  `json:"verified_at,omitempty"`
}
```

`*string` = "puede ser un string o nil". `string` = "siempre tiene un valor".

---

## P2-7. Structs

Un struct es una colección de campos con nombre y tipo. Es la forma de Go de agrupar datos relacionados.

### Declaración

```go
type Pet struct {
    ID      uuid.UUID
    Name    string
    Type    string
    Status  string
}
```

### Instanciar un struct

```go
// Con nombres de campo (recomendado — order-independent)
pet := domain.Pet{
    Name:   "Rex",
    Type:   "perro",
    Status: "active",
}

// Con puntero — &Pet{} crea el struct y devuelve su dirección
pet := &domain.Pet{
    Name: "Rex",
}

// Struct vacío — todos los campos en zero value
var pet domain.Pet  // pet.Name = "", pet.Status = "", etc.
```

### Acceder a campos

```go
pet := &domain.Pet{Name: "Rex"}

// Con variable normal
fmt.Println(pet.Name)    // "Rex"

// Con puntero — Go desreferencia automáticamente
fmt.Println(pet.Name)    // "Rex"  (Go hace (*pet).Name automáticamente)
```

### Structs anidados — Embedding

En el proyecto, `Claims` del JWT embebe `jwt.RegisteredClaims`:

```go
// pkg/jwt/jwt.go
type Claims struct {
    UserID uuid.UUID `json:"user_id"`
    jwt.RegisteredClaims   // ← embedding — hereda todos los campos y métodos
}

// Podés acceder a los campos del embedded struct directamente:
claims.ExpiresAt   // campo de RegisteredClaims
claims.UserID      // campo propio de Claims
```

---

## P2-8. Struct tags

Las struct tags son metadata que vas a ver en TODO el proyecto. Son strings entre backticks que van al lado de cada campo.

```go
type Pet struct {
    ID   uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    Name string    `gorm:"not null;size:100" json:"name"`
}
```

### Tag `json:"..."`

Le dice al encoder JSON cómo serializar/deserializar ese campo:

```go
Name string `json:"name"`           // campo JSON se llama "name" (snake_case)
Name string `json:"name,omitempty"` // omite el campo si está vacío
Pass string `json:"-"`              // NUNCA incluir en JSON (contraseñas, etc.)
```

En el proyecto:

```go
type User struct {
    PasswordHash string `gorm:"not null" json:"-"`           // nunca llega al frontend
    Phone        string `gorm:"size:20" json:"phone,omitempty"` // solo si tiene valor
}
```

### Tag `gorm:"..."`

Le dice a GORM cómo mapear el campo a la base de datos:

```go
ID      uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
// type:uuid         → columna de tipo UUID en PostgreSQL
// primaryKey        → es la clave primaria
// default:gen_...   → PostgreSQL genera el UUID automáticamente

OwnerID uuid.UUID `gorm:"type:uuid;not null;index"`
// not null          → constraint NOT NULL en la DB
// index             → crea un índice para búsquedas rápidas

Status  string    `gorm:"size:50;default:'active';index"`
// size:50           → VARCHAR(50) en la DB
// default:'active'  → valor por defecto al insertar

Owner   User      `gorm:"foreignKey:OwnerID"`
// foreignKey:OwnerID → relación: Pet.OwnerID apunta a User.ID
```

### Tag `binding:"..."`

Usado en los DTOs de requests para validación automática de Gin:

```go
type CreatePetRequest struct {
    Name string `json:"name" binding:"required"`  // Gin devuelve 400 si falta
    Type string `json:"type" binding:"required"`
}
```

---

## P2-9. Slices

Los slices son los arrays dinámicos de Go. Son lo que más vas a usar para colecciones.

### Declaración

```go
// Slice vacío (nil)
var pets []domain.Pet

// Slice vacío pero inicializado (len=0, cap=0)
pets := []domain.Pet{}

// Slice con valores iniciales
types := []string{"perro", "gato", "pajaro", "otro"}

// make — crear slice con longitud y capacidad
pets := make([]domain.Pet, 0, 10)  // vacío, pre-allocado para 10 elementos
```

### Operaciones básicas

```go
pets := []string{"Rex", "Luna"}

// Agregar — append siempre devuelve un NUEVO slice
pets = append(pets, "Max")      // ["Rex", "Luna", "Max"]

// Longitud
len(pets)  // 3

// Acceso por índice
pets[0]    // "Rex"
pets[1]    // "Luna"

// Slice de un slice (sub-slice)
pets[1:]   // ["Luna", "Max"]
pets[:2]   // ["Rex", "Luna"]
```

### En el proyecto

```go
// internal/repository/pet_repository.go
func (r *PostgresPetRepository) FindByOwnerID(ownerID string) ([]domain.Pet, error) {
    var pets []domain.Pet          // slice vacío para GORM
    err := r.db.
        Preload("Owner").
        Preload("Photos").
        Where("owner_id = ?", ownerID).
        Order("created_at DESC").
        Find(&pets).Error           // GORM llena el slice
    return pets, err
}

// internal/domain/models.go — relaciones one-to-many
type Pet struct {
    Photos  []Photo  `gorm:"foreignKey:PetID"`   // slice de fotos
    Reports []Report `gorm:"foreignKey:PetID"`   // slice de reportes
}
```

### Iterar con for range

```go
pets := []domain.Pet{ ... }

for i, pet := range pets {
    fmt.Println(i, pet.Name)  // i = índice, pet = valor
}

// Si no necesitás el índice
for _, pet := range pets {
    fmt.Println(pet.Name)
}

// Si solo necesitás el índice
for i := range pets {
    fmt.Println(i)
}
```

---

## P2-10. Maps

Un map es una colección de pares clave → valor. Como un objeto de JS, pero con tipos estrictos.

```go
// map[TipoClave]TipoValor
subscribers := map[string][]func(interface{}){}
//             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ clave=string, valor=slice de funciones

// Inicializar con make
m := make(map[string]int)

// Insertar
m["perros"] = 5
m["gatos"] = 3

// Leer
count := m["perros"]  // 5

// Verificar si existe
count, exists := m["pájaros"]
if !exists {
    fmt.Println("no hay pájaros")
}

// Eliminar
delete(m, "gatos")
```

En el proyecto, el EventBus usa un map para registrar los subscribers:

```go
// internal/event/event_bus.go
type EventBus struct {
    subscribers map[string][]func(interface{})
    //           ^^^^^^  ^^^^^^^^^^^^^^^^^^^^
    //           evento  lista de handlers para ese evento
}

// Agregar un subscriber
eb.subscribers[event] = append(eb.subscribers[event], handler)

// Leer subscribers de un evento
handlers := eb.subscribers[event]
```

---

## P2-11. Funciones

### Declaración básica

```go
// func nombre(params) tipoDeRetorno { ... }
func getEnv(key string, fallback string) string {
    // ...
    return fallback
}
```

### Múltiples valores de retorno

Esta es una de las features más características de Go. Una función puede devolver varios valores. Lo ves **en todos lados** en el proyecto:

```go
// Devuelve (*domain.Pet, error) — dos valores
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
    var pet domain.Pet
    err := r.db.Where("id = ?", id).First(&pet).Error
    if err != nil {
        return nil, domain.ErrPetNotFound   // dos valores en cada return
    }
    return &pet, nil                         // dos valores en cada return
}

// El caller recibe los dos valores
pet, err := repo.FindByID("123")
if err != nil {
    // manejar error
}
```

**Diferencia con JS**: En JS manejás errores con try/catch o Promise rejection. En Go, el error es un valor más — tenés que chequearlo explícitamente. El compilador te avisa si ignorás un valor de retorno.

### Funciones como valores (first-class)

En Go las funciones son valores — las podés pasar como argumento o guardar en variables:

```go
// internal/event/event_bus.go
// handler es una FUNCIÓN que recibe interface{} y no devuelve nada
func (eb *EventBus) Subscribe(event string, handler func(interface{})) {
    eb.subscribers[event] = append(eb.subscribers[event], handler)
}

// Pasar una función como argumento — es una función anónima (closure)
bus.Subscribe(event.EventReportCreated, func(payload interface{}) {
    evt := payload.(event.ReportCreatedEvent)
    fmt.Println("Nuevo reporte:", evt.ReportID)
})
```

### Funciones anónimas y closures

```go
// Función anónima asignada a variable
greet := func(name string) string {
    return "Hola, " + name
}
greet("Rex")  // "Hola, Rex"

// Goroutine con función anónima — muy común en el EventBus
go func() {
    defer func() { recover() }()
    handler(payload)
}()
```

Un **closure** es una función anónima que captura variables del scope exterior:

```go
// internal/event/event_bus.go
for _, h := range handlers {
    h := h  // ← IMPORTANTE: captura h en una variable nueva para la goroutine
    go func() {
        h(payload)  // h es una variable capturada (closure)
    }()
}
// Sin la re-declaración 'h := h', todas las goroutines compartirían
// la misma variable h del loop, que cambia en cada iteración.
```

### Funciones que devuelven funciones

El middleware de Gin usa este patrón — una función que devuelve otra función:

```go
// internal/middleware/auth.go
// Auth() devuelve un gin.HandlerFunc (que es func(*gin.Context))
func Auth(secretKey string) gin.HandlerFunc {
    return func(c *gin.Context) {       // ← la función que realmente maneja requests
        // secretKey está capturado del scope exterior (closure)
        userID, err := jwt.ValidateToken(parts[1], secretKey)
        // ...
    }
}

// En main.go, se llama Auth() para obtener el handler
protected.Use(middleware.Auth(cfg.JWTSecret))
```

---

## P2-12. Métodos y receivers

Un método es una función con un receptor — la forma en que Go asocia funciones a tipos.

### Receiver por puntero vs por valor

```go
// Receiver por VALOR — trabaja con una copia del struct
func (s petService) GetName() string {
    return "service"
    // s es una copia — cualquier cambio a s se descarta al salir
}

// Receiver por PUNTERO — trabaja con el struct real
func (s *petService) CreatePet(ownerID string, req CreatePetRequest) (*domain.Pet, error) {
    // s es el struct real — los cambios persisten
    return s.repo.Create(...)
}
```

**Regla del proyecto**: casi todos los métodos usan receiver por puntero (`*petService`, `*PetHandler`, `*EventBus`). Esto es el estándar en Go cuando:
- El struct tiene estado que puede cambiar
- El struct es grande (evita copias)
- Querés consistencia (mezclar value/pointer receivers en el mismo tipo genera warnings)

### Cómo se ven en el proyecto

```go
// internal/handler/pet_handler.go — receiver *PetHandler
func (h *PetHandler) CreatePet(c *gin.Context) { ... }
func (h *PetHandler) GetPet(c *gin.Context) { ... }
func (h *PetHandler) UpdatePet(c *gin.Context) { ... }

// internal/repository/pet_repository.go — receiver *PostgresPetRepository
func (r *PostgresPetRepository) Create(pet *domain.Pet) error { ... }
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) { ... }

// internal/event/event_bus.go — receiver *EventBus
func (eb *EventBus) Subscribe(event string, handler func(interface{})) { ... }
func (eb *EventBus) Publish(event string, payload interface{}) { ... }
```

---

## P2-13. Interfaces

Una interface define un **contrato** — qué métodos tiene que implementar un tipo. No hay `implements`. Si un tipo tiene los métodos, satisface la interface automáticamente.

### Declaración

```go
// internal/repository/interfaces.go
type PetRepository interface {
    Create(pet *domain.Pet) error
    FindByID(id string) (*domain.Pet, error)
    FindByOwnerID(ownerID string) ([]domain.Pet, error)
    Update(pet *domain.Pet) error
    Delete(id string) error
}
```

### Satisfacción implícita

`PostgresPetRepository` satisface `PetRepository` porque tiene todos esos métodos:

```go
type PostgresPetRepository struct { db *gorm.DB }

func (r *PostgresPetRepository) Create(pet *domain.Pet) error { ... }
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) { ... }
func (r *PostgresPetRepository) FindByOwnerID(ownerID string) ([]domain.Pet, error) { ... }
func (r *PostgresPetRepository) Update(pet *domain.Pet) error { ... }
func (r *PostgresPetRepository) Delete(id string) error { ... }
// ✅ Implementa todos los métodos → satisface PetRepository automáticamente
```

### Por qué es poderoso

El `petService` depende de la **interface**, no de la implementación concreta:

```go
type petService struct {
    repo repository.PetRepository  // ← interface, no PostgresPetRepository
}
```

Esto significa que podés pasarle cualquier tipo que implemente `PetRepository` — incluyendo un mock para testing:

```go
// En producción
petRepo := repository.NewPetRepository(db)        // PostgresPetRepository
svc := service.NewPetService(petRepo)             // ✅

// En tests (sin DB real)
mockRepo := mocks.NewMockPetRepository()          // MockPetRepository
svc := service.NewPetService(mockRepo)            // ✅ también funciona
```

### La interface `error`

`error` es una interface built-in de Go, no un tipo especial:

```go
type error interface {
    Error() string  // cualquier tipo con este método ES un error
}
```

Por eso `errors.New("mensaje")` devuelve algo que satisface `error`:

```go
// domain/errors.go
var ErrPetNotFound = errors.New("mascota no encontrada")
// errors.New devuelve *errorString que implementa error.Error()
```

### La interface vacía — `interface{}`

`interface{}` puede contener cualquier valor de cualquier tipo. Es el equivalente de `any` en TypeScript:

```go
// El EventBus usa interface{} para los payloads — puede ser cualquier evento
func (eb *EventBus) Publish(event string, payload interface{}) { ... }

// En Go moderno (1.18+) se escribe any en vez de interface{}
func (eb *EventBus) Publish(event string, payload any) { ... }
```

---

## P2-14. Control de flujo

### if / else

```go
// Sin paréntesis alrededor de la condición (diferente a JS)
if err != nil {
    return nil, err
}

// if con statement inicial — muy idiomático en Go
if err := s.repo.Create(pet); err != nil {
    return nil, err
}
// err solo existe dentro de este if/else — no contamina el scope exterior

// if / else if / else
if pet.Status == "active" {
    // ...
} else if pet.Status == "found" {
    // ...
} else {
    // ...
}
```

En el proyecto, el patrón `if err := ...; err != nil` está por todos lados:

```go
// internal/handler/pet_handler.go
if err := c.ShouldBindJSON(&req); err != nil {
    c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
    return
}
```

### for — el único loop de Go

Go no tiene `while`. Tiene solo `for`, pero en tres formas:

```go
// Forma 1: for clásico (como el for de JS)
for i := 0; i < 10; i++ {
    fmt.Println(i)
}

// Forma 2: for como while
i := 0
for i < 10 {
    i++
}

// Forma 3: loop infinito
for {
    // Corre para siempre — salís con break o return
}

// Forma 4: for range — iterar colecciones
for i, pet := range pets {
    fmt.Println(i, pet.Name)
}

for event, handlers := range eb.subscribers {
    fmt.Println(event, len(handlers))
}
```

En el EventBus:

```go
// internal/event/event_bus.go
for _, h := range handlers {
    h := h
    go func() {
        h(payload)
    }()
}
```

### switch

```go
switch pet.Type {
case "perro":
    fmt.Println("es un perro")
case "gato":
    fmt.Println("es un gato")
default:
    fmt.Println("otro animal")
}
```

**Diferencia con JS**: en Go no hay fall-through por defecto. Cada case es independiente — no necesitás `break`.

```go
// switch sin expresión — equivale a una cadena de if/else
switch {
case err == nil:
    fmt.Println("todo bien")
case errors.Is(err, domain.ErrPetNotFound):
    fmt.Println("no encontrado")
default:
    fmt.Println("error desconocido")
}
```

### return

En Go, `return` corta la función inmediatamente. En el proyecto se usa muchísimo para el "early return" pattern — retornar cuando hay un error y no continuar:

```go
func (h *PetHandler) UpdatePet(c *gin.Context) {
    ownerID := getUserID(c)
    petID := c.Param("id")

    var req service.UpdatePetRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return  // ← sale de la función acá, no sigue abajo
    }

    pet, err := h.petService.UpdatePet(ownerID, petID, req)
    if err != nil {
        if errors.Is(err, domain.ErrPetNotFound) {
            c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
            return  // ← sale acá
        }
        if errors.Is(err, domain.ErrForbidden) {
            c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
            return  // ← sale acá
        }
        c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
        return  // ← sale acá
    }

    c.JSON(http.StatusOK, dto.ToPetResponse(pet))  // solo llega acá si todo fue bien
}
```

---

## P2-15. Error handling

Error handling en Go es explícito, verbal, y omnipresente. Es diferente a JS y hay que entender el porqué.

### La interface `error`

Como vimos, `error` es una interface con un solo método:

```go
type error interface {
    Error() string
}
```

### Crear errores

```go
// errors.New — error simple con mensaje
var ErrPetNotFound = errors.New("mascota no encontrada")

// fmt.Errorf — error con formato (como printf)
return fmt.Errorf("usuario %s no encontrado", userID)

// fmt.Errorf con %w — wrappear un error (preserva el error original)
return fmt.Errorf("error conectando a PostgreSQL: %w", originalErr)
```

### Comparar errores — `errors.Is`

```go
// ❌ No hacer esto — compara punteros, no el error en sí
if err == domain.ErrPetNotFound { ... }

// ✅ Usar errors.Is — funciona aunque el error esté wrapped
if errors.Is(err, domain.ErrPetNotFound) {
    c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
    return
}
```

`errors.Is` desenvuelve la cadena de wrapping hasta encontrar (o no) el error objetivo.

### El patrón en el proyecto

Los errores fluyen hacia arriba desde el repo hasta el handler:

```go
// 1. El repo convierte errores de GORM a errores de dominio
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
    err := r.db.First(&pet).Error
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return nil, domain.ErrPetNotFound  // Error de dominio, no de GORM
    }
    return &pet, nil
}

// 2. El service propaga el error
func (s *petService) GetPetByID(id string) (*domain.Pet, error) {
    return s.repo.FindByID(id)  // propaga el error del repo
}

// 3. El handler lo interpreta y responde con el HTTP status correcto
func (h *PetHandler) GetPet(c *gin.Context) {
    pet, err := h.petService.GetPetByID(id)
    if err != nil {
        if errors.Is(err, domain.ErrPetNotFound) {
            c.JSON(404, gin.H{"error": err.Error()})
            return
        }
        c.JSON(500, gin.H{"error": domain.ErrInternal.Error()})
        return
    }
    c.JSON(200, dto.ToPetResponse(pet))
}
```

### El método `.Error()` en strings

Para convertir un error a string en el JSON de respuesta:

```go
c.JSON(404, gin.H{"error": err.Error()})
//                          ^^^^^^^^^ convierte el error a string
// err.Error() → "mascota no encontrada"
```

---

## P2-16. defer

`defer` ejecuta una función **cuando el scope actual termina** — sea por `return`, `panic`, o fin de función. Se ejecuta SIEMPRE, sin importar cómo salga la función.

### Uso básico

```go
func readFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()  // se cierra cuando readFile termina — sin importar cómo

    // ... trabajar con f ...
    return nil
}
```

### En el proyecto — recuperar panics

El EventBus usa `defer` para capturar panics sin crashear el servidor:

```go
// internal/event/event_bus.go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("[EventBus] panic recovered: %v", r)
        }
    }()
    handler(payload)
}()
```

`recover()` solo funciona dentro de un `defer`. Si `handler(payload)` hace `panic`, el `defer` lo captura y el servidor sigue andando.

### defer y mutex — unlock automático

```go
// internal/event/event_bus.go
func (eb *EventBus) Subscribe(event string, handler func(interface{})) {
    eb.mu.Lock()
    defer eb.mu.Unlock()  // ← se ejecuta cuando Subscribe termina

    // Si hay un panic acá, Unlock igual se llama
    eb.subscribers[event] = append(eb.subscribers[event], handler)
}
```

---

## P2-17. Goroutines y concurrencia básica

### Goroutines — `go`

Una goroutine es una función que corre de forma **concurrente**. El keyword es `go`:

```go
// Ejecutar en segundo plano — no bloquea
go func() {
    handler(payload)
}()

// La función de abajo continúa inmediatamente
fmt.Println("esto corre sin esperar al handler")
```

En el EventBus, cada subscriber corre en su propia goroutine:

```go
// internal/event/event_bus.go
for _, h := range handlers {
    h := h
    go func() {        // ← goroutine — corre concurrentemente
        defer recover()
        h(payload)
    }()
}
// Publish() retorna inmediatamente, sin esperar que los handlers terminen
// Es "fire-and-forget"
```

### Mutex — proteger datos compartidos

Cuando múltiples goroutines acceden al mismo dato, hay que protegerlo con un mutex:

```go
// internal/event/event_bus.go
type EventBus struct {
    subscribers map[string][]func(interface{})
    mu          sync.RWMutex   // mutex de lectura/escritura
}

// Para ESCRIBIR — Lock exclusivo (nadie puede leer ni escribir al mismo tiempo)
func (eb *EventBus) Subscribe(event string, handler func(interface{})) {
    eb.mu.Lock()
    defer eb.mu.Unlock()
    eb.subscribers[event] = append(eb.subscribers[event], handler)
}

// Para LEER — RLock compartido (varios pueden leer al mismo tiempo)
func (eb *EventBus) Publish(event string, payload interface{}) {
    eb.mu.RLock()
    handlers := eb.subscribers[event]
    eb.mu.RUnlock()
    // ...
}
```

`sync.RWMutex` permite lectura concurrente pero escritura exclusiva — perfecto para el EventBus donde se lee mucho más de lo que se escribe.

---

## P2-18. Packages e imports

### Qué es un package

Todo archivo Go pertenece a un package. El package es la unidad de organización de código en Go.

```go
package service   // este archivo es parte del package "service"
```

Todos los archivos de un mismo directorio **deben** tener el mismo package name.

### Imports

```go
import (
    // Packages de la librería estándar
    "errors"
    "fmt"
    "log"
    "net/http"
    "strings"
    "sync"
    "time"

    // Packages externos (third-party)
    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    "gorm.io/gorm"

    // Packages internos del proyecto
    "lost-pets/internal/domain"
    "lost-pets/internal/dto"
    "lost-pets/internal/service"
    "lost-pets/pkg/jwt"
)
```

### El módulo — go.mod

`go.mod` es como `package.json`. Define el nombre del módulo y las dependencias:

```
module lost-pets       ← nombre del módulo (usado en los imports internos)

go 1.23                ← versión mínima de Go

require (
    github.com/gin-gonic/gin v1.9.1
    gorm.io/gorm v1.25.5
    ...
)
```

Por eso los imports internos son `"lost-pets/internal/domain"` — el nombre del módulo es el prefijo.

### Import con alias

```go
import (
    jwtlib "github.com/golang-jwt/jwt/v5"  // alias para evitar colisión con nuestro pkg/jwt
    "lost-pets/pkg/jwt"                    // nuestro wrapper
)
```

---

## P2-19. Type assertions

Cuando tenés un valor de tipo `interface{}` y necesitás recuperar el tipo concreto:

```go
// Assertion directa — paniquea si falla
evt := payload.(event.ReportCreatedEvent)

// Assertion segura — devuelve ok=false en vez de panicar
evt, ok := payload.(event.ReportCreatedEvent)
if !ok {
    log.Println("tipo de payload inesperado")
    return
}
```

En el proyecto, el EventBus publica `interface{}` y los subscribers hacen assertion al tipo específico:

```go
// internal/service/notification_service.go
bus.Subscribe(event.EventReportCreated, func(payload interface{}) {
    evt, ok := payload.(event.ReportCreatedEvent)  // assertion segura
    if !ok {
        return
    }
    s.handleReportCreated(evt)
})
```

### Type switch

Cuando tenés múltiples tipos posibles:

```go
switch v := payload.(type) {
case event.ReportCreatedEvent:
    fmt.Println("reporte creado:", v.ReportID)
case event.MessageSentEvent:
    fmt.Println("mensaje enviado:", v.MessageID)
default:
    fmt.Printf("tipo desconocido: %T\n", v)
}
```

---

## P2-20. Nil en Go

`nil` es el zero value de punteros, slices, maps, channels, funciones e interfaces. Es similar al `null` de JS pero más específico.

```go
var pet *domain.Pet = nil       // puntero nil — no apunta a nada
var pets []domain.Pet = nil     // slice nil — diferente a slice vacío
var m map[string]int = nil      // map nil — NO podés leer ni escribir
var err error = nil             // interface nil — no hay error
```

### nil checks en el proyecto

```go
// Verificar si hay error
pet, err := repo.FindByID(id)
if err != nil {          // ← check estándar
    return nil, err
}

// config/config.go — Cloudinary puede ser nil si no está configurado
if cloudinaryClient == nil {
    log.Printf("Advertencia: Cloudinary no disponible")
}

// Devolver nil para indicar "no encontré nada"
func (r *PostgresPetRepository) FindByID(id string) (*domain.Pet, error) {
    if notFound {
        return nil, domain.ErrPetNotFound   // nil como "no hay valor"
    }
    return &pet, nil                         // nil como "no hay error"
}
```

### El truco con interfaces nil

Este es un gotcha clásico de Go. Una interface puede ser **no nil** aunque apunte a un valor nil:

```go
var p *domain.Pet = nil    // puntero nil
var i interface{} = p      // interface con tipo *domain.Pet pero valor nil

i == nil   // FALSE — la interface tiene tipo, aunque el valor sea nil
p == nil   // TRUE  — el puntero sí es nil
```

Por eso en el proyecto los constructores devuelven la **interface**, no el puntero:

```go
// ✅ Devuelve la interface — si es nil, es nil de verdad
func NewPetRepository(db *gorm.DB) PetRepository {
    return &PostgresPetRepository{db: db}
}

// ❌ Devuelve el puntero — puede crear interfaces "no nil" con valor nil
func NewPetRepository(db *gorm.DB) *PostgresPetRepository {
    return &PostgresPetRepository{db: db}
}
```

---

## Resumen visual — Tipos de Go y dónde los ves en el proyecto

| Concepto | Sintaxis | Dónde en el proyecto |
|----------|----------|----------------------|
| Variable corta | `x := valor` | En toda función |
| Variable larga | `var x Tipo` | `var pets []domain.Pet` en repos |
| Constante | `const X = valor` | Event names, tokenDuration |
| String | `"texto"` | Nombres, emails, estados |
| int / float64 | `42` / `3.14` | Conteos, coordenadas GPS |
| bool | `true` / `false` | IsVerified, IsBanned, IsRead |
| Puntero | `*T` / `&x` | Todo retorno opcional (`*domain.Pet`) |
| Struct | `type X struct{}` | Pet, User, Report, Claims |
| Slice | `[]T` | FindByOwnerID → `[]domain.Pet` |
| Map | `map[K]V` | EventBus.subscribers |
| Interface | `type X interface{}` | PetRepository, PetService, error |
| Función | `func(params) retorno` | Handlers, subscribers del bus |
| Método | `func (r *T) Método()` | Todos los repos, services, handlers |
| Goroutine | `go func(){}()` | EventBus.Publish |
| Defer | `defer f()` | Mutex unlock, recover() |
| Error | `error` interface | Todos los retornos |
| Type assertion | `x.(Tipo)` | EventBus subscribers |
