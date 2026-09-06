# Candidatos de callejero al publicar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Antes de dar de alta un callejero, mostrarle a quien publica los avistamientos cercanos —vencidos y vivos— para que reporte sobre la ficha existente en vez de crear un duplicado.

**Architecture:** Un endpoint protegido nuevo (`GET /api/pets/stray-candidates`) que consulta callejeros por cercanía **sin aplicar `straySightingNotExpired`**, y un paso nuevo del wizard web que lo consume entre el login y el alta. Revivir no necesita código: "es este" navega al formulario de reporte existente, que ya estampa `last_reported_at`.

**Tech Stack:** Go 1.25 + Gin + GORM + PostGIS (backend); React + Vite + Tailwind + React Query (web); Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-stray-duplicate-candidates-design.md`
**Issue:** #221
**Rama base:** `feat/stray-duplicate-candidates` (sale de `origin/main` = `e523599`)

> Los números de línea son de `main` al 2026-09-05. Van a moverse: **matchear por el código citado, no por el número**.

---

## Entrega: dos PRs stackeados

| PR | Contenido | Tareas |
|---|---|---|
| **1** | El endpoint con sus tests. Sin consumidor. | 1 – 5 |
| **2** | El paso en el wizard web. | 6 – 11 |

Mobile queda para una tanda posterior — anotado en el issue #221, que no se cierra hasta entonces.

**Antes de abrir cada PR:** `git log --oneline origin/main..HEAD` y verificar que sólo aparezca lo que escribiste (regla #30). El PR 2 sale **de la rama del PR 1**, y al mergear el 1 hay que reapuntar el 2 con `gh pr edit <n> --base main` **antes** de borrar la rama (regla #49).

## Estructura de archivos

**PR 1 — backend**

| Archivo | Responsabilidad |
|---|---|
| `internal/domain/stray_candidate.go` *(nuevo)* | `StrayCandidate`, `StrayCandidateCriteria`, `StrayCandidateRadiusMeters`, `StrayCandidateLimit` |
| `internal/repository/interfaces.go` *(modificar)* | Firma de `FindStrayCandidates` en `PetRepository` |
| `internal/repository/pet_repository.go` *(modificar)* | La consulta PostGIS |
| `internal/service/pet_service.go` *(modificar)* | Método passthrough con validación de coordenadas |
| `internal/dto/stray_candidate_dto.go` *(nuevo)* | `StrayCandidateResponse` + mapper |
| `internal/handler/pet_handler.go` *(modificar)* | `StrayCandidates` |
| `internal/app/router.go` *(modificar)* | La ruta protegida |
| `tests/stray_candidate_repository_test.go` *(nuevo)* | El test de las dos mitades, contra Postgres real |
| `tests/e2e/stray_candidates_flow_test.go` *(nuevo)* | El flujo por HTTP |

**PR 2 — web**

| Archivo | Responsabilidad |
|---|---|
| `shared/types/index.ts` *(modificar)* | `StrayCandidate` |
| `shared/api/client.ts` *(modificar)* | `getStrayCandidates` |
| `shared/hooks/index.ts` *(modificar)* | `useStrayCandidates` |
| `web/src/components/publish/CandidatesStep.tsx` *(nuevo)* | La lista, el cartel de error y "Publicar igual" |
| `web/src/pages/PublishWizardPage.tsx` *(modificar)* | El paso en la URL, su guarda y el cableado |
| `web/src/i18n/locales/{es,en,pt}.json` *(modificar)* | Claves del namespace `publish` |
| `web/src/components/publish/CandidatesStep.test.tsx` *(nuevo)* | Error ≠ vacío, y "Publicar igual" |

---

# PR 1 — El endpoint

### Task 1: El tipo de dominio

**Files:**
- Create: `backend/internal/domain/stray_candidate.go`

- [ ] **Step 1: Escribir el archivo**

```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// StrayCandidateRadiusMeters es el radio de búsqueda de candidatos: 1 km.
//
// Un callejero se mueve de a cuadras, no de a barrios. A 5 km una ciudad chica
// devuelve avistamientos de medio Montevideo y la pregunta "¿es alguno de
// estos?" se vuelve incontestable; a 500 m se pierde el perro que dormía ocho
// cuadras más allá, y ahí el duplicado se crea igual.
//
// NO es parámetro, por el mismo motivo que el plazo de straySightingNotExpired
// y que la allowlist de FindPublicByUserID: si el llamador lo pudiera pasar, un
// cero apagaría la búsqueda entera sin que nada avise. Cae justo en el piso del
// bound que ya usan /reports/nearby y la búsqueda con geo (1000–50000 m), así
// que no ensancha ningún rango existente.
const StrayCandidateRadiusMeters = 1000.0

// StrayCandidateLimit acota la lista. Diez es lo que una persona puede mirar y
// contestar; más abajo la pregunta deja de tener respuesta y el usuario aprieta
// "ninguno" sin leer, que es peor que no preguntarle nada.
const StrayCandidateLimit = 10

// StrayCandidateCriteria es lo que el usuario aporta: dónde está y qué animal
// vio. El radio y el tope NO están acá a propósito — ver las constantes.
type StrayCandidateCriteria struct {
	Lat float64
	Lng float64
	// PetType filtra por pets.type. Un gato no es candidato de un perro.
	// Vacío = sin filtro.
	PetType string
}

// StrayCandidate es un avistamiento de callejero cerca del punto consultado.
//
// NO lleva el teléfono ni ningún dato del reportante, y eso es deliberado: esta
// lista se muestra para RECONOCER a un animal, no para contactar a nadie. Ver
// la lección del preload de Owner en el perfil público — "el dato ya es público
// en otro lado" no equivale a "este camino no agrega exposición".
type StrayCandidate struct {
	PetID uuid.UUID `json:"-"`
	Name  string    `json:"-"`
	Type  string    `json:"-"`
	// PhotoURL es la foto primaria, o "" si la mascota no tiene ninguna.
	PhotoURL string `json:"-"`
	// LastSeenAt es COALESCE(last_reported_at, created_at): el mismo fallback
	// que usa straySightingNotExpired para decidir si está vencido. Se resuelve
	// en SQL y llega siempre con valor, así que la UI no tiene que elegir.
	LastSeenAt      time.Time `json:"-"`
	DistanceMeters  float64   `json:"-"`
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd backend && go build ./...`
Expected: sin salida, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/domain/stray_candidate.go
git commit -m "feat(backend): tipo de dominio para los candidatos de callejero"
```

---

### Task 2: El test del repositorio — las dos mitades

Va **antes** de la implementación. Corre contra Postgres real, porque un mock no tiene PostGIS ni constraints (regla #34).

**Files:**
- Create: `backend/tests/stray_candidate_repository_test.go`

- [ ] **Step 1: Escribir el test**

```go
package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Montevideo, el default del proyecto (regla #10).
const (
	baseLat = -34.9011
	baseLng = -56.1645
)

// desplazar mueve un punto ~metros hacia el norte. 1 grado de latitud ≈ 111.320 m.
func desplazar(metros float64) float64 {
	return baseLat + metros/111320.0
}

// sembrarStray crea un callejero con UN reporte en (lat, lng) y su reloj de
// última vista en lastSeen. Devuelve el id.
func sembrarStray(t *testing.T, db *gorm.DB, nombre, tipo string, lat, lng float64, lastSeen time.Time) uuid.UUID {
	t.Helper()

	reporter := domain.User{
		ID:    uuid.New(),
		Email: uuid.NewString() + "@test.local",
		Name:  "Reportante",
	}
	if err := db.Create(&reporter).Error; err != nil {
		t.Fatalf("crear reportante: %v", err)
	}

	pet := domain.Pet{
		ID:             uuid.New(),
		ReporterID:     &reporter.ID,
		Name:           nombre,
		Type:           tipo,
		Status:         domain.PetStatusStray,
		LastReportedAt: &lastSeen,
	}
	if err := db.Create(&pet).Error; err != nil {
		t.Fatalf("crear stray: %v", err)
	}

	report := domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: reporter.ID,
		Latitude:   lat,
		Longitude:  lng,
		Status:     "sighting",
		OccurredAt: &lastSeen,
	}
	if err := db.Create(&report).Error; err != nil {
		t.Fatalf("crear reporte: %v", err)
	}

	return pet.ID
}

func contiene(cands []domain.StrayCandidate, id uuid.UUID) bool {
	for _, c := range cands {
		if c.PetID == id {
			return true
		}
	}
	return false
}

// TestStrayCandidates_DevuelveLoVencidoQueElFeedEsconde es el punto de toda la
// feature, y afirma LAS DOS MITADES sobre la MISMA fila sembrada.
//
// Sólo con la primera mitad, un cambio que apagara la caducidad ENTERA pasaría
// verde: candidatos seguiría devolviendo al vencido, y el feed también. Lo que
// se prueba es el DESACUERDO entre las dos consultas, no cada una por separado.
// Es la lección del #157.
func TestStrayCandidates_DevuelveLoVencidoQueElFeedEsconde(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	vencido := time.Now().Add(-120 * 24 * time.Hour)
	id := sembrarStray(t, db, "Vencido", "perro", desplazar(300), baseLng, vencido)

	// Mitad 1: candidatos SÍ lo devuelve.
	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{
		Lat: baseLat, Lng: baseLng,
	})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contiene(cands, id) {
		t.Fatal("candidatos NO devolvió el avistamiento vencido — es lo único que este endpoint existe para hacer")
	}

	// Mitad 2: el feed lo sigue escondiendo. Sin esto el test no prueba nada:
	// pasaría igual con la caducidad apagada en todo el proyecto.
	//
	// Search devuelve TRES valores: ([]domain.Pet, int64, error).
	pets, _, err := repo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	for _, p := range pets {
		if p.ID == id {
			t.Fatal("el feed devolvió el avistamiento vencido — la caducidad del #220 se rompió")
		}
	}
}

func TestStrayCandidates_UnAvistamientoVivoApareceEnLasDos(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	id := sembrarStray(t, db, "Vivo", "perro", desplazar(300), baseLng, time.Now().Add(-24*time.Hour))

	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: baseLat, Lng: baseLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contiene(cands, id) {
		t.Fatal("candidatos no devolvió un avistamiento vivo y cercano")
	}

	pets, _, err := repo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	visto := false
	for _, p := range pets {
		if p.ID == id {
			visto = true
		}
	}
	if !visto {
		t.Fatal("el feed tendría que mostrar un avistamiento vivo")
	}
}

func TestStrayCandidates_ElRadioCorta(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	cerca := sembrarStray(t, db, "Cerca", "perro", desplazar(300), baseLng, time.Now())
	lejos := sembrarStray(t, db, "Lejos", "perro", desplazar(5000), baseLng, time.Now())

	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: baseLat, Lng: baseLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contiene(cands, cerca) {
		t.Fatal("el de 300 m tendría que estar")
	}
	if contiene(cands, lejos) {
		t.Fatalf("el de 5 km NO tendría que estar con radio %g m", domain.StrayCandidateRadiusMeters)
	}
}

func TestStrayCandidates_ElTipoAcota(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	perro := sembrarStray(t, db, "Perro", "perro", desplazar(200), baseLng, time.Now())
	gato := sembrarStray(t, db, "Gato", "gato", desplazar(200), baseLng, time.Now())

	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{
		Lat: baseLat, Lng: baseLng, PetType: "perro",
	})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contiene(cands, perro) {
		t.Fatal("faltó el perro")
	}
	if contiene(cands, gato) {
		t.Fatal("un gato no es candidato de un perro")
	}
}

// Una mascota `lost` tiene DUEÑO buscándola. Ofrecerla como candidato invitaría
// a reportar sobre la búsqueda de otra persona.
func TestStrayCandidates_NoDevuelveMascotasPerdidas(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	id := sembrarStray(t, db, "Perdida", "perro", desplazar(200), baseLng, time.Now())
	if err := db.Model(&domain.Pet{}).Where("id = ?", id).
		Update("status", domain.PetStatusLost).Error; err != nil {
		t.Fatalf("pasar a lost: %v", err)
	}

	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: baseLat, Lng: baseLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if contiene(cands, id) {
		t.Fatal("una mascota con dueño no es un candidato")
	}
}

// La distancia viaja hacia afuera porque la tarjeta la muestra ("a 300 m").
// Si saliera en cero, la UI diría "a 0 m" de todo sin que nada falle.
func TestStrayCandidates_TraeDistanciaYUltimaVista(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetRepository(db)

	visto := time.Now().Add(-100 * 24 * time.Hour)
	id := sembrarStray(t, db, "Medido", "perro", desplazar(300), baseLng, visto)

	cands, err := repo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: baseLat, Lng: baseLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	for _, c := range cands {
		if c.PetID != id {
			continue
		}
		if c.DistanceMeters < 250 || c.DistanceMeters > 350 {
			t.Fatalf("distancia fuera de rango: %g m (se sembró a ~300)", c.DistanceMeters)
		}
		if c.LastSeenAt.IsZero() {
			t.Fatal("LastSeenAt llegó en cero")
		}
		return
	}
	t.Fatal("no se encontró la mascota sembrada")
}
```

- [ ] **Step 2: Correr el test para verificar que NO compila todavía**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestStrayCandidates -count=1 > /tmp/t.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1`, y en el log `repo.FindStrayCandidates undefined`.

> **Verificá con el EXIT CODE, nunca con un grep sobre la salida** (regla #41). Y `DATABASE_URL` a **`lostpets_test`** en el puerto **5433** — a `lostpets` te borra el seed, y sin la variable `SetupTestDB` **saltea en silencio** y el verde no significa nada.

- [ ] **Step 3: Commit del test solo**

```bash
git add backend/tests/stray_candidate_repository_test.go
git commit -m "test(backend): el test de candidatos, en rojo — falta la consulta"
```

---

### Task 3: La consulta del repositorio

**Files:**
- Modify: `backend/internal/repository/interfaces.go` (interfaz `PetRepository`)
- Modify: `backend/internal/repository/pet_repository.go`

- [ ] **Step 1: Agregar la firma a la interfaz**

En `interfaces.go`, dentro de `PetRepository`, junto a `FindPublicByUserID`:

```go
	// FindStrayCandidates devuelve los callejeros cercanos al punto consultado
	// para preguntarle a quien va a publicar si no es uno de esos.
	//
	// Es la ÚNICA consulta de mascotas que NO aplica straySightingNotExpired, y
	// eso es su contrato entero: existe para ver justo lo que el feed, el mapa y
	// el perfil público esconden. No aplicarla NO es un parámetro — un
	// `include_expired` colgado de un endpoint compartido sería una perilla que
	// apaga la protección desde la superficie que la protección cuida (el
	// defecto que levantó la revisión del #220).
	//
	// El radio y el tope tampoco son parámetros: viven en el dominio
	// (StrayCandidateRadiusMeters, StrayCandidateLimit).
	FindStrayCandidates(c domain.StrayCandidateCriteria) ([]domain.StrayCandidate, error)
```

- [ ] **Step 2: Implementar la consulta**

En `pet_repository.go`, después de `FindByReporterID`:

```go
// FindStrayCandidates — ver el contrato en repository/interfaces.go.
//
// DISTINCT ON (p.id) porque una mascota tiene muchos reportes y sin eso saldría
// repetida una vez por cada pin dentro del radio. El ORDER BY interno elige el
// MÁS CERCANO de sus reportes, que es la respuesta correcta a "¿a qué distancia
// está este animal?".
//
// NO filtra por episodio, a diferencia de FindNearby, y es deliberado. Ese
// filtro existe para que el mapa de una búsqueda activa no mezcle pines de
// episodios viejos; acá la pregunta es otra ("¿este animal ya está
// registrado?") y un episodio cerrado no la cambia. Además current_episode_id
// es nullable: comparar contra NULL da NULL y excluiría EN SILENCIO a todo
// callejero sin episodio.
//
// Sin Preload de Owner ni de Reporter: esta lista se muestra para RECONOCER a
// un animal, no para contactar a nadie, y PetResponse incluye el teléfono sin
// condición. Ver el preload que filtraba el teléfono en el perfil público.
func (r *PostgresPetRepository) FindStrayCandidates(c domain.StrayCandidateCriteria) ([]domain.StrayCandidate, error) {
	// fmt.Sprintf para los float64 por el mismo motivo documentado en
	// FindNearby: gorm.Expr con ? puede perder el ordenamiento en expresiones
	// PostGIS. No hay riesgo de inyección — el tipo no es texto del usuario.
	distExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography)",
		c.Lng, c.Lat,
	)

	q := r.db.Table("pets").
		Select(`DISTINCT ON (pets.id)
			pets.id AS pet_id,
			pets.name,
			pets.type,
			COALESCE(photos.url, '') AS photo_url,
			COALESCE(pets.last_reported_at, pets.created_at) AS last_seen_at,
			` + distExpr + ` AS distance_meters`).
		Joins("JOIN reports ON reports.pet_id = pets.id").
		Joins("LEFT JOIN photos ON photos.pet_id = pets.id AND photos.is_primary = true").
		Where("pets.status = ?", domain.PetStatusStray).
		Where(fmt.Sprintf("%s <= ?", distExpr), domain.StrayCandidateRadiusMeters).
		Order("pets.id, " + distExpr + " ASC")

	if c.PetType != "" {
		q = q.Where("pets.type = ?", c.PetType)
	}

	var candidates []domain.StrayCandidate
	// La subconsulta re-ordena por distancia: DISTINCT ON obliga a que el ORDER
	// BY interno empiece por pets.id, así que el orden de adentro es por id y no
	// sirve para la pantalla.
	err := r.db.Table("(?) AS c", q).
		Order("c.distance_meters ASC").
		Limit(domain.StrayCandidateLimit).
		Scan(&candidates).Error

	return candidates, err
}
```

- [ ] **Step 3: Verificar que compila y correr el test**

```bash
cd backend && go build ./... && \
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestStrayCandidates -count=1 > /tmp/t.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. Si no, leer `/tmp/t.log`.

- [ ] **Step 4: Probar el rojo de la mitad que importa**

Comentar la línea `Where("pets.status = ?", domain.PetStatusStray)` y volver a correr.
Expected: falla `TestStrayCandidates_NoDevuelveMascotasPerdidas`. **Descomentar.**

Después, en `pet_repository.go`, agregar temporalmente a `FindStrayCandidates` el scope de caducidad:

```go
	expiryClause, expiryArgs := straySightingNotExpired()
	q = q.Where(expiryClause, expiryArgs...)
```

Expected: falla `TestStrayCandidates_DevuelveLoVencidoQueElFeedEsconde`. **Sacarlo.**

> Este paso no es ceremonia: un test que nunca se vio en rojo no prueba que proteja nada.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/repository/
git commit -m "feat(backend): consulta de callejeros cercanos sin filtro de caducidad"
```

---

### Task 4: Servicio, DTO, handler y ruta

**Files:**
- Modify: `backend/internal/service/pet_service.go`
- Create: `backend/internal/dto/stray_candidate_dto.go`
- Modify: `backend/internal/handler/pet_handler.go`
- Modify: `backend/internal/app/router.go`

- [ ] **Step 1: El método del servicio**

En la interfaz `PetService`:

```go
	// FindStrayCandidates devuelve los callejeros cercanos para la pregunta
	// "¿no es alguno de estos?" del alta. Ver el contrato del repositorio.
	FindStrayCandidates(c domain.StrayCandidateCriteria) ([]domain.StrayCandidate, error)
```

Y la implementación, junto a `SearchPets`:

```go
func (s *petService) FindStrayCandidates(c domain.StrayCandidateCriteria) ([]domain.StrayCandidate, error) {
	return s.repo.FindStrayCandidates(c)
}
```

- [ ] **Step 2: El DTO**

```go
package dto

import (
	"time"

	"lost-pets/internal/domain"
)

// StrayCandidateResponse es una tarjeta de la pregunta "¿no es alguno de
// estos?".
//
// Lleva `last_seen_at` y NO un booleano "vencido": la pantalla muestra "visto
// por última vez hace 4 meses", que es un HECHO que la persona puede usar para
// reconocer al animal. "Vencido" es jerga nuestra, no significa nada para quien
// lo lee y sugiere que el animal ya no está — que es justo lo que no sabemos.
type StrayCandidateResponse struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	PhotoURL       string    `json:"photo_url,omitempty"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	DistanceMeters float64   `json:"distance_meters"`
}

// ToStrayCandidateList mapea la lista. Devuelve slice vacío y NUNCA nil: el
// front distingue "no hay candidatos" de "no pudimos preguntar" por la
// AUSENCIA de datos, así que un null acá se leería como un fallo.
func ToStrayCandidateList(candidates []domain.StrayCandidate) []StrayCandidateResponse {
	out := make([]StrayCandidateResponse, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, StrayCandidateResponse{
			ID:             c.PetID.String(),
			Name:           c.Name,
			Type:           c.Type,
			PhotoURL:       c.PhotoURL,
			LastSeenAt:     c.LastSeenAt,
			DistanceMeters: c.DistanceMeters,
		})
	}
	return out
}
```

- [ ] **Step 3: El handler**

En `pet_handler.go`, después de `SearchPets`:

```go
// StrayCandidates godoc
// GET /api/pets/stray-candidates?lat=&lng=&type=
// Protegido. Devuelve los callejeros cercanos —vencidos y vivos— para
// preguntarle a quien va a publicar si no es alguno de esos.
//
// El radio NO se acepta por query: vive en domain.StrayCandidateRadiusMeters.
func (h *PetHandler) StrayCandidates(c *gin.Context) {
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
	if errLat != nil || errLng != nil || !validCoordinates(lat, lng) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	candidates, err := h.petService.FindStrayCandidates(domain.StrayCandidateCriteria{
		Lat:     lat,
		Lng:     lng,
		PetType: c.Query("type"),
	})
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToStrayCandidateList(candidates))
}
```

- [ ] **Step 4: La ruta**

En `router.go`, en el grupo `protected`, junto a `GET /pets/reported`:

```go
		// Estática, así que Gin la prioriza sobre cualquier /pets/:id del mismo
		// método — mismo criterio que /pets/mine y /pets/reported.
		protected.GET("/pets/stray-candidates", petHandler.StrayCandidates)
```

- [ ] **Step 5: Verificar que compila**

Run: `cd backend && go build ./...`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/
git commit -m "feat(backend): endpoint GET /api/pets/stray-candidates"
```

---

### Task 5: El test e2e

**Files:**
- Create: `backend/tests/e2e/stray_candidates_flow_test.go`

- [ ] **Step 1: Escribir el test**

```go
//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// TestStrayCandidatesFlow_ExigeSesionYDevuelveElCallejeroCercano recorre el
// endpoint por HTTP: sin token no existe, y con token devuelve el callejero que
// se acaba de dar de alta a 300 m.
func TestStrayCandidatesFlow_ExigeSesionYDevuelveElCallejeroCercano(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	const lat, lng = -34.9011, -56.1645
	// ~300 m al norte: 1 grado de latitud ≈ 111.320 m.
	vecino := lat + 300.0/111320.0

	url := fmt.Sprintf("%s/api/pets/stray-candidates?lat=%f&lng=%f&type=perro", baseURL, lat, lng)

	// ── Sin sesión: 401 ──
	anon, err := http.Get(url)
	if err != nil {
		t.Fatalf("sin token: %v", err)
	}
	defer anon.Body.Close()
	if anon.StatusCode != http.StatusUnauthorized {
		t.Fatalf("sin token: want 401, got %d", anon.StatusCode)
	}

	token, _ := registerAndLogin(t, baseURL)

	// ── Alta del callejero, con su initial_report obligatorio ──
	body, _ := json.Marshal(map[string]interface{}{
		"name":   "Callejero",
		"type":   "perro",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":    vecino,
			"longitude":   lng,
			"description": "visto en la esquina",
			"occurred_at": time.Now().Add(-time.Hour).Format(time.RFC3339),
		},
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(body))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")
	created, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("crear stray: %v", err)
	}
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("crear stray: want 201, got %d", created.StatusCode)
	}
	var pet struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(created.Body).Decode(&pet); err != nil {
		t.Fatalf("decode stray: %v", err)
	}

	// ── Con sesión: aparece, con distancia y última vista ──
	authReq, _ := http.NewRequest(http.MethodGet, url, nil)
	authReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	resp, err := http.DefaultClient.Do(authReq)
	if err != nil {
		t.Fatalf("con token: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("con token: want 200, got %d", resp.StatusCode)
	}

	var candidatos []struct {
		ID             string    `json:"id"`
		LastSeenAt     time.Time `json:"last_seen_at"`
		DistanceMeters float64   `json:"distance_meters"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&candidatos); err != nil {
		t.Fatalf("decode candidatos: %v", err)
	}

	for _, c := range candidatos {
		if c.ID != pet.ID {
			continue
		}
		if c.DistanceMeters < 250 || c.DistanceMeters > 350 {
			t.Fatalf("distancia fuera de rango: %g m", c.DistanceMeters)
		}
		if c.LastSeenAt.IsZero() {
			t.Fatal("last_seen_at llegó en cero")
		}
		return
	}
	t.Fatalf("el callejero recién creado no salió como candidato (%d resultados)", len(candidatos))
}

// Coordenadas inválidas son culpa del cliente: 400, no 500.
func TestStrayCandidatesFlow_CoordenadasInvalidasSon400(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	for _, q := range []string{"lat=999&lng=-56", "lat=abc&lng=-56", "lng=-56"} {
		req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/pets/stray-candidates?"+q, nil)
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d", q, resp.StatusCode)
		}
	}
}
```

- [ ] **Step 2: Correr**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test -tags e2e ./tests/e2e/ -run TestStrayCandidatesFlow -count=1 > /tmp/e2e.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 3: Suite completa del backend**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./... -count=1 > /tmp/all.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. Tarda ~600s — **no la interrumpas**: una corrida matada por timeout deja basura en `lostpets_test` y después fallan tres tests de Impact con "want N users, got N+1".

- [ ] **Step 4: Commit y PR 1**

```bash
git add backend/tests/e2e/stray_candidates_flow_test.go
git commit -m "test(backend): flujo e2e del endpoint de candidatos"
git log --oneline origin/main..HEAD   # sólo lo de este PR
git push -u origin feat/stray-duplicate-candidates
```

Abrir el PR con la skill `searchpet-pr`.

---

# PR 2 — El paso en el wizard web

> Sale de la rama del PR 1: `git checkout -b feat/stray-candidates-step` estando en `feat/stray-duplicate-candidates`.

### Task 6: Tipo, cliente y hook

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts`
- Modify: `frontend/packages/shared/hooks/index.ts`

- [ ] **Step 1: El tipo**

En `shared/types/index.ts`, junto a los tipos de Pet:

```ts
/**
 * Un avistamiento de callejero cercano, para la pregunta "¿no es alguno de
 * estos?" del alta (GET /api/pets/stray-candidates).
 *
 * `last_seen_at` viene siempre con valor — el backend resuelve el COALESCE — y
 * NO hay ningún campo "vencido": la pantalla muestra la fecha, que es el dato
 * que la persona usa para reconocer al animal.
 */
export interface StrayCandidate {
  id: string;
  name: string;
  type: PetType;
  photo_url?: string;
  last_seen_at: string;
  distance_meters: number;
}
```

- [ ] **Step 2: El método del cliente**

En `client.ts`, junto a `getReportedPets`:

```ts
  // El radio NO se manda: lo fija el backend (domain.StrayCandidateRadiusMeters).
  async getStrayCandidates(params: {
    lat: number;
    lng: number;
    type?: string;
  }): Promise<StrayCandidate[]> {
    const query: Record<string, string | number> = { lat: params.lat, lng: params.lng };
    if (params.type) query['type'] = params.type;
    return this.request<StrayCandidate[]>('GET', '/api/pets/stray-candidates', undefined, query);
  }
```

Agregar `StrayCandidate` al import de tipos del archivo.

- [ ] **Step 3: El hook**

En `shared/hooks/index.ts`, junto a `useReportedPets`:

```ts
// useStrayCandidates — callejeros cercanos para el paso "¿no es alguno de
// estos?" del alta (GET /api/pets/stray-candidates).
//
// `enabled` existe porque el paso sólo consulta cuando ya hay ubicación: sin
// ella no hay nada que preguntar. Ojo con el efecto de esa bandera — una query
// deshabilitada queda en `pending` PARA SIEMPRE, así que quien la consuma tiene
// que ramificar por `isLoading` y nunca por `isPending` (ver ListState).
export const useStrayCandidates = (
  params: { lat: number; lng: number; type?: string } | null,
  enabled: boolean = true,
) => {
  return useQuery({
    queryKey: ['stray-candidates', params?.lat, params?.lng, params?.type],
    queryFn: () => apiClient.getStrayCandidates(params!),
    enabled: enabled && params !== null,
    // No se cachea entre altas: dos publicaciones seguidas desde el mismo punto
    // son dos preguntas distintas, y la segunda tiene que ver la mascota que
    // creó la primera.
    staleTime: 0,
  });
};
```

- [ ] **Step 4: Verificar tipos**

```bash
cd frontend/packages/web && pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/
git commit -m "feat(shared): tipo, cliente y hook de candidatos de callejero"
```

---

### Task 7: Las claves i18n

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

- [ ] **Step 1: Agregar al namespace `publish` de `es.json`**

```json
"candidates": {
  "title": "¿No es alguno de estos?",
  "subtitle": "Encontramos avistamientos cerca de donde lo viste. Si es el mismo animal, sumá tu avistamiento a su ficha en vez de crear una nueva.",
  "lastSeen": "Visto por última vez {{when}}",
  "distance": "a {{meters}} m",
  "isThisOne": "Es este",
  "noneOfThem": "Ninguno, es otro animal",
  "errorTitle": "No pudimos buscar avistamientos cercanos",
  "errorBody": "Puede que ya haya una ficha de este animal. Podés reintentar o publicar igual.",
  "publishAnyway": "Publicar igual"
}
```

- [ ] **Step 2: `en.json`**

```json
"candidates": {
  "title": "Is it one of these?",
  "subtitle": "We found sightings near where you saw it. If it is the same animal, add your sighting to its page instead of creating a new one.",
  "lastSeen": "Last seen {{when}}",
  "distance": "{{meters}} m away",
  "isThisOne": "This is the one",
  "noneOfThem": "None of these, it is a different animal",
  "errorTitle": "We could not look for nearby sightings",
  "errorBody": "There may already be a page for this animal. You can retry or publish anyway.",
  "publishAnyway": "Publish anyway"
}
```

- [ ] **Step 3: `pt.json`**

```json
"candidates": {
  "title": "Não é algum destes?",
  "subtitle": "Encontramos avistamentos perto de onde você o viu. Se for o mesmo animal, some o seu avistamento à ficha dele em vez de criar uma nova.",
  "lastSeen": "Visto pela última vez {{when}}",
  "distance": "a {{meters}} m",
  "isThisOne": "É este",
  "noneOfThem": "Nenhum, é outro animal",
  "errorTitle": "Não conseguimos buscar avistamentos próximos",
  "errorBody": "Pode já existir uma ficha deste animal. Você pode tentar de novo ou publicar mesmo assim.",
  "publishAnyway": "Publicar mesmo assim"
}
```

- [ ] **Step 4: Verificar que `publish` está registrado en `index.ts`**

Run: `rg "publish" frontend/packages/web/src/i18n/index.ts`
Expected: aparece en los tres bloques `es`/`en`/`pt`. Si no, agregarlo — un namespace que está en los JSON pero no en el config devuelve **la clave cruda** (regla #21).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/i18n/
git commit -m "feat(web): claves i18n del paso de candidatos"
```

---

### Task 8: El test del componente — error ≠ vacío

**Files:**
- Create: `frontend/packages/web/src/components/publish/CandidatesStep.test.tsx`

- [ ] **Step 1: Escribir el test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CandidatesStep } from './CandidatesStep';
import type { StrayCandidate } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const candidato: StrayCandidate = {
  id: 'pet-1',
  name: 'Marrón',
  type: 'perro',
  photo_url: 'https://res.cloudinary.com/demo/image/upload/x.jpg',
  last_seen_at: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
  distance_meters: 312,
};

// El sobre mínimo de UseQueryResult que consume ListState.
const queryStub = (over: Record<string, unknown>) =>
  ({
    data: undefined,
    isLoading: false,
    isPaused: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  }) as never;

describe('CandidatesStep', () => {
  it('con la consulta caída muestra el cartel de error, NO "no hay candidatos"', () => {
    render(
      <CandidatesStep
        query={queryStub({ isError: true, data: undefined })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    // El cartel de error existe...
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // ...y el usuario NO queda encerrado: sigue pudiendo publicar.
    expect(screen.getByText('candidates.publishAnyway')).toBeInTheDocument();
  });

  it('con cero candidatos NO se muestra nada y avisa que hay que seguir', () => {
    const onSkip = vi.fn();
    const { container } = render(
      <CandidatesStep query={queryStub({ data: [] })} onSelect={vi.fn()} onSkip={onSkip} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('lista los candidatos y "es este" devuelve el elegido', async () => {
    const onSelect = vi.fn();
    render(
      <CandidatesStep query={queryStub({ data: [candidato] })} onSelect={onSelect} onSkip={vi.fn()} />,
    );

    expect(screen.getByText('Marrón')).toBeInTheDocument();
    // La tarjeta NUNCA usa la palabra "vencido" — dice cuándo se lo vio.
    expect(screen.queryByText(/vencid/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('candidates.isThisOne'));
    expect(onSelect).toHaveBeenCalledWith(candidato);
  });
});
```

- [ ] **Step 2: Correr y ver el rojo**

```bash
cd frontend/packages/web
pnpm vitest run src/components/publish/CandidatesStep.test.tsx > /tmp/v.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`, "Failed to resolve import ./CandidatesStep".

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/components/publish/CandidatesStep.test.tsx
git commit -m "test(web): el paso de candidatos, en rojo — falta el componente"
```

---

### Task 9: El componente

**Files:**
- Create: `frontend/packages/web/src/components/publish/CandidatesStep.tsx`

- [ ] **Step 1: Escribir el componente**

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StrayCandidate } from '@shared/types';
import { ListState } from '../list/ListState';
import { cloudinaryCardThumb } from '@shared/utils/cloudinaryThumb';
import { PawPlaceholder } from '../PawPlaceholder';

interface CandidatesStepProps {
  query: UseQueryResult<StrayCandidate[]>;
  /** El usuario dice que es este animal: se reporta sobre la ficha existente. */
  onSelect: (candidate: StrayCandidate) => void;
  /** No hay nada que preguntar (cero candidatos): seguir al alta. */
  onSkip: () => void;
}

/**
 * "¿No es alguno de estos?" — el paso que evita el duplicado.
 *
 * Tres reglas que NO son cosméticas:
 *
 * 1. **Con cero candidatos no se muestra**, y llama a `onSkip`. Preguntarle a
 *    alguien por una lista vacía es hacerle perder un paso.
 *
 * 2. **Si la consulta FALLA, sí se muestra**, con el cartel de error y
 *    "Publicar igual". Saltear en silencio pintaría "no hay candidatos" cuando
 *    en realidad no pudimos preguntar — el bug que `ListState` existe para
 *    matar— y acá el precio de esa mentira es el duplicado que este paso viene
 *    a evitar.
 *
 * 3. **Nunca bloquea.** Un 500 no puede impedir que alguien publique un animal
 *    que está en la calle ahora.
 */
export function CandidatesStep({ query, onSelect, onSkip }: CandidatesStepProps) {
  const { t } = useTranslation(['publish', 'common']);

  // `query.data` y no `items.length`: una lista vacía que SÍ llegó es una
  // respuesta ("no hay ninguno cerca") y el paso sobra. Un error deja `data`
  // en undefined y NO tiene que saltear.
  const sinCandidatos = query.data != null && query.data.length === 0;

  useEffect(() => {
    if (sinCandidatos) onSkip();
  }, [sinCandidatos, onSkip]);

  if (sinCandidatos) return null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {t('publish:candidates.title')}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('publish:candidates.subtitle')}
      </p>

      <ListState
        query={query}
        loading={<div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
        // Inalcanzable: con cero candidatos el componente ya devolvió null.
        // El slot es obligatorio, así que va el mismo esqueleto vacío.
        empty={<></>}
        errorTitle={t('publish:candidates.errorTitle')}
        errorBody={t('publish:candidates.errorBody')}
      >
        {(items) => (
          <ul className="space-y-3">
            {items.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                  {c.photo_url ? (
                    <img
                      src={cloudinaryCardThumb(c.photo_url)}
                      alt={c.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PawPlaceholder />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{c.name}</p>
                  {/* La fecha, NUNCA la palabra "vencido": es jerga nuestra,
                      sugiere que el animal ya no está, y lo que la persona
                      necesita para reconocerlo es cuándo se lo vio. */}
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('publish:candidates.lastSeen', {
                      when: new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
                        -Math.round((Date.now() - new Date(c.last_seen_at).getTime()) / 86400000),
                        'day',
                      ),
                    })}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t('publish:candidates.distance', { meters: Math.round(c.distance_meters) })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  {t('publish:candidates.isThisOne')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ListState>

      {/* Fuera del ListState a propósito: tiene que estar TAMBIÉN cuando la
          consulta falló, que es justo cuando el usuario no puede ver ninguna
          tarjeta y necesita una salida. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-6 w-full rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        {query.data == null
          ? t('publish:candidates.publishAnyway')
          : t('publish:candidates.noneOfThem')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Correr el test**

```bash
cd frontend/packages/web
pnpm vitest run src/components/publish/CandidatesStep.test.tsx > /tmp/v.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 3: Probar el rojo del invariante que importa**

Cambiar `const sinCandidatos = query.data != null && query.data.length === 0;` por
`const sinCandidatos = (query.data ?? []).length === 0;` — el bug clásico.

Run el test otra vez.
Expected: falla el caso "con la consulta caída muestra el cartel de error", porque con `data: undefined` saltearía. **Revertir.**

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/web/src/components/publish/CandidatesStep.tsx
git commit -m "feat(web): paso de candidatos que distingue lista caída de lista vacía"
```

---

### Task 10: Cablear el paso en el wizard

**Files:**
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`

- [ ] **Step 1: Sumar el paso a los tipos y a las listas**

```ts
export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'adoption-form' | 'location' | 'auth' | 'candidates' | 'success';

const PUBLISH_STEPS: PublishStep[] = ['intent', 'lost-pet', 'stray-form', 'adoption-form', 'location', 'auth', 'candidates', 'success'];

const STEP_INTENT: Partial<Record<PublishStep, PublishIntent>> = {
  'lost-pet': 'lost',
  'stray-form': 'stray',
  'adoption-form': 'adoption',
  location: 'stray',
  // A `candidates` sólo se llega desde el camino de callejera, igual que a
  // `location`: sin esto, un F5 en ?paso=candidatos deja el intent en null y se
  // repite el agujero de la regla #52.
  candidates: 'stray',
};
```

- [ ] **Step 2: La guarda de precondición**

En el bloque que deriva el paso pedido por URL, junto a la de `location`:

```ts
    if (pasoPedido === 'location' && !wizard.strayForm.type) return 'intent';
    // `candidates` consulta por UBICACIÓN: sin ella no tiene nada que preguntar
    // y el paso se quedaría vacío para siempre. Es la guarda que siempre falta
    // (regla #52, hallazgo (a)).
    if (pasoPedido === 'candidates' && !wizard.location) return 'intent';
```

- [ ] **Step 3: El hook y los handlers**

Junto a los otros hooks del componente:

```ts
  const candidatesQuery = useStrayCandidates(
    wizard.location
      ? {
          lat: wizard.location.latitude,
          lng: wizard.location.longitude,
          type: wizard.strayForm.type || undefined,
        }
      : null,
    step === 'candidates',
  );
```

Y reemplazar el cuerpo de `handlePublish`:

```ts
  const handlePublish = async (location: typeof wizard.location) => {
    if (!location) return;
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    // El paso de candidatos va DESPUÉS del login: reportar exige cuenta igual,
    // y con la sesión resuelta el endpoint puede ser protegido.
    setStep('candidates');
  };
```

En `InlineAuthStep.onAuthenticated`, cambiar la rama de callejera:

```ts
              if (wizard.location) setStep('candidates');
```

Y sumar los dos handlers del paso nuevo:

```ts
  // "Ninguno" y "Publicar igual" terminan en lo mismo: el alta que el usuario
  // vino a hacer. Un fallo de la consulta NUNCA la bloquea.
  const handleSkipCandidates = () => {
    if (wizard.location) submitStray(wizard.location);
  };

  // "Es este": el reporte va sobre la ficha EXISTENTE. No hay código de
  // revival — POST /api/reports estampa last_reported_at y la mascota vuelve al
  // feed, al mapa y al perfil sola.
  const handleSelectCandidate = (candidate: StrayCandidate) => {
    navigate(`/reports/create?petId=${candidate.id}&status=sighting`);
  };
```

- [ ] **Step 4: El render**

Entre el bloque de `auth` y el de `success`:

```tsx
        {step === 'candidates' && (
          <CandidatesStep
            query={candidatesQuery}
            onSelect={handleSelectCandidate}
            onSkip={handleSkipCandidates}
          />
        )}
```

- [ ] **Step 5: Los imports**

```ts
import { CandidatesStep } from '../components/publish/CandidatesStep';
import { useCreatePet, usePublishStray, useUploadPhoto, useStrayCandidates } from '@shared/hooks';
import type { Pet, CreatePetRequest, InitialReportRequest, StrayCandidate } from '@shared/types';
```

- [ ] **Step 6: Tipos y tests**

```bash
cd frontend/packages/web
pnpm tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
```
Expected: los dos `EXIT=0`. Si algún test del wizard esperaba que `handlePublish` creara la mascota de una, hay que actualizarlo — el flujo ahora pasa por `candidates`.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src/pages/PublishWizardPage.tsx
git commit -m "feat(web): el alta de un callejero pregunta antes si no es uno que ya está"
```

---

### Task 11: Verificación en el navegador y PR 2

- [ ] **Step 1: Levantar la app y recorrer el flujo**

Usar la skill `/verify`. Recorrer:

1. Publicar un callejero cerca de otro que ya exista → **aparece el paso** con la tarjeta, su distancia y "visto por última vez…".
2. "Es este" → cae en `/reports/create?petId=…&status=sighting`, **sin** crear una mascota nueva.
3. "Ninguno" → se crea la mascota y termina en `success`.
4. Con el backend apagado en ese punto → **cartel de error** y "Publicar igual", que publica.
5. F5 en `/publish?paso=candidatos` → vuelve a `intent`, no a un paso vacío.

- [ ] **Step 2: Suite completa de web**

```bash
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 3: Abrir el PR 2**

```bash
git log --oneline origin/main..HEAD    # ojo: incluye los commits del PR 1
git push -u origin feat/stray-candidates-step
```

Abrirlo **con base `feat/stray-duplicate-candidates`**, no `main`. El CI corre igual: el filtro `branches` se sacó en el #118 justamente para que un PR stackeado no quede sin jobs (regla #44).

- [ ] **Step 4: Actualizar el issue #221**

Comentar qué quedó afuera: **mobile sigue sin el paso**, así que hasta esa tanda las dos plataformas divergen. El issue **no se cierra** todavía. Sumar también la consulta que quedó sin medir:

```sql
SELECT count(*) FROM pets p
WHERE p.status = 'stray'
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.pet_id = p.id);
```

---

## Verificación final

- [ ] Backend verde con `DATABASE_URL` a `lostpets_test` (puerto 5433), medido **por exit code** y no por un grep sobre la salida (regla #41).
- [ ] E2E verde con `-tags e2e`.
- [ ] Web verde con `pnpm test:run`.
- [ ] Los cinco recorridos del navegador del Task 11.
- [ ] Después de mergear el PR 1: `gh pr edit <n> --base main` sobre el PR 2 **antes** de borrar la rama (regla #49).
- [ ] Después de cada merge, verificar el CI de **`main`**, no el del PR (regla #62).
- [ ] El deploy se confirma **por contenido**, no con `/health` (regla #46): `GET /api/pets/stray-candidates` sin token tiene que dar **401** en producción, y hoy da **404**. Ese cambio 404 → 401 es el discriminador.
