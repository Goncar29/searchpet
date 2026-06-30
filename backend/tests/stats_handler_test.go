package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// ============================================================
// Router setup
// ============================================================

func setupStatsRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewStatsHandler(db)
	r.GET("/api/stats", h.GetStats)
	return r
}

// newBrokenDB creates a gorm.DB connected to a non-existent PostgreSQL
// server so that every query fails — used to verify 503 error handling.
func newBrokenDB(t *testing.T) *gorm.DB {
	t.Helper()
	// DSN points to localhost:1 — guaranteed to refuse the connection.
	dsn := "host=127.0.0.1 port=1 user=nobody dbname=nobody sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		// gorm.Open with postgres driver returns an error only if the driver
		// itself fails to load, which should not happen here. If it does,
		// skip rather than fatal — the test environment may lack the driver.
		t.Skipf("could not open broken gorm.DB: %v", err)
	}
	return db
}

// ============================================================
// GetStats tests
// ============================================================

// TestStatsHandler_GetStats_DBError validates that a DB failure returns 503.
// This is the regression test for fix T-1-13.
func TestStatsHandler_GetStats_DBError(t *testing.T) {
	db := newBrokenDB(t)
	r := setupStatsRouter(db)

	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when DB is unavailable, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := body["code"]; !ok {
		t.Error("expected 'code' key in 503 response body")
	}
}

// TestStatsHandler_GetStats_LifetimeAndSnapshot validates the JSON shape:
// lifetime keys (pets_reunited DISTINCT, searches_started per-row) come from the
// ledger; snapshot keys (total_users, total_pets) are live counts; the legacy
// keys (total_reports, found_pets) are gone.
func TestStatsHandler_GetStats_LifetimeAndSnapshot(t *testing.T) {
	db := testdb.SetupTestDB(t)
	ctx := context.Background()

	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	statRepo := repository.NewStatEventRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{OwnerID: ptrUUID(owner.ID), Name: "Snap", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	// petA found twice -> distinct reunited = 1; one search opened.
	petA := uuid.New()
	_ = statRepo.Record(ctx, domain.StatEventPetFound, &petA)
	_ = statRepo.Record(ctx, domain.StatEventPetFound, &petA)
	_ = statRepo.Record(ctx, domain.StatEventSearchStarted, &petA)

	r := setupStatsRouter(db)
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	want := map[string]float64{
		"total_users":      1,
		"total_pets":       1,
		"pets_reunited":    1,
		"searches_started": 1,
	}
	for k, v := range want {
		got, ok := body[k]
		if !ok {
			t.Errorf("missing key %q in response %v", k, body)
			continue
		}
		if got.(float64) != v {
			t.Errorf("%q: want %v, got %v", k, v, got)
		}
	}
	for _, gone := range []string{"total_reports", "found_pets"} {
		if _, ok := body[gone]; ok {
			t.Errorf("legacy key %q should be absent, got %v", gone, body[gone])
		}
	}
}
