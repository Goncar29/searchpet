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

	// This month: 2 reunions (1 unlinked via recordEventAt + 1 linked to `pet`), 1 report.
	// Last month: 1 reunion (must be excluded).
	recordEventAt(t, db, domain.StatEventPetFound, thisMonth)
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

// "2026-13" passes the YYYY-MM regex but is not a real month, so it must be
// rejected by the time.Parse guard (the regex-only invalid test above never
// reaches that branch).
func TestMonthlyImpact_InvalidMonthValue(t *testing.T) {
	db := testdb.SetupTestDB(t)
	r := setupMonthlyRouter(db)
	code, _ := getMonthly(t, r, "2026-13")
	if code != http.StatusBadRequest {
		t.Errorf("month 2026-13: want 400, got %d", code)
	}
}

// The record lists are capped (cap is 50) and set truncated=true when they
// overflow. Seed cap+1 pet_found events on one pet in a month and assert the
// list is sliced to the cap with the flag set.
func TestMonthlyImpact_TruncatesAndFlags(t *testing.T) {
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
	for i := 0; i < 51; i++ {
		if err := db.Create(&domain.PlatformEvent{EventType: domain.StatEventPetFound, PetID: &pet.ID, CreatedAt: thisMonth}).Error; err != nil {
			t.Fatalf("seed event %d: %v", i, err)
		}
	}

	r := setupMonthlyRouter(db)
	code, resp := getMonthly(t, r, thisMonth.Format("2006-01"))
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if len(resp.ReunitedPets) != 50 {
		t.Errorf("reunited_pets: want 50 (capped), got %d", len(resp.ReunitedPets))
	}
	if !resp.Truncated {
		t.Errorf("truncated: want true, got false")
	}
}
