package tests

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestShelterRepository_GetAll(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	// GetAll es el directorio público: solo lista refugios approved (Task 3),
	// así que las fixtures deben crearse approved para ser visibles.
	shelters := []*domain.Shelter{
		{ID: uuid.New(), Name: "Refugio A", City: "Montevideo", IsVerified: true, Status: domain.ShelterStatusApproved},
		{ID: uuid.New(), Name: "Refugio B", City: "Montevideo", IsVerified: false, Status: domain.ShelterStatusApproved},
		{ID: uuid.New(), Name: "Refugio C", City: "Buenos Aires", IsVerified: true, Status: domain.ShelterStatusApproved},
	}
	for _, s := range shelters {
		if err := shelterRepo.Create(ctx, s); err != nil {
			t.Fatalf("Create shelter %q: %v", s.Name, err)
		}
	}

	// No filters — all 3
	all, err := shelterRepo.GetAll(ctx, "", nil)
	if err != nil {
		t.Fatalf("GetAll (no filter): %v", err)
	}
	if len(all) < 3 {
		t.Errorf("want at least 3 shelters, got %d", len(all))
	}

	// Filter by city
	byCityMVD, err := shelterRepo.GetAll(ctx, "Montevideo", nil)
	if err != nil {
		t.Fatalf("GetAll (Montevideo): %v", err)
	}
	if len(byCityMVD) < 2 {
		t.Errorf("want at least 2 Montevideo shelters, got %d", len(byCityMVD))
	}
	for _, s := range byCityMVD {
		if s.City != "Montevideo" {
			t.Errorf("unexpected city %q in Montevideo filter", s.City)
		}
	}

	// Filter by verified
	verified := true
	byVerified, err := shelterRepo.GetAll(ctx, "", &verified)
	if err != nil {
		t.Fatalf("GetAll (verified): %v", err)
	}
	for _, s := range byVerified {
		if !s.IsVerified {
			t.Errorf("unverified shelter %q appeared in verified filter", s.Name)
		}
	}
}

func TestShelterRepository_GetByID_Found(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	shelter := &domain.Shelter{
		ID:   uuid.New(),
		Name: "Refugio Test",
		City: "Montevideo",
	}
	if err := shelterRepo.Create(ctx, shelter); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := shelterRepo.GetByID(ctx, shelter.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != shelter.Name {
		t.Errorf("want name %q, got %q", shelter.Name, got.Name)
	}
}

func TestShelterRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	_, err := shelterRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
}

// newTestShelterWithOwner builds an unsaved shelter owned by ownerID.
func newTestShelterWithOwner(ownerID *uuid.UUID, name, status string) *domain.Shelter {
	return &domain.Shelter{
		OwnerUserID: ownerID,
		Name:        name,
		City:        "Montevideo",
		Status:      status,
	}
}

func TestShelterMigration_OwnerPartialUniqueIndex(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)

	// First shelter for the owner persists fine.
	first := newTestShelterWithOwner(&owner.ID, "Refugio Uno", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, first); err != nil {
		t.Fatalf("first Create: %v", err)
	}

	// Second shelter for the SAME owner violates the partial unique index.
	// Same detection pattern the codebase uses for PostgreSQL unique_violation
	// (badge_repository.go isUniqueViolation, block_service.go): match on
	// "23505", "duplicate key" or "unique constraint" in the error string.
	second := newTestShelterWithOwner(&owner.ID, "Refugio Dos", domain.ShelterStatusPending)
	err := shelterRepo.Create(ctx, second)
	if err == nil {
		t.Fatal("want unique violation for second shelter with same owner, got nil")
	}
	msg := err.Error()
	if !strings.Contains(msg, "23505") &&
		!strings.Contains(msg, "duplicate key") &&
		!strings.Contains(msg, "unique constraint") {
		t.Fatalf("want unique-constraint violation for second shelter with same owner, got: %v", err)
	}

	// Multiple ownerless shelters (admin/seed-created) are allowed — the index is partial.
	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(nil, "Sin Dueño A", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("ownerless A: %v", err)
	}
	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(nil, "Sin Dueño B", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("ownerless B: %v", err)
	}
}

func TestShelterRepository_GetAll_OnlyApproved(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)

	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(&owner.ID, "Pendiente", domain.ShelterStatusPending)); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(nil, "Aprobado", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("create approved: %v", err)
	}
	rejected := newTestShelterWithOwner(nil, "Rechazado", domain.ShelterStatusRejected)
	if err := shelterRepo.Create(ctx, rejected); err != nil {
		t.Fatalf("create rejected: %v", err)
	}

	shelters, err := shelterRepo.GetAll(ctx, "", nil)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if len(shelters) != 1 {
		t.Fatalf("want only the approved shelter, got %d", len(shelters))
	}
	if shelters[0].Name != "Aprobado" {
		t.Errorf("want 'Aprobado', got %q", shelters[0].Name)
	}
}

func TestShelterRepository_GetByOwner(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	stranger := newTestUser(t, userRepo)

	created := newTestShelterWithOwner(&owner.ID, "Mi Refugio", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, created); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := shelterRepo.GetByOwner(ctx, owner.ID)
	if err != nil {
		t.Fatalf("GetByOwner: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("want shelter %s, got %s", created.ID, got.ID)
	}

	if _, err := shelterRepo.GetByOwner(ctx, stranger.ID); err != domain.ErrShelterNotFound {
		t.Errorf("want ErrShelterNotFound for user without shelter, got %v", err)
	}
}

func TestShelterRepository_GetPendingQueue(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	ownerA := newTestUser(t, userRepo)
	ownerB := newTestUser(t, userRepo)

	// In the queue: a pending registration...
	pending := newTestShelterWithOwner(&ownerA.ID, "Pendiente", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, pending); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	// ...and an approved shelter with a staged link change.
	staged := newTestShelterWithOwner(&ownerB.ID, "Con Cambio", domain.ShelterStatusApproved)
	newURL := "https://nuevo.example.org/donar"
	staged.PendingDonationURL = &newURL
	if err := shelterRepo.Create(ctx, staged); err != nil {
		t.Fatalf("create staged: %v", err)
	}
	// NOT in the queue: a plain approved shelter and a rejected one.
	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(nil, "Tranquilo", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("create approved: %v", err)
	}
	if err := shelterRepo.Create(ctx, newTestShelterWithOwner(nil, "Rechazado", domain.ShelterStatusRejected)); err != nil {
		t.Fatalf("create rejected: %v", err)
	}

	queue, err := shelterRepo.GetPendingQueue(ctx)
	if err != nil {
		t.Fatalf("GetPendingQueue: %v", err)
	}
	if len(queue) != 2 {
		t.Fatalf("want 2 shelters in queue, got %d", len(queue))
	}
	names := map[string]bool{queue[0].Name: true, queue[1].Name: true}
	if !names["Pendiente"] || !names["Con Cambio"] {
		t.Errorf("want {Pendiente, Con Cambio} in queue, got %v", names)
	}
}

// El buscador de la página de refugios manda texto libre, y la ciudad la
// escribe a mano el dueño al registrarse. Con el `city = ?` exacto y sensible a
// mayúsculas que había antes, la pantalla contestaba "no encontramos refugios
// en X" habiendo refugios en X — la peor forma de fallar, porque parece un dato
// y es un bug. Va contra Postgres de verdad: un mock no tiene ILIKE.
func TestShelterRepository_GetAll_BuscaLaCiudadSinImportarMayusculasNiSerExacta(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	target := &domain.Shelter{
		ID: uuid.New(), Name: "Refugio Costero", City: "Ciudad de la Costa, Canelones",
		Status: domain.ShelterStatusApproved,
	}
	otro := &domain.Shelter{
		ID: uuid.New(), Name: "Refugio Norteño", City: "Tacuarembó",
		Status: domain.ShelterStatusApproved,
	}
	for _, s := range []*domain.Shelter{target, otro} {
		if err := shelterRepo.Create(ctx, s); err != nil {
			t.Fatalf("Create %q: %v", s.Name, err)
		}
	}

	encuentraElCostero := func(t *testing.T, query string) {
		t.Helper()
		got, err := shelterRepo.GetAll(ctx, query, nil)
		if err != nil {
			t.Fatalf("GetAll(%q): %v", query, err)
		}
		for _, s := range got {
			if s.ID == target.ID {
				return
			}
		}
		t.Errorf("GetAll(%q): no encontró el refugio guardado como %q", query, target.City)
	}

	// Cada uno de estos fallaba con el `=` exacto.
	encuentraElCostero(t, "ciudad de la costa") // todo en minúsculas
	encuentraElCostero(t, "CIUDAD DE LA COSTA") // todo en mayúsculas
	encuentraElCostero(t, "Ciudad de la Costa") // sin el ", Canelones" guardado
	encuentraElCostero(t, "Canelones")          // solo la parte de atrás
	encuentraElCostero(t, "costa canelones")    // términos sueltos, otro orden
	encuentraElCostero(t, "  costa  ")          // con espacios de sobra

	// Y sigue acotando: no puede devolver todo.
	got, err := shelterRepo.GetAll(ctx, "costa", nil)
	if err != nil {
		t.Fatalf("GetAll(costa): %v", err)
	}
	for _, s := range got {
		if s.ID == otro.ID {
			t.Errorf("GetAll(costa) devolvió %q, que está en %q", s.Name, s.City)
		}
	}
}
