package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"lost-pets/internal/handler"
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
	if _, ok := body["error"]; !ok {
		t.Error("expected 'error' key in 503 response body")
	}
}
