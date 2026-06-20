package service_test

import (
	"context"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

type mockVetRepo struct {
	gotRadius float64
	gotLimit  int
}

func (m *mockVetRepo) Upsert(_ context.Context, _ *domain.Vet) error { return nil }
func (m *mockVetRepo) FindNearby(_ context.Context, _, _, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error) {
	m.gotRadius = radiusMeters
	m.gotLimit = limit
	return []domain.VetNearbyResult{}, nil
}

func TestVetService_FindNearby_DefaultsRadiusWhenZero(t *testing.T) {
	repo := &mockVetRepo{}
	svc := service.NewVetService(repo)

	_, err := svc.FindNearby(context.Background(), -34.9, -56.1, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotRadius != 5000 {
		t.Errorf("default radius = %v, want 5000", repo.gotRadius)
	}
	if repo.gotLimit != 50 {
		t.Errorf("limit = %d, want 50", repo.gotLimit)
	}
}

func TestVetService_FindNearby_ClampsRadiusToMax(t *testing.T) {
	repo := &mockVetRepo{}
	svc := service.NewVetService(repo)

	_, err := svc.FindNearby(context.Background(), -34.9, -56.1, 999999)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotRadius != 50000 {
		t.Errorf("clamped radius = %v, want 50000", repo.gotRadius)
	}
}
