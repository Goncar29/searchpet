package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func seedVet(t *testing.T, repo repository.VetRepository, osmID int64, name string, lat, lng float64) {
	t.Helper()
	err := repo.Upsert(context.Background(), &domain.Vet{
		OSMType:      "node",
		OSMID:        osmID,
		Name:         name,
		Latitude:     lat,
		Longitude:    lng,
		Source:       "osm",
		LastSyncedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("seed vet %q: %v", name, err)
	}
}

func TestVetRepository_FindNearby_FiltersAndOrdersByDistance(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	// Montevideo center.
	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 1, "Close", lat+0.001, lng+0.001)  // ~150 m
	seedVet(t, repo, 2, "Mid", lat+0.02, lng+0.02)      // ~3 km
	seedVet(t, repo, 3, "Far", lat+0.5, lng+0.5)        // ~70 km — outside 5 km

	results, err := repo.FindNearby(context.Background(), lat, lng, 5000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 vets within 5km, got %d", len(results))
	}
	if results[0].Name != "Close" || results[1].Name != "Mid" {
		t.Errorf("expected distance order [Close, Mid], got [%s, %s]", results[0].Name, results[1].Name)
	}
	if results[0].DistanceMeters <= 0 || results[0].DistanceMeters > results[1].DistanceMeters {
		t.Errorf("distance not populated/ordered: %v vs %v", results[0].DistanceMeters, results[1].DistanceMeters)
	}
}

func TestVetRepository_Upsert_IsIdempotentByOSMKey(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 42, "Original", lat, lng)
	seedVet(t, repo, 42, "Renamed", lat, lng) // same osm_type+osm_id → update, not insert

	results, err := repo.FindNearby(context.Background(), lat, lng, 1000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 vet after re-upsert, got %d", len(results))
	}
	if results[0].Name != "Renamed" {
		t.Errorf("expected updated name 'Renamed', got %q", results[0].Name)
	}
}
