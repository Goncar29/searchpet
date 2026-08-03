# Quota Exhaustion Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a token-gated endpoint reporting how much of each mail channel's daily reserve is spent, so two UptimeRobot keyword monitors can alert at 80% and at exhaustion.

**Architecture:** A new `OpsQuotaService` in package `service` reads the two channel caps that already live there as unexported constants, counts consumption through the existing `CountSince(ctx, nil, channel, since)`, and grades each channel. A handler gates the report behind a shared secret using the exact ordering of `reindex_handler.go`. UptimeRobot matches keyword tokens in the response body; no threshold logic lives outside Go.

**Tech Stack:** Go 1.25, Gin, GORM, PostgreSQL. Tests with `net/http/httptest` and the existing `tests` package mocks.

**Spec:** `docs/superpowers/specs/2026-08-02-quota-exhaustion-alerting-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/internal/service/verification_service.go` | Modify: add exported `ChannelEmail` constant |
| `backend/internal/service/ops_quota_service.go` | Create: levels, alert tokens, `OpsQuotaService.Report` |
| `backend/internal/handler/ops_quota_handler.go` | Create: token gate + JSON response |
| `backend/config/config.go` | Modify: read `OPS_STATUS_TOKEN` |
| `backend/internal/app/router.go` | Modify: wire service + handler, register route |
| `backend/tests/ops_quota_service_test.go` | Create: level boundaries, alert escalation, error propagation |
| `backend/tests/ops_quota_handler_test.go` | Create: token gate ordering, 200 body, 500 on count failure |
| `backend/tests/e2e/ops_quota_flow_test.go` | Create: real Postgres count |

---

## Task 1: Use the existing `ChannelEmail` constant in the SendOTP guard

**Corrected after execution.** This task originally claimed `ChannelEmail` did not exist
and had to be created. It already existed in the `const` block of
`verification_service.go`. The claim came from a verification whose output was piped
through `head -8`, which cut the line that would have shown it — a truncated check read as
a complete one, which is the same failure this plan warns about elsewhere.

What actually needed doing: `SendOTP` compared against the bare literal `"email"` while
the constant sat six lines above it. Do not touch the constant or its comment.

**Files:**
- Modify: `backend/internal/service/verification_service.go`

- [ ] **Step 1: Use the constant in SendOTP**

In the same file, replace the channel guard:

```go
	// Validar canal
	if channel != ChannelEmail {
		return domain.ErrInvalidInput
```

- [ ] **Step 2: Build and run the existing suite**

Run: `cd backend && go build ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -count=1 > /tmp/t1.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. Read `/tmp/t1.log` on any other value — never grep for "FAIL" (rule #41).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/service/verification_service.go
git commit -m "refactor(auth): usar la constante ChannelEmail en el guard de SendOTP"
```

---

## Task 2: Grade a channel's consumption

**Files:**
- Create: `backend/internal/service/ops_quota_service.go`
- Create: `backend/tests/ops_quota_service_test.go`

- [ ] **Step 1: Write the failing boundary test**

Create `backend/tests/ops_quota_service_test.go`:

```go
package tests

import (
	"testing"

	"lost-pets/internal/service"
)

// TestLevelFor_Bordes fija los bordes de los dos topes reales. El umbral de aviso
// es cap*4/5 con division entera: 250 -> 200 y 50 -> 40 caen exactos, y este test
// es lo unico que lo garantiza si alguien mueve un cap.
func TestLevelFor_Bordes(t *testing.T) {
	casos := []struct {
		nombre string
		used   int64
		cap    int
		quiero string
	}{
		{"email 199 sigue ok", 199, 250, service.QuotaLevelOK},
		{"email 200 es aviso", 200, 250, service.QuotaLevelWarning},
		{"email 249 sigue aviso", 249, 250, service.QuotaLevelWarning},
		{"email 250 es critico", 250, 250, service.QuotaLevelCritical},
		{"email 251 sigue critico", 251, 250, service.QuotaLevelCritical},
		{"reset 39 sigue ok", 39, 50, service.QuotaLevelOK},
		{"reset 40 es aviso", 40, 50, service.QuotaLevelWarning},
		{"reset 49 sigue aviso", 49, 50, service.QuotaLevelWarning},
		{"reset 50 es critico", 50, 50, service.QuotaLevelCritical},
		{"cero es ok", 0, 250, service.QuotaLevelOK},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if got := service.LevelFor(c.used, c.cap); got != c.quiero {
				t.Fatalf("LevelFor(%d, %d) = %q, quiero %q", c.used, c.cap, got, c.quiero)
			}
		})
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -count=1 -run TestLevelFor_Bordes > /tmp/t2.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: service.LevelFor` in `/tmp/t2.log`.

- [ ] **Step 3: Create the service file with the level logic**

Create `backend/internal/service/ops_quota_service.go`:

```go
package service

import (
	"context"
	"time"

	"lost-pets/internal/repository"
)

// Niveles de consumo del cupo, del mas leve al mas grave.
const (
	QuotaLevelOK       = "ok"
	QuotaLevelWarning  = "warning"
	QuotaLevelCritical = "critical"
)

// Tokens que los monitores de UptimeRobot buscan en el cuerpo de la respuesta.
// Son parte del contrato del endpoint, no detalle interno: renombrar uno apaga
// su monitor en silencio.
const (
	AlertQuotaWarn = "QUOTA_WARN"
	AlertQuotaCrit = "QUOTA_CRIT"
)

// LevelFor mapea consumo a nivel.
//
// El umbral de aviso se DERIVA del tope (80%) y no se declara aparte a proposito:
// una constante suelta seguiria existiendo mientras deja de significar 80% apenas
// alguien mueve un cap, y el desfasaje es mudo. Es el modo de falla de la regla
// #40, donde un tope existia solo en apariencia.
func LevelFor(used int64, capacity int) string {
	switch {
	case used >= int64(capacity):
		return QuotaLevelCritical
	case used >= int64(capacity)*4/5:
		return QuotaLevelWarning
	default:
		return QuotaLevelOK
	}
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd backend && go test ./tests/ -count=1 -run TestLevelFor_Bordes > /tmp/t2.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/ops_quota_service.go backend/tests/ops_quota_service_test.go
git commit -m "feat(ops): graduar el consumo del cupo con el umbral derivado del tope"
```

---

## Task 3: Escalating to critical must not read as recovery

**Files:**
- Modify: `backend/internal/service/ops_quota_service.go`
- Modify: `backend/tests/ops_quota_service_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/ops_quota_service_test.go`:

```go
// TestAlertsFor_CriticoEmiteLosDos es el test que protege el bug sutil: si critico
// emitiera solo QUOTA_CRIT, el cuerpo perderia QUOTA_WARN y el monitor de aviso
// mandaria un "recuperado" en el mismo instante que el otro manda "caido".
func TestAlertsFor_CriticoEmiteLosDos(t *testing.T) {
	casos := []struct {
		nivel  string
		quiero []string
	}{
		{service.QuotaLevelOK, []string{}},
		{service.QuotaLevelWarning, []string{service.AlertQuotaWarn}},
		{service.QuotaLevelCritical, []string{service.AlertQuotaWarn, service.AlertQuotaCrit}},
	}

	for _, c := range casos {
		t.Run(c.nivel, func(t *testing.T) {
			got := service.AlertsFor(c.nivel)
			if len(got) != len(c.quiero) {
				t.Fatalf("AlertsFor(%q) = %v, quiero %v", c.nivel, got, c.quiero)
			}
			for i := range c.quiero {
				if got[i] != c.quiero[i] {
					t.Fatalf("AlertsFor(%q)[%d] = %q, quiero %q", c.nivel, i, got[i], c.quiero[i])
				}
			}
		})
	}
}

// TestAlertsFor_OkNoEsNil garantiza que el JSON serialice [] y no null: un null
// en el cuerpo no rompe los monitores hoy, pero es un contrato mas debil de lo
// necesario para nada a cambio.
func TestAlertsFor_OkNoEsNil(t *testing.T) {
	if service.AlertsFor(service.QuotaLevelOK) == nil {
		t.Fatal("AlertsFor(ok) devolvio nil, quiero un slice vacio")
	}
}

// TestWorstLevel toma el peor de dos niveles: el status global es el del canal
// mas comprometido, no un promedio.
func TestWorstLevel(t *testing.T) {
	casos := []struct{ a, b, quiero string }{
		{service.QuotaLevelOK, service.QuotaLevelOK, service.QuotaLevelOK},
		{service.QuotaLevelOK, service.QuotaLevelWarning, service.QuotaLevelWarning},
		{service.QuotaLevelWarning, service.QuotaLevelOK, service.QuotaLevelWarning},
		{service.QuotaLevelWarning, service.QuotaLevelCritical, service.QuotaLevelCritical},
		{service.QuotaLevelCritical, service.QuotaLevelWarning, service.QuotaLevelCritical},
	}
	for _, c := range casos {
		if got := service.WorstLevel(c.a, c.b); got != c.quiero {
			t.Fatalf("WorstLevel(%q,%q) = %q, quiero %q", c.a, c.b, got, c.quiero)
		}
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -count=1 -run "TestAlertsFor|TestWorstLevel" > /tmp/t3.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: service.AlertsFor` in `/tmp/t3.log`.

- [ ] **Step 3: Implement both helpers**

Append to `backend/internal/service/ops_quota_service.go`:

```go
// AlertsFor renderiza los tokens que matchean los monitores.
//
// Critico emite LOS DOS a proposito. Emitir solo QUOTA_CRIT sacaria QUOTA_WARN del
// cuerpo, y el monitor de aviso disparia una recuperacion en el mismo instante en
// que el de critico dispara una caida. Escalar no puede leerse como recuperarse.
func AlertsFor(level string) []string {
	switch level {
	case QuotaLevelCritical:
		return []string{AlertQuotaWarn, AlertQuotaCrit}
	case QuotaLevelWarning:
		return []string{AlertQuotaWarn}
	default:
		return []string{}
	}
}

// WorstLevel devuelve el mas grave de dos niveles.
func WorstLevel(a, b string) string {
	rank := map[string]int{QuotaLevelOK: 0, QuotaLevelWarning: 1, QuotaLevelCritical: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd backend && go test ./tests/ -count=1 -run "TestAlertsFor|TestWorstLevel" > /tmp/t3.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/ops_quota_service.go backend/tests/ops_quota_service_test.go
git commit -m "feat(ops): en critico el cuerpo emite los dos tokens, escalar no es recuperarse"
```

---

## Task 4: Build the report, and never grade a count that failed

**Files:**
- Modify: `backend/internal/service/ops_quota_service.go`
- Modify: `backend/tests/ops_quota_service_test.go`

`mockTokenRepo` already exists in `backend/tests/verification_service_test.go` with
`countGlobal int64` and `countErr error` fields, and the tests live in the same package.
Reuse it — do not write a second mock.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/ops_quota_service_test.go`:

First extend the file's import block to `"context"`, `"errors"`, `"testing"`, and
`"lost-pets/internal/service"`. Then append:

```go
// TestReport_ArmaLosDosCanales verifica el cuerpo completo con consumo real.
//
// mockTokenRepo.CountSince devuelve countGlobal cuando userID es nil, que es
// exactamente como el servicio cuenta el canal entero.
func TestReport_ArmaLosDosCanales(t *testing.T) {
	repo := &mockTokenRepo{countGlobal: 203}
	svc := service.NewOpsQuotaService(repo)

	rep, err := svc.Report(context.Background())
	if err != nil {
		t.Fatalf("Report devolvio error: %v", err)
	}
	if len(rep.Channels) != 2 {
		t.Fatalf("quiero 2 canales, hay %d", len(rep.Channels))
	}
	if rep.Channels[0].Channel != service.ChannelEmail || rep.Channels[0].Cap != 250 {
		t.Fatalf("canal 0 = %+v, quiero email con cap 250", rep.Channels[0])
	}
	if rep.Channels[1].Channel != service.ChannelPasswordReset || rep.Channels[1].Cap != 50 {
		t.Fatalf("canal 1 = %+v, quiero password_reset con cap 50", rep.Channels[1])
	}
	// 203 sobre 250 es aviso; 203 sobre 50 es critico. El peor manda.
	if rep.Status != service.QuotaLevelCritical {
		t.Fatalf("status = %q, quiero critical", rep.Status)
	}
	if rep.WindowHours != 24 {
		t.Fatalf("window_hours = %v, quiero 24", rep.WindowHours)
	}
}

// TestReport_ErrorDeConteoNoSeTraga es el test mas importante del archivo. Un
// conteo que fallo no puede volverse un "ok": es la misma forma que el varchar(10)
// (regla #34), el curl sin --fail (#41) y el /health contestando 200 desde un
// binario viejo (#46) — una senal de exito que tambien se emite cuando el chequeo
// no ocurrio.
func TestReport_ErrorDeConteoNoSeTraga(t *testing.T) {
	repo := &mockTokenRepo{countErr: errors.New("boom")}
	svc := service.NewOpsQuotaService(repo)

	rep, err := svc.Report(context.Background())
	if err == nil {
		t.Fatal("Report devolvio nil error con el conteo roto")
	}
	if rep != nil {
		t.Fatalf("Report devolvio un reporte (%+v) con el conteo roto", rep)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && go test ./tests/ -count=1 -run TestReport_ > /tmp/t4.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: service.NewOpsQuotaService` in `/tmp/t4.log`.

- [ ] **Step 3: Implement the service**

Append to `backend/internal/service/ops_quota_service.go`:

```go
// ChannelQuota es el consumo de un canal en QuotaWindow.
type ChannelQuota struct {
	Channel string `json:"channel"`
	Used    int64  `json:"used"`
	Cap     int    `json:"cap"`
	Level   string `json:"level"`
}

// QuotaReport es el cuerpo que consume el monitoreo externo.
type QuotaReport struct {
	WindowHours float64        `json:"window_hours"`
	Status      string         `json:"status"`
	Alerts      []string       `json:"alerts"`
	Channels    []ChannelQuota `json:"channels"`
}

// OpsQuotaService reporta cuanto se gasto de la reserva diaria de cada canal.
//
// Vive en package service a proposito: emailVerificationGlobalDailyMax y
// passwordResetGlobalDailyMax ya son constantes privadas de este paquete, asi que
// las lee directo sin exportarlas ni duplicarlas.
type OpsQuotaService struct {
	tokenRepo repository.VerificationTokenRepository
}

func NewOpsQuotaService(tokenRepo repository.VerificationTokenRepository) *OpsQuotaService {
	return &OpsQuotaService{tokenRepo: tokenRepo}
}

// Report cuenta los dos canales sobre QuotaWindow y los gradua.
//
// Un error de conteo se PROPAGA, nunca se traga: reportar "ok" sobre un conteo que
// no se pudo hacer es exactamente la falla que este proyecto ya pago tres veces.
func (s *OpsQuotaService) Report(ctx context.Context) (*QuotaReport, error) {
	since := time.Now().Add(-QuotaWindow)

	emailUsed, err := s.tokenRepo.CountSince(ctx, nil, ChannelEmail, since)
	if err != nil {
		return nil, err
	}
	resetUsed, err := s.tokenRepo.CountSince(ctx, nil, ChannelPasswordReset, since)
	if err != nil {
		return nil, err
	}

	channels := []ChannelQuota{
		{
			Channel: ChannelEmail,
			Used:    emailUsed,
			Cap:     emailVerificationGlobalDailyMax,
			Level:   LevelFor(emailUsed, emailVerificationGlobalDailyMax),
		},
		{
			Channel: ChannelPasswordReset,
			Used:    resetUsed,
			Cap:     passwordResetGlobalDailyMax,
			Level:   LevelFor(resetUsed, passwordResetGlobalDailyMax),
		},
	}

	status := QuotaLevelOK
	for _, c := range channels {
		status = WorstLevel(status, c.Level)
	}

	return &QuotaReport{
		WindowHours: QuotaWindow.Hours(),
		Status:      status,
		Alerts:      AlertsFor(status),
		Channels:    channels,
	}, nil
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd backend && go test ./tests/ -count=1 -run TestReport_ > /tmp/t4.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/ops_quota_service.go backend/tests/ops_quota_service_test.go
git commit -m "feat(ops): reporte de los dos canales, y un conteo fallido nunca se gradua"
```

---

## Task 5: The token gate, and the ordering that makes it safe

**Files:**
- Create: `backend/internal/handler/ops_quota_handler.go`
- Create: `backend/tests/ops_quota_handler_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/ops_quota_handler_test.go`:

```go
package tests

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

func buildOpsQuotaRouter(token string, repo *mockTokenRepo) *gin.Engine {
	h := handler.NewOpsQuotaHandler(service.NewOpsQuotaService(repo), token)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/ops/quota", h.Report)
	return r
}

func doOpsQuota(r *gin.Engine, header string, setHeader bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/ops/quota", nil)
	if setHeader {
		req.Header.Set("X-Ops-Token", header)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestOpsQuota_TokenVacioDa404ConHeaderVacio es un test sobre el ORDEN de los dos
// chequeos, no sobre el 404. Si el handler comparara el header antes de mirar si
// hay token configurado, un OPS_STATUS_TOKEN sin setear matchearia con un header
// vacio y el endpoint le contestaria a cualquiera. Invertir las dos guardas sigue
// pasando todos los demas tests de este archivo; solo falla este.
func TestOpsQuota_TokenVacioDa404ConHeaderVacio(t *testing.T) {
	r := buildOpsQuotaRouter("", &mockTokenRepo{})

	w := doOpsQuota(r, "", true)
	if w.Code != http.StatusNotFound {
		t.Fatalf("con token sin configurar y header vacio: %d, quiero 404", w.Code)
	}

	w = doOpsQuota(r, "", false)
	if w.Code != http.StatusNotFound {
		t.Fatalf("con token sin configurar y sin header: %d, quiero 404", w.Code)
	}
}

// TestOpsQuota_TokenEquivocadoDa404 — 404 y no 401: un 401 confirma que la ruta existe.
func TestOpsQuota_TokenEquivocadoDa404(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{})
	w := doOpsQuota(r, "otra-cosa", true)
	if w.Code != http.StatusNotFound {
		t.Fatalf("token equivocado: %d, quiero 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "quota") {
		t.Fatalf("el 404 filtro info del cupo: %s", w.Body.String())
	}
}

// TestOpsQuota_TokenCorrectoDevuelveElCuerpo verifica el contrato completo.
func TestOpsQuota_TokenCorrectoDevuelveElCuerpo(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countGlobal: 0})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusOK {
		t.Fatalf("token correcto: %d, quiero 200", w.Code)
	}
	var rep service.QuotaReport
	if err := json.Unmarshal(w.Body.Bytes(), &rep); err != nil {
		t.Fatalf("cuerpo no parsea: %v — %s", err, w.Body.String())
	}
	if rep.Status != service.QuotaLevelOK {
		t.Fatalf("status = %q, quiero ok", rep.Status)
	}
	if len(rep.Alerts) != 0 {
		t.Fatalf("alerts = %v, quiero vacio", rep.Alerts)
	}
	if strings.Contains(w.Body.String(), service.AlertQuotaWarn) {
		t.Fatalf("en ok el cuerpo no puede contener %s: %s", service.AlertQuotaWarn, w.Body.String())
	}
}

// TestOpsQuota_CriticoPoneLosDosTokensEnElCuerpo es lo que los monitores matchean.
// Se verifica sobre el TEXTO CRUDO, no sobre el struct, porque UptimeRobot busca
// substrings en el cuerpo — es el cuerpo lo que hay que probar, no el modelo.
func TestOpsQuota_CriticoPoneLosDosTokensEnElCuerpo(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countGlobal: 250})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusOK {
		t.Fatalf("codigo %d, quiero 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, service.AlertQuotaCrit) {
		t.Fatalf("falta %s en %s", service.AlertQuotaCrit, body)
	}
	if !strings.Contains(body, service.AlertQuotaWarn) {
		t.Fatalf("falta %s en %s — escalar no puede leerse como recuperarse", service.AlertQuotaWarn, body)
	}
}

// TestOpsQuota_ConteoRotoDa500SinNivel: si el conteo fallo, el cuerpo no puede
// contener "ok" ni un array de alertas. Un 200 diciendo ok sobre un conteo que no
// ocurrio es peor que un 500.
func TestOpsQuota_ConteoRotoDa500SinNivel(t *testing.T) {
	r := buildOpsQuotaRouter("secreto", &mockTokenRepo{countErr: errors.New("boom")})
	w := doOpsQuota(r, "secreto", true)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("conteo roto: %d, quiero 500", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, `"status"`) || strings.Contains(body, `"alerts"`) {
		t.Fatalf("el 500 no puede traer status ni alerts: %s", body)
	}
}
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd backend && go test ./tests/ -count=1 -run TestOpsQuota_ > /tmp/t5.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, with `undefined: handler.NewOpsQuotaHandler` in `/tmp/t5.log`.

- [ ] **Step 3: Write the handler**

Create `backend/internal/handler/ops_quota_handler.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/service"
)

// opsTokenHeader lleva el secreto compartido que autoriza el reporte de cupo.
const opsTokenHeader = "X-Ops-Token"

// OpsQuotaHandler publica el consumo del cupo de mail para el monitoreo externo.
//
// El cuerpo dice cuanta cuota queda, que para un atacante es el marcador del
// partido: le confirma si ya gano y cuanto le falta. De ahi el token, y de ahi que
// todo camino no autorizado termine en un 404 mudo en vez de un 401.
type OpsQuotaHandler struct {
	quotaService *service.OpsQuotaService
	token        string
}

func NewOpsQuotaHandler(quotaService *service.OpsQuotaService, token string) *OpsQuotaHandler {
	return &OpsQuotaHandler{quotaService: quotaService, token: token}
}

// Report devuelve el consumo por canal.
func (h *OpsQuotaHandler) Report(c *gin.Context) {
	// Deshabilitado salvo que OPS_STATUS_TOKEN este configurado.
	//
	// Este chequeo VA PRIMERO y no es estilo: al reves, una variable sin setear
	// matchearia con un header vacio y el endpoint le contestaria a cualquiera.
	// Misma regla que REINDEX_TOKEN (#18).
	if h.token == "" {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}
	if c.GetHeader(opsTokenHeader) != h.token {
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "not found"})
		return
	}

	report, err := h.quotaService.Report(c.Request.Context())
	if err != nil {
		// Sin status y sin alerts: nunca se gradua un conteo que no ocurrio.
		c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "message": "quota report failed"})
		return
	}

	c.JSON(http.StatusOK, report)
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd backend && go test ./tests/ -count=1 -run TestOpsQuota_ > /tmp/t5.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Prove the ordering test actually guards**

Temporarily swap the two guards in `Report` (header comparison first), then run:

Run: `cd backend && go test ./tests/ -count=1 -run TestOpsQuota_ > /tmp/t5b.log 2>&1; echo "EXIT=$?"`
Expected: non-zero, and `/tmp/t5b.log` names only `TestOpsQuota_TokenVacioDa404ConHeaderVacio`.

Restore the original order and re-run to `EXIT=0`. A guard nobody has seen fail is a guard nobody has verified.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/ops_quota_handler.go backend/tests/ops_quota_handler_test.go
git commit -m "feat(ops): endpoint del cupo gateado por token, con el chequeo del vacio primero"
```

---

## Task 6: Wire the config and the route

**Files:**
- Modify: `backend/config/config.go`
- Modify: `backend/internal/app/router.go`

- [ ] **Step 1: Add the config field**

In `backend/config/config.go`, next to `ReindexToken`:

```go
	// OpsStatusToken gates the mail-quota status endpoint consumed by external
	// monitoring. Empty disables the endpoint entirely (404, no surface).
	OpsStatusToken string
```

And in the struct literal, next to `ReindexToken: getEnv("REINDEX_TOKEN", "")`:

```go
		OpsStatusToken: getEnv("OPS_STATUS_TOKEN", ""),
```

- [ ] **Step 2: Wire service and handler in the router**

In `backend/internal/app/router.go`, right after the `reindexHandler := ...` line:

```go
	opsQuotaHandler := handler.NewOpsQuotaHandler(
		service.NewOpsQuotaService(verificationTokenRepo),
		cfg.OpsStatusToken,
	)
```

- [ ] **Step 3: Register the route**

In the same file, immediately after the `router.POST("/api/admin/reindex-embeddings", ...)` line:

```go
	router.GET("/api/ops/quota", opsQuotaHandler.Report)
```

- [ ] **Step 4: Build and run the full backend suite**

Run: `cd backend && go build ./... && go vet ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./... -count=1 > /tmp/t6.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. On anything else, read `/tmp/t6.log`.

- [ ] **Step 5: Commit**

```bash
git add backend/config/config.go backend/internal/app/router.go
git commit -m "feat(ops): cablear el endpoint del cupo y su token de configuracion"
```

---

## Task 7: Prove it counts real rows

Repository mocks have no constraints and no sweeper. This quota has already shipped
broken twice for exactly that reason (rules #34 and #40), so the count goes through real
Postgres before anyone trusts it.

**Files:**
- Create: `backend/tests/e2e/ops_quota_flow_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/e2e/ops_quota_flow_test.go`. All helpers used below already exist
in the package: `startTestServerWithConfig` (`helpers_test.go:53`), `registerAndLogin`
(`helpers_test.go:86`), and `userIDByEmail` / `seedEmailToken` (`verification_quota_flow_test.go`).

```go
//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"lost-pets/config"
	"lost-pets/internal/service"
)

// TestOpsQuota_CuentaFilasReales siembra filas del canal email en Postgres y
// verifica que el endpoint las reporte. Los mocks no tienen sweeper ni columnas:
// este es el unico test que ve el conteo tal como corre en produccion, y este
// cupo ya se rompio dos veces por confiar en mocks (reglas #34 y #40).
func TestOpsQuota_CuentaFilasReales(t *testing.T) {
	// Mismo determinismo que el e2e hermano: sin credenciales el mailer es noop.
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("MAIL_FROM_EMAIL", "")

	baseURL, db, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.OpsStatusToken = "test-ops-token"
	})
	defer cleanup()

	_, email := registerAndLogin(t, baseURL)
	userID := userIDByEmail(t, db, email)

	const sembrados = 3
	for i := 0; i < sembrados; i++ {
		seedEmailToken(t, db, userID, time.Now().Add(-time.Duration(i+1)*time.Minute))
	}

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/ops/quota", nil)
	if err != nil {
		t.Fatalf("armar request: %v", err)
	}
	req.Header.Set("X-Ops-Token", "test-ops-token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, quiero 200", resp.StatusCode)
	}

	var rep service.QuotaReport
	if err := json.NewDecoder(resp.Body).Decode(&rep); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}

	var emailUsed int64 = -1
	for _, c := range rep.Channels {
		if c.Channel == service.ChannelEmail {
			emailUsed = c.Used
		}
	}
	if emailUsed != sembrados {
		t.Fatalf("email.used = %d, quiero %d — el endpoint no esta contando filas reales", emailUsed, sembrados)
	}
}

// TestOpsQuota_SinTokenNoExiste: contra el server real, no contra un router armado
// a mano. Confirma que la ruta quedo registrada Y que el gate viaja con ella.
func TestOpsQuota_SinTokenNoExiste(t *testing.T) {
	baseURL, _, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.OpsStatusToken = "test-ops-token"
	})
	defer cleanup()

	resp, err := http.Get(baseURL + "/api/ops/quota")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("sin header: status %d, quiero 404", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run and confirm it fails, then passes**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/e2e/ -tags e2e -count=1 -run TestOpsQuota_ > /tmp/t7.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/e2e/ops_quota_flow_test.go
git commit -m "test(e2e): el endpoint del cupo cuenta filas reales de Postgres"
```

---

## Task 8: Create the monitors, and verify the assumption they rest on

This task runs against live infrastructure and must happen **after** the backend is
deployed with `OPS_STATUS_TOKEN` set in Render.

- [ ] **Step 1: Generate and set the token in Render**

Generate a random token, set it as `OPS_STATUS_TOKEN` on the Render service, and wait for
the redeploy.

- [ ] **Step 2: Verify by content, not by /health**

Run, substituting the real token:

```bash
curl -s -o /dev/null -w "sin-token=%{http_code}\n" https://searchpet.onrender.com/api/ops/quota
curl -s -H "X-Ops-Token: <token>" https://searchpet.onrender.com/api/ops/quota
```

Expected: `sin-token=404`, and the second returns the JSON report. A 404 on the second
means the deploy has not landed yet — `/health` answering 200 proves nothing (rule #46).

- [ ] **Step 3: Verify the 500 assumption before relying on it**

The spec flags this explicitly. A 500 removes both keywords from the body, and an
`ALERT_EXISTS` monitor does not fire on an absent keyword — so the alerting could go quiet
exactly when it breaks.

Create a throwaway UptimeRobot KEYWORD monitor pointed at any URL that reliably returns
500, with `keywordType: ALERT_EXISTS` and a keyword that will never appear. Observe
whether UptimeRobot marks it DOWN.

- If it goes DOWN: the two monitors below are sufficient. Delete the throwaway.
- If it stays UP: add a third monitor of type `HTTP` over the same URL with the same
  custom header, which alerts on any non-2xx. Delete the throwaway.

Record the observed result in the spec's Open risks section. **Do not skip this step and
assume the favourable branch.**

- [ ] **Step 4: Create the two monitors**

Both `type: KEYWORD`, `url: https://searchpet.onrender.com/api/ops/quota`,
`keywordType: ALERT_EXISTS`, `interval: 300`, `keywordCaseType: 0` (case-sensitive),
`customHttpHeaders: {"X-Ops-Token": "<token>"}`, and the same alert contacts as the
existing `searchpet.onrender.com` monitor.

| friendlyName | keywordValue |
|---|---|
| `SearchPet — cuota de mail al 80%` | `QUOTA_WARN` |
| `SearchPet — cuota de mail agotada` | `QUOTA_CRIT` |

- [ ] **Step 5: Prove the monitors actually fire**

A monitor nobody has seen fire is a monitor nobody has verified — the same reasoning as
Step 5 of Task 5.

Temporarily lower `emailVerificationGlobalDailyMax` in a scratch branch deployed nowhere,
**or** seed enough rows in the production window to cross 80%. The safer option: point a
throwaway monitor at a static URL whose body contains `QUOTA_WARN` and confirm the alert
reaches you through the existing contacts.

- [ ] **Step 6: Document the token**

Add `OPS_STATUS_TOKEN` to `docs/github-secrets.md` under the `ci.yml` secrets table
introduced earlier, noting that it is a Render environment variable rather than a GitHub
secret, and that leaving it unset disables the endpoint.

```bash
git add docs/github-secrets.md
git commit -m "docs(ops): documentar OPS_STATUS_TOKEN y que vacio deshabilita el endpoint"
```

---

## Final verification

- [ ] **Full backend suite with the exit code, never a grep (rule #41)**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./... -count=1 > /tmp/final.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **E2E suite**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/e2e/ -tags e2e -count=1 > /tmp/final-e2e.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

`DATABASE_URL` must point at `lostpets_test`. Against `lostpets` the tests wipe the dev
seed, and **without the variable `testdb.SetupTestDB` skips every integration test in
silence** — a green run would mean none of them executed.
