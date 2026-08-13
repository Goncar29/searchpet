package service_test

import (
	"context"
	"testing"
	"time"

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

// VetService no barre ni cuenta: sólo consulta por cercanía. Estos dos existen
// para satisfacer la interfaz, y devuelven el valor cero a propósito — si algún
// día VetService los llamara de verdad, un test que dependa de su resultado
// fallaría acá y no en producción.
func (m *mockVetRepo) SoftDeleteStaleBefore(_ context.Context, _ time.Time) (int64, error) {
	return 0, nil
}

func (m *mockVetRepo) CountActiveOSM(_ context.Context) (int64, error) { return 0, nil }

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
	// 500, no 50: con 50 el recorte se aplicaba DESPUES de ordenar por distancia
	// y las veterinarias mas lejanas desaparecian del mapa sin aviso. Este mock
	// solo puede afirmar que el techo VIAJA hasta el repositorio — un mock no
	// tiene filas que recortar. Que el techo alcance para la densidad real
	// medida lo cubre tests/vet_service_test.go contra Postgres, con el alcance
	// exacto documentado ahi: fija el piso del techo, no la ausencia de recorte.
	if repo.gotLimit != 500 {
		t.Errorf("limit = %d, want 500", repo.gotLimit)
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
