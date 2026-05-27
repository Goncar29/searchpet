package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestLocationAlertRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	alert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		Name:           "Cerca de casa",
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       5.0,
		IsActive:       true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := alertRepo.GetByID(ctx, alert.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != alert.Name {
		t.Errorf("want name %q, got %q", alert.Name, got.Name)
	}
	if got.RadiusKm != alert.RadiusKm {
		t.Errorf("want radiusKm=5.0, got %f", got.RadiusKm)
	}
}

func TestLocationAlertRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	// This validates the T-1-01 fix: must return ErrAlertNotFound, not gorm.ErrRecordNotFound
	_, err := alertRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrAlertNotFound) {
		t.Errorf("want ErrAlertNotFound, got %v", err)
	}
}

func TestLocationAlertRepository_FindActiveAlertsNear_Found(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Alert centered at Montevideo with 5 km radius
	alert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		Name:           "Active Alert",
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       5.0,
		IsActive:       true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Query point 100 m north of center — within 5 km radius
	nearbyLat := mvdLat + 0.001 // ~111 m
	alerts, err := alertRepo.FindActiveAlertsNear(ctx, nearbyLat, mvdLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear: %v", err)
	}

	found := false
	for _, a := range alerts {
		if a.ID == alert.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected alert %s in FindActiveAlertsNear results", alert.ID)
	}
}

func TestLocationAlertRepository_FindActiveAlertsNear_NotFound_OutsideRadius(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Alert centered at Montevideo with 1 km radius
	alert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		Name:           "Small Radius Alert",
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       1.0,
		IsActive:       true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Query point ~111 km north — outside 1 km radius
	farLat := mvdLat + 1.0
	alerts, err := alertRepo.FindActiveAlertsNear(ctx, farLat, mvdLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear: %v", err)
	}

	for _, a := range alerts {
		if a.ID == alert.ID {
			t.Errorf("alert %s (1 km radius) should NOT appear when querying 111 km away", alert.ID)
		}
	}
}

func TestLocationAlertRepository_FindActiveAlertsNear_PetTypeFilter(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Dog-only alert at Montevideo
	dogAlert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		Name:           "Dog Alert",
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       5.0,
		PetType:        "perro",
		IsActive:       true,
	}
	// Any-type alert at Montevideo
	anyAlert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		Name:           "Any Alert",
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       5.0,
		PetType:        "",
		IsActive:       true,
	}
	for _, a := range []*domain.LocationAlert{dogAlert, anyAlert} {
		if err := alertRepo.Create(ctx, a); err != nil {
			t.Fatalf("Create alert %q: %v", a.Name, err)
		}
	}

	// Query for "perro" — should find dogAlert and anyAlert
	results, err := alertRepo.FindActiveAlertsNear(ctx, mvdLat, mvdLng, "perro")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear (perro): %v", err)
	}
	foundDog, foundAny := false, false
	for _, a := range results {
		if a.ID == dogAlert.ID {
			foundDog = true
		}
		if a.ID == anyAlert.ID {
			foundAny = true
		}
	}
	if !foundDog {
		t.Error("expected dogAlert in perro-filtered results")
	}
	if !foundAny {
		t.Error("expected anyAlert (empty pet_type) in perro-filtered results")
	}

	// Query for "gato" — should find anyAlert but NOT dogAlert
	catResults, err := alertRepo.FindActiveAlertsNear(ctx, mvdLat, mvdLng, "gato")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear (gato): %v", err)
	}
	for _, a := range catResults {
		if a.ID == dogAlert.ID {
			t.Error("dogAlert should NOT appear in gato-filtered results")
		}
	}
}

func TestLocationAlertRepository_GetByUserID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	for i := 0; i < 2; i++ {
		a := &domain.LocationAlert{
			ID:             uuid.New(),
			UserID:         user.ID,
			AlertLatitude:  mvdLat,
			AlertLongitude: mvdLng,
			RadiusKm:       3.0,
			IsActive:       true,
		}
		if err := alertRepo.Create(ctx, a); err != nil {
			t.Fatalf("Create alert %d: %v", i, err)
		}
	}

	alerts, err := alertRepo.GetByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByUserID: %v", err)
	}
	if len(alerts) < 2 {
		t.Errorf("want at least 2 alerts, got %d", len(alerts))
	}
}

func TestLocationAlertRepository_Delete_SoftDelete(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	alert := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         user.ID,
		AlertLatitude:  mvdLat,
		AlertLongitude: mvdLng,
		RadiusKm:       5.0,
		IsActive:       true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Soft delete — sets is_active = false
	if err := alertRepo.Delete(ctx, alert.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// GetByUserID only returns active alerts
	alerts, err := alertRepo.GetByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByUserID after delete: %v", err)
	}
	for _, a := range alerts {
		if a.ID == alert.ID {
			t.Errorf("soft-deleted alert %s should not appear in GetByUserID", alert.ID)
		}
	}

	// Record still exists in DB with is_active=false (verify via GetByID)
	got, err := alertRepo.GetByID(ctx, alert.ID)
	if err != nil {
		t.Fatalf("GetByID after soft delete: %v", err)
	}
	if got.IsActive {
		t.Error("want IsActive=false after soft delete")
	}
}
