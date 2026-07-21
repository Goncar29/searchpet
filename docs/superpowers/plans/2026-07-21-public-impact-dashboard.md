# Public Impact Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public transparency page at `/impacto` that shows SearchPet's social-impact metrics (reunions, searches, community size, monthly trend) from data that already exists.

**Architecture:** New public backend endpoint `GET /api/stats/impact` (dedicated `ImpactHandler`, 5-min in-memory cache) that aggregates the append-only `platform_events` ledger + snapshot counts. Web-only frontend: a React Query hook, a zero-dependency hand-rolled SVG line chart, and an `ImpactPage`. The existing `GET /api/stats` endpoint is left untouched.

**Tech Stack:** Go 1.25 + Gin + GORM (backend); React + Vite + React Query + i18next (web); hand-rolled inline SVG for charts (no chart library).

**Spec:** `docs/superpowers/specs/2026-07-21-public-impact-dashboard-design.md`

**Branch:** `feat/public-impact-dashboard` (already created; spec committed).

---

## File Structure

**Backend**
- Create: `backend/internal/handler/impact_handler.go` — `ImpactHandler`, response types, cache, aggregation queries.
- Modify: `backend/internal/app/router.go` — instantiate handler (~line 210), register route (~line 265).
- Create: `backend/tests/impact_handler_test.go` — httptest coverage.

**Frontend — shared**
- Modify: `frontend/packages/shared/types/index.ts` — `ImpactStats`, `ImpactTotals`, `ImpactMonthlyCount`.
- Modify: `frontend/packages/shared/api/client.ts` — `getImpactStats()` + type import.
- Modify: `frontend/packages/shared/hooks/index.ts` — `useImpactStats()`.
- Modify: `frontend/packages/shared/api/client.test.ts` — `getImpactStats` test.

**Frontend — web**
- Create: `frontend/packages/web/src/components/ImpactLineChart.tsx` — SVG line chart.
- Create: `frontend/packages/web/src/components/ImpactLineChart.test.tsx`.
- Create: `frontend/packages/web/src/pages/ImpactPage.tsx` — the page.
- Create: `frontend/packages/web/src/pages/ImpactPage.test.tsx`.
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — add `impact` namespace.
- Modify: `frontend/packages/web/src/i18n/index.ts` — register `impact` in all 3 language blocks.
- Modify: `frontend/packages/web/src/App.tsx` — public route `/impacto`.
- Modify: `frontend/packages/web/src/layouts/MainLayout.tsx` — footer link.
- Modify: `frontend/packages/web/src/pages/HomePage.tsx` — soft CTA to `/impacto`.

**Run commands (reference)**
- Backend tests: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable go test ./tests/ -run Impact -v`
  - ⚠️ Use a **dedicated `lostpets_test` DB**, NOT the dev DB — `go test` truncates every table (gotcha: running against the dev `lostpets` DB wipes the seed). Local Postgres host port is **5433**.
- Web + shared tests: `cd frontend/packages/web && pnpm test:run` (chains web Vitest + shared via `vitest.shared.config.ts`).
- Web typecheck/build: `cd frontend/packages/web && pnpm build`.

---

## Task 1: Backend impact endpoint

**Files:**
- Create: `backend/tests/impact_handler_test.go`
- Create: `backend/internal/handler/impact_handler.go`
- Modify: `backend/internal/app/router.go:210` and `backend/internal/app/router.go:265`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/impact_handler_test.go`:

```go
package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func setupImpactRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewImpactHandler(db)
	r.GET("/api/stats/impact", h.GetImpactStats)
	return r
}

// recordEventAt inserts a platform_events row with an explicit created_at.
// GORM autoCreateTime only fills the field when it is the zero value, so a
// non-zero CreatedAt is preserved — this lets us place events in past months.
func recordEventAt(t *testing.T, db *gorm.DB, eventType string, at time.Time) {
	t.Helper()
	pid := uuid.New()
	ev := &domain.PlatformEvent{EventType: eventType, PetID: &pid, CreatedAt: at}
	if err := db.Create(ev).Error; err != nil {
		t.Fatalf("seed event: %v", err)
	}
}

func TestImpactHandler_DBError(t *testing.T) {
	db := newBrokenDB(t)
	r := setupImpactRouter(db)

	req := httptest.NewRequest(http.MethodGet, "/api/stats/impact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when DB is unavailable, got %d: %s", w.Code, w.Body.String())
	}
}

func TestImpactHandler_TotalsAndRate(t *testing.T) {
	db := testdb.SetupTestDB(t)

	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)

	owner := newTestUser(t, userRepo)
	// One lost pet -> active_searches = 1, total_pets = 1.
	lost := &domain.Pet{OwnerID: ptrUUID(owner.ID), Name: "Lost", Type: "perro", Status: domain.PetStatusLost, Version: 1}
	if err := petRepo.Create(lost); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	now := time.Now().UTC()
	recordEventAt(t, db, domain.StatEventPetFound, now)
	recordEventAt(t, db, domain.StatEventPetFound, now)
	recordEventAt(t, db, domain.StatEventSearchStarted, now)
	recordEventAt(t, db, domain.StatEventSearchStarted, now)

	r := setupImpactRouter(db)
	req := httptest.NewRequest(http.MethodGet, "/api/stats/impact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Totals struct {
			PetsReunited    int64   `json:"pets_reunited"`
			SearchesStarted int64   `json:"searches_started"`
			TotalUsers      int64   `json:"total_users"`
			TotalPets       int64   `json:"total_pets"`
			ActiveSearches  int64   `json:"active_searches"`
			ReunionRate     float64 `json:"reunion_rate"`
		} `json:"totals"`
		ReunionsByMonth []struct {
			Month string `json:"month"`
			Count int64  `json:"count"`
		} `json:"reunions_by_month"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.Totals.PetsReunited != 2 {
		t.Errorf("pets_reunited: want 2, got %d", resp.Totals.PetsReunited)
	}
	if resp.Totals.SearchesStarted != 2 {
		t.Errorf("searches_started: want 2, got %d", resp.Totals.SearchesStarted)
	}
	if resp.Totals.TotalUsers != 1 {
		t.Errorf("total_users: want 1, got %d", resp.Totals.TotalUsers)
	}
	if resp.Totals.TotalPets != 1 {
		t.Errorf("total_pets: want 1, got %d", resp.Totals.TotalPets)
	}
	if resp.Totals.ActiveSearches != 1 {
		t.Errorf("active_searches: want 1, got %d", resp.Totals.ActiveSearches)
	}
	if resp.Totals.ReunionRate != 1.0 { // 2 reunited / 2 searches
		t.Errorf("reunion_rate: want 1.0, got %v", resp.Totals.ReunionRate)
	}
}

func TestImpactHandler_ReunionRateZeroWhenNoSearches(t *testing.T) {
	db := testdb.SetupTestDB(t)
	recordEventAt(t, db, domain.StatEventPetFound, time.Now().UTC())

	r := setupImpactRouter(db)
	req := httptest.NewRequest(http.MethodGet, "/api/stats/impact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp struct {
		Totals struct {
			ReunionRate float64 `json:"reunion_rate"`
		} `json:"totals"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Totals.ReunionRate != 0 {
		t.Errorf("reunion_rate with zero searches: want 0, got %v", resp.Totals.ReunionRate)
	}
}

func TestImpactHandler_ReunionsByMonth_WindowAndGapFill(t *testing.T) {
	db := testdb.SetupTestDB(t)

	now := time.Now().UTC()
	firstOfThisMonth := time.Date(now.Year(), now.Month(), 1, 12, 0, 0, 0, time.UTC)
	twoMonthsAgo := firstOfThisMonth.AddDate(0, -2, 0)

	// 3 reunions this month, 1 reunion two months ago, none last month.
	recordEventAt(t, db, domain.StatEventPetFound, firstOfThisMonth)
	recordEventAt(t, db, domain.StatEventPetFound, firstOfThisMonth)
	recordEventAt(t, db, domain.StatEventPetFound, firstOfThisMonth)
	recordEventAt(t, db, domain.StatEventPetFound, twoMonthsAgo)

	r := setupImpactRouter(db)
	req := httptest.NewRequest(http.MethodGet, "/api/stats/impact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp struct {
		ReunionsByMonth []struct {
			Month string `json:"month"`
			Count int64  `json:"count"`
		} `json:"reunions_by_month"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Continuous trailing 12-month window.
	if len(resp.ReunionsByMonth) != 12 {
		t.Fatalf("want 12 months, got %d", len(resp.ReunionsByMonth))
	}
	// Last bucket = current month = 3.
	last := resp.ReunionsByMonth[11]
	if last.Month != firstOfThisMonth.Format("2006-01") || last.Count != 3 {
		t.Errorf("current month: want {%s 3}, got {%s %d}", firstOfThisMonth.Format("2006-01"), last.Month, last.Count)
	}
	// Two months ago = 1.
	if got := resp.ReunionsByMonth[9]; got.Count != 1 {
		t.Errorf("two-months-ago bucket: want count 1, got %d (month %s)", got.Count, got.Month)
	}
	// Last month (gap) = 0.
	if got := resp.ReunionsByMonth[10]; got.Count != 0 {
		t.Errorf("gap month: want count 0, got %d (month %s)", got.Count, got.Month)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./tests/ -run Impact -v`
Expected: compile error — `undefined: handler.NewImpactHandler`.

- [ ] **Step 3: Create the handler**

Create `backend/internal/handler/impact_handler.go`:

```go
package handler

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// impactCacheTTL is how long a computed payload is served from memory before a
// recompute. Impact numbers do not change per second; this shields the DB
// (Render free tier) from repeated public hits.
const impactCacheTTL = 5 * time.Minute

// impactMonthsWindow is how many trailing calendar months reunions_by_month spans.
const impactMonthsWindow = 12

// ImpactHandler serves the public impact dashboard at GET /api/stats/impact.
type ImpactHandler struct {
	db *gorm.DB

	mu       sync.RWMutex
	cached   *ImpactResponse
	cachedAt time.Time
}

func NewImpactHandler(db *gorm.DB) *ImpactHandler {
	return &ImpactHandler{db: db}
}

// ImpactTotals are the headline numbers. Lifetime counters (pets_reunited,
// searches_started) come from the append-only ledger; total_users/total_pets/
// active_searches are live snapshot counts; reunion_rate is derived.
type ImpactTotals struct {
	PetsReunited    int64   `json:"pets_reunited"`
	SearchesStarted int64   `json:"searches_started"`
	TotalUsers      int64   `json:"total_users"`
	TotalPets       int64   `json:"total_pets"`
	ActiveSearches  int64   `json:"active_searches"`
	ReunionRate     float64 `json:"reunion_rate"`
}

// MonthlyCount is one point on the reunions-per-month series. Month is "YYYY-MM".
type MonthlyCount struct {
	Month string `json:"month"`
	Count int64  `json:"count"`
}

type ImpactResponse struct {
	Totals          ImpactTotals   `json:"totals"`
	ReunionsByMonth []MonthlyCount `json:"reunions_by_month"`
}

// GetImpactStats godoc
// GET /api/stats/impact
func (h *ImpactHandler) GetImpactStats(c *gin.Context) {
	h.mu.RLock()
	if h.cached != nil && time.Since(h.cachedAt) < impactCacheTTL {
		resp := h.cached
		h.mu.RUnlock()
		c.JSON(http.StatusOK, resp)
		return
	}
	h.mu.RUnlock()

	resp, err := h.compute()
	if err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	h.mu.Lock()
	h.cached = resp
	h.cachedAt = time.Now()
	h.mu.Unlock()

	c.JSON(http.StatusOK, resp)
}

func (h *ImpactHandler) compute() (*ImpactResponse, error) {
	var totals ImpactTotals

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventPetFound).
		Count(&totals.PetsReunited).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventSearchStarted).
		Count(&totals.SearchesStarted).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.User{}).Count(&totals.TotalUsers).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Pet{}).Count(&totals.TotalPets).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Pet{}).
		Where("status IN ?", []string{domain.PetStatusLost, domain.PetStatusStray}).
		Count(&totals.ActiveSearches).Error; err != nil {
		return nil, err
	}

	if totals.SearchesStarted > 0 {
		totals.ReunionRate = float64(totals.PetsReunited) / float64(totals.SearchesStarted)
	}

	series, err := h.reunionsByMonth()
	if err != nil {
		return nil, err
	}

	return &ImpactResponse{Totals: totals, ReunionsByMonth: series}, nil
}

// reunionsByMonth returns pet_found counts per calendar month for the trailing
// impactMonthsWindow months, filling months with no events with count:0 so the
// chart line is continuous.
func (h *ImpactHandler) reunionsByMonth() ([]MonthlyCount, error) {
	type row struct {
		Month string
		Count int64
	}
	var rows []row
	err := h.db.Model(&domain.PlatformEvent{}).
		Select("to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*) AS count").
		Where("event_type = ?", domain.StatEventPetFound).
		Group("date_trunc('month', created_at)").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	counts := make(map[string]int64, len(rows))
	for _, r := range rows {
		counts[r.Month] = r.Count
	}

	// Anchor to the first of the current month so AddDate never skips a month.
	now := time.Now().UTC()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	series := make([]MonthlyCount, 0, impactMonthsWindow)
	for i := impactMonthsWindow - 1; i >= 0; i-- {
		key := first.AddDate(0, -i, 0).Format("2006-01")
		series = append(series, MonthlyCount{Month: key, Count: counts[key]})
	}
	return series, nil
}
```

- [ ] **Step 4: Wire the route**

In `backend/internal/app/router.go`, after line 210 (`statsHandler := handler.NewStatsHandler(db)`) add:

```go
	impactHandler := handler.NewImpactHandler(db)
```

Then in the public group, right after line 265 (`public.GET("/stats", statsHandler.GetStats)`) add:

```go
		public.GET("/stats/impact", impactHandler.GetImpactStats)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable go test ./tests/ -run Impact -v`
Expected: PASS (4 tests). `TestImpactHandler_DBError` passes even without DATABASE_URL; the other three skip if it is unset — set it.

- [ ] **Step 6: Verify the build compiles**

Run: `cd backend && go build ./...`
Expected: no output (success).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/handler/impact_handler.go backend/internal/app/router.go backend/tests/impact_handler_test.go
git commit -m "feat(impact): add public GET /api/stats/impact endpoint"
```

---

## Task 2: Shared layer — types, client, hook

**Files:**
- Modify: `frontend/packages/shared/types/index.ts:139` (near the existing `Stats` interface)
- Modify: `frontend/packages/shared/api/client.ts` (type import block + after `getStats`)
- Modify: `frontend/packages/shared/hooks/index.ts:578` (after `useStats`)
- Modify: `frontend/packages/shared/api/client.test.ts`

- [ ] **Step 1: Add the types**

In `frontend/packages/shared/types/index.ts`, immediately after the `Stats` interface (ends at line 144), add:

```typescript
export interface ImpactMonthlyCount {
  month: string; // "YYYY-MM"
  count: number;
}

export interface ImpactTotals {
  pets_reunited: number;
  searches_started: number;
  total_users: number;
  total_pets: number;
  active_searches: number;
  reunion_rate: number; // 0..1
}

export interface ImpactStats {
  totals: ImpactTotals;
  reunions_by_month: ImpactMonthlyCount[];
}
```

- [ ] **Step 2: Add the client method**

In `frontend/packages/shared/api/client.ts`, add `ImpactStats` to the type import block (it already imports `Stats` at line 45 — add the line below it):

```typescript
  ImpactStats,
```

Then, immediately after the `getStats()` method (line 648-650), add:

```typescript
  async getImpactStats(): Promise<ImpactStats> {
    return this.request<ImpactStats>('GET', '/api/stats/impact');
  }
```

- [ ] **Step 3: Add the failing client test**

In `frontend/packages/shared/api/client.test.ts`, add this test inside the same top-level `describe` block that contains the `getStats` tests (near line 356):

```typescript
  it('getImpactStats resolves the impact payload', async () => {
    const payload = {
      totals: {
        pets_reunited: 2,
        searches_started: 4,
        total_users: 1,
        total_pets: 1,
        active_searches: 1,
        reunion_rate: 0.5,
      },
      reunions_by_month: [{ month: '2026-07', count: 2 }],
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

    await expect(client.getImpactStats()).resolves.toEqual(payload);
  });
```

- [ ] **Step 4: Add the hook**

In `frontend/packages/shared/hooks/index.ts`, immediately after the `useStats` hook (ends line 578), add:

```typescript
export const useImpactStats = () => {
  return useQuery({
    queryKey: ['impact-stats'],
    queryFn: () => apiClient.getImpactStats(),
    staleTime: 5 * 60 * 1000, // 5 min — matches the backend cache TTL
  });
};
```

- [ ] **Step 5: Run the shared tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts`
Expected: PASS, including the new `getImpactStats` test.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts frontend/packages/shared/api/client.test.ts frontend/packages/shared/hooks/index.ts
git commit -m "feat(impact): add shared ImpactStats type, client method and hook"
```

---

## Task 3: ImpactLineChart component (zero-dep SVG)

**Files:**
- Create: `frontend/packages/web/src/components/ImpactLineChart.tsx`
- Create: `frontend/packages/web/src/components/ImpactLineChart.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/components/ImpactLineChart.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ImpactLineChart } from './ImpactLineChart';

describe('ImpactLineChart', () => {
  it('renders a polyline with one coordinate per data point', () => {
    const data = [
      { month: '2026-05', count: 1 },
      { month: '2026-06', count: 3 },
      { month: '2026-07', count: 2 },
    ];
    const { container } = render(<ImpactLineChart data={data} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(3);
  });

  it('renders nothing when data is empty', () => {
    const { container } = render(<ImpactLineChart data={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/ImpactLineChart.test.tsx`
Expected: FAIL — cannot resolve `./ImpactLineChart`.

- [ ] **Step 3: Implement the component**

Create `frontend/packages/web/src/components/ImpactLineChart.tsx`:

```tsx
import type { ImpactMonthlyCount } from '@shared/types';

interface ImpactLineChartProps {
  data: ImpactMonthlyCount[];
  color?: string;
  height?: number;
}

// Hand-rolled SVG line chart — zero dependencies. Renders a filled area under a
// polyline. The viewBox is a fixed 600xheight coordinate space scaled to 100%
// width by the browser, so it is responsive without JS.
export function ImpactLineChart({ data, color = '#22c55e', height = 160 }: ImpactLineChartProps) {
  if (data.length === 0) return null;

  const width = 600;
  const pad = 6;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const coords = data.map((d, i) => {
    const x = i * stepX;
    const y = height - pad - (d.count / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(' ');
  const area = `${line} ${width},${height} 0,${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="auto"
      preserveAspectRatio="none"
      role="img"
      aria-label="Reuniones por mes"
    >
      <polygon points={area} fill={color} fillOpacity={0.13} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/ImpactLineChart.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/ImpactLineChart.tsx frontend/packages/web/src/components/ImpactLineChart.test.tsx
git commit -m "feat(impact): add zero-dependency ImpactLineChart SVG component"
```

---

## Task 4: ImpactPage

**Files:**
- Create: `frontend/packages/web/src/pages/ImpactPage.tsx`
- Create: `frontend/packages/web/src/pages/ImpactPage.test.tsx`

> **Note on i18n in the test:** the test mocks `react-i18next` so `t` returns the key, and mocks `@shared/hooks`. This mirrors the existing web page tests (e.g. `MyPetsPage.test.tsx`).

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/pages/ImpactPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

const useImpactStats = vi.fn();
vi.mock('@shared/hooks', () => ({ useImpactStats: () => useImpactStats() }));

import { ImpactPage } from './ImpactPage';

describe('ImpactPage', () => {
  it('renders the reunions total when data is loaded', () => {
    useImpactStats.mockReturnValue({
      data: {
        totals: {
          pets_reunited: 1247,
          searches_started: 3891,
          total_users: 5402,
          total_pets: 6130,
          active_searches: 214,
          reunion_rate: 0.32,
        },
        reunions_by_month: [{ month: '2026-07', count: 12 }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ImpactPage />);
    // Number is locale-formatted; assert the grouped digits appear.
    expect(screen.getByText(/1[.,]247/)).toBeInTheDocument();
  });

  it('renders an error state on failure', () => {
    useImpactStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    render(<ImpactPage />);
    expect(screen.getByText('impact:error')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ImpactPage.test.tsx`
Expected: FAIL — cannot resolve `./ImpactPage`.

- [ ] **Step 3: Implement the page**

Create `frontend/packages/web/src/pages/ImpactPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useImpactStats } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ImpactLineChart } from '../components/ImpactLineChart';

function StatTile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-700">
      <div className="text-3xl font-extrabold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export function ImpactPage() {
  const { t, i18n } = useTranslation('impact');
  const { data, isLoading, isError, error } = useImpactStats();

  const nf = new Intl.NumberFormat(i18n.language);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-gray-500">
        {t('loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-red-600">
        {isError ? getErrorMessage(error, t) : t('error')}
      </div>
    );
  }

  const { totals, reunions_by_month } = data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold">{t('title')} 🐾</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={nf.format(totals.pets_reunited)} label={t('reunited')} accent="#22c55e" />
        <StatTile value={nf.format(totals.searches_started)} label={t('searches')} accent="#3b82f6" />
        <StatTile value={nf.format(totals.total_users)} label={t('community')} />
        <StatTile value={nf.format(totals.total_pets)} label={t('registered')} />
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div className="mb-3 text-sm font-bold">{t('reunionsByMonth')}</div>
        <ImpactLineChart data={reunions_by_month} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile value={nf.format(totals.active_searches)} label={t('activeSearches')} accent="#3b82f6" />
        <StatTile
          value={`${Math.round(totals.reunion_rate * 100)}%`}
          label={t('reunionRate')}
          accent="#22c55e"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ImpactPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/ImpactPage.tsx frontend/packages/web/src/pages/ImpactPage.test.tsx
git commit -m "feat(impact): add public ImpactPage"
```

---

## Task 5: i18n `impact` namespace (es/en/pt) + registration

> ⚠️ **Rule #21 gotcha:** adding the block to the locale JSONs is NOT enough. The namespace MUST also be registered in `web/src/i18n/index.ts` in all three language blocks, or `useTranslation('impact')` returns the raw keys on screen.

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/es.json`
- Modify: `frontend/packages/web/src/i18n/locales/en.json`
- Modify: `frontend/packages/web/src/i18n/locales/pt.json`
- Modify: `frontend/packages/web/src/i18n/index.ts` (lines 51, 79, 107 area)

- [ ] **Step 1: Add the `impact` block to `es.json`**

Add this top-level key to `frontend/packages/web/src/i18n/locales/es.json` (alongside the other web-only namespaces like `vets`, `fosterHomes`):

```json
"impact": {
  "title": "El impacto de SearchPet",
  "subtitle": "Una causa social, 100% gratuita. Estos son los números, sin nada oculto.",
  "reunited": "Mascotas reunidas 💚",
  "searches": "Búsquedas iniciadas",
  "community": "Familias en la comunidad",
  "registered": "Mascotas registradas",
  "reunionsByMonth": "Reuniones por mes",
  "activeSearches": "Búsquedas activas ahora",
  "reunionRate": "Tasa de reunión",
  "loading": "Cargando impacto…",
  "error": "No pudimos cargar las estadísticas de impacto.",
  "footerLink": "Nuestro impacto",
  "homeCta": "Ver nuestro impacto →"
}
```

- [ ] **Step 2: Add the `impact` block to `en.json`**

```json
"impact": {
  "title": "SearchPet's impact",
  "subtitle": "A social cause, 100% free. These are the numbers, with nothing hidden.",
  "reunited": "Pets reunited 💚",
  "searches": "Searches started",
  "community": "Families in the community",
  "registered": "Pets registered",
  "reunionsByMonth": "Reunions per month",
  "activeSearches": "Active searches now",
  "reunionRate": "Reunion rate",
  "loading": "Loading impact…",
  "error": "We couldn't load the impact statistics.",
  "footerLink": "Our impact",
  "homeCta": "See our impact →"
}
```

- [ ] **Step 3: Add the `impact` block to `pt.json`**

```json
"impact": {
  "title": "O impacto do SearchPet",
  "subtitle": "Uma causa social, 100% gratuita. Estes são os números, sem nada escondido.",
  "reunited": "Pets reunidos 💚",
  "searches": "Buscas iniciadas",
  "community": "Famílias na comunidade",
  "registered": "Pets registrados",
  "reunionsByMonth": "Reuniões por mês",
  "activeSearches": "Buscas ativas agora",
  "reunionRate": "Taxa de reunião",
  "loading": "Carregando impacto…",
  "error": "Não foi possível carregar as estatísticas de impacto.",
  "footerLink": "Nosso impacto",
  "homeCta": "Ver nosso impacto →"
}
```

- [ ] **Step 4: Register the namespace in `index.ts`**

In `frontend/packages/web/src/i18n/index.ts`, add `impact: <lang>.impact,` in each of the three language blocks, right after the `fosterHomes` line (lines 51, 79, 107):

- In the `es` block (after line 51 `fosterHomes: es.fosterHomes,`): `        impact: es.impact,`
- In the `en` block (after line 79 `fosterHomes: en.fosterHomes,`): `        impact: en.impact,`
- In the `pt` block (after line 107 `fosterHomes: pt.fosterHomes,`): `        impact: pt.impact,`

- [ ] **Step 5: Verify typecheck/build passes**

Run: `cd frontend/packages/web && pnpm build`
Expected: build succeeds (JSON imports resolve, no TS errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json frontend/packages/web/src/i18n/index.ts
git commit -m "feat(impact): add impact i18n namespace (es/en/pt)"
```

---

## Task 6: Wire the route + navigation

**Files:**
- Modify: `frontend/packages/web/src/App.tsx` (import + route, public MainLayout group ~line 65)
- Modify: `frontend/packages/web/src/layouts/MainLayout.tsx` (footer)
- Modify: `frontend/packages/web/src/pages/HomePage.tsx` (CTA near the stats section)

- [ ] **Step 1: Add the route in `App.tsx`**

Add the import next to the other page imports (near line 15):

```tsx
import { ImpactPage } from './pages/ImpactPage';
```

Add the public route inside the `<Route element={<MainLayout />}>` group, after the `/shelters` route (line 58):

```tsx
          <Route path="/impacto" element={<ImpactPage />} />
```

- [ ] **Step 2: Add the footer link in `MainLayout.tsx`**

In `frontend/packages/web/src/layouts/MainLayout.tsx`, locate the footer navigation links (the existing `<Link>` list in the `<footer>`). Add, following the exact markup of the sibling links:

```tsx
<Link to="/impacto">{t('impact:footerLink')}</Link>
```

If the footer's `useTranslation` call does not already include the `impact` namespace, add it to the array (e.g. `useTranslation(['layout', 'footer', 'impact'])`). Verify by reading the existing `useTranslation(...)` call at the top of the footer component before editing.

- [ ] **Step 3: Add a CTA on `HomePage.tsx`**

In `frontend/packages/web/src/pages/HomePage.tsx`, near the existing stats section, add a link to the impact page following the page's existing button/link styling:

```tsx
<Link to="/impacto" className="text-blue-600 hover:underline">
  {t('impact:homeCta')}
</Link>
```

Ensure `Link` is imported from `react-router-dom` (it usually already is) and that `impact` is in the page's `useTranslation([...])` namespaces. Verify both by reading the top of `HomePage.tsx` before editing.

- [ ] **Step 4: Run the web test suite + build**

Run: `cd frontend/packages/web && pnpm test:run && pnpm build`
Expected: all tests PASS and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/App.tsx frontend/packages/web/src/layouts/MainLayout.tsx frontend/packages/web/src/pages/HomePage.tsx
git commit -m "feat(impact): wire /impacto route, footer link and home CTA"
```

---

## Task 7: E2E smoke test (optional)

**Files:**
- Create: `frontend/packages/web/e2e/impact.spec.ts` (only if the repo already has a Playwright `e2e/` dir with a config; otherwise skip)

- [ ] **Step 1: Write the smoke test**

Create `frontend/packages/web/e2e/impact.spec.ts` (mirror an existing spec's imports/setup):

```ts
import { test, expect } from '@playwright/test';

test('impact page renders without login', async ({ page }) => {
  await page.goto('/impacto');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: /reuniones|reunions|reuniões/i })).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `cd frontend/packages/web && pnpm exec playwright test impact.spec.ts`
Expected: PASS (requires the backend + web dev servers per the existing Playwright config).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/e2e/impact.spec.ts
git commit -m "test(impact): add /impacto e2e smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** all 6 metrics (Task 1 response + Task 4 tiles), monthly granularity + trailing-12-month window + gap-fill (Task 1 `reunionsByMonth` + its test), 5-min cache (Task 1 handler), zero-dep SVG charts (Task 3), web-only page + route + nav (Tasks 4/6), i18n with the rule-#21 registration (Task 5), testing across all layers (each task). ✅
- **Type consistency:** JSON keys `pets_reunited/searches_started/total_users/total_pets/active_searches/reunion_rate` + `reunions_by_month[].{month,count}` are identical across the Go structs (Task 1), TS types (Task 2), and consumers (Tasks 3/4). Hook `useImpactStats` and client `getImpactStats` names match across Tasks 2/4. ✅
- **Known verify-before-edit spots:** Task 6 footer/CTA edits depend on the exact existing markup of `MainLayout.tsx` / `HomePage.tsx` — the steps instruct reading the `useTranslation(...)` call before editing (not blind edits).
```
