package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// occurred_at is optional: most reports never set it. The search date range
// must read the sighting time the app shows everywhere else,
// COALESCE(occurred_at, created_at), the same rule FindNearby uses. Comparing
// the bare column drops every report without a date, so a date search loses
// almost every pet.

type dateFilterFixture struct {
	petRepo    repository.PetRepository
	reportRepo repository.ReportRepository
	owner      *domain.User
}

func newDateFilterFixture(t *testing.T) dateFilterFixture {
	t.Helper()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	return dateFilterFixture{
		petRepo:    repository.NewPetRepository(db),
		reportRepo: repository.NewReportRepository(db),
		owner:      newTestUser(t, userRepo),
	}
}

// lostPetReportedNow creates a lost pet with one report filed now, with the
// given occurred_at (nil = the user did not enter a date).
func (f dateFilterFixture) lostPetReportedNow(t *testing.T, name string, occurredAt *time.Time) *domain.Pet {
	t.Helper()
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(f.owner.ID), Name: name, Type: "perro", Status: domain.PetStatusLost}
	if err := f.petRepo.Create(pet); err != nil {
		t.Fatalf("Create %s: %v", name, err)
	}
	rep := &domain.Report{
		ID: uuid.New(), PetID: pet.ID, ReporterID: f.owner.ID, Status: "lost",
		Latitude: mvdLat, Longitude: mvdLng, OccurredAt: occurredAt,
	}
	if err := f.reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report %s: %v", name, err)
	}
	return pet
}

func (f dateFilterFixture) search(t *testing.T, from, to *time.Time) []domain.Pet {
	t.Helper()
	results, _, err := f.petRepo.Search(domain.PetSearchCriteria{From: from, To: to, Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	return results
}

func TestSearch_FromKeepsReportsWithoutOccurredAt(t *testing.T) {
	f := newDateFilterFixture(t)
	pet := f.lostPetReportedNow(t, "SinFecha", nil)

	from := time.Now().Add(-time.Hour)
	if !contiene(f.search(t, &from, nil), pet.ID) {
		t.Error("a report filed now with no occurred_at must match from=1h ago")
	}
}

func TestSearch_ToKeepsReportsWithoutOccurredAt(t *testing.T) {
	f := newDateFilterFixture(t)
	pet := f.lostPetReportedNow(t, "SinFecha", nil)

	to := time.Now().Add(time.Hour)
	if !contiene(f.search(t, nil, &to), pet.ID) {
		t.Error("a report filed now with no occurred_at must match to=1h ahead")
	}
}

// Existing behavior that must hold: when the user did enter a date, that date
// is the sighting time, not when the report was filed.
func TestSearch_OccurredAtStillWinsOverCreatedAt(t *testing.T) {
	f := newDateFilterFixture(t)
	seen := time.Now().Add(-10 * 24 * time.Hour)
	pet := f.lostPetReportedNow(t, "ConFecha", &seen)

	recent := time.Now().Add(-2 * 24 * time.Hour)
	if contiene(f.search(t, &recent, nil), pet.ID) {
		t.Error("a sighting dated 10 days ago must not match from=2 days ago, even if filed now")
	}
	around := seen.Add(-time.Hour)
	beforeFiling := seen.Add(time.Hour)
	if !contiene(f.search(t, &around, &beforeFiling), pet.ID) {
		t.Error("a sighting dated 10 days ago must match a range around that date")
	}
	// The upper bound reads the same time: filed now, but seen 10 days ago, so
	// to=2 days ago keeps it. Comparing created_at would drop it.
	if !contiene(f.search(t, nil, &recent), pet.ID) {
		t.Error("a sighting dated 10 days ago must match to=2 days ago, even if filed now")
	}
}
