# Impact Monthly Detail Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-selectable drill-down to the admin impact dashboard: pick a month, see that month's activity numbers (reunions, new users, reports) and browse the reunited pets and reports behind them.

**Architecture:** A new admin-gated backend endpoint `GET /api/stats/impact/monthly?month=YYYY-MM` computes event-sourced per-month totals plus capped record lists, cached per month. Shared type + client method + React Query hook expose it. A new hand-rolled `MonthlyImpactSection` component (native `<select>` + Tailwind tables) mounts on the existing `ImpactPage` below the trend charts.

**Tech Stack:** Go + Gin + GORM (backend); TypeScript + React + Vite + Tailwind + React Query + react-i18next (frontend). No new dependencies.

---

## File Structure

- Create: `backend/internal/handler/monthly_impact_handler.go` — the new handler, its response types, per-month cache, and SQL.
- Modify: `backend/internal/domain/errors.go` — add `ErrInvalidMonthParam`.
- Modify: `backend/internal/app/router.go` — build + wire the handler in the admin group.
- Create: `backend/tests/monthly_impact_handler_test.go` — integration tests.
- Modify: `frontend/packages/shared/types/index.ts` — `MonthlyImpact` + item types.
- Modify: `frontend/packages/shared/api/client.ts` — `getMonthlyImpact`.
- Modify: `frontend/packages/shared/hooks/index.ts` — `useMonthlyImpact`.
- Create: `frontend/packages/web/src/components/MonthlyImpactSection.tsx` — the UI section.
- Create: `frontend/packages/web/src/components/MonthlyImpactSection.test.tsx` — component test.
- Modify: `frontend/packages/web/src/pages/ImpactPage.tsx` — mount the section.
- Modify: `frontend/packages/web/src/pages/ImpactPage.test.tsx` — mock the new hook.
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — new keys in the `impact` namespace.

Backend integration tests require a Postgres+PostGIS test DB. Run them with:
`DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestMonthlyImpact -v`
(from `backend/`). Web tests run from `frontend/packages/web` with `npx vitest run <path>`; shared tests with `npx vitest run --config vitest.shared.config.ts <path>`.

---

## Task 1: Backend — monthly endpoint

**Files:**
- Modify: `backend/internal/domain/errors.go`
- Create: `backend/internal/handler/monthly_impact_handler.go`
- Modify: `backend/internal/app/router.go`
- Create: `backend/tests/monthly_impact_handler_test.go`

- [ ] **Step 1: Add the domain error**

In `backend/internal/domain/errors.go`, next to `ErrInvalidDateParam` in the var block, add:

```go
	ErrInvalidMonthParam      = errors.New("parámetro 'month' debe ser YYYY-MM")
```

And in the `CodeFor` map, next to `ErrInvalidDateParam: "invalid_date_param",`, add:

```go
	ErrInvalidMonthParam:      "invalid_month_param",
```

- [ ] **Step 2: Write the handler**

Create `backend/internal/handler/monthly_impact_handler.go`:

```go
package handler

import (
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// monthlyRecordCap bounds each record list so a busy month cannot return an
// unbounded payload. When a list is capped, Truncated is set so the UI can hint
// "there are more".
const monthlyRecordCap = 50

// monthlyCacheMax bounds the per-month cache. month is validated to YYYY-MM, so
// an unbounded key set is possible in principle; clearing at the cap keeps
// memory bounded. In practice only ~12 months are ever queried.
const monthlyCacheMax = 24

// monthRe validates the month query param.
var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

// MonthlyTotals are the event-sourced counts for a single calendar month.
type MonthlyTotals struct {
	Reunions int64 `json:"reunions"`
	NewUsers int64 `json:"new_users"`
	Reports  int64 `json:"reports"`
}

// MonthlyReunion is one pet reunited in the month (a pet_found event joined to
// its pet). ReunitedAt is the event time.
type MonthlyReunion struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Type       string    `json:"type"`
	ReunitedAt time.Time `json:"reunited_at"`
}

// MonthlyReport is one report created in the month, with its pet's name.
type MonthlyReport struct {
	ID        uuid.UUID `json:"id"`
	PetName   string    `json:"pet_name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type MonthlyResponse struct {
	Month        string           `json:"month"`
	Totals       MonthlyTotals    `json:"totals"`
	ReunitedPets []MonthlyReunion `json:"reunited_pets"`
	Reports      []MonthlyReport  `json:"reports"`
	Truncated    bool             `json:"truncated"`
}

type monthlyCacheEntry struct {
	payload    *MonthlyResponse
	computedAt time.Time
}

// MonthlyImpactHandler serves the admin-only monthly drill-down at
// GET /api/stats/impact/monthly. The route is mounted behind Auth+RequireAdmin.
type MonthlyImpactHandler struct {
	db    *gorm.DB
	mu    sync.Mutex
	cache map[string]monthlyCacheEntry
}

func NewMonthlyImpactHandler(db *gorm.DB) *MonthlyImpactHandler {
	return &MonthlyImpactHandler{db: db, cache: make(map[string]monthlyCacheEntry)}
}

// GetMonthly godoc
// GET /api/stats/impact/monthly?month=YYYY-MM
func (h *MonthlyImpactHandler) GetMonthly(c *gin.Context) {
	month := c.Query("month")
	if month == "" {
		month = time.Now().UTC().Format("2006-01")
	}
	if !monthRe.MatchString(month) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidMonthParam)
		return
	}
	start, err := time.Parse("2006-01", month)
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidMonthParam)
		return
	}
	start = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)

	h.mu.Lock()
	if e, ok := h.cache[month]; ok && time.Since(e.computedAt) < impactCacheTTL {
		payload := e.payload
		h.mu.Unlock()
		c.JSON(http.StatusOK, payload)
		return
	}
	h.mu.Unlock()

	payload, err := h.compute(month, start, end)
	if err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	h.mu.Lock()
	if len(h.cache) >= monthlyCacheMax {
		h.cache = make(map[string]monthlyCacheEntry)
	}
	h.cache[month] = monthlyCacheEntry{payload: payload, computedAt: time.Now()}
	h.mu.Unlock()

	c.JSON(http.StatusOK, payload)
}

func (h *MonthlyImpactHandler) compute(month string, start, end time.Time) (*MonthlyResponse, error) {
	var totals MonthlyTotals

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ? AND created_at >= ? AND created_at < ?", domain.StatEventPetFound, start, end).
		Count(&totals.Reunions).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.User{}).
		Where("created_at >= ? AND created_at < ?", start, end).
		Count(&totals.NewUsers).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Report{}).
		Where("created_at >= ? AND created_at < ?", start, end).
		Count(&totals.Reports).Error; err != nil {
		return nil, err
	}

	// Reunited pets: pet_found events in the month joined to their pet. Fetch one
	// past the cap to detect truncation. The JOIN drops events whose pet was
	// deleted, so this list can be shorter than totals.Reunions — expected.
	reunited := make([]MonthlyReunion, 0, monthlyRecordCap)
	if err := h.db.Table("platform_events AS pe").
		Select("p.id AS id, p.name AS name, p.type AS type, pe.created_at AS reunited_at").
		Joins("JOIN pets p ON p.id = pe.pet_id").
		Where("pe.event_type = ? AND pe.created_at >= ? AND pe.created_at < ?", domain.StatEventPetFound, start, end).
		Order("pe.created_at DESC").
		Limit(monthlyRecordCap + 1).
		Scan(&reunited).Error; err != nil {
		return nil, err
	}

	reports := make([]MonthlyReport, 0, monthlyRecordCap)
	if err := h.db.Table("reports AS r").
		Select("r.id AS id, p.name AS pet_name, r.status AS status, r.created_at AS created_at").
		Joins("JOIN pets p ON p.id = r.pet_id").
		Where("r.created_at >= ? AND r.created_at < ?", start, end).
		Order("r.created_at DESC").
		Limit(monthlyRecordCap + 1).
		Scan(&reports).Error; err != nil {
		return nil, err
	}

	truncated := false
	if len(reunited) > monthlyRecordCap {
		reunited = reunited[:monthlyRecordCap]
		truncated = true
	}
	if len(reports) > monthlyRecordCap {
		reports = reports[:monthlyRecordCap]
		truncated = true
	}

	return &MonthlyResponse{
		Month:        month,
		Totals:       totals,
		ReunitedPets: reunited,
		Reports:      reports,
		Truncated:    truncated,
	}, nil
}
```

- [ ] **Step 3: Wire the route**

In `backend/internal/app/router.go`, next to `impactHandler := handler.NewImpactHandler(db)` (~line 211), add:

```go
	monthlyImpactHandler := handler.NewMonthlyImpactHandler(db)
```

In the admin group, next to `admin.GET("/stats/impact", impactHandler.GetImpactStats)`, add:

```go
		admin.GET("/stats/impact/monthly", monthlyImpactHandler.GetMonthly)
```

- [ ] **Step 4: Write the failing test**

Create `backend/tests/monthly_impact_handler_test.go`:

```go
package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func setupMonthlyRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewMonthlyImpactHandler(db)
	r.GET("/api/stats/impact/monthly", h.GetMonthly)
	return r
}

type monthlyResp struct {
	Month  string `json:"month"`
	Totals struct {
		Reunions int64 `json:"reunions"`
		NewUsers int64 `json:"new_users"`
		Reports  int64 `json:"reports"`
	} `json:"totals"`
	ReunitedPets []struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Type       string `json:"type"`
		ReunitedAt string `json:"reunited_at"`
	} `json:"reunited_pets"`
	Reports []struct {
		ID        string `json:"id"`
		PetName   string `json:"pet_name"`
		Status    string `json:"status"`
		CreatedAt string `json:"created_at"`
	} `json:"reports"`
	Truncated bool `json:"truncated"`
}

func getMonthly(t *testing.T, r *gin.Engine, month string) (int, monthlyResp) {
	t.Helper()
	url := "/api/stats/impact/monthly"
	if month != "" {
		url += "?month=" + month
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp monthlyResp
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w.Code, resp
}

func TestMonthlyImpact_SelectedMonthOnly(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{OwnerID: ptrUUID(owner.ID), Name: "Firulais", Type: "perro", Status: domain.PetStatusFound, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	now := time.Now().UTC()
	thisMonth := time.Date(now.Year(), now.Month(), 1, 12, 0, 0, 0, time.UTC)
	lastMonth := thisMonth.AddDate(0, -1, 0)

	// This month: 2 reunions of `pet`, 1 report. Last month: 1 reunion (excluded).
	recordEventAt(t, db, domain.StatEventPetFound, thisMonth) // not joined to a pet (nil pet ok for count only)
	// Use a pet-linked event so the reunited_pets list is populated:
	if err := db.Create(&domain.PlatformEvent{EventType: domain.StatEventPetFound, PetID: &pet.ID, CreatedAt: thisMonth}).Error; err != nil {
		t.Fatalf("seed event: %v", err)
	}
	recordEventAt(t, db, domain.StatEventPetFound, lastMonth)

	if err := db.Create(&domain.Report{PetID: pet.ID, ReporterID: owner.ID, Status: "sighting", Latitude: -34.9, Longitude: -56.1, CreatedAt: thisMonth}).Error; err != nil {
		t.Fatalf("seed report: %v", err)
	}

	r := setupMonthlyRouter(db)
	code, resp := getMonthly(t, r, thisMonth.Format("2006-01"))
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if resp.Month != thisMonth.Format("2006-01") {
		t.Errorf("month: want %s, got %s", thisMonth.Format("2006-01"), resp.Month)
	}
	if resp.Totals.Reunions != 2 {
		t.Errorf("reunions: want 2 (this month only), got %d", resp.Totals.Reunions)
	}
	if resp.Totals.Reports != 1 {
		t.Errorf("reports: want 1, got %d", resp.Totals.Reports)
	}
	// Only the pet-linked event surfaces in the list.
	if len(resp.ReunitedPets) != 1 || resp.ReunitedPets[0].Name != "Firulais" {
		t.Errorf("reunited_pets: want 1 (Firulais), got %+v", resp.ReunitedPets)
	}
	if len(resp.Reports) != 1 || resp.Reports[0].PetName != "Firulais" {
		t.Errorf("reports list: want 1 (Firulais), got %+v", resp.Reports)
	}
}

func TestMonthlyImpact_InvalidMonth(t *testing.T) {
	db := testdb.SetupTestDB(t)
	r := setupMonthlyRouter(db)
	code, _ := getMonthly(t, r, "2026-13-99")
	if code != http.StatusBadRequest {
		t.Errorf("invalid month: want 400, got %d", code)
	}
}

func TestMonthlyImpact_EmptyMonth(t *testing.T) {
	db := testdb.SetupTestDB(t)
	r := setupMonthlyRouter(db)
	code, resp := getMonthly(t, r, "2020-01")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if resp.Totals.Reunions != 0 || len(resp.ReunitedPets) != 0 || len(resp.Reports) != 0 {
		t.Errorf("empty month should be zero, got %+v", resp)
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `gofmt -w internal/handler/monthly_impact_handler.go tests/monthly_impact_handler_test.go && go build ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestMonthlyImpact -v`
Expected: build OK; `TestMonthlyImpact_SelectedMonthOnly`, `_InvalidMonth`, `_EmptyMonth` all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/domain/errors.go backend/internal/handler/monthly_impact_handler.go backend/internal/app/router.go backend/tests/monthly_impact_handler_test.go
git commit -m "feat(impact): add admin monthly drill-down endpoint"
```

---

## Task 2: Shared — type, client method, hook

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts`
- Modify: `frontend/packages/shared/hooks/index.ts`
- Modify: `frontend/packages/shared/api/client.test.ts`

- [ ] **Step 1: Add the types**

In `frontend/packages/shared/types/index.ts`, after the `ImpactStats` interface, add:

```ts
export interface MonthlyImpactReunion {
  id: string;
  name: string;
  type: string;
  reunited_at: string; // ISO
}

export interface MonthlyImpactReport {
  id: string;
  pet_name: string;
  status: string;
  created_at: string; // ISO
}

export interface MonthlyImpact {
  month: string; // "YYYY-MM"
  totals: { reunions: number; new_users: number; reports: number };
  reunited_pets: MonthlyImpactReunion[];
  reports: MonthlyImpactReport[];
  truncated: boolean;
}
```

- [ ] **Step 2: Add the client method**

In `frontend/packages/shared/api/client.ts`, add `MonthlyImpact` to the type import block from `../types` (next to `ImpactStats`). Then, right after the `getImpactStats` method, add:

```ts
  async getMonthlyImpact(month: string): Promise<MonthlyImpact> {
    return this.request<MonthlyImpact>(
      'GET',
      `/api/stats/impact/monthly?month=${encodeURIComponent(month)}`,
    );
  }
```

- [ ] **Step 3: Add the hook**

In `frontend/packages/shared/hooks/index.ts`, right after the `useImpactStats` hook, add:

```ts
export const useMonthlyImpact = (month: string) => {
  return useQuery({
    queryKey: ['impact-monthly', month],
    queryFn: () => apiClient.getMonthlyImpact(month),
    enabled: !!month,
  });
};
```

- [ ] **Step 4: Extend the client test**

In `frontend/packages/shared/api/client.test.ts`, after the `getImpactStats` test (`it('getImpactStats ...')`), add:

```ts
  it('getMonthlyImpact resolves the monthly payload', async () => {
    const payload = {
      month: '2026-06',
      totals: { reunions: 2, new_users: 1, reports: 3 },
      reunited_pets: [{ id: 'a', name: 'Firulais', type: 'perro', reunited_at: '2026-06-10T00:00:00Z' }],
      reports: [{ id: 'r', pet_name: 'Firulais', status: 'sighting', created_at: '2026-06-03T00:00:00Z' }],
      truncated: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    await expect(client.getMonthlyImpact('2026-06')).resolves.toEqual(payload);
  });
```

- [ ] **Step 5: Run tests + typecheck**

Run (from `frontend/packages/web`):
`npx tsc --noEmit && npx vitest run --config vitest.shared.config.ts api/client.test.ts`
Expected: tsc clean; all shared client tests PASS (including the new one).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts frontend/packages/shared/hooks/index.ts frontend/packages/shared/api/client.test.ts
git commit -m "feat(impact): add getMonthlyImpact client + useMonthlyImpact hook"
```

---

## Task 3: Web — MonthlyImpactSection component + i18n

**Files:**
- Create: `frontend/packages/web/src/components/MonthlyImpactSection.tsx`
- Create: `frontend/packages/web/src/components/MonthlyImpactSection.test.tsx`
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

- [ ] **Step 1: Add i18n keys**

In each of `es.json`, `en.json`, `pt.json`, inside the `impact` object, after `"last12Months"`, add the block for that language.

es.json:
```json
    "monthlyTitle": "Detalle mensual",
    "monthlySubtitle": "Actividad del mes seleccionado",
    "monthReunions": "Reuniones",
    "monthNewUsers": "Usuarios nuevos",
    "monthReports": "Reportes",
    "reunitedPetsTitle": "Mascotas reunidas",
    "reportsTitle": "Reportes creados",
    "colName": "Nombre",
    "colType": "Tipo",
    "colDate": "Fecha",
    "colPet": "Mascota",
    "colStatus": "Estado",
    "monthEmpty": "Sin registros este mes",
    "monthTruncated": "Mostrando los primeros {{cap}} registros de este mes",
```

en.json:
```json
    "monthlyTitle": "Monthly detail",
    "monthlySubtitle": "Activity for the selected month",
    "monthReunions": "Reunions",
    "monthNewUsers": "New users",
    "monthReports": "Reports",
    "reunitedPetsTitle": "Reunited pets",
    "reportsTitle": "Reports created",
    "colName": "Name",
    "colType": "Type",
    "colDate": "Date",
    "colPet": "Pet",
    "colStatus": "Status",
    "monthEmpty": "No records this month",
    "monthTruncated": "Showing the first {{cap}} records of this month",
```

pt.json:
```json
    "monthlyTitle": "Detalhe mensal",
    "monthlySubtitle": "Atividade do mês selecionado",
    "monthReunions": "Reuniões",
    "monthNewUsers": "Novos usuários",
    "monthReports": "Reportes",
    "reunitedPetsTitle": "Pets reunidos",
    "reportsTitle": "Reportes criados",
    "colName": "Nome",
    "colType": "Tipo",
    "colDate": "Data",
    "colPet": "Pet",
    "colStatus": "Status",
    "monthEmpty": "Sem registros neste mês",
    "monthTruncated": "Mostrando os primeiros {{cap}} registros deste mês",
```

- [ ] **Step 2: Write the component**

Create `frontend/packages/web/src/components/MonthlyImpactSection.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMonthlyImpact } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';

function Tile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-700">
      <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-50" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export function MonthlyImpactSection({
  months,
  nf,
  lang,
}: {
  months: string[];
  nf: Intl.NumberFormat;
  lang: string;
}) {
  const { t } = useTranslation('impact');
  const [month, setMonth] = useState(months.length ? months[months.length - 1] : '');
  const { data, isLoading, isError, error } = useMonthlyImpact(month);

  const fmtMonthLong = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  };
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' });

  return (
    <section className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">{t('impact:monthlyTitle')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('impact:monthlySubtitle')}</p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          aria-label={t('impact:monthlyTitle')}
        >
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              {fmtMonthLong(m)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-gray-500">{t('impact:loading')}</p>}
      {isError && <p className="py-8 text-center text-sm text-red-600">{getErrorMessage(error, t)}</p>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Tile value={nf.format(data.totals.reunions)} label={t('impact:monthReunions')} accent="#22c55e" />
            <Tile value={nf.format(data.totals.new_users)} label={t('impact:monthNewUsers')} accent="#8b5cf6" />
            <Tile value={nf.format(data.totals.reports)} label={t('impact:monthReports')} accent="#f59e0b" />
          </div>

          {data.truncated && (
            <p className="mb-2 text-xs text-gray-400">{t('impact:monthTruncated', { cap: 50 })}</p>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Reunited pets */}
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t('impact:reunitedPetsTitle')}</div>
              {data.reunited_pets.length === 0 ? (
                <p className="text-sm text-gray-400">{t('impact:monthEmpty')}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="pb-2 font-medium">{t('impact:colName')}</th>
                      <th className="pb-2 font-medium">{t('impact:colType')}</th>
                      <th className="pb-2 text-right font-medium">{t('impact:colDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reunited_pets.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2">
                          <Link to={`/pets/${p.id}`} className="font-medium text-primary hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">{p.type}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">{fmtDate(p.reunited_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Reports */}
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t('impact:reportsTitle')}</div>
              {data.reports.length === 0 ? (
                <p className="text-sm text-gray-400">{t('impact:monthEmpty')}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="pb-2 font-medium">{t('impact:colPet')}</th>
                      <th className="pb-2 font-medium">{t('impact:colStatus')}</th>
                      <th className="pb-2 text-right font-medium">{t('impact:colDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2 text-gray-700 dark:text-gray-300">{r.pet_name}</td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">{r.status}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write the component test**

Create `frontend/packages/web/src/components/MonthlyImpactSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

const useMonthlyImpact = vi.fn();
vi.mock('@shared/hooks', () => ({ useMonthlyImpact: (m: string) => useMonthlyImpact(m) }));
vi.mock('@shared/utils/apiErrors', () => ({ getErrorMessage: () => 'err' }));

import { MonthlyImpactSection } from './MonthlyImpactSection';

const nf = new Intl.NumberFormat('es');

describe('MonthlyImpactSection', () => {
  it('renders month tiles and record tables', () => {
    useMonthlyImpact.mockReturnValue({
      data: {
        month: '2026-07',
        totals: { reunions: 5, new_users: 2, reports: 8 },
        reunited_pets: [{ id: 'p1', name: 'Firulais', type: 'perro', reunited_at: '2026-07-10T00:00:00Z' }],
        reports: [{ id: 'r1', pet_name: 'Michi', status: 'sighting', created_at: '2026-07-03T00:00:00Z' }],
        truncated: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <MonthlyImpactSection months={['2026-06', '2026-07']} nf={nf} lang="es" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Firulais')).toBeInTheDocument();
    expect(screen.getByText('Michi')).toBeInTheDocument();
    expect(screen.getByText('Firulais').closest('a')).toHaveAttribute('href', '/pets/p1');
  });

  it('renders an empty state when a month has no records', () => {
    useMonthlyImpact.mockReturnValue({
      data: {
        month: '2020-01',
        totals: { reunions: 0, new_users: 0, reports: 0 },
        reunited_pets: [],
        reports: [],
        truncated: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <MonthlyImpactSection months={['2020-01']} nf={nf} lang="es" />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('impact:monthEmpty').length).toBe(2);
  });
});
```

- [ ] **Step 4: Run the component test + typecheck**

Run (from `frontend/packages/web`):
`npx tsc --noEmit && npx vitest run src/components/MonthlyImpactSection.test.tsx`
Expected: tsc clean; both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/MonthlyImpactSection.tsx frontend/packages/web/src/components/MonthlyImpactSection.test.tsx frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(impact): add MonthlyImpactSection component + i18n"
```

---

## Task 4: Web — mount the section on ImpactPage

**Files:**
- Modify: `frontend/packages/web/src/pages/ImpactPage.tsx`
- Modify: `frontend/packages/web/src/pages/ImpactPage.test.tsx`

- [ ] **Step 1: Import and render the section**

In `frontend/packages/web/src/pages/ImpactPage.tsx`, add the import near the other component imports:

```tsx
import { MonthlyImpactSection } from '../components/MonthlyImpactSection';
```

Then, inside the returned JSX, immediately after the "Live snapshot" grid (the `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">…</div>` that holds `activeSearches` + `reunionRate`) and before the offscreen share-card `<div ref={cardRef} …>`, add:

```tsx
      <MonthlyImpactSection
        months={reunions_by_month.map((d) => d.month)}
        nf={nf}
        lang={i18n.language}
      />
```

- [ ] **Step 2: Mock the new hook in the page test**

In `frontend/packages/web/src/pages/ImpactPage.test.tsx`, replace the `@shared/hooks` mock line:

```tsx
const useImpactStats = vi.fn();
vi.mock('@shared/hooks', () => ({ useImpactStats: () => useImpactStats() }));
```

with:

```tsx
const useImpactStats = vi.fn();
const useMonthlyImpact = vi.fn(() => ({ data: undefined, isLoading: false, isError: false, error: null }));
vi.mock('@shared/hooks', () => ({
  useImpactStats: () => useImpactStats(),
  useMonthlyImpact: (m: string) => useMonthlyImpact(m),
}));
```

Then wrap the render in both existing tests with a router — add the import at the top:

```tsx
import { MemoryRouter } from 'react-router';
```

and change each `render(<ImpactPage />);` to:

```tsx
    render(
      <MemoryRouter>
        <ImpactPage />
      </MemoryRouter>,
    );
```

- [ ] **Step 3: Run the full impact web suite + typecheck**

Run (from `frontend/packages/web`):
`npx tsc --noEmit && npx vitest run src/pages/ImpactPage.test.tsx src/components/MonthlyImpactSection.test.tsx src/components/ImpactLineChart.test.tsx`
Expected: tsc clean; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/web/src/pages/ImpactPage.tsx frontend/packages/web/src/pages/ImpactPage.test.tsx
git commit -m "feat(impact): mount monthly detail section on ImpactPage"
```

---

## Task 5: Full verification (live)

- [ ] **Step 1: Restart the local backend** (picks up the new endpoint)

The local stack from the prior session runs the backend on `:8081`. Rebuild it:
```bash
# from backend/ — kill the process listening on 8081, then:
go run ./cmd/server > /tmp/searchpet-backend.log 2>&1 &
```
Wait for `http://localhost:8081/health` to return 200.

- [ ] **Step 2: Verify the endpoint end-to-end**

```bash
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@searchpet.local","password":"admin1234"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s "http://localhost:8081/api/stats/impact/monthly?month=$(date +%Y-%m)" -H "Authorization: Bearer $TOKEN" | python -m json.tool
```
Expected: 200 with `totals`, `reunited_pets`, `reports`, `truncated`. Confirm without a token it is 401.

- [ ] **Step 3: Eyeball the web page**

Refresh `http://localhost:3000/admin/impact` (web dev server has HMR). Confirm: the month selector appears, changing months updates the tiles and tables, reunited-pet rows link to `/pets/:id`, dark mode reads correctly.

- [ ] **Step 4: Final full web test run**

Run (from `frontend/packages/web`): `npx vitest run`
Expected: whole web suite green.

---

## Notes for the implementer

- The impact endpoint and its test live in the same `tests` package; reuse the existing `newTestUser`, `ptrUUID`, and `recordEventAt` helpers (defined in `pet_repository_test.go` / `abuse_report_service_test.go` / `impact_handler_test.go`). Do not redeclare them.
- `.Model()` is table-name-agnostic; `Table("… AS …")` with a raw `Joins` is used only where a JOIN + alias is needed. `report_abuses`/`pets`/`reports` table names are GORM defaults.
- Slices are initialized with `make([]T, 0, cap)` so an empty month serializes as `[]`, not `null`.
- i18n `impact` namespace is already registered in `web/src/i18n/index.ts` (all three languages); only the JSON locale files need new keys.
- Do NOT push or retitle PR #104 as part of this plan — the user controls that.
```
