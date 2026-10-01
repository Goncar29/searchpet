package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

func mkPet(t *testing.T, repo repository.PetRepository, owner, reporter *uuid.UUID, status string) *domain.Pet {
	t.Helper()
	p := &domain.Pet{ID: uuid.New(), OwnerID: owner, ReporterID: reporter, Name: "P", Type: "perro", Status: status}
	if err := repo.Create(p); err != nil {
		t.Fatalf("create pet: %v", err)
	}
	return p
}

func mkReport(t *testing.T, repo repository.ReportRepository, petID, reporterID uuid.UUID, status, desc string) *domain.Report {
	t.Helper()
	r := &domain.Report{PetID: petID, ReporterID: reporterID, Status: status, Latitude: -34.9, Longitude: -56.1, LocationDescription: desc}
	if err := repo.Create(r); err != nil {
		t.Fatalf("create report: %v", err)
	}
	return r
}

func TestReportRepository_CountByReporter_ExcluyeElCierreAutomatico(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	reports := repository.NewReportRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, users)
	other := newTestUser(t, users)
	ownPet := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
	strayPet := mkPet(t, pets, nil, ptrUUID(owner.ID), domain.PetStatusStray)

	// Cuentan: perdida del dueño, avistamiento inicial del callejero, y un
	// avistamiento del dueño sobre la mascota de otra persona.
	mkReport(t, reports, ownPet.ID, owner.ID, "lost", "")
	mkReport(t, reports, strayPet.ID, owner.ID, "sighting", "")
	otherPet := mkPet(t, pets, ptrUUID(other.ID), nil, domain.PetStatusLost)
	mkReport(t, reports, otherPet.ID, owner.ID, "sighting", "")
	// NO cuentan: cierre del dueño sobre su mascota y cierre del reportante
	// sobre su callejero.
	mkReport(t, reports, ownPet.ID, owner.ID, "found", "Closure report")
	mkReport(t, reports, strayPet.ID, owner.ID, "found", "Closure report")

	got, err := reports.CountByReporter(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 3 {
		t.Fatalf("want 3 (cierres excluidos), got %d", got)
	}
}

func TestReportRepository_CountByReporter_UnFoundDeQuienLaEncontroSiCuenta(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	reports := repository.NewReportRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, users)
	finder := newTestUser(t, users)
	pet := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
	stray := mkPet(t, pets, nil, ptrUUID(owner.ID), domain.PetStatusStray)

	mkReport(t, reports, pet.ID, finder.ID, "found", "la tengo yo")
	mkReport(t, reports, stray.ID, finder.ID, "found", "")
	// Un cierre con la descripción de otro texto sigue siendo cierre: el
	// discriminante es la estructura, no el string.
	mkReport(t, reports, pet.ID, owner.ID, "found", "cualquier texto")

	if got, _ := reports.CountByReporter(ctx, finder.ID); got != 2 {
		t.Fatalf("finder: want 2, got %d", got)
	}
	if got, _ := reports.CountByReporter(ctx, owner.ID); got != 0 {
		t.Fatalf("owner: want 0 (solo cierre), got %d", got)
	}
}

func TestReportRepository_CountByReporter_BorrarBajaElConteo(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	reports := repository.NewReportRepository(db)
	ctx := context.Background()

	u := newTestUser(t, users)
	pet := mkPet(t, pets, ptrUUID(u.ID), nil, domain.PetStatusLost)
	r1 := mkReport(t, reports, pet.ID, u.ID, "lost", "")
	mkReport(t, reports, pet.ID, u.ID, "sighting", "")

	if got, _ := reports.CountByReporter(ctx, u.ID); got != 2 {
		t.Fatalf("want 2, got %d", got)
	}
	if err := reports.Delete(ctx, r1.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := reports.CountByReporter(ctx, u.ID); got != 1 {
		t.Fatalf("after delete want 1, got %d", got)
	}
}

func TestPetRepository_CountFoundByUser(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)

	x := newTestUser(t, users)
	y := newTestUser(t, users)

	owned := mkPet(t, pets, ptrUUID(x.ID), nil, domain.PetStatusFound)
	mkPet(t, pets, nil, ptrUUID(x.ID), domain.PetStatusFound) // callejero encontrado
	mkPet(t, pets, ptrUUID(x.ID), nil, domain.PetStatusLost)  // perdida: no
	mkPet(t, pets, ptrUUID(y.ID), nil, domain.PetStatusFound) // de otro: no

	if got, _ := pets.CountFoundByUser(x.ID.String()); got != 2 {
		t.Fatalf("want 2, got %d", got)
	}
	if err := pets.Delete(owned.ID.String()); err != nil {
		t.Fatal(err)
	}
	if got, _ := pets.CountFoundByUser(x.ID.String()); got != 1 {
		t.Fatalf("after delete want 1, got %d", got)
	}
}

// Fixes the prod bug: user_points holds inflated counters, the profile must
// report the row counts while points still come from user_points.

type stubReports struct {
	repository.ReportRepository
	n int64
}

func (s stubReports) CountByReporter(context.Context, uuid.UUID) (int64, error) { return s.n, nil }

type stubPets struct {
	repository.PetRepository
	n int64
}

func (s stubPets) CountFoundByUser(string) (int64, error) { return s.n, nil }

func TestGamificationService_GetPublicProfile_ContadoresDesdeFilas(t *testing.T) {
	userID := uuid.New()
	svc := service.NewGamificationService(
		&mockBadgeRepository{},
		&mockUserPointsRepository{getByUserIDFn: func(context.Context, uuid.UUID) (*domain.UserPoints, error) {
			return &domain.UserPoints{UserID: userID, Points: 77, TotalReports: 41, FoundCount: 12, ShareCount: 5}, nil
		}},
		&mockUserRepository{getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, Name: "T"}, nil
		}},
		&mockGamificationReviewRepository{},
		stubReports{n: 2},
		stubPets{n: 1},
	)
	resp, err := svc.GetPublicProfile(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if resp.TotalReports != 2 || resp.FoundCount != 1 {
		t.Errorf("want reports=2 found=1 from rows, got %d/%d", resp.TotalReports, resp.FoundCount)
	}
	if resp.TotalPoints != 77 || resp.ShareCount != 5 {
		t.Errorf("points/shares must stay counter-based, got %d/%d", resp.TotalPoints, resp.ShareCount)
	}
}
