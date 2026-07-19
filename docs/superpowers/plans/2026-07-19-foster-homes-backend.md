# Foster Homes — Backend (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la API completa de "hogares transitorios" (registro, moderación, suspensión, denuncias, retención forense e historial de ediciones), reutilizando el patrón de auto-registro de refugios.

**Architecture:** Clean Architecture (Handler → Service → Repository → Domain), igual que el resto del backend. Espeja `ShelterService.RegisterOwn` para el registro y moderación; agrega estado `suspended`, dos tablas de auditoría append-only (`foster_home_moderation_logs`, `foster_home_change_logs`) y extiende `ReportAbuse` con un tercer target polimórfico. La sección es privada: todos los endpoints van detrás del middleware Auth.

**Tech Stack:** Go 1.25 + Gin + GORM + PostgreSQL/PostGIS. Cloudinary (`ImageUploader` interface). `github.com/lib/pq` para `pq.StringArray` (text[]).

**Spec:** `docs/superpowers/specs/2026-07-19-foster-homes-registration-design.md`

**Alcance:** SOLO backend. Web (Fase 2) y mobile (Fase 3) son planes separados que consumen esta API (precedente: adopción #91→#92→#93).

**Convenciones a respetar:**
- Errores: `writeError(c, status, err)` → `{code,message}`; nunca `gin.H{"error":...}` (regla #11).
- Repositorios detrás de interfaces (regla #6); assertion estática `var _ Iface = (*impl)(nil)`.
- DTOs para no exponer modelos (regla #7); opcionales `*string` (regla #22).
- Commits: convencionales, SIN `Co-Authored-By` ni atribución AI.
- Correr tests: desde `backend/`, `go test ./...`.

---

## File Structure

**Crear:**
- `backend/internal/domain/foster_home.go` — modelos `FosterHome`, `FosterHomePhoto`, `FosterHomeModerationLog`, `FosterHomeChangeLog` + consts de estado y acción.
- `backend/internal/repository/foster_home_repository.go` — `FosterHomeRepository` impl.
- `backend/internal/repository/foster_home_photo_repository.go` — fotos.
- `backend/internal/repository/foster_home_audit_repository.go` — moderation + change logs (append-only).
- `backend/internal/dto/foster_home_dto.go` — requests/responses/mappers.
- `backend/internal/service/foster_home_service.go` — lógica de negocio (registro, edición+changelog, moderación+modlog).
- `backend/internal/service/foster_home_photo_service.go` — upload/delete de fotos del hogar.
- `backend/internal/handler/foster_home_handler.go` — endpoints owner + directorio + admin + fotos.
- `backend/migrations/0000NN_foster_homes.up.sql` / `.down.sql` — índices GIN + columna en `reports_abuse`.
- Tests: `backend/tests/foster_home_service_test.go`, `foster_home_handler_test.go`, `foster_home_audit_test.go`, `backend/tests/e2e/foster_home_flow_test.go`.

**Modificar:**
- `backend/internal/domain/models.go` — agregar `TargetFosterHomeID` a `ReportAbuse`.
- `backend/internal/domain/errors.go` — nuevos sentinels + codes.
- `backend/internal/repository/interfaces.go` — nuevas interfaces.
- `backend/internal/dto/abuse_report_dto.go` — soportar `target_foster_home_id`.
- `backend/internal/service/abuse_report_service.go` — validar target foster home + no self-report + dedupe.
- `backend/internal/service/auth_service.go` (o su handler) — hook `owner_contact_changed`.
- `backend/internal/app/router.go` — registrar rutas.
- `backend/cmd/server/main.go` — DI + AutoMigrate.

---

## Task 1: Dominio — modelos y constantes

**Files:**
- Create: `backend/internal/domain/foster_home.go`
- Modify: `backend/internal/domain/models.go` (campo en `ReportAbuse`)

- [ ] **Step 1: Crear los modelos**

`backend/internal/domain/foster_home.go`:
```go
package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Estados del ciclo de vida de un hogar transitorio.
// suspended = baja lógica admin — el registro NUNCA se borra (retención forense).
const (
	FosterHomeStatusPending   = "pending"
	FosterHomeStatusApproved  = "approved"
	FosterHomeStatusRejected  = "rejected"
	FosterHomeStatusSuspended = "suspended"
)

// Acciones de moderación (columna action de FosterHomeModerationLog).
const (
	FosterHomeActionApprove   = "approve"
	FosterHomeActionReject    = "reject"
	FosterHomeActionSuspend   = "suspend"
	FosterHomeActionReinstate = "reinstate"
)

// Tipos de cambio del historial de ediciones (FosterHomeChangeLog.ChangeType).
const (
	FosterHomeChangeListingEdit  = "listing_edit"
	FosterHomeChangeOwnerContact = "owner_contact_changed"
)

// FosterHome es el hogar transitorio de un usuario (domicilio que aloja animales).
type FosterHome struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerUserID     uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"owner_user_id"`
	City            string         `gorm:"not null" json:"city"`
	HousingType     string         `gorm:"not null;size:20" json:"housing_type"` // house | apartment
	AnimalTypes     pq.StringArray `gorm:"type:text[];not null" json:"animal_types"` // dog | cat | other
	Capacity        int            `gorm:"not null" json:"capacity"`
	Description     string         `gorm:"not null" json:"description"`
	WhatsappPhone   *string        `gorm:"size:20" json:"whatsapp_phone,omitempty"`
	Latitude        *float64       `json:"latitude,omitempty"`
	Longitude       *float64       `json:"longitude,omitempty"`
	Status          string         `gorm:"not null;default:'pending';index" json:"status"`
	RejectionReason string         `gorm:"size:500" json:"rejection_reason,omitempty"`
	CreatedAt       time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time      `gorm:"autoUpdateTime" json:"updated_at"`

	Owner  User              `gorm:"foreignKey:OwnerUserID" json:"-"`
	Photos []FosterHomePhoto `gorm:"foreignKey:FosterHomeID" json:"photos,omitempty"`
}

// FosterHomePhoto es una foto del ESPACIO del hogar (no de una mascota).
type FosterHomePhoto struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	URL          string    `gorm:"not null" json:"url"`
	PublicID     string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// FosterHomeModerationLog registra CADA acción admin sobre un hogar, con snapshot
// inmutable del contacto del dueño al momento de la acción (evidencia forense).
type FosterHomeModerationLog struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID  uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	ActorAdminID  uuid.UUID `gorm:"type:uuid;not null;index" json:"actor_admin_id"`
	Action        string    `gorm:"size:20;not null" json:"action"`
	Reason        string    `gorm:"size:500" json:"reason"`
	OwnerUserID   uuid.UUID `gorm:"type:uuid;not null" json:"owner_user_id"`
	OwnerEmail    string    `gorm:"size:255" json:"owner_email"`
	OwnerPhone    string    `gorm:"size:20" json:"owner_phone"`
	OwnerWhatsapp string    `gorm:"size:20" json:"owner_whatsapp"`
	CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}

// FosterHomeChangeLog registra cada EDICIÓN (append-only) con el diff before→after.
type FosterHomeChangeLog struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID  uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	EditedByID    uuid.UUID `gorm:"type:uuid;not null;index" json:"edited_by_id"`
	ChangeType    string    `gorm:"size:30;not null" json:"change_type"`
	ChangedFields string    `gorm:"type:jsonb" json:"changed_fields"` // {"field":{"old":..,"new":..}}
	OwnerEmail    string    `gorm:"size:255" json:"owner_email"`
	OwnerPhone    string    `gorm:"size:20" json:"owner_phone"`
	OwnerWhatsapp string    `gorm:"size:20" json:"owner_whatsapp"`
	CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}
```

- [ ] **Step 2: Agregar el target foster home a `ReportAbuse`**

En `backend/internal/domain/models.go`, dentro del struct `ReportAbuse`, agregar el campo y la asociación (después de `TargetUserID`):
```go
	TargetFosterHomeID *uuid.UUID `gorm:"type:uuid;column:target_foster_home_id" json:"target_foster_home_id,omitempty"`
```
Y en el bloque de asociaciones (después de `TargetReport`):
```go
	FosterHome *FosterHome `gorm:"foreignKey:TargetFosterHomeID;constraint:OnDelete:SET NULL" json:"-"`
```

- [ ] **Step 3: Verificar que compila**

Run: `cd backend && go build ./...`
Expected: sin errores (puede pedir `go mod tidy` si `github.com/lib/pq` no estaba como require directo; correrlo).

Run: `cd backend && go mod tidy`

- [ ] **Step 4: Commit**

```bash
git add backend/internal/domain/foster_home.go backend/internal/domain/models.go backend/go.mod backend/go.sum
git commit -m "feat(foster-homes): add domain models and abuse target"
```

---

## Task 2: Dominio — errores y codes

**Files:**
- Modify: `backend/internal/domain/errors.go`

- [ ] **Step 1: Agregar los sentinels**

En `backend/internal/domain/errors.go`, dentro del bloque `var (...)`, agregar una sección (después del bloque `// Shelter`):
```go
	// Foster homes
	ErrFosterHomeNotFound       = errors.New("foster_home_not_found")
	ErrFosterHomeAlreadyOwned   = errors.New("foster_home_already_owned")
	ErrInvalidFosterHomeStatus  = errors.New("invalid_foster_home_status")
	ErrFosterHomeSuspended      = errors.New("foster_home_suspended")
	ErrSuspensionReasonRequired = errors.New("suspension_reason_required")
	ErrTooManyFosterPhotos      = errors.New("too_many_photos")
	ErrSelfAbuseReport          = errors.New("self_abuse_report")
	ErrDuplicateAbuseReport     = errors.New("duplicate_abuse_report")
```
> Nota: `ErrEmailNotVerified` y `ErrRejectionReasonRequired` ya existen (bloque Shelter) — reusarlos, no redefinir.

- [ ] **Step 2: Agregar los codes**

En el mapa `ErrorCodes`, agregar (después del bloque `// Shelter`):
```go
	// Foster homes
	ErrFosterHomeNotFound:       "foster_home_not_found",
	ErrFosterHomeAlreadyOwned:   "foster_home_already_owned",
	ErrInvalidFosterHomeStatus:  "invalid_foster_home_status",
	ErrFosterHomeSuspended:      "foster_home_suspended",
	ErrSuspensionReasonRequired: "suspension_reason_required",
	ErrTooManyFosterPhotos:      "too_many_photos",
	ErrSelfAbuseReport:          "self_abuse_report",
	ErrDuplicateAbuseReport:     "duplicate_abuse_report",
```

- [ ] **Step 3: Test de que `CodeFor` mapea los nuevos codes**

`backend/tests/foster_home_errors_test.go`:
```go
package tests

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestFosterHomeErrorCodes(t *testing.T) {
	cases := map[error]string{
		domain.ErrFosterHomeNotFound:       "foster_home_not_found",
		domain.ErrFosterHomeAlreadyOwned:   "foster_home_already_owned",
		domain.ErrFosterHomeSuspended:      "foster_home_suspended",
		domain.ErrSuspensionReasonRequired: "suspension_reason_required",
		domain.ErrSelfAbuseReport:          "self_abuse_report",
		domain.ErrDuplicateAbuseReport:     "duplicate_abuse_report",
	}
	for err, want := range cases {
		if got := domain.CodeFor(err); got != want {
			t.Errorf("CodeFor(%v) = %q, want %q", err, got, want)
		}
	}
}
```

- [ ] **Step 4: Correr el test**

Run: `cd backend && go test ./tests/ -run TestFosterHomeErrorCodes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/errors.go backend/tests/foster_home_errors_test.go
git commit -m "feat(foster-homes): add domain errors and codes"
```

---

## Task 3: Migración SQL

**Files:**
- Create: `backend/migrations/0000NN_foster_homes.up.sql`
- Create: `backend/migrations/0000NN_foster_homes.down.sql`

- [ ] **Step 1: Determinar el número de migración**

Run: `ls backend/migrations | sort | tail -5`
Usar el siguiente número consecutivo (si el mayor es `000016_*`, usar `000017`). Reemplazar `0000NN` abajo por ese número.

- [ ] **Step 2: Escribir la migración up**

`backend/migrations/0000NN_foster_homes.up.sql`:
```sql
-- Índice GIN para filtrar hogares por tipo de animal (animal_types text[]).
-- Las tablas foster_homes/foster_home_photos/foster_home_moderation_logs/
-- foster_home_change_logs las crea AutoMigrate desde los structs GORM; esta
-- migración agrega lo que AutoMigrate no expresa.
CREATE INDEX IF NOT EXISTS idx_foster_homes_animal_types
	ON foster_homes USING GIN (animal_types);

-- Columna de denuncia hacia un hogar (tercer target polimórfico de reports_abuse).
ALTER TABLE reports_abuse
	ADD COLUMN IF NOT EXISTS target_foster_home_id uuid;

-- Anti-spam: como máximo una denuncia PENDING por (denunciante, hogar).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_abuse_pending_foster_home
	ON reports_abuse (reporter_id, target_foster_home_id)
	WHERE target_foster_home_id IS NOT NULL AND status = 'pending';
```

- [ ] **Step 3: Escribir la migración down**

`backend/migrations/0000NN_foster_homes.down.sql`:
```sql
DROP INDEX IF EXISTS uniq_abuse_pending_foster_home;
ALTER TABLE reports_abuse DROP COLUMN IF EXISTS target_foster_home_id;
DROP INDEX IF EXISTS idx_foster_homes_animal_types;
```

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/
git commit -m "feat(foster-homes): add GIN index and abuse target migration"
```

---

## Task 4: Repositorios

**Files:**
- Modify: `backend/internal/repository/interfaces.go`
- Create: `backend/internal/repository/foster_home_repository.go`
- Create: `backend/internal/repository/foster_home_photo_repository.go`
- Create: `backend/internal/repository/foster_home_audit_repository.go`

- [ ] **Step 1: Declarar las interfaces**

En `backend/internal/repository/interfaces.go`, agregar (después de `ShelterRepository`):
```go
// FosterHomeRepository define el contrato para acceder a datos de hogares transitorios.
type FosterHomeRepository interface {
	Create(ctx context.Context, fh *domain.FosterHome) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.FosterHome, error)
	GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.FosterHome, error)
	// GetApproved lista SOLO approved (directorio privado). city/animalType == "" → sin filtro.
	GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error)
	GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error)
	Update(ctx context.Context, fh *domain.FosterHome) error
}

// FosterHomePhotoRepository define el contrato para fotos del hogar.
type FosterHomePhotoRepository interface {
	Create(ctx context.Context, p *domain.FosterHomePhoto) error
	CountByFosterHome(ctx context.Context, fhID uuid.UUID) (int64, error)
	FindByFosterHome(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomePhoto, error)
	FindByID(ctx context.Context, id uuid.UUID) (*domain.FosterHomePhoto, error)
	DeleteByID(ctx context.Context, id uuid.UUID) error
}

// FosterHomeAuditRepository persiste los rastros append-only (nunca se borra).
type FosterHomeAuditRepository interface {
	CreateModerationLog(ctx context.Context, l *domain.FosterHomeModerationLog) error
	ListModerationLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeModerationLog, error)
	CreateChangeLog(ctx context.Context, l *domain.FosterHomeChangeLog) error
	ListChangeLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeChangeLog, error)
}
```

- [ ] **Step 2: Implementar `FosterHomeRepository`**

`backend/internal/repository/foster_home_repository.go`:
```go
package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomeRepository struct {
	db *gorm.DB
}

func NewFosterHomeRepository(db *gorm.DB) FosterHomeRepository {
	return &postgresFosterHomeRepository{db: db}
}

func (r *postgresFosterHomeRepository) Create(ctx context.Context, fh *domain.FosterHome) error {
	return r.db.WithContext(ctx).Create(fh).Error
}

func (r *postgresFosterHomeRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.FosterHome, error) {
	var fh domain.FosterHome
	res := r.db.WithContext(ctx).Preload("Photos").First(&fh, "id = ?", id)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrFosterHomeNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &fh, nil
}

func (r *postgresFosterHomeRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.FosterHome, error) {
	var fh domain.FosterHome
	res := r.db.WithContext(ctx).Preload("Photos").First(&fh, "owner_user_id = ?", ownerID)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrFosterHomeNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &fh, nil
}

func (r *postgresFosterHomeRepository) GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error) {
	var list []domain.FosterHome
	q := r.db.WithContext(ctx).Model(&domain.FosterHome{}).
		Preload("Photos").
		Where("status = ?", domain.FosterHomeStatusApproved)
	if city != "" {
		q = q.Where("city = ?", city)
	}
	if animalType != "" {
		// animal_types es text[]; filtro por pertenencia con el operador @>.
		q = q.Where("animal_types @> ARRAY[?]::text[]", animalType)
	}
	err := q.Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeRepository) GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error) {
	var list []domain.FosterHome
	err := r.db.WithContext(ctx).
		Where("status = ?", domain.FosterHomeStatusPending).
		Order("created_at ASC").
		Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeRepository) Update(ctx context.Context, fh *domain.FosterHome) error {
	return r.db.WithContext(ctx).Save(fh).Error
}

var _ FosterHomeRepository = (*postgresFosterHomeRepository)(nil)
```

- [ ] **Step 3: Implementar `FosterHomePhotoRepository`**

`backend/internal/repository/foster_home_photo_repository.go`:
```go
package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomePhotoRepository struct {
	db *gorm.DB
}

func NewFosterHomePhotoRepository(db *gorm.DB) FosterHomePhotoRepository {
	return &postgresFosterHomePhotoRepository{db: db}
}

func (r *postgresFosterHomePhotoRepository) Create(ctx context.Context, p *domain.FosterHomePhoto) error {
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *postgresFosterHomePhotoRepository) CountByFosterHome(ctx context.Context, fhID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.FosterHomePhoto{}).
		Where("foster_home_id = ?", fhID).Count(&n).Error
	return n, err
}

func (r *postgresFosterHomePhotoRepository) FindByFosterHome(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomePhoto, error) {
	var list []domain.FosterHomePhoto
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at ASC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomePhotoRepository) FindByID(ctx context.Context, id uuid.UUID) (*domain.FosterHomePhoto, error) {
	var p domain.FosterHomePhoto
	res := r.db.WithContext(ctx).First(&p, "id = ?", id)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrPhotoNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &p, nil
}

func (r *postgresFosterHomePhotoRepository) DeleteByID(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&domain.FosterHomePhoto{}, "id = ?", id).Error
}

var _ FosterHomePhotoRepository = (*postgresFosterHomePhotoRepository)(nil)
```

- [ ] **Step 4: Implementar `FosterHomeAuditRepository`**

`backend/internal/repository/foster_home_audit_repository.go`:
```go
package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomeAuditRepository struct {
	db *gorm.DB
}

func NewFosterHomeAuditRepository(db *gorm.DB) FosterHomeAuditRepository {
	return &postgresFosterHomeAuditRepository{db: db}
}

func (r *postgresFosterHomeAuditRepository) CreateModerationLog(ctx context.Context, l *domain.FosterHomeModerationLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *postgresFosterHomeAuditRepository) ListModerationLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeModerationLog, error) {
	var list []domain.FosterHomeModerationLog
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeAuditRepository) CreateChangeLog(ctx context.Context, l *domain.FosterHomeChangeLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *postgresFosterHomeAuditRepository) ListChangeLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeChangeLog, error) {
	var list []domain.FosterHomeChangeLog
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at DESC").Find(&list).Error
	return list, err
}

var _ FosterHomeAuditRepository = (*postgresFosterHomeAuditRepository)(nil)
```

- [ ] **Step 5: Verificar que compila**

Run: `cd backend && go build ./...`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/
git commit -m "feat(foster-homes): add repositories"
```

---

## Task 5: DTOs

**Files:**
- Create: `backend/internal/dto/foster_home_dto.go`

- [ ] **Step 1: Escribir requests, responses y mappers**

`backend/internal/dto/foster_home_dto.go`:
```go
package dto

import (
	"strings"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"lost-pets/internal/domain"
)

var validHousingTypes = map[string]bool{"house": true, "apartment": true}
var validAnimalTypes = map[string]bool{"dog": true, "cat": true, "other": true}

// RegisterFosterHomeRequest — POST /api/foster-homes.
type RegisterFosterHomeRequest struct {
	City          string   `json:"city" binding:"required"`
	HousingType   string   `json:"housing_type" binding:"required"`
	AnimalTypes   []string `json:"animal_types" binding:"required"`
	Capacity      int      `json:"capacity" binding:"required"`
	Description   string   `json:"description" binding:"required"`
	WhatsappPhone *string  `json:"whatsapp_phone"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
}

func (r *RegisterFosterHomeRequest) Validate() error {
	if strings.TrimSpace(r.City) == "" || strings.TrimSpace(r.Description) == "" {
		return domain.ErrInvalidInput
	}
	if !validHousingTypes[r.HousingType] {
		return domain.ErrInvalidInput
	}
	if r.Capacity < 1 {
		return domain.ErrInvalidInput
	}
	if len(r.AnimalTypes) == 0 {
		return domain.ErrInvalidInput
	}
	for _, t := range r.AnimalTypes {
		if !validAnimalTypes[t] {
			return domain.ErrInvalidInput
		}
	}
	return nil
}

func ToRegisterFosterHomeDomain(req *RegisterFosterHomeRequest) *domain.FosterHome {
	return &domain.FosterHome{
		City:          req.City,
		HousingType:   req.HousingType,
		AnimalTypes:   pq.StringArray(req.AnimalTypes),
		Capacity:      req.Capacity,
		Description:   req.Description,
		WhatsappPhone: req.WhatsappPhone,
		Latitude:      req.Latitude,
		Longitude:     req.Longitude,
	}
}

// UpdateMyFosterHomeRequest — PUT /api/foster-homes/mine. Punteros (regla #22):
// nil = no tocar, valor = aplicar. Los enums/arrays van por valor (nil = no tocar).
type UpdateMyFosterHomeRequest struct {
	City          *string   `json:"city"`
	HousingType   *string   `json:"housing_type"`
	AnimalTypes   []string  `json:"animal_types"`
	Capacity      *int      `json:"capacity"`
	Description   *string   `json:"description"`
	WhatsappPhone *string   `json:"whatsapp_phone"`
	Latitude      *float64  `json:"latitude"`
	Longitude     *float64  `json:"longitude"`
}

func (r *UpdateMyFosterHomeRequest) Validate() error {
	if r.City != nil && strings.TrimSpace(*r.City) == "" {
		return domain.ErrInvalidInput
	}
	if r.Description != nil && strings.TrimSpace(*r.Description) == "" {
		return domain.ErrInvalidInput
	}
	if r.HousingType != nil && !validHousingTypes[*r.HousingType] {
		return domain.ErrInvalidInput
	}
	if r.Capacity != nil && *r.Capacity < 1 {
		return domain.ErrInvalidInput
	}
	if r.AnimalTypes != nil {
		if len(r.AnimalTypes) == 0 {
			return domain.ErrInvalidInput
		}
		for _, t := range r.AnimalTypes {
			if !validAnimalTypes[t] {
				return domain.ErrInvalidInput
			}
		}
	}
	return nil
}

// RejectFosterHomeRequest — reject/suspend comparten forma (motivo requerido).
type ReasonRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// FosterHomePhotoResponse
type FosterHomePhotoResponse struct {
	ID  uuid.UUID `json:"id"`
	URL string    `json:"url"`
}

// FosterHomeResponse — vista de directorio (usuarios logueados).
type FosterHomeResponse struct {
	ID            uuid.UUID                 `json:"id"`
	OwnerUserID   uuid.UUID                 `json:"owner_user_id"`
	City          string                    `json:"city"`
	HousingType   string                    `json:"housing_type"`
	AnimalTypes   []string                  `json:"animal_types"`
	Capacity      int                       `json:"capacity"`
	Description   string                    `json:"description"`
	WhatsappPhone *string                   `json:"whatsapp_phone,omitempty"`
	Photos        []FosterHomePhotoResponse `json:"photos"`
	CreatedAt     string                    `json:"created_at"`
}

func ToFosterHomeResponse(fh *domain.FosterHome) FosterHomeResponse {
	photos := make([]FosterHomePhotoResponse, 0, len(fh.Photos))
	for _, p := range fh.Photos {
		photos = append(photos, FosterHomePhotoResponse{ID: p.ID, URL: p.URL})
	}
	return FosterHomeResponse{
		ID:            fh.ID,
		OwnerUserID:   fh.OwnerUserID,
		City:          fh.City,
		HousingType:   fh.HousingType,
		AnimalTypes:   []string(fh.AnimalTypes),
		Capacity:      fh.Capacity,
		Description:   fh.Description,
		WhatsappPhone: fh.WhatsappPhone,
		Photos:        photos,
		CreatedAt:     fh.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func ToFosterHomeListResponse(list []domain.FosterHome) []FosterHomeResponse {
	out := make([]FosterHomeResponse, len(list))
	for i := range list {
		out[i] = ToFosterHomeResponse(&list[i])
	}
	return out
}

// MyFosterHomeResponse — vista del dueño (+ status/rejection_reason).
type MyFosterHomeResponse struct {
	FosterHomeResponse
	Status          string `json:"status"`
	RejectionReason string `json:"rejection_reason,omitempty"`
}

func ToMyFosterHomeResponse(fh *domain.FosterHome) MyFosterHomeResponse {
	return MyFosterHomeResponse{
		FosterHomeResponse: ToFosterHomeResponse(fh),
		Status:             fh.Status,
		RejectionReason:    fh.RejectionReason,
	}
}

func ToMyFosterHomeListResponse(list []domain.FosterHome) []MyFosterHomeResponse {
	out := make([]MyFosterHomeResponse, len(list))
	for i := range list {
		out[i] = ToMyFosterHomeResponse(&list[i])
	}
	return out
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd backend && go build ./...`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/dto/foster_home_dto.go
git commit -m "feat(foster-homes): add DTOs"
```

---

## Task 6: Service — registro y edición (con changelog)

**Files:**
- Create: `backend/internal/service/foster_home_service.go`
- Test: `backend/tests/foster_home_service_test.go`

- [ ] **Step 1: Escribir el test del registro (TDD)**

`backend/tests/foster_home_service_test.go`:
```go
package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// --- fakes mínimos (implementan solo lo que el service usa) ---

type fakeFHRepo struct {
	byOwner map[uuid.UUID]*domain.FosterHome
	created *domain.FosterHome
}

func newFakeFHRepo() *fakeFHRepo { return &fakeFHRepo{byOwner: map[uuid.UUID]*domain.FosterHome{}} }

func (f *fakeFHRepo) Create(_ context.Context, fh *domain.FosterHome) error {
	fh.ID = uuid.New()
	f.created = fh
	f.byOwner[fh.OwnerUserID] = fh
	return nil
}
func (f *fakeFHRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.FosterHome, error) {
	for _, fh := range f.byOwner {
		if fh.ID == id {
			return fh, nil
		}
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fakeFHRepo) GetByOwner(_ context.Context, ownerID uuid.UUID) (*domain.FosterHome, error) {
	if fh, ok := f.byOwner[ownerID]; ok {
		return fh, nil
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fakeFHRepo) GetApproved(_ context.Context, _, _ string) ([]domain.FosterHome, error) {
	return nil, nil
}
func (f *fakeFHRepo) GetPendingQueue(_ context.Context) ([]domain.FosterHome, error) { return nil, nil }
func (f *fakeFHRepo) Update(_ context.Context, fh *domain.FosterHome) error {
	f.byOwner[fh.OwnerUserID] = fh
	return nil
}

type fakeUserRepo struct{ users map[uuid.UUID]*domain.User }

func (f *fakeUserRepo) Create(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return nil, domain.ErrUserNotFound
}
func (f *fakeUserRepo) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (f *fakeUserRepo) Update(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepo) Delete(context.Context, uuid.UUID) error    { return nil }

type fakeAuditRepo struct {
	modLogs    []*domain.FosterHomeModerationLog
	changeLogs []*domain.FosterHomeChangeLog
}

func (f *fakeAuditRepo) CreateModerationLog(_ context.Context, l *domain.FosterHomeModerationLog) error {
	f.modLogs = append(f.modLogs, l)
	return nil
}
func (f *fakeAuditRepo) ListModerationLogs(context.Context, uuid.UUID) ([]domain.FosterHomeModerationLog, error) {
	return nil, nil
}
func (f *fakeAuditRepo) CreateChangeLog(_ context.Context, l *domain.FosterHomeChangeLog) error {
	f.changeLogs = append(f.changeLogs, l)
	return nil
}
func (f *fakeAuditRepo) ListChangeLogs(context.Context, uuid.UUID) ([]domain.FosterHomeChangeLog, error) {
	return nil, nil
}

func newVerifiedUser() (uuid.UUID, *fakeUserRepo) {
	id := uuid.New()
	return id, &fakeUserRepo{users: map[uuid.UUID]*domain.User{
		id: {ID: id, Email: "u@test.com", EmailVerified: true},
	}}
}

func TestRegisterOwn_RequiresEmailVerified(t *testing.T) {
	id := uuid.New()
	userRepo := &fakeUserRepo{users: map[uuid.UUID]*domain.User{id: {ID: id, EmailVerified: false}}}
	svc := service.NewFosterHomeService(newFakeFHRepo(), userRepo, &fakeAuditRepo{}, nil)

	err := svc.RegisterOwn(context.Background(), id.String(), &domain.FosterHome{City: "Montevideo"})
	if err != domain.ErrEmailNotVerified {
		t.Fatalf("got %v, want ErrEmailNotVerified", err)
	}
}

func TestRegisterOwn_SecondHomeConflicts(t *testing.T) {
	id, userRepo := newVerifiedUser()
	repo := newFakeFHRepo()
	svc := service.NewFosterHomeService(repo, userRepo, &fakeAuditRepo{}, nil)

	if err := svc.RegisterOwn(context.Background(), id.String(), &domain.FosterHome{City: "MVD"}); err != nil {
		t.Fatalf("first register: %v", err)
	}
	err := svc.RegisterOwn(context.Background(), id.String(), &domain.FosterHome{City: "MVD"})
	if err != domain.ErrFosterHomeAlreadyOwned {
		t.Fatalf("got %v, want ErrFosterHomeAlreadyOwned", err)
	}
}

func TestRegisterOwn_BornsPending(t *testing.T) {
	id, userRepo := newVerifiedUser()
	repo := newFakeFHRepo()
	svc := service.NewFosterHomeService(repo, userRepo, &fakeAuditRepo{}, nil)

	if err := svc.RegisterOwn(context.Background(), id.String(), &domain.FosterHome{City: "MVD"}); err != nil {
		t.Fatalf("register: %v", err)
	}
	if repo.created.Status != domain.FosterHomeStatusPending {
		t.Fatalf("status = %q, want pending", repo.created.Status)
	}
	if repo.created.OwnerUserID != id {
		t.Fatalf("owner not set")
	}
}
```

- [ ] **Step 2: Correr el test (debe fallar: falta el service)**

Run: `cd backend && go test ./tests/ -run TestRegisterOwn -v`
Expected: FAIL de compilación — `undefined: service.NewFosterHomeService`.

- [ ] **Step 3: Escribir el service (registro + edición + changelog)**

`backend/internal/service/foster_home_service.go`:
```go
package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// FosterHomeService define el contrato de negocio de hogares transitorios.
type FosterHomeService interface {
	RegisterOwn(ctx context.Context, userID string, fh *domain.FosterHome) error
	GetMine(ctx context.Context, userID string) (*domain.FosterHome, error)
	UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyFosterHomeRequest) (*domain.FosterHome, error)
	GetApprovedByID(ctx context.Context, id string) (*domain.FosterHome, error)
	GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error)

	GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error)
	Approve(ctx context.Context, adminID, id string) (*domain.FosterHome, error)
	Reject(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error)
	Suspend(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error)
	Reinstate(ctx context.Context, adminID, id string) (*domain.FosterHome, error)
	ModerationLogs(ctx context.Context, id string) ([]domain.FosterHomeModerationLog, error)
	ChangeLogs(ctx context.Context, id string) ([]domain.FosterHomeChangeLog, error)

	// RecordOwnerContactChange registra un cambio de contacto del dueño (hook de perfil).
	RecordOwnerContactChange(ctx context.Context, userID uuid.UUID, changed map[string][2]string) error
}

type fosterHomeService struct {
	repo      repository.FosterHomeRepository
	userRepo  repository.UserRepository
	auditRepo repository.FosterHomeAuditRepository
	bus       *event.EventBus
}

func NewFosterHomeService(
	repo repository.FosterHomeRepository,
	userRepo repository.UserRepository,
	auditRepo repository.FosterHomeAuditRepository,
	bus *event.EventBus,
) FosterHomeService {
	return &fosterHomeService{repo: repo, userRepo: userRepo, auditRepo: auditRepo, bus: bus}
}

func (s *fosterHomeService) RegisterOwn(ctx context.Context, userID string, fh *domain.FosterHome) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	user, err := s.userRepo.GetByID(ctx, ownerUUID)
	if err != nil {
		return err
	}
	if !user.EmailVerified {
		return domain.ErrEmailNotVerified
	}
	if _, err := s.repo.GetByOwner(ctx, ownerUUID); err == nil {
		return domain.ErrFosterHomeAlreadyOwned
	} else if !errors.Is(err, domain.ErrFosterHomeNotFound) {
		return err
	}

	fh.OwnerUserID = ownerUUID
	fh.Status = domain.FosterHomeStatusPending
	if err := s.repo.Create(ctx, fh); err != nil {
		return err
	}
	if s.bus != nil {
		s.bus.Publish("foster_home.submitted", map[string]any{"foster_home_id": fh.ID, "owner_user_id": ownerUUID})
	}
	return nil
}

func (s *fosterHomeService) GetMine(ctx context.Context, userID string) (*domain.FosterHome, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByOwner(ctx, ownerUUID)
}

func (s *fosterHomeService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyFosterHomeRequest) (*domain.FosterHome, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.repo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, err
	}
	// Un hogar suspendido queda CONGELADO: el dueño no puede editarlo (§18).
	if fh.Status == domain.FosterHomeStatusSuspended {
		return nil, domain.ErrFosterHomeSuspended
	}

	changed := map[string][2]string{} // field -> [old, new]
	if req.City != nil && *req.City != fh.City {
		changed["city"] = [2]string{fh.City, *req.City}
		fh.City = *req.City
	}
	if req.HousingType != nil && *req.HousingType != fh.HousingType {
		changed["housing_type"] = [2]string{fh.HousingType, *req.HousingType}
		fh.HousingType = *req.HousingType
	}
	if req.Description != nil && *req.Description != fh.Description {
		changed["description"] = [2]string{fh.Description, *req.Description}
		fh.Description = *req.Description
	}
	if req.Capacity != nil && *req.Capacity != fh.Capacity {
		changed["capacity"] = [2]string{itoa(fh.Capacity), itoa(*req.Capacity)}
		fh.Capacity = *req.Capacity
	}
	if req.WhatsappPhone != nil && (fh.WhatsappPhone == nil || *req.WhatsappPhone != *fh.WhatsappPhone) {
		old := ""
		if fh.WhatsappPhone != nil {
			old = *fh.WhatsappPhone
		}
		changed["whatsapp_phone"] = [2]string{old, *req.WhatsappPhone}
		v := *req.WhatsappPhone
		fh.WhatsappPhone = &v
	}
	if req.AnimalTypes != nil {
		changed["animal_types"] = [2]string{joinCSV([]string(fh.AnimalTypes)), joinCSV(req.AnimalTypes)}
		fh.AnimalTypes = pq.StringArray(req.AnimalTypes)
	}
	if req.Latitude != nil {
		fh.Latitude = req.Latitude
	}
	if req.Longitude != nil {
		fh.Longitude = req.Longitude
	}

	// Un rejected que se edita vuelve a pending (resubmit).
	if fh.Status == domain.FosterHomeStatusRejected {
		fh.Status = domain.FosterHomeStatusPending
		fh.RejectionReason = ""
	}

	if err := s.repo.Update(ctx, fh); err != nil {
		return nil, err
	}

	// Historial de ediciones (§18.1) — solo si algo cambió.
	if len(changed) > 0 {
		s.writeChangeLog(ctx, fh, ownerUUID, domain.FosterHomeChangeListingEdit, changed)
	}
	return fh, nil
}

// writeChangeLog serializa el diff y persiste un FosterHomeChangeLog con snapshot de contacto.
func (s *fosterHomeService) writeChangeLog(ctx context.Context, fh *domain.FosterHome, editor uuid.UUID, changeType string, changed map[string][2]string) {
	diff := map[string]map[string]string{}
	for field, oldNew := range changed {
		diff[field] = map[string]string{"old": oldNew[0], "new": oldNew[1]}
	}
	raw, _ := json.Marshal(diff)
	wa := ""
	if fh.WhatsappPhone != nil {
		wa = *fh.WhatsappPhone
	}
	ownerEmail, ownerPhone := "", ""
	if u, err := s.userRepo.GetByID(ctx, fh.OwnerUserID); err == nil {
		ownerEmail, ownerPhone = u.Email, u.Phone
	}
	_ = s.auditRepo.CreateChangeLog(ctx, &domain.FosterHomeChangeLog{
		FosterHomeID:  fh.ID,
		EditedByID:    editor,
		ChangeType:    changeType,
		ChangedFields: string(raw),
		OwnerEmail:    ownerEmail,
		OwnerPhone:    ownerPhone,
		OwnerWhatsapp: wa,
	})
}

func (s *fosterHomeService) RecordOwnerContactChange(ctx context.Context, userID uuid.UUID, changed map[string][2]string) error {
	fh, err := s.repo.GetByOwner(ctx, userID)
	if errors.Is(err, domain.ErrFosterHomeNotFound) {
		return nil // el usuario no tiene hogar → nada que auditar
	}
	if err != nil {
		return err
	}
	if len(changed) == 0 {
		return nil
	}
	s.writeChangeLog(ctx, fh, userID, domain.FosterHomeChangeOwnerContact, changed)
	return nil
}

// helpers
func itoa(n int) string { return strconvItoa(n) }
```

> **Nota:** definir los helpers `strconvItoa` y `joinCSV` al final del archivo:
```go
import "strconv"    // agregar al bloque de imports
import "strings"    // agregar al bloque de imports

func strconvItoa(n int) string { return strconv.Itoa(n) }
func joinCSV(xs []string) string { return strings.Join(xs, ",") }
```
> (O simplemente usar `strconv.Itoa` y `strings.Join` inline — el wrapper es para claridad del plan; el implementador puede simplificar.)

Los métodos de moderación (`Approve/Reject/Suspend/Reinstate/GetPendingQueue/GetApproved/GetApprovedByID/ModerationLogs/ChangeLogs`) se implementan en la Task 7 (mismo archivo). Para que compile el registro ahora, agregá stubs temporales que retornen `domain.ErrInternal`, o implementá la Task 7 antes de correr el build final.

- [ ] **Step 4: Correr los tests de registro**

Run: `cd backend && go test ./tests/ -run TestRegisterOwn -v`
Expected: PASS (los 3 subtests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/foster_home_service.go backend/tests/foster_home_service_test.go
git commit -m "feat(foster-homes): register + edit service with change history"
```

---

## Task 7: Service — moderación (con moderation log)

**Files:**
- Modify: `backend/internal/service/foster_home_service.go`
- Test: `backend/tests/foster_home_service_test.go` (agregar)

- [ ] **Step 1: Escribir los tests de moderación**

Agregar a `backend/tests/foster_home_service_test.go`:
```go
func approvedHome(t *testing.T) (*fakeFHRepo, *fakeAuditRepo, service.FosterHomeService, uuid.UUID, string) {
	t.Helper()
	id, userRepo := newVerifiedUser()
	repo := newFakeFHRepo()
	audit := &fakeAuditRepo{}
	svc := service.NewFosterHomeService(repo, userRepo, audit, nil)
	if err := svc.RegisterOwn(context.Background(), id.String(), &domain.FosterHome{City: "MVD"}); err != nil {
		t.Fatalf("register: %v", err)
	}
	fhID := repo.created.ID.String()
	adminID := uuid.New().String()
	if _, err := svc.Approve(context.Background(), adminID, fhID); err != nil {
		t.Fatalf("approve: %v", err)
	}
	return repo, audit, svc, id, fhID
}

func TestSuspend_RequiresReasonAndLogs(t *testing.T) {
	_, audit, svc, _, fhID := approvedHome(t)
	adminID := uuid.New().String()

	if _, err := svc.Suspend(context.Background(), adminID, fhID, ""); err != domain.ErrSuspensionReasonRequired {
		t.Fatalf("empty reason: got %v, want ErrSuspensionReasonRequired", err)
	}
	fh, err := svc.Suspend(context.Background(), adminID, fhID, "fraude")
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if fh.Status != domain.FosterHomeStatusSuspended {
		t.Fatalf("status = %q, want suspended", fh.Status)
	}
	// Debe haber log de approve + suspend con snapshot.
	var suspendLogged bool
	for _, l := range audit.modLogs {
		if l.Action == domain.FosterHomeActionSuspend && l.Reason == "fraude" {
			suspendLogged = true
		}
	}
	if !suspendLogged {
		t.Fatal("suspend action not logged with reason")
	}
}

func TestEditSuspended_IsFrozen(t *testing.T) {
	repo, _, svc, ownerID, fhID := approvedHome(t)
	adminID := uuid.New().String()
	if _, err := svc.Suspend(context.Background(), adminID, fhID, "fraude"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	city := "Salto"
	_, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyFosterHomeRequest{City: &city})
	if err != domain.ErrFosterHomeSuspended {
		t.Fatalf("got %v, want ErrFosterHomeSuspended", err)
	}
	_ = repo
}
```
> Agregar `"lost-pets/internal/dto"` a los imports del test.

- [ ] **Step 2: Implementar la moderación en el service**

Agregar a `backend/internal/service/foster_home_service.go` (reemplazar los stubs si los habías puesto):
```go
func (s *fosterHomeService) GetApprovedByID(ctx context.Context, id string) (*domain.FosterHome, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.repo.GetByID(ctx, fhUUID)
	if err != nil {
		return nil, err
	}
	// El directorio solo sirve approved; el resto responde 404 (no revela existencia).
	if fh.Status != domain.FosterHomeStatusApproved {
		return nil, domain.ErrFosterHomeNotFound
	}
	return fh, nil
}

func (s *fosterHomeService) GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error) {
	return s.repo.GetApproved(ctx, city, animalType)
}

func (s *fosterHomeService) GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error) {
	return s.repo.GetPendingQueue(ctx)
}

// loadAny carga un hogar por ID sin filtrar estado (vía admin).
func (s *fosterHomeService) loadAny(ctx context.Context, id string) (*domain.FosterHome, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByID(ctx, fhUUID)
}

// transition aplica el cambio de estado, persiste y escribe el moderation log con snapshot.
func (s *fosterHomeService) transition(ctx context.Context, adminID, id, action, reason, newStatus string, allowedFrom ...string) (*domain.FosterHome, error) {
	adminUUID, err := uuid.Parse(adminID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.loadAny(ctx, id)
	if err != nil {
		return nil, err
	}
	ok := false
	for _, from := range allowedFrom {
		if fh.Status == from {
			ok = true
			break
		}
	}
	if !ok {
		return nil, domain.ErrInvalidFosterHomeStatus
	}
	fh.Status = newStatus
	if action == domain.FosterHomeActionReject {
		fh.RejectionReason = reason
	}
	if err := s.repo.Update(ctx, fh); err != nil {
		return nil, err
	}

	// Snapshot forense del contacto del dueño (§18).
	wa := ""
	if fh.WhatsappPhone != nil {
		wa = *fh.WhatsappPhone
	}
	ownerEmail, ownerPhone := "", ""
	if u, uerr := s.userRepo.GetByID(ctx, fh.OwnerUserID); uerr == nil {
		ownerEmail, ownerPhone = u.Email, u.Phone
	}
	_ = s.auditRepo.CreateModerationLog(ctx, &domain.FosterHomeModerationLog{
		FosterHomeID:  fh.ID,
		ActorAdminID:  adminUUID,
		Action:        action,
		Reason:        reason,
		OwnerUserID:   fh.OwnerUserID,
		OwnerEmail:    ownerEmail,
		OwnerPhone:    ownerPhone,
		OwnerWhatsapp: wa,
	})

	if s.bus != nil {
		s.bus.Publish("foster_home."+action, map[string]any{"foster_home_id": fh.ID})
	}
	return fh, nil
}

func (s *fosterHomeService) Approve(ctx context.Context, adminID, id string) (*domain.FosterHome, error) {
	return s.transition(ctx, adminID, id, domain.FosterHomeActionApprove, "", domain.FosterHomeStatusApproved, domain.FosterHomeStatusPending)
}

func (s *fosterHomeService) Reject(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error) {
	if reason == "" {
		return nil, domain.ErrRejectionReasonRequired
	}
	return s.transition(ctx, adminID, id, domain.FosterHomeActionReject, reason, domain.FosterHomeStatusRejected, domain.FosterHomeStatusPending)
}

func (s *fosterHomeService) Suspend(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error) {
	if reason == "" {
		return nil, domain.ErrSuspensionReasonRequired
	}
	return s.transition(ctx, adminID, id, domain.FosterHomeActionSuspend, reason, domain.FosterHomeStatusSuspended, domain.FosterHomeStatusApproved)
}

func (s *fosterHomeService) Reinstate(ctx context.Context, adminID, id string) (*domain.FosterHome, error) {
	return s.transition(ctx, adminID, id, domain.FosterHomeActionReinstate, "", domain.FosterHomeStatusApproved, domain.FosterHomeStatusSuspended)
}

func (s *fosterHomeService) ModerationLogs(ctx context.Context, id string) ([]domain.FosterHomeModerationLog, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.auditRepo.ListModerationLogs(ctx, fhUUID)
}

func (s *fosterHomeService) ChangeLogs(ctx context.Context, id string) ([]domain.FosterHomeChangeLog, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.auditRepo.ListChangeLogs(ctx, fhUUID)
}
```

- [ ] **Step 3: Correr toda la suite del service**

Run: `cd backend && go test ./tests/ -run 'TestRegisterOwn|TestSuspend|TestEditSuspended' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/service/foster_home_service.go backend/tests/foster_home_service_test.go
git commit -m "feat(foster-homes): admin moderation with forensic logs"
```

---

## Task 8: Service + Handler — fotos del hogar (Cloudinary)

**Files:**
- Create: `backend/internal/service/foster_home_photo_service.go`
- Test: `backend/tests/foster_home_photo_test.go`

- [ ] **Step 1: Escribir el service de fotos**

Reutiliza la interface `ImageUploader` (ya existe en `photo_service.go`, mismo package `service`). Carpeta Cloudinary: `foster_homes`. Límite: 5.

`backend/internal/service/foster_home_photo_service.go`:
```go
package service

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

const maxPhotosPerFosterHome = 5

type FosterHomePhotoService interface {
	Upload(ctx context.Context, userID string, file io.Reader, filename string) (*domain.FosterHomePhoto, error)
	Delete(ctx context.Context, userID, photoID string) error
}

type fosterHomePhotoService struct {
	fhRepo    repository.FosterHomeRepository
	photoRepo repository.FosterHomePhotoRepository
	storage   ImageUploader
}

func NewFosterHomePhotoService(
	fhRepo repository.FosterHomeRepository,
	photoRepo repository.FosterHomePhotoRepository,
	storage ImageUploader,
) FosterHomePhotoService {
	return &fosterHomePhotoService{fhRepo: fhRepo, photoRepo: photoRepo, storage: storage}
}

func (s *fosterHomePhotoService) Upload(ctx context.Context, userID string, file io.Reader, filename string) (*domain.FosterHomePhoto, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.fhRepo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, err // ErrFosterHomeNotFound se propaga
	}
	count, err := s.photoRepo.CountByFosterHome(ctx, fh.ID)
	if err != nil {
		return nil, err
	}
	if count >= maxPhotosPerFosterHome {
		return nil, domain.ErrTooManyFosterPhotos
	}
	if s.storage == nil {
		return nil, domain.ErrStorageFailed
	}
	publicID := fmt.Sprintf("foster_homes/%s/%d", fh.ID, time.Now().UnixMilli())
	secureURL, returnedID, err := s.storage.UploadImage(ctx, file, publicID, "foster_homes")
	if err != nil {
		return nil, domain.ErrStorageFailed
	}
	p := &domain.FosterHomePhoto{FosterHomeID: fh.ID, URL: secureURL, PublicID: returnedID}
	if err := s.photoRepo.Create(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *fosterHomePhotoService) Delete(ctx context.Context, userID, photoID string) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	fh, err := s.fhRepo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return err
	}
	pID, err := uuid.Parse(photoID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	photo, err := s.photoRepo.FindByID(ctx, pID)
	if err != nil {
		return err
	}
	if photo.FosterHomeID != fh.ID {
		return domain.ErrPhotoNotFound // no es dueño de esta foto
	}
	if s.storage != nil && photo.PublicID != "" {
		_ = s.storage.Delete(ctx, photo.PublicID) // best-effort
	}
	return s.photoRepo.DeleteByID(ctx, pID)
}
```

- [ ] **Step 2: Test del límite de 5 fotos**

`backend/tests/foster_home_photo_test.go`:
```go
package tests

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

type fakePhotoRepo struct{ n int64 }

func (f *fakePhotoRepo) Create(context.Context, *domain.FosterHomePhoto) error { f.n++; return nil }
func (f *fakePhotoRepo) CountByFosterHome(context.Context, uuid.UUID) (int64, error) {
	return f.n, nil
}
func (f *fakePhotoRepo) FindByFosterHome(context.Context, uuid.UUID) ([]domain.FosterHomePhoto, error) {
	return nil, nil
}
func (f *fakePhotoRepo) FindByID(context.Context, uuid.UUID) (*domain.FosterHomePhoto, error) {
	return nil, domain.ErrPhotoNotFound
}
func (f *fakePhotoRepo) DeleteByID(context.Context, uuid.UUID) error { return nil }

type stubUploader struct{}

func (stubUploader) UploadImage(_ context.Context, _ io.Reader, _, _ string) (string, string, error) {
	return "https://cdn/x.jpg", "foster_homes/x", nil
}
func (stubUploader) Delete(context.Context, string) error { return nil }

// fhRepo con un hogar del owner.
type oneHomeRepo struct{ owner uuid.UUID; id uuid.UUID }

func (r oneHomeRepo) Create(context.Context, *domain.FosterHome) error { return nil }
func (r oneHomeRepo) GetByID(context.Context, uuid.UUID) (*domain.FosterHome, error) {
	return &domain.FosterHome{ID: r.id, OwnerUserID: r.owner}, nil
}
func (r oneHomeRepo) GetByOwner(_ context.Context, o uuid.UUID) (*domain.FosterHome, error) {
	if o == r.owner {
		return &domain.FosterHome{ID: r.id, OwnerUserID: r.owner}, nil
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (r oneHomeRepo) GetApproved(context.Context, string, string) ([]domain.FosterHome, error) {
	return nil, nil
}
func (r oneHomeRepo) GetPendingQueue(context.Context) ([]domain.FosterHome, error) { return nil, nil }
func (r oneHomeRepo) Update(context.Context, *domain.FosterHome) error             { return nil }

func TestUpload_RejectsSixthPhoto(t *testing.T) {
	owner := uuid.New()
	fhRepo := oneHomeRepo{owner: owner, id: uuid.New()}
	photoRepo := &fakePhotoRepo{n: 5}
	svc := service.NewFosterHomePhotoService(fhRepo, photoRepo, stubUploader{})

	_, err := svc.Upload(context.Background(), owner.String(), strings.NewReader("x"), "a.jpg")
	if err != domain.ErrTooManyFosterPhotos {
		t.Fatalf("got %v, want ErrTooManyFosterPhotos", err)
	}
}
```

- [ ] **Step 3: Correr el test**

Run: `cd backend && go test ./tests/ -run TestUpload_RejectsSixthPhoto -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/service/foster_home_photo_service.go backend/tests/foster_home_photo_test.go
git commit -m "feat(foster-homes): photo service with 5-photo limit and Cloudinary folder"
```

---

## Task 9: Denuncias — extender AbuseReport

**Files:**
- Modify: `backend/internal/dto/abuse_report_dto.go`
- Modify: `backend/internal/service/abuse_report_service.go`
- Test: `backend/tests/foster_home_abuse_test.go`

- [ ] **Step 1: Extender el request DTO**

En `backend/internal/dto/abuse_report_dto.go`, agregar el campo a `CreateAbuseReportRequest`:
```go
	TargetFosterHomeID *uuid.UUID `json:"target_foster_home_id"`
```
Y en `AbuseReportResponse`:
```go
	TargetFosterHomeID *uuid.UUID `json:"target_foster_home_id,omitempty"`
```
En `ToAbuseReportResponse`, copiar el campo:
```go
		TargetFosterHomeID: r.TargetFosterHomeID,
```

- [ ] **Step 2: Escribir el test (no self-report + dedupe)**

`backend/tests/foster_home_abuse_test.go` — testea la regla de negocio del service. Ajustá el nombre del constructor/método a la firma real de `AbuseReportService` (inspeccioná `abuse_report_service.go` antes). Estructura esperada:
```go
package tests

// Verifica dos invariantes al denunciar un hogar:
//  (1) un usuario no puede denunciar su PROPIO hogar → ErrSelfAbuseReport
//  (2) una segunda denuncia pending del mismo (denunciante, hogar) → ErrDuplicateAbuseReport
// (Implementar con los fakes del repo de abuse + foster home siguiendo el patrón
//  de foster_home_service_test.go.)
```
> Este test depende de la firma concreta del `AbuseReportService`. El implementador debe: (a) leer `abuse_report_service.go`, (b) agregar al método `Create` (o equivalente) la validación: si `TargetFosterHomeID != nil`, cargar el hogar; si `fh.OwnerUserID == reporterID` → `ErrSelfAbuseReport`; y chequear duplicado pending vía el índice único (el `Create` del repo devolverá error de constraint → mapear a `ErrDuplicateAbuseReport`, o pre-check con un `count`).

- [ ] **Step 3: Implementar la validación en el service**

En `backend/internal/service/abuse_report_service.go`, dentro de la creación de denuncia, agregar (adaptando a la firma real):
```go
	if req.TargetFosterHomeID != nil {
		fh, err := s.fosterHomeRepo.GetByID(ctx, *req.TargetFosterHomeID)
		if err != nil {
			return nil, err // ErrFosterHomeNotFound
		}
		if fh.OwnerUserID == reporterUUID {
			return nil, domain.ErrSelfAbuseReport
		}
	}
```
> Inyectar `repository.FosterHomeRepository` en el `abuseReportService` (agregar al struct + constructor + wiring en main.go). El dedupe lo garantiza el índice único parcial de la migración (Task 3); mapear el error de constraint de Postgres a `domain.ErrDuplicateAbuseReport` en el repo `Create`, o hacer un pre-check `count` de denuncias pending por `(reporter, foster_home)`.

- [ ] **Step 4: Correr el test**

Run: `cd backend && go test ./tests/ -run FosterHomeAbuse -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dto/abuse_report_dto.go backend/internal/service/abuse_report_service.go backend/tests/foster_home_abuse_test.go
git commit -m "feat(foster-homes): abuse reports against foster homes"
```

---

## Task 10: Hook de contacto del dueño (perfil)

**Files:**
- Modify: `backend/internal/service/auth_service.go` (o el handler `UpdateMe`) — inspeccionar cuál actualiza el perfil.

- [ ] **Step 1: Localizar el update de perfil**

Run: `cd backend && grep -n "func.*UpdateMe\|func.*UpdateProfile\|user.Phone =" internal/handler/auth_handler.go internal/service/auth_service.go`
Identificar dónde se aplican los cambios de `name`/`phone`/`email` del usuario autenticado.

- [ ] **Step 2: Calcular el diff de contacto y registrar**

Antes de persistir el usuario, capturar los valores viejos; después de persistir, si cambió `name`/`phone`/`email`, construir `changed map[string][2]string` y llamar:
```go
	// Hook forense: si el usuario tiene un hogar transitorio, registrar el cambio
	// de contacto (§18.1) — cubre el vector "edito el perfil para evadir el contacto".
	if s.fosterHomeService != nil && len(contactChanged) > 0 {
		_ = s.fosterHomeService.RecordOwnerContactChange(ctx, user.ID, contactChanged)
	}
```
Donde `contactChanged` solo incluye los campos que efectivamente cambiaron, ej.:
```go
	contactChanged := map[string][2]string{}
	if oldPhone != user.Phone {
		contactChanged["phone"] = [2]string{oldPhone, user.Phone}
	}
	if oldName != user.Name {
		contactChanged["name"] = [2]string{oldName, user.Name}
	}
	if oldEmail != user.Email {
		contactChanged["email"] = [2]string{oldEmail, user.Email}
	}
```
> Inyectar `FosterHomeService` en el service/handler de auth (campo opcional; puede ser nil → no-op). Evita import cycle: `FosterHomeService` está en el mismo package `service`, así que es una dependencia interna directa.

- [ ] **Step 3: Verificar compilación y correr tests de auth**

Run: `cd backend && go build ./... && go test ./tests/ -run Auth -v`
Expected: build OK; los tests de auth existentes siguen verdes.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/service/auth_service.go backend/internal/handler/auth_handler.go
git commit -m "feat(foster-homes): record owner contact changes for forensic history"
```

---

## Task 11: Handler

**Files:**
- Create: `backend/internal/handler/foster_home_handler.go`
- Test: `backend/tests/foster_home_handler_test.go`

- [ ] **Step 1: Escribir el handler**

Espeja `shelter_handler.go`. `getUserID(c)` ya existe en `handler/helpers.go`. Todos los métodos usan `writeError`.

`backend/internal/handler/foster_home_handler.go`:
```go
package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

const maxFosterPhotoSize = 5 * 1024 * 1024

type FosterHomeHandler struct {
	svc      service.FosterHomeService
	photoSvc service.FosterHomePhotoService
}

func NewFosterHomeHandler(svc service.FosterHomeService, photoSvc service.FosterHomePhotoService) *FosterHomeHandler {
	return &FosterHomeHandler{svc: svc, photoSvc: photoSvc}
}

// POST /api/foster-homes
func (h *FosterHomeHandler) RegisterOwn(c *gin.Context) {
	var req dto.RegisterFosterHomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	fh := dto.ToRegisterFosterHomeDomain(&req)
	if err := h.svc.RegisterOwn(c.Request.Context(), getUserID(c), fh); err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailNotVerified):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrFosterHomeAlreadyOwned):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusCreated, dto.ToMyFosterHomeResponse(fh))
}

// GET /api/foster-homes/mine
func (h *FosterHomeHandler) GetMine(c *gin.Context) {
	fh, err := h.svc.GetMine(c.Request.Context(), getUserID(c))
	if err != nil {
		writeFHNotFoundOr500(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

// PUT /api/foster-homes/mine
func (h *FosterHomeHandler) UpdateMine(c *gin.Context) {
	var req dto.UpdateMyFosterHomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	fh, err := h.svc.UpdateMine(c.Request.Context(), getUserID(c), &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrFosterHomeSuspended):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

// GET /api/foster-homes  (?city= &animal_type=)
func (h *FosterHomeHandler) List(c *gin.Context) {
	list, err := h.svc.GetApproved(c.Request.Context(), c.Query("city"), c.Query("animal_type"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToFosterHomeListResponse(list))
}

// GET /api/foster-homes/:id
func (h *FosterHomeHandler) GetByID(c *gin.Context) {
	fh, err := h.svc.GetApprovedByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeFHNotFoundOr500(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToFosterHomeResponse(fh))
}

// POST /api/foster-homes/mine/photos  (multipart "photo")
func (h *FosterHomeHandler) UploadPhoto(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFosterPhotoSize+1024)
	if err := c.Request.ParseMultipartForm(maxFosterPhotoSize); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}
	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrPhotoFieldRequired)
		return
	}
	defer file.Close()
	if header.Size > maxFosterPhotoSize {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := strings.Split(http.DetectContentType(buf[:n]), ";")[0]
	if !allowedMIMETypes[mime] {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidFileType)
		return
	}
	if _, err := file.Seek(0, 0); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	photo, err := h.photoSvc.Upload(c.Request.Context(), getUserID(c), file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrTooManyFosterPhotos):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrStorageFailed):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusCreated, dto.FosterHomePhotoResponse{ID: photo.ID, URL: photo.URL})
}

// DELETE /api/foster-homes/mine/photos/:photoId
func (h *FosterHomeHandler) DeletePhoto(c *gin.Context) {
	if err := h.photoSvc.Delete(c.Request.Context(), getUserID(c), c.Param("photoId")); err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound), errors.Is(err, domain.ErrPhotoNotFound):
			writeError(c, http.StatusNotFound, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// --- Admin ---

func (h *FosterHomeHandler) PendingQueue(c *gin.Context) {
	list, err := h.svc.GetPendingQueue(c.Request.Context())
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeListResponse(list))
}

func (h *FosterHomeHandler) Approve(c *gin.Context) {
	fh, err := h.svc.Approve(c.Request.Context(), getUserID(c), c.Param("id"))
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Reject(c *gin.Context) {
	var req dto.ReasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrRejectionReasonRequired)
		return
	}
	fh, err := h.svc.Reject(c.Request.Context(), getUserID(c), c.Param("id"), req.Reason)
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Suspend(c *gin.Context) {
	var req dto.ReasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrSuspensionReasonRequired)
		return
	}
	fh, err := h.svc.Suspend(c.Request.Context(), getUserID(c), c.Param("id"), req.Reason)
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Reinstate(c *gin.Context) {
	fh, err := h.svc.Reinstate(c.Request.Context(), getUserID(c), c.Param("id"))
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) ModerationLogs(c *gin.Context) {
	logs, err := h.svc.ModerationLogs(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, logs)
}

func (h *FosterHomeHandler) ChangeLogs(c *gin.Context) {
	logs, err := h.svc.ChangeLogs(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, logs)
}

// helpers
func writeFHNotFoundOr500(c *gin.Context, err error) {
	if errors.Is(err, domain.ErrFosterHomeNotFound) {
		writeError(c, http.StatusNotFound, err)
		return
	}
	if errors.Is(err, domain.ErrInvalidInput) {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}

func writeFHTransitionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrFosterHomeNotFound):
		writeError(c, http.StatusNotFound, err)
	case errors.Is(err, domain.ErrInvalidFosterHomeStatus):
		writeError(c, http.StatusConflict, err)
	case errors.Is(err, domain.ErrRejectionReasonRequired), errors.Is(err, domain.ErrSuspensionReasonRequired), errors.Is(err, domain.ErrInvalidInput):
		writeError(c, http.StatusBadRequest, err)
	default:
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
	}
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd backend && go build ./...`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/handler/foster_home_handler.go
git commit -m "feat(foster-homes): HTTP handlers"
```

---

## Task 12: Wiring — rutas, DI y AutoMigrate

**Files:**
- Modify: `backend/internal/app/router.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Inspeccionar el wiring de refugios**

Run: `cd backend && grep -n "shelter\|Shelter" internal/app/router.go cmd/server/main.go`
Ubicar: dónde se construyen los servicios/handlers (main.go) y dónde se registran los grupos de rutas protegidas y admin (router.go).

- [ ] **Step 2: DI en main.go**

En `backend/cmd/server/main.go`, junto al resto de constructores, agregar:
```go
	fosterHomeRepo := repository.NewFosterHomeRepository(db)
	fosterHomePhotoRepo := repository.NewFosterHomePhotoRepository(db)
	fosterHomeAuditRepo := repository.NewFosterHomeAuditRepository(db)
	fosterHomeService := service.NewFosterHomeService(fosterHomeRepo, userRepo, fosterHomeAuditRepo, eventBus)
	fosterHomePhotoService := service.NewFosterHomePhotoService(fosterHomeRepo, fosterHomePhotoRepo, cloudinaryClient)
	fosterHomeHandler := handler.NewFosterHomeHandler(fosterHomeService, fosterHomePhotoService)
```
> Usar los nombres reales de `userRepo`, `eventBus`, `cloudinaryClient` que ya existan en main.go (verificar en el Step 1). Pasar `fosterHomeService` al service de auth (Task 10) y al de abuse (Task 9) en su construcción.

- [ ] **Step 3: AutoMigrate**

En `main.go` (y en `cmd/seed/main.go` si corresponde), agregar los modelos al `db.AutoMigrate(...)`:
```go
		&domain.FosterHome{}, &domain.FosterHomePhoto{},
		&domain.FosterHomeModerationLog{}, &domain.FosterHomeChangeLog{},
```

- [ ] **Step 4: Rutas en router.go**

Dentro del grupo protegido por Auth (mismo grupo que usa `/pets`, `/shelters/mine`, etc.) agregar:
```go
	fosterHomes := protected.Group("/foster-homes")
	{
		fosterHomes.POST("", fosterHomeHandler.RegisterOwn)
		fosterHomes.GET("", fosterHomeHandler.List)
		fosterHomes.GET("/mine", fosterHomeHandler.GetMine)
		fosterHomes.PUT("/mine", fosterHomeHandler.UpdateMine)
		fosterHomes.POST("/mine/photos", fosterHomeHandler.UploadPhoto)
		fosterHomes.DELETE("/mine/photos/:photoId", fosterHomeHandler.DeletePhoto)
		fosterHomes.GET("/:id", fosterHomeHandler.GetByID)
	}
```
> **Cuidado con el conflicto de rutas Gin**: `GET /:id` y `GET /mine` en el mismo grupo pueden chocar. Gin (httprouter) NO permite un param `:id` y un path estático `mine` en la misma posición. **Solución:** registrar `/mine` como sub-path fijo ANTES, o mover el detalle a `GET /detail/:id`. Verificar el patrón que usa `shelters` (que tiene el mismo caso `/:id` vs `/mine`) y copiarlo exactamente. Si shelters lo resuelve, replicar; si no, usar `/:id` con un guard que trate `id == "mine"` aparte.

En el grupo admin (protegido por `RequireAdmin`, mismo que `/admin/shelters`):
```go
	adminFH := admin.Group("/foster-homes")
	{
		adminFH.GET("/pending", fosterHomeHandler.PendingQueue)
		adminFH.POST("/:id/approve", fosterHomeHandler.Approve)
		adminFH.POST("/:id/reject", fosterHomeHandler.Reject)
		adminFH.POST("/:id/suspend", fosterHomeHandler.Suspend)
		adminFH.POST("/:id/reinstate", fosterHomeHandler.Reinstate)
		adminFH.GET("/:id/logs", fosterHomeHandler.ModerationLogs)
		adminFH.GET("/:id/history", fosterHomeHandler.ChangeLogs)
	}
```

- [ ] **Step 5: Verificar compilación y arranque**

Run: `cd backend && go build ./... && go vet ./...`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/app/router.go backend/cmd/server/main.go backend/cmd/seed/main.go
git commit -m "feat(foster-homes): wire routes, DI and AutoMigrate"
```

---

## Task 13: E2E flow test

**Files:**
- Create: `backend/tests/e2e/foster_home_flow_test.go`

- [ ] **Step 1: Escribir el flow test**

Sigue el patrón de `backend/tests/e2e/adoption_flow_test.go` (build tag `//go:build e2e`). Cubre: registrar usuario + verificar email → `POST /api/foster-homes` (201, pending) → admin `approve` → aparece en `GET /api/foster-homes` → admin `suspend` con motivo → desaparece del directorio (404 en `GET /:id`) → `GET /api/admin/foster-homes/:id/logs` tiene el registro de suspend.

> Inspeccionar `adoption_flow_test.go` para el bootstrapping (router de test, helper de auth admin, seed de usuario verificado) y replicarlo. No inventar helpers nuevos si ya existen.

- [ ] **Step 2: Correr e2e**

Run: `cd backend && go test -tags e2e ./tests/e2e/ -run FosterHome -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/e2e/foster_home_flow_test.go
git commit -m "test(foster-homes): e2e register→approve→suspend flow"
```

---

## Task 14: Suite completa + cierre

- [ ] **Step 1: Correr TODA la suite backend**

Run: `cd backend && go test ./...`
Expected: PASS (sin romper tests existentes).

- [ ] **Step 2: Vet + build final**

Run: `cd backend && go vet ./... && go build ./...`
Expected: limpio.

- [ ] **Step 3: Verificación manual mínima (opcional, con DB local)**

Levantar `make dev` + backend, y con `curl` (o el seed) probar: registrar hogar sin email verificado → 403; registrar con email verificado → 201 pending; segundo registro → 409.

- [ ] **Step 4: Abrir PR (Fase 1)**

Seguir la convención del proyecto (skill `searchpet-pr`). Base `main`, rama `feat/foster-homes`. Título: `feat(foster-homes): backend — registration, moderation, forensic retention, abuse reports`.

---

## Self-Review (cobertura del spec)

- §3 Gate (email verificado, 1 por cuenta, pending) → Task 6.
- §4 Campos obligatorios + validación → Task 5 (`Validate`).
- §5 Modelo de datos (4 tablas + ReportAbuse) → Tasks 1, 3.
- §6 Moderación (approve/reject/suspend/reinstate + eventos) → Task 7, 11, 12.
- §7 Contacto (whatsapp opcional en el modelo; chat in-app usa el MessageService existente — sin cambios backend) → Tasks 1, 5.
- §8 Fotos (Cloudinary folder `foster_homes`, máx 5, tabla separada) → Tasks 4, 8.
- §9 Endpoints (todos JWT; no delete del hogar) → Tasks 11, 12.
- §13 Errores `{code,message}` → Tasks 2, 11.
- §18 Retención forense (cero delete, suspend, moderation log snapshots, freeze del suspended) → Tasks 6, 7.
- §18.1 Historial de ediciones (changelog en edit + hook de perfil) → Tasks 6, 10.
- §19 Denuncias (target foster home, no self, dedupe) → Tasks 3, 9.
- §14 Testing → Tasks 6, 7, 8, 9, 13, 14.

**Gaps deliberados (Fase 2/3, no backend):** i18n (frontend), shared types/hooks/client, UI web y mobile. Se listan en el spec §10–§12 y van en planes separados.

**Nota de riesgo (Task 12, Step 4):** el choque de rutas Gin `/:id` vs `/mine` es el punto más frágil — resolverlo mirando cómo lo hace `shelters`, que tiene exactamente el mismo caso.
