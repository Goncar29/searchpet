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

func TestImpactHandler_CachesWithinTTL(t *testing.T) {
	db := testdb.SetupTestDB(t)

	now := time.Now().UTC()
	recordEventAt(t, db, domain.StatEventPetFound, now)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewImpactHandler(db) // single handler instance -> shared cache
	r.GET("/api/stats/impact", h.GetImpactStats)

	call := func() int64 {
		req := httptest.NewRequest(http.MethodGet, "/api/stats/impact", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var resp struct {
			Totals struct {
				PetsReunited int64 `json:"pets_reunited"`
			} `json:"totals"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp.Totals.PetsReunited
	}

	first := call() // 1, and caches it
	if first != 1 {
		t.Fatalf("first call: want 1, got %d", first)
	}

	// Insert another reunion AFTER the first (now cached) response.
	recordEventAt(t, db, domain.StatEventPetFound, now)

	second := call() // still 1 — served from cache, not recomputed
	if second != 1 {
		t.Errorf("cached call: want 1 (stale-from-cache), got %d", second)
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
