# Liveness and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /health/ready`, which answers 503 when Postgres does not respond, so an outage of the database stops being invisible to monitoring — while `/health` stays dependency-free.

**Architecture:** A `HealthHandler` in `internal/handler` depends on a small `ReadinessChecker` interface it declares itself. The concrete implementation lives in `pkg/database`, which already owns connection concerns, and runs `SELECT 1` under a 2s context timeout. `/health` is not modified.

**Tech Stack:** Go 1.25, Gin, GORM, PostgreSQL. Tests with `net/http/httptest`, the existing `tests` package, and `tests/e2e` behind the `e2e` build tag.

**Spec:** `docs/superpowers/specs/2026-08-03-health-readiness-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/internal/handler/health_handler.go` | Create: `ReadinessChecker` interface, `HealthHandler.Ready` |
| `backend/pkg/database/readiness.go` | Create: GORM-backed checker, `SELECT 1` + 2s timeout |
| `backend/internal/app/router.go` | Modify: wire the handler, register `GET /health/ready` |
| `backend/tests/health_handler_test.go` | Create: stubbed 200/503 paths and body shape |
| `backend/tests/e2e/health_ready_flow_test.go` | Create: real Postgres, closed pool, and `/health` staying dumb |

---

## Task 1: The readiness handler

**Files:**
- Create: `backend/internal/handler/health_handler.go`
- Create: `backend/tests/health_handler_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/health_handler_test.go`:

```go
package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"lost-pets/internal/handler"
)

// stubChecker devuelve el error que le pongan, sin tocar ninguna base.
type stubChecker struct{ err error }

func (s *stubChecker) Check(ctx context.Context) error { return s.err }

func buildHealthRouter(err error) *gin.Engine {
	h := handler.NewHealthHandler(&stubChecker{err: err}, zap.NewNop())
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health/ready", h.Ready)
	return r
}

func doReady(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestReady_BaseRespondeDa200 es el camino feliz.
func TestReady_BaseRespondeDa200(t *testing.T) {
	w := doReady(buildHealthRouter(nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, quiero 200", w.Code)
	}

	var cuerpo map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if cuerpo["status"] != "ready" {
		t.Fatalf(`status = %q, quiero "ready"`, cuerpo["status"])
	}
}

// TestReady_BaseCaidaDa503 fija el contrato que el monitor lee: cualquier no-2xx
// lo tumba, y 503 es el que corresponde a una dependencia caida.
func TestReady_BaseCaidaDa503(t *testing.T) {
	w := doReady(buildHealthRouter(errors.New("dial tcp 10.0.0.7:5432: connect: connection refused")))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, quiero 503", w.Code)
	}

	var cuerpo map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if cuerpo["code"] != "not_ready" {
		t.Fatalf(`code = %q, quiero "not_ready"`, cuerpo["code"])
	}
}

// TestReady_ElCuerpoNoFiltraElErrorDelDriver es el test que protege la decision del
// spec: los errores de Postgres traen host, puerto, usuario y a veces el nombre de
// la base, y este endpoint es PUBLICO. El detalle va al log, nunca al cuerpo.
func TestReady_ElCuerpoNoFiltraElErrorDelDriver(t *testing.T) {
	const secreto = "dial tcp 10.0.0.7:5432: connect: connection refused"
	w := doReady(buildHealthRouter(errors.New(secreto)))

	cuerpo := w.Body.String()
	for _, filtracion := range []string{"10.0.0.7", "5432", "dial tcp"} {
		if strings.Contains(cuerpo, filtracion) {
			t.Fatalf("el cuerpo %q expone %q — el error del driver no puede salir al publico", cuerpo, filtracion)
		}
	}
}
```

The import block of this file needs `"strings"` alongside the others.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -count=1 -run TestReady_ > /tmp/h1.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: handler.NewHealthHandler` in `/tmp/h1.log`. Read the log on any other value — never grep for "FAIL" (rule #41).

- [ ] **Step 3: Create the handler**

Create `backend/internal/handler/health_handler.go`:

```go
package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ReadinessChecker responde si la dependencia dura del backend contesta.
//
// La interfaz la declara el consumidor, no el proveedor: el handler no conoce
// gorm y se testea con un stub. La implementacion concreta vive en pkg/database,
// que ya es la duena de las cuestiones de conexion.
type ReadinessChecker interface {
	Check(ctx context.Context) error
}

// HealthHandler sirve el readiness. El liveness (/health) NO pasa por aca a
// proposito: su valor es no tener dependencias. Ver el design del 2026-08-03.
type HealthHandler struct {
	checker ReadinessChecker
	log     *zap.Logger
}

func NewHealthHandler(checker ReadinessChecker, log *zap.Logger) *HealthHandler {
	return &HealthHandler{checker: checker, log: log}
}

// Ready contesta 200 si la base responde y 503 si no.
//
// El error real del driver va al LOG y nunca al cuerpo: los errores de conexion
// de Postgres traen host, puerto, usuario y a veces el nombre de la base, y este
// endpoint es publico. Regalar la topologia de la infraestructura justo cuando
// algo se rompio es exactamente lo que no queremos.
func (h *HealthHandler) Ready(c *gin.Context) {
	if err := h.checker.Check(c.Request.Context()); err != nil {
		h.log.Error("readiness: la base no contesta", zap.Error(err))
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    "not_ready",
			"message": "database unreachable",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && go test ./tests/ -count=1 -run TestReady_ > /tmp/h1.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/health_handler.go backend/tests/health_handler_test.go
git commit -m "feat(ops): handler de readiness, con el error del driver solo en el log"
```

---

## Task 2: The database-backed checker

**Files:**
- Create: `backend/pkg/database/readiness.go`
- Modify: `backend/tests/health_handler_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/health_handler_test.go`:

```go
// TestReadinessChecker_ExigeElValor es el test que impide repetir la falla que este
// endpoint existe para cerrar. Un Scan que no encuentra filas devuelve error nil y
// deja la variable en cero: seria "listo" sin que la base haya contestado nada.
// El checker tiene que exigir que el valor vuelva, no solo que no haya error.
func TestReadinessChecker_ExigeElValor(t *testing.T) {
	db := testdb.SetupTestDB(t)

	checker := database.NewReadinessChecker(db)
	if err := checker.Check(context.Background()); err != nil {
		t.Fatalf("contra una base viva: %v, quiero nil", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	if err := checker.Check(context.Background()); err == nil {
		t.Fatal("con el pool cerrado devolvio nil — el chequeo no ocurrio y dio verde igual")
	}
}
```

Add these imports to the file's import block:

```go
	"lost-pets/pkg/database"
	"lost-pets/tests/testdb"
```

This test seeds no rows on purpose. `testdb.SetupTestDB` registers a cleanup that
truncates every table and closes the pool; closing the pool here makes that truncate
log a warning instead of running. With nothing seeded there is nothing to leak into
the next test.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -count=1 -run TestReadinessChecker_ > /tmp/h2.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: database.NewReadinessChecker` in `/tmp/h2.log`.

`DATABASE_URL` must point at `lostpets_test`, never `lostpets` — the suite truncates
every table. Without the variable `SetupTestDB` skips in silence and a green run means
nothing ran (rule #41).

- [ ] **Step 3: Create the checker**

Create `backend/pkg/database/readiness.go`:

```go
package database

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// readinessTimeout acota lo que puede tardar el chequeo.
//
// Una base colgada no rechaza la conexion: la acepta y no contesta nunca. Sin
// plazo, el request queda abierto hasta que el monitor corta a los 30s, y en el
// medio se come una goroutine por cada poll. Tiene que fallar rapido, no tarde.
const readinessTimeout = 2 * time.Second

// ReadinessChecker corre un SELECT 1 contra la base.
type ReadinessChecker struct {
	db *gorm.DB
}

func NewReadinessChecker(db *gorm.DB) *ReadinessChecker {
	return &ReadinessChecker{db: db}
}

// Check devuelve nil solo si la base contesto el valor esperado.
//
// Es SELECT 1 y no db.Ping() a proposito: Ping puede dar verde contra una conexion
// que ya estaba en el pool sin que el servidor del otro lado conteste nada, o sea
// una senal de exito que tambien se emite cuando el chequeo no ocurrio. Esa es la
// familia de bug que este endpoint viene a cerrar (reglas #34, #41, #46).
//
// Por el mismo motivo se exige el VALOR: un Scan sin filas devuelve error nil y
// deja uno en cero.
func (c *ReadinessChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, readinessTimeout)
	defer cancel()

	var uno int
	if err := c.db.WithContext(ctx).Raw("SELECT 1").Scan(&uno).Error; err != nil {
		return err
	}
	if uno != 1 {
		return fmt.Errorf("readiness: la base no devolvio el valor esperado (%d)", uno)
	}
	return nil
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -count=1 -run TestReadinessChecker_ > /tmp/h2.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/pkg/database/readiness.go backend/tests/health_handler_test.go
git commit -m "feat(ops): checker de readiness con SELECT 1, timeout y valor exigido"
```

---

## Task 3: Register the route

**Files:**
- Modify: `backend/internal/app/router.go`

- [ ] **Step 1: Add the import**

In the import block of `backend/internal/app/router.go`, add after `"lost-pets/pkg/googleauth"`:

```go
	"lost-pets/pkg/database"
```

Keep the existing import order — the block is grouped with `lost-pets/...` paths together.

- [ ] **Step 2: Register the route next to /health**

Find this block (around line 295):

```go
	// ----------------------------------------
	// HEALTH CHECK
	// ----------------------------------------
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})
```

Replace it with:

```go
	// ----------------------------------------
	// HEALTH CHECK — liveness y readiness son DOS preguntas distintas
	//
	// /health no toca ninguna dependencia, y eso es la feature, no una omision:
	// si mirara la base, el monitor dejaria de distinguir "el proceso murio" de
	// "la base no contesta", que son dos fallas con respuestas opuestas. El test
	// TestHealthReady_HealthSigueTontoConLaBaseCaida lo protege.
	// ----------------------------------------
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	healthHandler := handler.NewHealthHandler(database.NewReadinessChecker(db), log)
	router.GET("/health/ready", healthHandler.Ready)
```

- [ ] **Step 3: Build and run the whole suite**

Run: `cd backend && go build ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./... -count=1 > /tmp/h3.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/router.go
git commit -m "feat(ops): registrar /health/ready y dejar por escrito por que /health no cambia"
```

---

## Task 4: Prove it against real Postgres, and prove /health stays dumb

**Files:**
- Create: `backend/tests/e2e/health_ready_flow_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/e2e/health_ready_flow_test.go`:

```go
//go:build e2e

package e2e_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestHealthReady_ConLaBaseCaidaDa503YHealthSigueEn200 corre los dos endpoints
// contra el server real y contra Postgres real, primero sanos y despues con el
// pool cerrado.
//
// Los dos casos viven en la misma funcion y en este orden porque comparten un
// unico pool cerrado, y cerrarlo es destructivo. El test NO siembra ni una fila a
// proposito: el cleanup de SetupTestDB trunca y cierra, y con el pool ya cerrado
// ese truncate loguea un warning en vez de correr. Sin filas sembradas no hay nada
// que se filtre al test siguiente.
//
// El segundo tramo es el que importa mas que ninguno: es el unico que impide que
// alguien "arregle" /health haciendolo consultar la base y borre en silencio la
// distincion entre "el proceso murio" y "la base no contesta".
func TestHealthReady_ConLaBaseCaidaDa503YHealthSigueEn200(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	// --- con la base viva ---

	resp, err := http.Get(baseURL + "/health/ready")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("con la base viva: status %d, quiero 200", resp.StatusCode)
	}
	var sano map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&sano); err != nil {
		resp.Body.Close()
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	resp.Body.Close()
	if sano["status"] != "ready" {
		t.Fatalf(`status = %q, quiero "ready"`, sano["status"])
	}

	// --- se cae la base ---

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	resp, err = http.Get(baseURL + "/health/ready")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("con la base caida: status %d, quiero 503 — el readiness no la esta mirando", resp.StatusCode)
	}

	var caido map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&caido); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if caido["code"] != "not_ready" {
		t.Fatalf(`code = %q, quiero "not_ready"`, caido["code"])
	}
}

// TestHealthReady_HealthSigueTontoConLaBaseCaida es el guardian del diseno.
//
// Si algun dia alguien le agrega una consulta a /health con la mejor intencion,
// este test se pone rojo y le explica por que no.
func TestHealthReady_HealthSigueTontoConLaBaseCaida(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/health dio %d con la base caida — dejo de ser un liveness y el monitor perdio el diagnostico", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/e2e/ -tags e2e -count=1 -run TestHealthReady_ > /tmp/h4.log 2>&1; echo "EXIT=$?"`

If Tasks 1-3 are already committed this passes immediately. To see it red on purpose,
temporarily comment out the `router.GET("/health/ready", ...)` line, re-run, and confirm
the first test fails with `status 404, quiero 200`. Restore the line afterwards.

- [ ] **Step 3: Run the whole e2e suite**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/e2e/ -tags e2e -count=1 > /tmp/h4-all.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. This confirms the closed pool did not poison any sibling test.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/e2e/health_ready_flow_test.go
git commit -m "test(e2e): la base caida da 503 y /health sigue contestando 200"
```

---

## Task 5: The monitor, after the merge

This task runs against live infrastructure and must happen **after** the change is merged
and deployed.

- [ ] **Step 1: Verify the deploy by content, not by /health**

`/health` answers 200 from the old binary just as happily (rule #46). The proof is the new
route existing:

```bash
curl -s -o /dev/null -w "ready=%{http_code}\n" https://searchpet.onrender.com/health/ready
```

Expected: `ready=200`. A 404 means the deploy has not landed yet.

- [ ] **Step 2: Create the monitor**

Type `HTTP` (not KEYWORD), `url: https://searchpet.onrender.com/health/ready`,
`interval: 300`, alert contact `8348190`, friendly name
`SearchPet — base de datos sin responder`.

No keyword and no custom header are needed, so the UptimeRobot MCP server can create this
one directly — the `customHttpHeaders` limitation that forced the raw v3 API for the quota
monitors does not apply. `interval: 60` is rejected by the plan; 300 is the floor.

- [ ] **Step 3: Confirm it reads UP**

A newly created monitor starts as `STARTED` and needs one interval to report. Re-read it
after ~5 minutes and confirm `status: UP`. If it reads DOWN, the endpoint is answering
non-2xx in production and that is a real finding, not a monitor misconfiguration.

- [ ] **Step 4: Update the gap table in CLAUDE.md**

Mark the `/health` row as done, and correct the reason recorded there: Render cannot
restart on a Neon blip today because `healthCheckPath` is empty. The real reason for the
split is diagnostic. `CLAUDE.md` is gitignored and lives only on this machine — it is not
part of any commit.

---

## Final verification

- [ ] **Full backend suite, by exit code and never a grep (rule #41)**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./... -count=1 > /tmp/final.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **E2E suite**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/e2e/ -tags e2e -count=1 > /tmp/final-e2e.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

`-count=1` is mandatory: `go test` returns `ok (cached)` after an edit.
