package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// stampedReport crea un reporte ya sellado con el episodio, como lo deja
// CreateReport en produccion.
func stampedReport(t *testing.T, reports repository.ReportRepository, petID, reporterID, episodeID uuid.UUID, status string) {
	t.Helper()
	r := mkReport(t, reports, petID, reporterID, status, "")
	if err := reports.SetEpisodeID(r.ID.String(), episodeID); err != nil {
		t.Fatalf("stamp episode: %v", err)
	}
}

func candidateIDs(cs []domain.HelperCandidate) map[uuid.UUID]bool {
	out := make(map[uuid.UUID]bool, len(cs))
	for _, c := range cs {
		out[c.ID] = true
	}
	return out
}

func TestHelperCreditRepository_FindCandidates(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	reports := repository.NewReportRepository(db)
	episodes := repository.NewEpisodeRepository(db)
	credits := repository.NewPetHelperCreditRepository(db)

	owner := newTestUser(t, users)
	helperA := newTestUser(t, users)
	helperB := newTestUser(t, users)
	oldHelper := newTestUser(t, users)

	pet := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
	oldEp, err := episodes.Open(pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	// Reporte de una busqueda anterior: no puede contar en la actual.
	stampedReport(t, reports, pet.ID, oldHelper.ID, oldEp.ID, "sighting")
	if err := episodes.CloseCurrent(pet.ID.String(), "found"); err != nil {
		t.Fatal(err)
	}
	ep, err := episodes.Open(pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}

	stampedReport(t, reports, pet.ID, owner.ID, ep.ID, "lost")       // el dueno: excluido
	stampedReport(t, reports, pet.ID, helperA.ID, ep.ID, "sighting") // incluido
	stampedReport(t, reports, pet.ID, helperA.ID, ep.ID, "found")    // mismo usuario, no duplica
	stampedReport(t, reports, pet.ID, helperB.ID, ep.ID, "found")    // cualquier estado cuenta

	got, err := credits.FindCandidates(pet.ID.String(), ep.ID)
	if err != nil {
		t.Fatal(err)
	}
	ids := candidateIDs(got)
	if len(got) != 2 || !ids[helperA.ID] || !ids[helperB.ID] {
		t.Fatalf("want exactly helperA and helperB (distinct), got %+v", got)
	}
	if ids[owner.ID] {
		t.Fatal("the owner must never be a candidate")
	}
	if ids[oldHelper.ID] {
		t.Fatal("a reporter of an older episode must not be a candidate of the current one")
	}

	// La busqueda anterior si devuelve a su propio reportante: el alcance es por episodio.
	prev, err := credits.FindCandidates(pet.ID.String(), oldEp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(prev) != 1 || prev[0].ID != oldHelper.ID {
		t.Fatalf("old episode should list only oldHelper, got %+v", prev)
	}
}

func TestHelperCreditRepository_FindCandidates_StrayExcludesItsReporter(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	reports := repository.NewReportRepository(db)
	episodes := repository.NewEpisodeRepository(db)
	credits := repository.NewPetHelperCreditRepository(db)

	reporter := newTestUser(t, users)
	other := newTestUser(t, users)

	// Un callejero tiene owner_id NULL: sin IS DISTINCT FROM, `owner_id <> x`
	// daria NULL y la consulta descartaria a TODOS, incluido el otro ayudante.
	stray := mkPet(t, pets, nil, ptrUUID(reporter.ID), domain.PetStatusStray)
	ep, err := episodes.Open(stray.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	stampedReport(t, reports, stray.ID, reporter.ID, ep.ID, "sighting")
	stampedReport(t, reports, stray.ID, other.ID, ep.ID, "sighting")

	got, err := credits.FindCandidates(stray.ID.String(), ep.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != other.ID {
		t.Fatalf("stray: want only the other reporter, got %+v", got)
	}
}

func TestHelperCreditRepository_InsertCredits_OnlyNewOnesAndOncePerPet(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	episodes := repository.NewEpisodeRepository(db)
	credits := repository.NewPetHelperCreditRepository(db)

	owner := newTestUser(t, users)
	helper := newTestUser(t, users)
	helper2 := newTestUser(t, users)
	pet := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
	ep1, err := episodes.Open(pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	if err := episodes.CloseCurrent(pet.ID.String(), "found"); err != nil {
		t.Fatal(err)
	}
	ep2, err := episodes.Open(pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}

	mk := func(ep uuid.UUID, h uuid.UUID) domain.PetHelperCredit {
		e := ep
		return domain.PetHelperCredit{PetID: pet.ID, EpisodeID: &e, HelperUserID: h, CreditedBy: owner.ID}
	}

	first, err := credits.InsertCredits([]domain.PetHelperCredit{mk(ep1.ID, helper.ID)})
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0] != helper.ID {
		t.Fatalf("first insert: want [helper], got %v", first)
	}

	// Segunda busqueda de la MISMA mascota: helper ya cobro, helper2 es nuevo.
	second, err := credits.InsertCredits([]domain.PetHelperCredit{mk(ep2.ID, helper.ID), mk(ep2.ID, helper2.ID)})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0] != helper2.ID {
		t.Fatalf("second insert must return only the newly credited helper2, got %v", second)
	}

	n, err := credits.CountByHelper(helper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("helper credited twice for the same pet must count 1, got %d", n)
	}
}

func TestHelperCreditRepository_CountByHelper_DistinctPets(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	episodes := repository.NewEpisodeRepository(db)
	credits := repository.NewPetHelperCreditRepository(db)

	owner := newTestUser(t, users)
	helper := newTestUser(t, users)
	other := newTestUser(t, users)

	for i := 0; i < 3; i++ {
		p := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
		ep, err := episodes.Open(p.ID.String())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := credits.InsertCredits([]domain.PetHelperCredit{{PetID: p.ID, EpisodeID: &ep.ID, HelperUserID: helper.ID, CreditedBy: owner.ID}}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := credits.CountByHelper(helper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 3 {
		t.Fatalf("helper: want 3 distinct pets, got %d", got)
	}
	got, err = credits.CountByHelper(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("someone never credited: want 0, got %d", got)
	}
}

// Las FK las agrega la migracion 000028 (AutoMigrate solo pone la tabla y los
// indices). Borrar la mascota tiene que llevarse sus creditos: si la FK faltara,
// la fila quedaria huerfana y seguiria contando en found_count.
func TestHelperCreditRepository_DeletingThePetCascadesItsCredits(t *testing.T) {
	db := testdb.SetupTestDB(t)
	users := repository.NewUserRepository(db)
	pets := repository.NewPetRepository(db)
	episodes := repository.NewEpisodeRepository(db)
	credits := repository.NewPetHelperCreditRepository(db)

	owner := newTestUser(t, users)
	helper := newTestUser(t, users)
	p := mkPet(t, pets, ptrUUID(owner.ID), nil, domain.PetStatusLost)
	ep, err := episodes.Open(p.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := credits.InsertCredits([]domain.PetHelperCredit{{PetID: p.ID, EpisodeID: &ep.ID, HelperUserID: helper.ID, CreditedBy: owner.ID}}); err != nil {
		t.Fatal(err)
	}
	if err := pets.Delete(p.ID.String()); err != nil {
		t.Fatal(err)
	}
	got, err := credits.CountByHelper(helper.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("credits must go with the pet (FK ON DELETE CASCADE), got %d", got)
	}
}
