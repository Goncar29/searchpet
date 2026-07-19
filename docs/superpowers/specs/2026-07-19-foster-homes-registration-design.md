# Hogares Transitorios — Diseño (registro + visibilidad)

- **Fecha:** 2026-07-19
- **Estado:** Diseño aprobado (pendiente de review del spec)
- **Autor:** brainstorming Carlos + Claude
- **Alcance de esta iteración:** requisitos de registro, visibilidad y modelo de datos base de la sección "hogares transitorios", en backend + web + mobile, con i18n completo (es/en/pt).

---

## 1. Contexto y motivación

Un **hogar transitorio** es una persona que ofrece su domicilio para **alojar temporalmente** a un animal rescatado (perdido o callejero) hasta que se resuelva su situación. Complementa el directorio de refugios existente, pero es conceptualmente distinto:

| | Refugio (`shelters`) | Hogar transitorio (`foster_homes`) |
|---|---|---|
| Qué es | Institución | Persona / domicilio particular |
| Monetización | Enlaza a su web/donaciones | Ninguna |
| Visibilidad | Directorio **público** | **Privado** (solo usuarios logueados) |
| Contacto | Teléfono/email de la institución | Chat in-app + WhatsApp opcional |
| Confianza | Datos institucionales | Mayor cuidado: recibe un animal vivo en su casa |

La feature **reutiliza casi tal cual el patrón de auto-registro de refugios** (`ShelterService.RegisterOwn`): email verificado, máximo uno por cuenta, nace `pending`, cola de moderación admin, eventos. Las diferencias están en los campos propios del hogar, la visibilidad privada y el manejo de fotos.

---

## 2. Alcance

### Dentro de alcance
- Registro de un hogar transitorio por parte de un usuario autenticado con email verificado.
- Requisitos y validaciones de registro (gate + campos obligatorios).
- Moderación admin (pending → approved/rejected con motivo).
- **Seguridad y retención forense (§18):** el hogar **nunca se borra**; el dueño no puede eliminarlo; solo el admin puede **suspenderlo** (baja lógica con rastro). Registro inmutable para casos de estafa/animal robado.
- **Historial de cambios (§18.1):** toda edición del hogar y de los datos de contacto del dueño se registra append-only (before→after), para detectar ediciones hechas para evadir el contacto real.
- **Denuncias (§19):** cualquier usuario logueado puede denunciar un hogar; la denuncia entra por la cola de abuso existente y puede derivar en suspensión.
- Directorio **privado** de hogares aprobados (solo usuarios logueados).
- Detalle de un hogar + vías de contacto (chat in-app + WhatsApp opcional).
- Fotos del lugar en Cloudinary (carpeta y tabla separadas de las fotos de mascotas).
- Superficies web y mobile.
- i18n completo (es/en/pt) en todo lo anterior.

### Fuera de alcance (YAGNI — ver §16)
- Tracking de disponibilidad/ocupación en tiempo real (lleno/disponible).
- Reseñas o rating de hogares transitorios.
- Matching automático de mascotas `stray`/`lost` con hogares.
- Verificación por OTP del teléfono de WhatsApp.
- Georreferencia fina en mapa (se filtra por ciudad; lat/lng queda opcional para el futuro).

---

## 3. Modelo de confianza y visibilidad

**Gate de elegibilidad** (antes de aceptar el registro):
1. Usuario autenticado (JWT).
2. **Email verificado** (`user.EmailVerified`). Si no → `403 email_not_verified`.
3. **Máximo un hogar transitorio por cuenta** (índice único). Segundo intento → `409 foster_home_already_owned`.
4. El registro **nace `pending`** → cola de moderación admin.

**Visibilidad: privada.** Toda la sección exige login. Un visitante anónimo no ve el directorio ni el detalle. Razones:
- Se exponen domicilios particulares y fotos de la casa → regla #3 (privacidad).
- El contacto base (chat in-app) ya exige login, así que "ver sin poder actuar" no aporta alcance real.

Consecuencia técnica: a diferencia de `shelters` (cuyo `GET /api/shelters` es público), **todos** los endpoints de `foster_homes` van detrás del middleware de auth.

---

## 4. Requisitos de registro

### Campos obligatorios
| Campo | Tipo | Validación |
|---|---|---|
| `city` | string | requerido, no vacío (trim) |
| `animal_types` | enum[] | requerido, ≥1; valores en `{dog, cat, other}` |
| `capacity` | int | requerido, ≥1 |
| `housing_type` | enum | requerido, `{house, apartment}` |
| `description` | string | requerido, no vacío (trim) |

### Contacto (§7)
- **Chat in-app: siempre disponible** — no requiere ningún campo extra (usa `owner_user_id`).
- **WhatsApp: opcional** — `whatsapp_phone *string`. Si se carga, se muestra en el detalle; si no, el hogar sigue contactable por chat.

### Fotos (§8)
- Opcionales, **máximo 5** por hogar.
- Cloudinary carpeta `foster_homes/`, tabla `foster_home_photos` (separada de `photos`, que es de mascotas).

### Patrón de edición (rule #22)
Los campos opcionales en el request de edición son punteros (`*string`): `nil` = no tocar, `&""` = vaciar. Igual que `UpdateMyShelterRequest`.

---

## 5. Modelo de datos

### Tabla `foster_homes`
```go
// FosterHome representa el hogar transitorio de un usuario.
type FosterHome struct {
    ID            uuid.UUID       `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    OwnerUserID   uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex" json:"owner_user_id"`
    City          string          `gorm:"not null" json:"city"`
    HousingType   string          `gorm:"not null;size:20" json:"housing_type"`   // house | apartment
    AnimalTypes   pq.StringArray  `gorm:"type:text[];not null" json:"animal_types"` // dog | cat | other
    Capacity      int             `gorm:"not null" json:"capacity"`
    Description   string          `gorm:"not null" json:"description"`
    WhatsappPhone *string         `gorm:"size:20" json:"whatsapp_phone,omitempty"`
    Latitude      *float64        `json:"latitude,omitempty"`  // opcional (futuro mapa)
    Longitude     *float64        `json:"longitude,omitempty"`
    Status        string          `gorm:"not null;default:'pending';index" json:"status"`
    RejectionReason string        `gorm:"size:500" json:"rejection_reason,omitempty"`
    CreatedAt     time.Time       `gorm:"autoCreateTime" json:"created_at"`
    UpdatedAt     time.Time       `gorm:"autoUpdateTime" json:"updated_at"`

    Owner  User              `gorm:"foreignKey:OwnerUserID" json:"-"`
    Photos []FosterHomePhoto `gorm:"foreignKey:FosterHomeID" json:"photos,omitempty"`
}
```

### Tabla `foster_home_photos`
```go
// FosterHomePhoto es una foto del ESPACIO del hogar (no de una mascota).
type FosterHomePhoto struct {
    ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    FosterHomeID uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
    URL          string    `gorm:"not null" json:"url"`        // Cloudinary secure_url
    PublicID     string    `gorm:"not null" json:"-"`          // Cloudinary public_id (para borrar)
    CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}
```

### Estados (enum, mismo criterio que `ShelterStatus`)
```go
const (
    FosterHomeStatusPending   = "pending"
    FosterHomeStatusApproved  = "approved"
    FosterHomeStatusRejected  = "rejected"
    FosterHomeStatusSuspended = "suspended" // baja lógica admin (§18) — NUNCA se borra
)
```
El estado `suspended` es **terminal desde la óptica del dueño**: el hogar desaparece del directorio pero el registro se conserva (evidencia). Solo un admin puede suspender/reinstaurar. No hay borrado físico en ningún estado.

### Extensión de `reports_abuse` (denuncias — §19)
Se agrega un tercer target a la tabla existente (hoy soporta `TargetUserID` **o** `TargetReportID`):
```go
// En domain.ReportAbuse — nuevo campo (nullable, mismo patrón polimórfico):
TargetFosterHomeID *uuid.UUID `gorm:"type:uuid;column:target_foster_home_id" json:"target_foster_home_id,omitempty"`
FosterHome         *FosterHome `gorm:"foreignKey:TargetFosterHomeID;constraint:OnDelete:SET NULL" json:"-"`
```
No se crea una cola nueva: la denuncia usa la MISMA cola/flujo de `AbuseReportService` + admin.

### Tabla `foster_home_moderation_logs` (rastro forense)
`AdminAuditLog` no sirve (su `CHECK` está atado a `grant`/`revoke` de rol admin). Tabla dedicada con **snapshots** para que la evidencia sobreviva aunque el dueño edite/limpie sus datos después:
```go
// FosterHomeModerationLog registra CADA acción de moderación sobre un hogar.
// Snapshots inmutables: identidad y contacto del dueño AL MOMENTO de la acción.
type FosterHomeModerationLog struct {
    ID               uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    FosterHomeID     uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
    ActorAdminID     uuid.UUID `gorm:"type:uuid;not null;index" json:"actor_admin_id"`
    Action           string    `gorm:"size:20;not null" json:"action"` // approve|reject|suspend|reinstate
    Reason           string    `gorm:"size:500" json:"reason"`
    OwnerUserID      uuid.UUID `gorm:"type:uuid;not null" json:"owner_user_id"`      // snapshot
    OwnerEmail       string    `gorm:"size:255" json:"owner_email"`                 // snapshot
    OwnerPhone       string    `gorm:"size:20" json:"owner_phone"`                  // snapshot
    OwnerWhatsapp    string    `gorm:"size:20" json:"owner_whatsapp"`               // snapshot
    CreatedAt        time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}
```
Esta tabla **tampoco** se purga nunca.

### Tabla `foster_home_change_logs` (historial de ediciones — §18.1)
Append-only: una fila por cada edición del hogar o de los datos de contacto del dueño. Detecta cambios hechos para evadir el contacto real. Nunca se purga.
```go
// FosterHomeChangeLog registra cada EDICIÓN (no acción admin) con el diff
// before→after y un snapshot del contacto vigente del dueño.
type FosterHomeChangeLog struct {
    ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
    FosterHomeID  uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
    EditedByID    uuid.UUID `gorm:"type:uuid;not null;index" json:"edited_by_id"` // normalmente el dueño
    ChangeType    string    `gorm:"size:30;not null" json:"change_type"`          // listing_edit | owner_contact_changed
    // Diff JSON: { "field": {"old": "...", "new": "..."} } — solo los campos que cambiaron.
    ChangedFields string    `gorm:"type:jsonb" json:"changed_fields"`
    // Snapshot del contacto vigente DESPUÉS del cambio (redundante a propósito para lectura forense directa).
    OwnerEmail    string    `gorm:"size:255" json:"owner_email"`
    OwnerPhone    string    `gorm:"size:20" json:"owner_phone"`
    OwnerWhatsapp string    `gorm:"size:20" json:"owner_whatsapp"`
    CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}
```
**Dónde se escribe:**
- `listing_edit`: en `PUT /api/foster-homes/mine` (service), calculando el diff contra el estado previo antes de persistir.
- `owner_contact_changed`: cuando el dueño de un hogar edita sus datos de contacto en el perfil (`PUT /api/auth/me`), se engancha un hook que, **si el usuario posee un hogar transitorio**, registra el diff de los campos de contacto (`name`, `phone`, `email`, y el `whatsapp_phone` del hogar). Evita el vector "edito el perfil, no el hogar, para escaparle al contacto".

> Nota de dependencia: el diff se guarda como JSON en una columna `jsonb` (string tipado). No requiere `gorm.io/datatypes` — se serializa con `encoding/json` en el service. Si se prefiere, alternativa: dos columnas `previous_snapshot`/`new_snapshot` jsonb.

### Migración SQL
- Nueva migración numerada (siguiente número libre en `backend/migrations/`).
- Crea `foster_homes`, `foster_home_photos`, `foster_home_moderation_logs` y `foster_home_change_logs`.
- Agrega la columna `target_foster_home_id` a `reports_abuse` (denuncias, §19).
- `OwnerUserID` con **índice único** (un hogar por cuenta). Como el owner es `NOT NULL` (siempre auto-registro, no hay creación admin sin dueño), un unique index simple alcanza — no hace falta el índice parcial que usa `shelters` (que sí permite owner nulo).
- Índice GIN sobre `animal_types` para filtrar por tipo.
- Nota infra: `AutoMigrate` corre en el deploy (regla #19). La migración SQL cubre lo que AutoMigrate no expresa (índice GIN, defaults).

**Nota `pq.StringArray`:** requiere `github.com/lib/pq` (ya es dependencia transitiva vía golang-migrate). Alternativa si se prefiere evitarla: tabla hija `foster_home_animal_types`. Se elige `text[]` por simplicidad y por permitir filtro con un solo índice GIN.

---

## 6. Moderación

Reutiliza el flujo de `shelters` **simplificado** (no hay "staging de links" como en refugios — un hogar no tiene links de donación, así que no existe la sub-moderación de `Pending*`).

| Transición | Endpoint | Evento publicado |
|---|---|---|
| Registro | `POST /api/foster-homes` | `foster_home.submitted` |
| Aprobar (pending → approved) | `POST /api/admin/foster-homes/:id/approve` | `foster_home.approved` |
| Rechazar (pending → rejected, con motivo) | `POST /api/admin/foster-homes/:id/reject` | `foster_home.rejected` |
| **Suspender (approved → suspended, con motivo)** | `POST /api/admin/foster-homes/:id/suspend` | `foster_home.suspended` |
| **Reinstaurar (suspended → approved)** | `POST /api/admin/foster-homes/:id/reinstate` | `foster_home.approved` |

- Cada transición admin escribe un `FosterHomeModerationLog` con snapshots (§18).
- `GetByID` del directorio: solo sirve `approved`; `pending`/`rejected`/`suspended` responden `404 foster_home_not_found` (no revela existencia, igual que refugios).
- El dueño ve su propio hogar en cualquier estado vía `GET /api/foster-homes/mine` (incluye `status` y `rejection_reason`).
- Editar un hogar `rejected` lo puede volver a `pending` (resubmit), igual que refugios. Un hogar `suspended` queda **congelado**: el dueño NO puede editarlo ni reactivarlo (solo el admin).
- **No existe borrado.** Ver §18 — no hay endpoint de delete del hogar para ningún rol; el admin suspende, no purga.

**Listeners de eventos (mínimos):**
- `foster_home.submitted` → `NotificationService` avisa a admins (o queda para la cola admin; push opcional).
- `foster_home.approved` / `foster_home.rejected` → `NotificationService` avisa al dueño.

---

## 7. Contacto

- **Chat in-app (siempre):** el detalle muestra un botón "Contactar" que abre una conversación con `owner_user_id` usando el `MessageService` existente (sender/receiver). Respeta bloqueos bidireccionales (ya implementado).
- **WhatsApp (opcional):** si `whatsapp_phone` está seteado, se muestra un botón que abre `wa.me/<phone>` con mensaje pre-llenado (reutilizar `buildWhatsAppMessage` en `shared/utils`). Como toda la sección es privada, el teléfono solo lo ven usuarios logueados.

Esto evita el problema conocido de "dueño incontactable" (el chat in-app es el piso garantizado).

---

## 8. Fotos

- **Proveedor:** Cloudinary (el mismo de todo el proyecto — mantiene el $0/mes y el patrón único de imágenes).
- **Carpeta:** `foster_homes/` (separada de las fotos de mascotas).
- **Tabla:** `foster_home_photos` (FK a `foster_homes`), separada de `photos` (FK a `pets`).
- **Reutilización:** `pkg/storage` (Cloudinary) ya expone upload/delete con `public_id`; se agrega el parámetro de carpeta.
- **Límite:** máximo 5 fotos por hogar (validado en el service al subir).
- **Endpoints:** subir/borrar foto del propio hogar (§9).

---

## 9. API endpoints

Todos **JWT** (sección privada). Espejo de `shelters` menos la parte pública.

### Usuario (dueño)
```
POST   /api/foster-homes             → RegisterOwn (nace pending)
GET    /api/foster-homes/mine        → mi hogar (cualquier estado, con status/rejection_reason)
PUT    /api/foster-homes/mine        → editar mi hogar (rule #22; rejected → resubmit; BLOQUEADO si suspended)
POST   /api/foster-homes/mine/photos → subir foto (Cloudinary, máx 5)
DELETE /api/foster-homes/mine/photos/:photoId → borrar foto
```
> **NO existe `DELETE /api/foster-homes/mine`.** Por diseño (§18) el dueño no puede borrar su hogar — es evidencia potencial. La única baja es la suspensión admin.

### Denuncias (usuario logueado)
```
POST   /api/abuse-reports            → denunciar (body con target_foster_home_id) — endpoint EXISTENTE extendido
```

### Directorio (usuarios logueados)
```
GET    /api/foster-homes             → directorio (solo approved); filtros ?city= &animal_type=
GET    /api/foster-homes/:id         → detalle (solo approved; 404 si no)
```

### Admin (JWT + RequireAdmin)
```
GET    /api/admin/foster-homes/pending        → cola de revisión
POST   /api/admin/foster-homes/:id/approve    → pending → approved
POST   /api/admin/foster-homes/:id/reject     → pending → rejected (body {"reason": "..."})
POST   /api/admin/foster-homes/:id/suspend    → approved → suspended (body {"reason": "..."}, §18)
POST   /api/admin/foster-homes/:id/reinstate  → suspended → approved
GET    /api/admin/foster-homes/:id/logs       → rastro de moderación (FosterHomeModerationLog, §18)
GET    /api/admin/foster-homes/:id/history    → historial de ediciones (FosterHomeChangeLog, §18.1)
```
Las denuncias de hogares se ven en la cola de abuso admin existente (`GET /api/admin/abuse-reports`), enriquecida con la referencia al hogar.

### DTOs (espejo de shelter_dto.go)
- `RegisterFosterHomeRequest` + `Validate()` → `ToRegisterFosterHomeDomain`.
- `UpdateMyFosterHomeRequest` (opcionales `*string`) → aplica en el service.
- `FosterHomeResponse` (vista de directorio) / `MyFosterHomeResponse` (dueño: + status/rejection_reason) / `AdminFosterHomeResponse` (+ owner_user_id).

---

## 10. Frontend web (`packages/web`)

Rutas **protegidas** (dentro del guard de auth):
- `FosterHomesPage` — directorio privado con filtros ciudad/tipo de animal (patrón draft/applied de filtros, no dispara API por keystroke — Gap conocido ya resuelto en otras pantallas).
- `FosterHomeDetailPage` — detalle + galería de fotos + botones Contactar (chat) y WhatsApp (si hay).
- `RegisterFosterHomePage` — formulario de registro (wizard o single-form) con validación cliente espejo del `Validate()` backend.
- `MyFosterHomePage` — vista del dueño (estado, motivo de rechazo, editar, gestionar fotos).
- **Admin:** extender la sección admin existente con la cola de hogares pendientes + approve/reject (reutiliza el layout de la cola de refugios).

Reutilizar `PhotoBanner`/patrón de subida de imágenes ya existente. Client HTTP y hooks en `shared/` (regla #9).

---

## 11. Frontend mobile (`packages/mobile`)

- **Entrada:** ítem accesible para usuarios logueados (menú de perfil o tab secundaria; decidir en el plan según densidad de tabs — hoy hay 5).
- `app/foster-homes/index.tsx` — listado (privado).
- `app/foster-home/[id].tsx` — detalle + galería + Contactar (chat) + WhatsApp opcional.
- `app/foster-homes/register.tsx` — formulario de registro.
- `app/foster-homes/mine.tsx` — vista/edición del dueño + fotos.
- Reutilizar el patrón de subida de fotos de mobile (expo-image-picker + Cloudinary) y el `AdoptionFormStep`/wizard como referencia estructural.
- **Tests:** los smoke tests mockean `@shared/hooks` hook por hook (regla #17). Todo hook nuevo usado en una screen testeada debe agregarse a su mock. Usar `pnpm test:run` (NUNCA `pnpm test`, que es watch).

---

## 12. i18n (es / en / pt) — alcance completo

Requisito explícito: **toda** la feature i18n en los 3 idiomas, web y mobile. Nada hardcodeado.

- **Namespace nuevo:** `fosterHomes` (labels de UI, formulario, filtros, contacto, estados).
- **Web:** además de agregar el JSON en `web/src/i18n/locales/{es,en,pt}.json`, **registrar el namespace en `web/src/i18n/index.ts`** en los 3 bloques `es/en/pt` (regla #21 — si no, `useTranslation('fosterHomes')` devuelve la clave cruda).
- **Mobile:** agregar el namespace en los locales de mobile.
- **Labels enumerados** (nunca hardcodear):
  - Estados: `fosterHomes:status.pending|approved|rejected|suspended`.
  - Tipo de vivienda: `fosterHomes:housingType.house|apartment`.
  - Tipos de animal: `fosterHomes:animalType.dog|cat|other`.
  - Denuncia: botón/modal `fosterHomes:report.*` (motivo, confirmación, éxito).
  - Suspensión (admin): `fosterHomes:admin.suspend|reinstate|reason`.
- **Errores API:** en idioma del usuario vía `getErrorMessage(err, t)` desde `shared/utils/apiErrors.ts` (regla #11). Agregar los códigos nuevos (`foster_home_already_owned`, `foster_home_not_found`, etc.) al namespace `errors` en los 3 idiomas.

---

## 13. Manejo de errores (regla #11)

Todos los errores HTTP usan `writeError(c, status, err)` → `{code, message}`. Errores de dominio nuevos (en `domain/errors.go`, espejo de los de shelter):

| Error de dominio | HTTP | Code |
|---|---|---|
| `ErrEmailNotVerified` (reusar) | 403 | `email_not_verified` |
| `ErrFosterHomeAlreadyOwned` | 409 | `foster_home_already_owned` |
| `ErrFosterHomeNotFound` | 404 | `foster_home_not_found` |
| `ErrInvalidFosterHomeStatus` | 409 | `invalid_foster_home_status` |
| `ErrFosterHomeSuspended` (edición bloqueada) | 409 | `foster_home_suspended` |
| `ErrRejectionReasonRequired` (reusar) | 400 | `rejection_reason_required` |
| `ErrSuspensionReasonRequired` | 400 | `suspension_reason_required` |
| `ErrTooManyPhotos` | 400 | `too_many_photos` |
| `ErrInvalidInput` / `ErrBindingFailed` (reusar) | 400 | ... |

---

## 14. Testing

- **Backend:** tests de service (register: email no verificado → 403; segundo hogar → 409; nace pending), transiciones admin (approve/reject, reject sin motivo → 400), y filtro del directorio (solo approved). Espejo de `shelter_service_test.go` / `shelter_handler_test.go`.
- **Límite de fotos:** test de que la 6ª foto → `too_many_photos`.
- **Seguridad (§18/§19):** no existe delete del hogar (ninguna ruta); `approved → suspended` requiere motivo; editar un `suspended` → `409 foster_home_suspended`; cada transición admin escribe un `FosterHomeModerationLog` con snapshots; una edición del dueño escribe un `FosterHomeChangeLog` con el diff; editar el contacto en el perfil siendo dueño de un hogar escribe `owner_contact_changed`; no se puede denunciar el propio hogar; denuncia duplicada `pending` bloqueada.
- **Web:** tests de hooks nuevos en `shared/hooks` (los que tengan lógica real, no passthrough — ver política del proyecto). Correr con `pnpm vitest run --config vitest.shared.config.ts` desde `web/` (regla #14).
- **Mobile:** smoke tests de las screens con mocks de `@shared/hooks` (regla #17).
- **E2E (opcional):** flujo Go httptest register → pending → approve → aparece en directorio.

---

## 15. Reutilización del patrón de refugios — resumen de diferencias

**Se calca:** gate de email verificado, uno por cuenta (índice único), estado `pending`→`approved`/`rejected`, eventos, DTOs `Register/UpdateMine/My/Admin`, manejo de errores, `getByIDAnyStatus`, cola admin.

**Difiere:**
1. **Visibilidad privada** → todos los endpoints van con auth (refugios tiene `GET` público).
2. **Sin links de donación/website** → no existe la sub-moderación de `Pending*` links; la moderación es solo del registro completo.
3. **Campos propios** → `housing_type`, `animal_types[]`, `capacity`, `whatsapp_phone`.
4. **Fotos** → tabla `foster_home_photos` + carpeta Cloudinary (refugios no tiene fotos).
5. **Contacto** → chat in-app + WhatsApp opcional (refugios enlaza a su web/donación).
6. **Seguridad reforzada** (§18/§19, más estricto que refugios) → sin borrado para ningún rol, estado `suspended`, snapshots de moderación, **historial de ediciones** y **denuncias** integradas a la cola de abuso.

---

## 16. Fuera de alcance (YAGNI)

Explícitamente **NO** en esta iteración (candidatos a futuras):
- Disponibilidad/ocupación en tiempo real (toggle lleno/disponible).
- Reseñas/rating de hogares transitorios.
- Matching automático mascota↔hogar.
- Verificación OTP del WhatsApp.
- Mapa georreferenciado (se filtra por ciudad; lat/lng queda como columna opcional para no bloquear el futuro).

---

## 17. Defaults asumidos (a confirmar en review)

Marcados con mi mejor criterio; fáciles de cambiar antes del plan:
1. **Contacto:** chat in-app siempre + WhatsApp opcional (no se exige teléfono).
2. **Fotos:** opcionales, máximo 5.
3. **Capacidad:** entero ≥ 1.
4. **Sin lat/lng obligatorio:** filtrado por ciudad; georreferencia queda opcional.
5. **`animal_types`** como `text[]` (no tabla hija).
6. **Suspensión con motivo obligatorio** (igual que el reject); reinstauración sin motivo.
7. **Denuncia:** un usuario no puede denunciar su propio hogar; se permite 1 denuncia activa por (denunciante, hogar) para evitar spam (índice/guard). A confirmar.

---

## 18. Seguridad y retención forense (requisito crítico)

> Motivación (Carlos): aunque el admin apruebe, siempre existe posibilidad de estafa. Si un animal es robado, el registro del hogar es **evidencia**. La seguridad va ante todo.

**Principios (no negociables del diseño):**

1. **Cero borrado físico.** No hay `DELETE` del hogar para ningún rol. `foster_homes` y `foster_home_moderation_logs` **nunca** se purgan. No se usa soft-delete que oculte/pierda datos: el registro persiste con su `owner_user_id` intacto.
2. **El dueño no tiene poder de destrucción.** Puede registrar y editar (en `pending`/`approved`/`rejected`), nada más. No puede borrar ni desactivar. Si quiere dejar de ofrecer el hogar, lo gestiona un admin (suspensión) — así queda rastro.
3. **Solo el admin da de baja, y solo suspende.** `approved → suspended` con **motivo obligatorio**. Suspendido = fuera del directorio, pero el registro completo se conserva. Reversible con `reinstate` (solo admin).
4. **Snapshots forenses.** Cada acción de moderación escribe un `FosterHomeModerationLog` con copia inmutable de identidad y contacto del dueño (email, phone, whatsapp) **al momento de la acción** — para que un estafador que después limpie sus datos no borre la evidencia. La denuncia también retiene `reporter_id`.
5. **Congelamiento del suspendido.** Un hogar `suspended` no admite edición del dueño (`409 foster_home_suspended`) — se preserva el estado exacto que motivó la baja.
6. **Atribución completa.** Toda transición admin registra `actor_admin_id` + `reason` + timestamp. Quién aprobó, quién suspendió, cuándo y por qué.

**Consideración abierta (para review):** un dueño legítimo que quiere realmente irse queda dependiente del admin. Es una fricción deliberada a favor de la trazabilidad. Si más adelante molesta, se puede sumar un estado `owner_withdrawn` (auto-suspensión solicitada por el dueño) que igual conserva el registro — pero NO en esta iteración.

### 18.1 Historial de cambios (edición)

Complementa la retención: no alcanza con conservar el registro actual, hay que conservar **cómo cambió**. Un estafador podría editar su teléfono/WhatsApp para que el contacto real (víctima, autoridades) ya no lo alcance. Por eso:

- **Toda edición** del hogar (`PUT /api/foster-homes/mine`) escribe un `FosterHomeChangeLog` con el **diff before→after** de los campos que cambiaron + snapshot del contacto vigente.
- **Toda edición de contacto del dueño** (perfil, `PUT /api/auth/me`) que afecte a un usuario con hogar transitorio registra un `FosterHomeChangeLog` de tipo `owner_contact_changed` con el diff de `name`/`phone`/`email`/`whatsapp_phone`.
- Append-only, **nunca se purga**, sin endpoint de borrado.
- **Visible solo para admin** (`GET /api/admin/foster-homes/:id/history`). No se expone al dueño ni al público — es material de investigación.

Con esto quedan dos rastros complementarios: **quién moderó** (`foster_home_moderation_logs`, §18) y **qué editó el dueño y cuándo** (`foster_home_change_logs`, §18.1).

---

## 19. Denuncias de hogares

Reutiliza el sistema de abuso existente (`ReportAbuse` + `AbuseReportService` + cola admin) — no se crea nada paralelo.

- **Quién:** cualquier usuario logueado (la sección es privada, así que siempre hay identidad). No puede denunciar su propio hogar.
- **Cómo:** `POST /api/abuse-reports` con `target_foster_home_id` (nuevo target polimórfico junto a los existentes `target_user_id`/`target_report_id`). `reason` requerido.
- **Anti-spam:** máximo una denuncia `pending` por (denunciante, hogar). Segundo intento → error de duplicado (a confirmar el code exacto).
- **Flujo admin:** la denuncia aparece en `GET /api/admin/abuse-reports` (enriquecida con la referencia al hogar: nombre/ciudad/owner). El admin puede resolver/descartar la denuncia **y**, si corresponde, **suspender** el hogar (§18). Ambas acciones quedan auditadas.
- **UI:** botón "Denunciar" en el detalle del hogar (web + mobile), con modal de motivo. i18n `fosterHomes:report.*`.
- **Evento (opcional):** `abuse_report.created` (si ya existe) → notificar admins; si no existe, la cola admin alcanza para el MVP.
