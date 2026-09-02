# Perfil público: diseño del perfil propio + publicaciones visibles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/users/:id` use el lenguaje visual del perfil propio y muestre las
mascotas que esa persona publicó y todavía no cerró, sin exponer nunca las
`registered` ni las `archived`.

**Architecture:** Un endpoint público nuevo `GET /api/users/:id/pets` que aplica
la allowlist de estados **en el `WHERE` de SQL** (una fila privada no sale de
Postgres), y una reescritura de `UserProfilePage.tsx` que reusa la estructura de
tres columnas de `ProfilePage.tsx`. Nada de diseño nuevo: se porta el existente.

**Tech Stack:** Go 1.25 + Gin + GORM · PostgreSQL · React 19 + Vite + Tailwind ·
React Query v5 · i18next · Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-public-profile-redesign-design.md`

---

## Antes de empezar

**Entorno.** Los tests de integración se saltean **en silencio** sin
`DATABASE_URL`, así que un verde puede significar que no corrió ninguno
(regla #41). En toda corrida de Go:

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
```

**Nunca apuntes a `lostpets`** — esa es la base con tu seed y los tests la borran.

**Verificá por exit code, jamás con un grep sobre la salida:**

```bash
go test ./... -count=1 > /tmp/go.log 2>&1; echo "EXIT=$?"
```

`-count=1` es obligatorio: sin él `go test` devuelve `ok (cached)` después de editar.

**Rama.** Sale de `origin/main`, no de otra rama (regla #30):

```bash
git fetch origin && git checkout -b feat/public-profile-pets origin/main
```

## Estructura de archivos

### PR 1 — backend (`feat/public-profile-pets`)

| Archivo | Responsabilidad |
|---|---|
| `backend/internal/domain/pet_status.go` | **Modificar** — sumar `PublicProfileVisibleStatuses` |
| `backend/internal/repository/interfaces.go` | **Modificar** — sumar `FindPublicByUserID` a `PetRepository` |
| `backend/internal/repository/pet_repository.go` | **Modificar** — implementarlo con la allowlist en SQL |
| `backend/internal/service/interfaces.go` | **Modificar** — sumar `GetPublicPets` a `PetService` |
| `backend/internal/service/pet_service.go` | **Modificar** — pasar la allowlist del dominio al repo |
| `backend/internal/handler/pet_handler.go` | **Modificar** — `GetPublicPets`, valida uuid, 400/500 |
| `backend/internal/app/router.go` | **Modificar** — `public.GET("/users/:id/pets", ...)` |
| `backend/tests/pet_repository_test.go` | **Modificar** — el test negativo contra Postgres real |
| `frontend/packages/shared/api/client.ts` | **Modificar** — `getUserPets(userID)` |
| `frontend/packages/shared/hooks/index.ts` | **Modificar** — `useUserPets(userID)` |

### PR 2 — frontend (`feat/public-profile-redesign`, stack sobre el anterior)

| Archivo | Responsabilidad |
|---|---|
| `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` | **Modificar** — claves bajo `profile.public.*` |
| `frontend/packages/web/src/pages/UserProfilePage.tsx` | **Reescribir** el layout |
| `frontend/packages/web/src/pages/UserProfilePage.test.tsx` | **Modificar** — cobertura del layout nuevo |

> **Las claves van dentro del namespace `profile`, que YA está registrado** en
> los tres bloques de `web/src/i18n/index.ts`. Crear un namespace nuevo obligaría
> a registrarlo y olvidarse pinta la clave cruda sin ningún error (regla #21).
> No se crea uno: no hace falta.

---

# PR 1 — El endpoint

### Task 1: La allowlist de estados

**Files:**
- Modify: `backend/internal/domain/pet_status.go` (después de `AdoptionVisibleStatuses`)
- Test: `backend/internal/domain/status_machine_test.go`

- [ ] **Step 1: Escribir el test que falla**

En `backend/internal/domain/status_machine_test.go`, al final:

```go
func TestPublicProfileVisibleStatuses_NuncaIncluyeLosPrivados(t *testing.T) {
	// El punto entero de la lista: `registered` es el inventario de animales de
	// una persona y `archived` es lo que bajó a propósito. Si alguno entra acá,
	// el perfil público los publica.
	for _, s := range PublicProfileVisibleStatuses {
		if s == PetStatusRegistered || s == PetStatusArchived {
			t.Fatalf("estado privado %q en PublicProfileVisibleStatuses", s)
		}
	}

	want := map[string]bool{
		PetStatusLost: true, PetStatusStray: true, PetStatusFound: true,
		PetStatusAdoption: true, PetStatusAdopted: true,
	}
	if len(PublicProfileVisibleStatuses) != len(want) {
		t.Fatalf("largo = %d, quiero %d: %v", len(PublicProfileVisibleStatuses), len(want), PublicProfileVisibleStatuses)
	}
	for _, s := range PublicProfileVisibleStatuses {
		if !want[s] {
			t.Errorf("estado inesperado %q", s)
		}
	}
}
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd backend && go test ./internal/domain/ -run TestPublicProfileVisibleStatuses -count=1; echo "EXIT=$?"
```

Esperado: FAIL — `undefined: PublicProfileVisibleStatuses`.

- [ ] **Step 3: Implementar**

En `backend/internal/domain/pet_status.go`, después del bloque de
`AdoptionVisibleStatuses`:

```go
// PublicProfileVisibleStatuses son los estados que un TERCERO ve en el perfil
// público de otra persona (GET /api/users/:id/pets).
//
// Excluye `registered` y `archived` por el mismo motivo que
// PublicSearchableStatuses: publicarlos sería un inventario de qué animales
// tiene esa persona y dónde vive. `archived` es además el interruptor con el
// que el dueño baja cualquier publicación de esta vista — por eso no hace falta
// una preferencia de privacidad por mascota.
//
// Incluye `found` y `adopted` a propósito: los dos son finales felices que ya
// fueron públicos (found está en PublicSearchableStatuses; adopted estuvo
// listado en /api/adoptions mientras fue adoption). La adopción NO transfiere
// la mascota —el status machine sólo permite adoption ↔ adopted y → archived—
// así que no hay un adoptante cuya privacidad proteger.
//
// EXPLÍCITA y no derivada, igual que las otras cuatro: si mañana se agrega un
// estado, hay que decidir si entra. El default —quedar afuera— es el que no
// publica nada de nadie.
var PublicProfileVisibleStatuses = []string{
	PetStatusLost,
	PetStatusStray,
	PetStatusFound,
	PetStatusAdoption,
	PetStatusAdopted,
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd backend && go test ./internal/domain/ -run TestPublicProfileVisibleStatuses -count=1; echo "EXIT=$?"
```

Esperado: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/pet_status.go backend/internal/domain/status_machine_test.go
git commit -m "feat(domain): la allowlist de estados que un tercero ve en un perfil ajeno"
```

---

### Task 2: El método de repositorio, con el filtro en SQL

**Files:**
- Modify: `backend/internal/repository/interfaces.go:20-23`
- Modify: `backend/internal/repository/pet_repository.go:84-97`
- Test: `backend/tests/pet_repository_test.go`

- [ ] **Step 1: Escribir el test que falla**

Al final de `backend/tests/pet_repository_test.go`:

```go
// Este test corre contra Postgres REAL y no contra un mock a propósito: los
// mocks no tienen WHERE, así que no pueden ver un filtro que no se aplicó
// (regla #34). Y afirma la NEGATIVA — que las privadas no vuelven— porque un
// test que sólo comprueba que las cinco visibles vuelven pasa igual con el
// filtro entero borrado.
func TestPetRepository_FindPublicByUserID_NoDevuelveLasPrivadas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	repo := repository.NewPostgresPetRepository(gormDB)

	owner := testdb.CreateTestUser(t, gormDB, "duenio-perfil@test.com")

	seed := func(name, status string) {
		p := &domain.Pet{
			OwnerID: &owner.ID,
			Name:    name,
			Type:    "perro",
			Status:  status,
		}
		if err := repo.Create(p); err != nil {
			t.Fatalf("sembrando %s/%s: %v", name, status, err)
		}
	}

	seed("Visible-Lost", domain.PetStatusLost)
	seed("Visible-Stray", domain.PetStatusStray)
	seed("Visible-Found", domain.PetStatusFound)
	seed("Visible-Adoption", domain.PetStatusAdoption)
	seed("Visible-Adopted", domain.PetStatusAdopted)
	seed("PRIVADA-Registered", domain.PetStatusRegistered)
	seed("PRIVADA-Archived", domain.PetStatusArchived)

	pets, err := repo.FindPublicByUserID(owner.ID.String(), domain.PublicProfileVisibleStatuses)
	if err != nil {
		t.Fatalf("FindPublicByUserID: %v", err)
	}

	for _, p := range pets {
		if p.Status == domain.PetStatusRegistered || p.Status == domain.PetStatusArchived {
			t.Errorf("FUGA: volvió %q en estado %q", p.Name, p.Status)
		}
	}
	if len(pets) != 5 {
		t.Fatalf("largo = %d, quiero 5: %v", len(pets), nombres(pets))
	}
}

// Una mascota puede matchear los DOS vínculos: quien reporta un callejero y
// después lo adopta queda como owner Y como reporter de la misma fila. Con dos
// consultas concatenadas aparecería duplicada en el perfil.
func TestPetRepository_FindPublicByUserID_NoDuplicaSiEsDueniaYReporter(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	repo := repository.NewPostgresPetRepository(gormDB)

	u := testdb.CreateTestUser(t, gormDB, "duenia-y-reporter@test.com")

	p := &domain.Pet{
		OwnerID:    &u.ID,
		ReporterID: &u.ID,
		Name:       "Callejero Adoptado",
		Type:       "perro",
		Status:     domain.PetStatusAdopted,
	}
	if err := repo.Create(p); err != nil {
		t.Fatalf("sembrando: %v", err)
	}

	pets, err := repo.FindPublicByUserID(u.ID.String(), domain.PublicProfileVisibleStatuses)
	if err != nil {
		t.Fatalf("FindPublicByUserID: %v", err)
	}
	if len(pets) != 1 {
		t.Fatalf("largo = %d, quiero 1 (duplicado): %v", len(pets), nombres(pets))
	}
}

// El callejero que reportó sin ser dueña: owner_id nil, reporter_id suyo.
func TestPetRepository_FindPublicByUserID_IncluyeLosQueReporto(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	repo := repository.NewPostgresPetRepository(gormDB)

	reporter := testdb.CreateTestUser(t, gormDB, "reporter-perfil@test.com")

	p := &domain.Pet{
		ReporterID: &reporter.ID,
		Name:       "Callejero del Parque",
		Type:       "gato",
		Status:     domain.PetStatusStray,
	}
	if err := repo.Create(p); err != nil {
		t.Fatalf("sembrando: %v", err)
	}

	pets, err := repo.FindPublicByUserID(reporter.ID.String(), domain.PublicProfileVisibleStatuses)
	if err != nil {
		t.Fatalf("FindPublicByUserID: %v", err)
	}
	if len(pets) != 1 || pets[0].Name != "Callejero del Parque" {
		t.Fatalf("quiero el callejero reportado, tengo: %v", nombres(pets))
	}
}

func nombres(pets []domain.Pet) []string {
	out := make([]string, len(pets))
	for i, p := range pets {
		out[i] = p.Name + "/" + p.Status
	}
	return out
}
```

> **Si `testdb.CreateTestUser` no existe con esa firma**, abrí
> `backend/tests/user_review_repository_test.go` y copiá el helper de alta de
> usuario que usa ese archivo. No inventes uno nuevo.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd backend && export DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  && go test ./tests/ -run TestPetRepository_FindPublicByUserID -count=1; echo "EXIT=$?"
```

Esperado: FAIL — `repo.FindPublicByUserID undefined`.

- [ ] **Step 3: Implementar la interfaz**

En `backend/internal/repository/interfaces.go`, dentro de `PetRepository`,
justo después de `FindByReporterID`:

```go
	// FindPublicByUserID devuelve las mascotas de un usuario que un TERCERO
	// puede ver en su perfil público: las que publicó y todavía no cerró.
	//
	// La allowlist se aplica en el WHERE y no después: una fila `registered`
	// no tiene que salir nunca de Postgres. Filtrar más arriba la cargaría a
	// memoria para descartarla, y filtrar en el cliente no filtraría nada.
	//
	// Cubre los dos vínculos en UNA consulta —`owner_id` (las suyas) y
	// `reporter_id` (los callejeros que reportó sin ser dueña)— porque una
	// misma fila puede matchear ambos y dos listas pegadas la duplicarían.
	FindPublicByUserID(userID string, statuses []string) ([]domain.Pet, error)
```

- [ ] **Step 4: Implementar el método**

En `backend/internal/repository/pet_repository.go`, después de
`FindByReporterID`:

```go
// FindPublicByUserID — ver el contrato en repository/interfaces.go.
func (r *PostgresPetRepository) FindPublicByUserID(userID string, statuses []string) ([]domain.Pet, error) {
	var pets []domain.Pet
	err := r.db.
		Preload("Owner").
		Preload("Photos", orderedPhotos).
		Where("(owner_id = ? OR reporter_id = ?) AND status IN ?", userID, userID, statuses).
		Order("created_at DESC").
		Find(&pets).Error
	return pets, err
}
```

- [ ] **Step 5: Correr y verificar que pasan**

```bash
cd backend && go test ./tests/ -run TestPetRepository_FindPublicByUserID -count=1; echo "EXIT=$?"
```

Esperado: `EXIT=0`, tres tests OK.

- [ ] **Step 6: Verificar el test EN ROJO con el bug puesto**

Este paso no es opcional. Sacá ` AND status IN ?` del `Where` (y sus argumentos),
corré de nuevo y confirmá que `NoDevuelveLasPrivadas` **falla** con "FUGA".
Después restaurá la línea y confirmá el verde.

Un test de filtro que nunca viste en rojo no sabés si prueba el filtro.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/repository/ backend/tests/pet_repository_test.go
git commit -m "feat(repo): las mascotas publicas de un usuario, con la allowlist en SQL"
```

---

### Task 3: Servicio

**Files:**
- Modify: `backend/internal/service/interfaces.go`
- Modify: `backend/internal/service/pet_service.go:297-299`

- [ ] **Step 1: Sumar el método a la interfaz**

En `backend/internal/service/interfaces.go`, dentro de `PetService`, al lado de
`GetReportedPets`:

```go
	// GetPublicPets retorna lo que un tercero ve en el perfil público de otro
	// usuario. La allowlist la fija el dominio, no el llamador: un parámetro
	// dejaría que cualquier call site pase la lista completa y ningún test lo
	// cazaría (regla #40).
	GetPublicPets(userID string) ([]domain.Pet, error)
```

- [ ] **Step 2: Implementar**

En `backend/internal/service/pet_service.go`, después de `GetReportedPets`:

```go
// GetPublicPets — ver el contrato en service/interfaces.go.
func (s *petService) GetPublicPets(userID string) ([]domain.Pet, error) {
	return s.repo.FindPublicByUserID(userID, domain.PublicProfileVisibleStatuses)
}
```

- [ ] **Step 3: Compilar**

```bash
cd backend && go build ./... ; echo "EXIT=$?"
```

Esperado: `EXIT=0`. Si algún mock de `PetRepository` en `tests/` no compila,
agregale `FindPublicByUserID` devolviendo lo que el test necesite — el
compilador te dice cuáles.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/service/
git commit -m "feat(service): GetPublicPets fija la allowlist desde el dominio"
```

---

### Task 4: Handler y ruta

**Files:**
- Modify: `backend/internal/handler/pet_handler.go` (después de `GetReportedPets`, ~línea 120)
- Modify: `backend/internal/app/router.go:394`
- Test: `backend/tests/e2e/public_profile_pets_test.go` (crear)

- [ ] **Step 1: Escribir el test e2e que falla**

Crear `backend/tests/e2e/public_profile_pets_test.go`:

```go
//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"testing"
)

// El endpoint es PÚBLICO: se pide SIN token a propósito. Que un tercero
// anónimo no vea las mascotas privadas es la afirmación entera de la feature,
// y sólo se puede comprobar sin sesión.
func TestPerfilPublico_NoExponeLasMascotasPrivadas(t *testing.T) {
	env := setupE2E(t)

	owner := env.registerUser(t, "duenia-e2e@test.com", "password123")

	env.createPet(t, owner.Token, map[string]any{
		"name": "Perdida Publica", "type": "perro", "status": "lost",
	})
	env.createPet(t, owner.Token, map[string]any{
		"name": "Privada Registrada", "type": "gato", "status": "registered",
	})

	resp := env.get(t, "/api/users/"+owner.User.ID+"/pets", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, quiero 200", resp.StatusCode)
	}

	var pets []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&pets); err != nil {
		t.Fatalf("decodificando: %v", err)
	}

	for _, p := range pets {
		if p["status"] == "registered" || p["status"] == "archived" {
			t.Errorf("FUGA: %v en estado %v", p["name"], p["status"])
		}
	}
	if len(pets) != 1 {
		t.Fatalf("largo = %d, quiero 1 (sólo la perdida)", len(pets))
	}
}

func TestPerfilPublico_UUIDMalformadoDa400(t *testing.T) {
	env := setupE2E(t)
	resp := env.get(t, "/api/users/no-es-un-uuid/pets", "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, quiero 400", resp.StatusCode)
	}
}
```

> **Adaptá los helpers** (`setupE2E`, `registerUser`, `createPet`, `get`) a los
> que ya usan los tests de `backend/tests/e2e/`. Abrí uno existente y copiá sus
> nombres exactos; no inventes helpers nuevos.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd backend && go test -tags e2e ./tests/e2e/ -run TestPerfilPublico -count=1; echo "EXIT=$?"
```

Esperado: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Implementar el handler**

En `backend/internal/handler/pet_handler.go`, después de `GetReportedPets`:

```go
// GetPublicPets godoc
// GET /api/users/:id/pets — público, no requiere auth.
//
// Retorna lo que la persona publicó y todavía no cerró. La allowlist de estados
// vive en el dominio y se aplica en SQL; este handler no filtra nada.
func (h *PetHandler) GetPublicPets(c *gin.Context) {
	idStr := c.Param("id")
	if _, err := uuid.Parse(idStr); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	pets, err := h.petService.GetPublicPets(idStr)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetListResponse(pets))
}
```

> **No devuelve 404 si el usuario no existe, y es deliberado**: la respuesta es
> una lista, y "usuario inexistente" y "usuario sin publicaciones" dan la misma
> lista vacía. Distinguirlos costaría una consulta extra a `users` en cada carga
> para convertir un caso que la pantalla ya maneja (el perfil de al lado ya
> devuelve su propio 404) en un error. Si `uuid.Parse` no lo agarra, es una URL
> inventada y la pantalla muestra "Perfil no encontrado" por el otro endpoint.

Si `uuid` no está importado en ese archivo, agregá `"github.com/google/uuid"`.

- [ ] **Step 4: Registrar la ruta**

En `backend/internal/app/router.go`, justo debajo de la línea
`public.GET("/users/:id/profile", gamHandler.GetPublicProfile)`:

```go
		public.GET("/users/:id/pets", petHandler.GetPublicPets)
```

- [ ] **Step 5: Correr y verificar que pasan**

```bash
cd backend && go test -tags e2e ./tests/e2e/ -run TestPerfilPublico -count=1; echo "EXIT=$?"
```

Esperado: `EXIT=0`.

- [ ] **Step 6: Correr TODA la suite**

```bash
cd backend && go test ./... -count=1 > /tmp/go.log 2>&1; echo "EXIT=$?"
cd backend && go test -tags e2e ./tests/e2e/ -count=1 > /tmp/e2e.log 2>&1; echo "E2E=$?"
```

Esperado: `EXIT=0` y `E2E=0`. Cualquier otra cosa, leé el log.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/handler/pet_handler.go backend/internal/app/router.go backend/tests/e2e/
git commit -m "feat(api): GET /api/users/:id/pets expone lo publicado y nada mas"
```

---

### Task 5: Cliente y hook compartidos

**Files:**
- Modify: `frontend/packages/shared/api/client.ts:426-428`
- Modify: `frontend/packages/shared/hooks/index.ts:172-180`

- [ ] **Step 1: Sumar el método al cliente**

En `frontend/packages/shared/api/client.ts`, después de `getReportedPets`:

```ts
  // getUserPets — lo que otra persona publicó y todavía no cerró
  // (GET /api/users/:id/pets, público). El backend aplica la allowlist de
  // estados en SQL: acá NO se filtra nada, y filtrar acá tampoco serviría.
  async getUserPets(userID: string): Promise<Pet[]> {
    return this.request<Pet[]>('GET', `/api/users/${userID}/pets`);
  }
```

- [ ] **Step 2: Sumar el hook**

En `frontend/packages/shared/hooks/index.ts`, después de `useReportedPets`:

```ts
// useUserPets — las publicaciones visibles de OTRA persona (perfil público).
// La queryKey lleva el userID para que dos perfiles no se pisen la caché.
export const useUserPets = (userID: string) => {
  return useQuery({
    queryKey: ['pets', 'public', userID],
    queryFn: () => apiClient.getUserPets(userID),
    enabled: !!userID,
  });
};
```

- [ ] **Step 3: Verificar tipos y correr los tests de shared**

```bash
cd frontend/packages/web && pnpm tsc --noEmit; echo "TSC=$?"
cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts > /tmp/shared.log 2>&1; echo "SHARED=$?"
```

Esperado: `TSC=0` y `SHARED=0`.

- [ ] **Step 4: Commit y abrir el PR**

```bash
git add frontend/packages/shared/
git commit -m "feat(shared): cliente y hook de las mascotas publicas de un usuario"
git push -u origin feat/public-profile-pets
```

Abrí el PR con la skill `searchpet-pr`. **Antes**, confirmá que la rama salió
del lugar correcto (regla #30):

```bash
git fetch origin && git log --oneline origin/main..HEAD
```

Esperado: exactamente los 5 commits de este PR. Si aparece más, la rama salió
del lugar equivocado.

---

# PR 2 — La pantalla

Stack sobre el anterior:

```bash
git checkout -b feat/public-profile-redesign
```

### Task 6: Las claves i18n en los tres idiomas

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/es.json` (dentro de `profile`)
- Modify: `frontend/packages/web/src/i18n/locales/en.json` (ídem)
- Modify: `frontend/packages/web/src/i18n/locales/pt.json` (ídem)

- [ ] **Step 1: Sumar el bloque `public` dentro de `profile` en `es.json`**

```json
"public": {
  "activity": "Actividad",
  "points": "Puntos",
  "reports": "Reportes",
  "reunited": "Reunidos",
  "shared": "Compartidos",
  "achievements": "Logros",
  "noAchievements": "Todavía no desbloqueó ningún logro.",
  "posts": "Publicaciones",
  "postsEmpty": "No tiene publicaciones activas.",
  "postsError": "No pudimos cargar sus publicaciones.",
  "adoption": "En adopción",
  "adoptionEmpty": "No tiene mascotas en adopción.",
  "reviews": "Reseñas",
  "reviewsEmpty": "Aún no hay reseñas.",
  "reviewsError": "No pudimos cargar las reseñas.",
  "leaveReview": "Dejar reseña",
  "editReview": "Editar reseña",
  "deleteReview": "Eliminar",
  "reviewCount_one": "{{count}} reseña",
  "reviewCount_other": "{{count}} reseñas",
  "noRating": "Sin calificaciones",
  "totalPoints": "puntos totales",
  "report": "Denunciar",
  "reporting": "Enviando...",
  "reportSent": "Denuncia enviada. Gracias por reportarlo.",
  "reportReason": "Motivo de la denuncia:",
  "reasons": {
    "spam": "Spam",
    "fake": "Publicación falsa",
    "abuse": "Abuso",
    "inappropriate": "Contenido inapropiado",
    "other": "Otro"
  },
  "block": "Bloquear usuario",
  "unblock": "Desbloquear usuario",
  "processing": "Procesando...",
  "confirmBlock": "¿Querés bloquear a {{name}}? Ya no podrán enviarse mensajes.",
  "confirmUnblock": "¿Querés desbloquear a {{name}}?",
  "confirmDeleteReview": "¿Eliminar tu reseña?",
  "notFound": "Perfil no encontrado",
  "notFoundHint": "Este usuario no existe o su perfil no está disponible.",
  "backHome": "Volver al inicio",
  "seeRanking": "Ver ranking por ciudad →",
  "yourRating": "Tu calificación",
  "reviewPlaceholder": "Escribí tu reseña...",
  "publishReview": "Publicar reseña",
  "saveReview": "Guardar cambios",
  "saving": "Guardando...",
  "starsRequired": "Seleccioná entre 1 y 5 estrellas.",
  "textRequired": "Escribí un comentario."
}
```

- [ ] **Step 2: Traducir el MISMO set en `en.json` y `pt.json`**

Las tres listas tienen que tener **exactamente las mismas claves**. Una faltante
se pinta cruda y en silencio, y ningún test unitario la ve porque mockean
`t: (key) => key`.

- [ ] **Step 3: El mapeo, para que reemplazar sea mecánico y no de criterio**

Estas son **todas** las cadenas cableadas de `UserProfilePage.tsx` hoy. Las
Tasks 7, 8 y 9 sólo tienen que aplicar esta tabla; no hay ninguna decisión que
tomar mientras se reescribe el JSX.

| Cadena de hoy | Clave |
|---|---|
| `puntos totales` | `profile:public.totalPoints` |
| `Actividad` | `profile:public.activity` |
| `Reportes` | `profile:public.reports` |
| `Reunidos` | `profile:public.reunited` |
| `Compartidos` | `profile:public.shared` |
| `Logros` | `profile:public.achievements` |
| `Aún no tiene logros desbloqueados.` | `profile:public.noAchievements` |
| `Denunciar` | `profile:public.report` |
| `Enviando...` | `profile:public.reporting` |
| `Motivo de la denuncia:` | `profile:public.reportReason` |
| `Spam` / `Publicación falsa` / `Abuso` / `Contenido inapropiado` / `Otro` | `profile:public.reasons.<reason>` |
| `Denuncia enviada. Gracias por reportarlo.` | `profile:public.reportSent` |
| `Bloquear usuario` | `profile:public.block` |
| `Desbloquear usuario` | `profile:public.unblock` |
| `Procesando...` | `profile:public.processing` |
| `¿Querés bloquear a X? Ya no podrán enviarse mensajes.` | `profile:public.confirmBlock` con `{{name}}` |
| `¿Querés desbloquear a X?` | `profile:public.confirmUnblock` con `{{name}}` |
| `Reseñas` | `profile:public.reviews` |
| `Dejar reseña` | `profile:public.leaveReview` |
| `Editar reseña` | `profile:public.editReview` |
| `Eliminar` (en `ReviewCard`) | `profile:public.deleteReview` |
| `¿Eliminar tu reseña?` | `profile:public.confirmDeleteReview` |
| `Aún no hay reseñas.` | `profile:public.reviewsEmpty` |
| `1 reseña` / `N reseñas` | `profile:public.reviewCount` con `{{count}}` |
| `Tu calificación` | `profile:public.yourRating` |
| `Escribí tu reseña...` | `profile:public.reviewPlaceholder` |
| `Seleccioná entre 1 y 5 estrellas.` | `profile:public.starsRequired` |
| `Escribí un comentario.` | `profile:public.textRequired` |
| `Guardando...` | `profile:public.saving` |
| `Guardar cambios` | `profile:public.saveReview` |
| `Publicar reseña` | `profile:public.publishReview` |
| `Perfil no encontrado` | `profile:public.notFound` |
| `Este usuario no existe o su perfil no está disponible.` | `profile:public.notFoundHint` |
| `Volver al inicio` | `profile:public.backHome` |
| `Ver ranking por ciudad →` | `profile:public.seeRanking` |
| `Cancelar` | **`common:cancel`** — ya existe, no dupliques |

Dos cosas que no son opcionales:

- **Declará los namespaces explícitos**: `useTranslation(['profile', 'common', 'badges', 'pets'])`.
  Confiar en que `common:` resuelva por recursos precargados funciona hoy, pero
  el día que no, la falla es una clave cruda en pantalla **que ningún test ve**,
  porque en los tests `t` está mockeado (regla #61).
- **Antes de sumar una clave nueva, buscala en `admin` y en `common`.** Los
  motivos de denuncia pueden existir ya en el namespace `admin` de la cola de
  denuncias: si están, reusalos y borrá el bloque `reasons` de arriba.

- [ ] **Step 4: Test de paridad de claves**

Crear `frontend/packages/web/src/i18n/publicProfileKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

describe('profile.public — paridad de claves en los tres idiomas', () => {
  it('en tiene las mismas claves que es', () => {
    expect(keys(en.profile.public)).toEqual(keys(es.profile.public));
  });
  it('pt tiene las mismas claves que es', () => {
    expect(keys(pt.profile.public)).toEqual(keys(es.profile.public));
  });
  it('ninguna traducción quedó vacía', () => {
    for (const [lang, dict] of [['en', en], ['pt', pt]] as const) {
      for (const [k, v] of Object.entries(dict.profile.public)) {
        expect(v, `${lang}.profile.public.${k}`).not.toBe('');
      }
    }
  });
});
```

- [ ] **Step 5: Correr**

```bash
cd frontend/packages/web && pnpm vitest run src/i18n/publicProfileKeys.test.ts; echo "EXIT=$?"
```

Esperado: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/i18n/
git commit -m "feat(web): claves i18n del perfil publico en es, en y pt"
```

---

### Task 7: La columna izquierda — identidad, actividad, logros

**Files:**
- Modify: `frontend/packages/web/src/pages/UserProfilePage.tsx`

- [ ] **Step 1: Cambiar el contenedor a tres columnas**

Reemplazar el wrapper del `return` principal (hoy
`<div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4"><div className="max-w-lg mx-auto space-y-4">`)
por la estructura del perfil propio:

```tsx
<div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
  {/* Sin banda de encabezado: el nombre de la persona ya es el encabezado,
      igual que en ProfilePage. */}
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <aside className="lg:col-span-1 space-y-6">
        {/* Tasks 7 */}
      </aside>
      <div className="lg:col-span-2 space-y-8">
        {/* Tasks 8 y 9 */}
      </div>
    </div>
  </div>
</div>
```

El `px-4 sm:px-6 lg:px-8` va **en el mismo div que el `max-w-7xl`**, nunca en el
de afuera: afuera no achica la página, la corre (regla #50).

- [ ] **Step 2: La tarjeta de identidad**

Dentro del `<aside>`:

```tsx
<section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
  <div className="flex flex-col items-center text-center">
    {profile.profile_photo_url ? (
      <img
        src={cloudinaryThumb(profile.profile_photo_url, 224)}
        alt=""
        className="h-28 w-28 rounded-full object-cover ring-4 ring-primary/20"
      />
    ) : (
      <div className="h-28 w-28 rounded-full bg-primary/10 dark:bg-primary/20 ring-4 ring-primary/20 flex items-center justify-center font-display text-4xl font-bold text-primary">
        {profile.name.charAt(0).toUpperCase()}
      </div>
    )}

    <h1 className="font-display text-headline font-semibold text-gray-900 dark:text-gray-100 mt-4 break-words">
      {profile.name}
    </h1>

    {profile.city && (
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 inline-flex items-center gap-1">
        <Icon name="location-on" className="h-4 w-4" aria-hidden />
        {profile.city}
      </p>
    )}
  </div>

  {/* Denunciar / Bloquear — sin filas de contacto: el email es privado y el
      teléfono ya viaja dentro de las tarjetas de mascota de esta misma página,
      así que ponerlo acá no lo protegería, sólo lo convertiría en un directorio
      por perfil. */}
  {isAuthenticated && !isOwnProfile && (
    <div className="mt-5 pt-5 border-t border-gray-100 dark:border-gray-800 space-y-2">
      {/* Los dos botones y el menú de motivos que YA existen en el archivo
          (líneas ~305-366 de la versión actual) se conservan tal cual: misma
          lógica, mismos handlers, mismos estados. Lo único que cambia es que
          cada cadena literal pasa a su clave según la tabla de la Task 6 —
          incluido el objeto inline `{spam: 'Spam', fake: 'Publicación falsa', …}`
          del `.map()` de motivos, que pasa a `t(\`profile:public.reasons.${reason}\`)`. */}
    </div>
  )}
</section>
```

`font-semibold` explícito no es cosmético: `font-display` fija la familia y el
preflight de Tailwind v4 deja los `h1-h6` en `font-weight: inherit`.

Si `location-on` no existe en `components/Icon.tsx`, elegí el más cercano de los
que sí están; **si no hay ninguno equivalente, dejá el 📍** con `aria-hidden`
(convención del proyecto: no se fuerza un ícono que borra la distinción).

- [ ] **Step 3: La tarjeta de actividad, con la grilla 2×2**

```tsx
<section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
    {t('profile:public.activity')}
  </h2>
  <div className="grid grid-cols-2 gap-3">
    <StatTile label={t('profile:public.points')} value={profile.total_points} />
    <StatTile label={t('profile:public.reports')} value={profile.total_reports} />
    <StatTile label={t('profile:public.reunited')} value={profile.found_count} />
    <StatTile label={t('profile:public.shared')} value={profile.share_count} />
  </div>
</section>
```

Y el tile, reemplazando al `StatPill` de hoy:

```tsx
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-primary/5 dark:bg-primary/10 p-4 text-center">
      <p className="text-2xl font-bold text-primary">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
```

- [ ] **Step 4: La tarjeta de logros, sólo los conseguidos**

```tsx
<section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
    {t('profile:public.achievements')} ({profile.badges.length})
  </h2>
  {profile.badges.length === 0 ? (
    <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
      {t('profile:public.noAchievements')}
    </p>
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {profile.badges.map((badge: Badge) => <BadgeCard key={badge.id} badge={badge} />)}
    </div>
  )}
</section>
```

**No se dibujan los bloqueados en gris.** El perfil propio los muestra porque su
copy es motivacional para el dueño ("Verificá tu identidad"); a un desconocido le
mostraría lo que esa persona *no* logró.

**Ojo con `hidden sm:*`**: la grilla usa `grid-cols-1 sm:grid-cols-2`, que
degrada a una columna. No la cambies por `hidden sm:grid` — eso haría desaparecer
los logros enteros abajo de 640px, o sea justo en el teléfono.

- [ ] **Step 5: Verificar el build y los tests**

```bash
cd frontend/packages/web && pnpm tsc --noEmit; echo "TSC=$?"
cd frontend/packages/web && pnpm vitest run src/pages/UserProfilePage.test.tsx; echo "EXIT=$?"
```

Los tests van a fallar donde asserteaban el layout viejo. Actualizalos al nuevo;
no borres aserciones para poner el verde.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/UserProfilePage.tsx frontend/packages/web/src/pages/UserProfilePage.test.tsx
git commit -m "feat(web): el perfil publico adopta las tres columnas del perfil propio"
```

---

### Task 8: Las publicaciones

**Files:**
- Modify: `frontend/packages/web/src/pages/UserProfilePage.tsx`

- [ ] **Step 1: Escribir el test que falla**

En `UserProfilePage.test.tsx`:

```tsx
it('muestra las publicaciones y separa las de adopción', async () => {
  mockUseUserPets.mockReturnValue({
    data: [
      { id: 'p1', name: 'Firulais', status: 'lost', type: 'perro', photos: [] },
      { id: 'p2', name: 'Michi', status: 'adoption', type: 'gato', photos: [] },
    ],
    isLoading: false, isError: false, isPaused: false,
  });

  render(<UserProfilePage />, { wrapper });

  expect(await screen.findByText('Firulais')).toBeInTheDocument();
  expect(screen.getByText('Michi')).toBeInTheDocument();
  expect(screen.getByText('profile:public.adoption')).toBeInTheDocument();
});

it('una consulta caída NO se pinta como "no tiene publicaciones"', async () => {
  mockUseUserPets.mockReturnValue({
    data: undefined, isLoading: false, isError: true, isPaused: false,
  });

  render(<UserProfilePage />, { wrapper });

  expect(await screen.findByText('profile:public.postsError')).toBeInTheDocument();
  expect(screen.queryByText('profile:public.postsEmpty')).not.toBeInTheDocument();
});
```

Agregá `useUserPets` al mock de `@shared/hooks` del archivo — los smoke tests
mockean hook por hook y uno nuevo sin mockear rompe la screen entera.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/UserProfilePage.test.tsx; echo "EXIT=$?"
```

- [ ] **Step 3: Implementar las dos secciones**

Arriba del componente, junto a los otros imports:

```tsx
import { Link } from 'react-router';
import { useUserPets } from '@shared/hooks';
import type { Pet } from '@shared/types';
import { splitOwnedPets } from '@shared/utils/ownedPetBuckets';
import { cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
import { Icon } from '../components/Icon';
```

> **No existe ningún componente de tarjeta de mascota compartido.**
> `PetCardWeb` se borró en el PR #57 por código muerto, y hoy cada pantalla
> dibuja la suya: `MyPetsPage` tiene un `PetCard` local (línea 50), `AdoptPage`
> y `HomePage` lo hacen inline. Se sigue ese patrón — extraer un componente
> común es una refactorización aparte y no entra acá.

Definí la tarjeta local en el mismo archivo, arriba del componente de página.
Es el markup de `AdoptPage` con el badge de estado dinámico:

```tsx
function ProfilePetCard({ pet }: { pet: Pet }) {
  const { t } = useTranslation(['pets']);
  return (
    <Link to={`/pets/${pet.id}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
        <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
          {pet.photos?.[0]?.url ? (
            <img
              // Variante `feed` y no `adopt`, MEDIDO y no copiado de al lado
              // (regla #55): esta grilla es de 2 columnas dentro de una columna
              // de ~789px, o sea tarjetas de ~376px — casi el doble que las
              // ~280px de Adoptar, que por eso pide 450. `feed` es [600, 300],
              // que además calza el 2:1 de esta caja `h-48`.
              src={cloudinaryCardThumb(pet.photos[0].url, 'feed')}
              loading="lazy"
              alt={pet.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <PawPlaceholder className="w-2/5 max-w-20" />
            </div>
          )}
          {/* El badge sale de `pets:status.<status>` — nunca hardcodear la
              etiqueta (regla #13). `statusBadgeBg` ya existe en AdoptPage;
              moverlo a un helper compartido si hace falta en las dos. */}
          <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}>
            {t(`pets:status.${pet.status}`).toUpperCase()}
          </span>
        </div>
        <div className="p-4">
          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
            {pet.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 min-h-[1.25rem]">
            {[pet.type && t(`pets:types.${pet.type}`), pet.breed, pet.color]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1 min-h-[1.25rem]">
            {pet.city && (
              <>
                <Icon name="location-on" className="h-4 w-4 shrink-0" />
                <span className="truncate">{pet.city}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
}
```

El `font-semibold` explícito y los `min-h-[1.25rem]` no son cosmética: el
primero porque `font-display` fija la familia y no el peso, y los segundos
porque sin ellos las tarjetas de la grilla quedan de alturas dispares cuando a
una le falta la raza o la ciudad.

La ruta de detalle es **`/pets/${pet.id}`** (plural), no `/pet/`.

Dentro del componente, junto a las otras queries:

```tsx
const petsQuery = useUserPets(id ?? '');
// Mismo corte que usan MyPetsPage y ProfilePage: una definición, tres
// consumidores. `adoption` acá agrupa `adoption` y `adopted`.
const { owned: posts, adoption: adoptionPets } = splitOwnedPets(petsQuery.data);
```

Y en la columna derecha, **antes** de las reseñas:

```tsx
<section>
  <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
    {t('profile:public.posts')}
  </h2>
  <ListState
    query={petsQuery}
    select={() => posts}
    errorTitle={t('profile:public.postsError')}
    loading={
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-56 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    }
    empty={
      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
        {t('profile:public.postsEmpty')}
      </p>
    }
  >
    {(items) => (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map((pet) => <ProfilePetCard key={pet.id} pet={pet} />)}
      </div>
    )}
  </ListState>
</section>

{/* Una falla, un cartel: si la query se cae, el aviso lo pone la sección de
    arriba. Esta sección con `empty={<></>}` no dibuja nada y no afirma nada. */}
<section>
  <ListState
    query={petsQuery}
    select={() => adoptionPets}
    loading={<></>}
    empty={<></>}
  >
    {(items) => (
      <>
        <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('profile:public.adoption')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {items.map((pet) => <ProfilePetCard key={pet.id} pet={pet} />)}
        </div>
      </>
    )}
  </ListState>
</section>
```

Dos cosas del uso de `ListState` que no son opcionales:

- El `select` devuelve la tajada **ya calculada** con `splitOwnedPets`. La
  primitiva decide el cartel de error por `query.data == null`, **nunca** por
  `items.length === 0`: una tajada vacía —tiene mascotas pero ninguna en
  adopción— es una respuesta, no ignorancia.
- La rama se elige por `isLoading` y **nunca** por `isPending`. Con
  `enabled: false` una query queda `pending` para siempre.

Verificá la firma exacta de `select` y `errorTitle` en
`components/list/ListState.tsx` antes de escribir: si `select` recibe la data,
usá `select={(data) => splitOwnedPets(data).owned}` en vez de la variable de
afuera.

- [ ] **Step 4: Correr y verificar que pasan**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/UserProfilePage.test.tsx; echo "EXIT=$?"
```

- [ ] **Step 5: Buscar lo que quedó AFUERA de la rama envuelta**

El modo de falla conocido de la primitiva. Buscá en el archivo toda referencia a
`posts` y `adoptionPets` que no esté dentro de un `ListState`, y de cada una
preguntá si *afirma* algo: un contador "(0)" en un título con la query caída es
una mentira; un link que no aparece, no. Si hay un `.find()` sobre la lista,
blindalo con `?.`.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/UserProfilePage.tsx frontend/packages/web/src/pages/UserProfilePage.test.tsx
git commit -m "feat(web): el perfil publico muestra lo que esa persona publico"
```

---

### Task 9: Reseñas en una sola tarjeta, y el rating vacío

**Files:**
- Modify: `frontend/packages/web/src/pages/UserProfilePage.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('sin reseñas no dibuja el guión suelto del promedio', () => {
  mockUsePublicProfile.mockReturnValue({
    data: { ...baseProfile, avg_rating: 0, review_count: 0 },
    isLoading: false, error: null,
  });

  render(<UserProfilePage />, { wrapper });

  expect(screen.queryByText('—')).not.toBeInTheDocument();
  expect(screen.getByText('profile:public.noRating')).toBeInTheDocument();
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/UserProfilePage.test.tsx -t "guión suelto"; echo "EXIT=$?"
```

Esperado: FAIL — el `—` está en el DOM.

- [ ] **Step 3: Fusionar las dos tarjetas y arreglar el vacío**

Borrar la tarjeta suelta de "Rating summary" y poner su contenido como
encabezado de la de reseñas:

```tsx
<section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
  <div className="flex items-center justify-between gap-4 mb-5">
    <div className="flex items-center gap-3">
      {profile.review_count > 0 ? (
        <>
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-50">
            {profile.avg_rating.toFixed(1)}
          </span>
          <div>
            <StarDisplay stars={Math.round(profile.avg_rating)} size="text-lg" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {t('profile:public.reviewCount', { count: profile.review_count })}
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          {t('profile:public.noRating')}
        </p>
      )}
    </div>
    {canReview && (
      <button type="button" onClick={handleOpenForm} className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors">
        {myReview ? t('profile:public.editReview') : t('profile:public.leaveReview')}
      </button>
    )}
  </div>

  {/* El formulario inline (`showForm`, `StarSelector`, el `textarea`, los dos
      botones) y el `<ListState>` de reseñas que YA existen en el archivo se
      conservan tal cual: misma lógica, mismos handlers. Sólo cambian las
      cadenas literales por sus claves, según la tabla de la Task 6. Ojo con
      `'Eliminar'` dentro de `ReviewCard`, que está en otra función del mismo
      archivo y es fácil de pasar por alto — `ReviewCard` necesita su propio
      `useTranslation('profile')`. */}
</section>
```

El `—` no era un bug de datos: era `avg_rating.toFixed` esquivado con un guión
largo en `text-3xl font-bold`, que en pantalla se lee como una barra negra
suelta al lado de cinco estrellas grises.

- [ ] **Step 4: Correr toda la suite web**

```bash
cd frontend/packages/web && pnpm tsc --noEmit; echo "TSC=$?"
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "WEB=$?"
```

Esperado: `TSC=0` y `WEB=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/UserProfilePage.tsx frontend/packages/web/src/pages/UserProfilePage.test.tsx
git commit -m "fix(web): el promedio vacio ya no pinta una barra negra suelta"
```

---

### Task 10: Verificación en el navegador

Ningún test de este plan puede ver alineación, claves crudas ni el layout real.
jsdom no tiene layout y los tests mockean `t` devolviendo la clave.

- [ ] **Step 1: Levantar y entrar**

Con el backend en `:8081` y la web en `:3000` (ver la memoria `local-run-setup`),
entrá a `/users/<id-de-otro-usuario>` logueado como otro.

- [ ] **Step 2: Medir el alineado**

En la consola del navegador:

```js
const h1 = document.querySelector('h1').getBoundingClientRect().x;
const logo = document.querySelector('header a').getBoundingClientRect().x;
console.log({ h1, logo });
```

Esperado: **los dos en 32**. No midas el elemento `max-w-7xl` más ancho de la
página: ése siempre es el navbar y toda página da correcto.

- [ ] **Step 3: Barrer claves i18n crudas en los TRES idiomas**

Cambiá el idioma con el selector y en cada uno:

```js
console.log(document.body.innerText.match(/[a-z_]+[.:][a-zA-Z_.]+/g));
```

Esperado: `null` en los tres. Cualquier `profile:public.algo` en pantalla es una
clave que falta.

- [ ] **Step 4: Probar la mentira que este trabajo viene a matar**

Cortá la red (DevTools → Network → Offline) y recargá. La sección de
publicaciones tiene que decir **"no pudimos cargar"**, nunca "no tiene
publicaciones activas".

- [ ] **Step 5: Confirmar la privacidad de punta a punta**

Con el usuario dueño, creá una mascota y dejala en `registered`. Desde otra
cuenta, entrá a su perfil y confirmá que **no aparece**. Después, en la pestaña
Network, abrí la respuesta de `/api/users/<id>/pets` y confirmá que la mascota
`registered` **no está en el JSON**.

Ese segundo chequeo es el que vale: que no se vea en pantalla no prueba que no
se haya mandado.

- [ ] **Step 6: Push y PR**

```bash
git push -u origin feat/public-profile-redesign
```

Abrí el PR con `searchpet-pr`, con base en `feat/public-profile-pets`.

> **Al mergear el stack** (regla #49): la base va **sin** `--delete-branch`,
> después `gh pr edit <n> --base main` en el hijo, y recién ahí borrás la rama.
> Borrar la rama base cierra automáticamente el PR stackeado encima, sin avisar.

---

## Riesgos y decisiones ya cerradas

- **`adopted` es el único estado que esto vuelve público por primera vez.**
  Aceptado a conciencia: ya fue público con foto y descripción mientras estuvo
  en `adoption`.
- **El teléfono del dueño de una mascota perdida ya es público** vía
  `GET /api/pets/search`, sin sesión. Es deliberado y preexistente. Este cambio
  no lo empeora ni puede arreglarlo.
- **Mobile queda como está.** El perfil público de mobile no se toca.
- **No se agrega preferencia de privacidad por mascota.** El interruptor es
  `archived`.
