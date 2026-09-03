package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// La búsqueda con filtro geográfico hace JOIN a reports y deduplica con un
// SELECT DISTINCT. Hasta el commit que trajo este test, ese DISTINCT enumeraba
// las columnas A MANO y la lista ya había divergido: toda columna ausente volvía
// EN CERO, sin error y sin ninguna señal, porque el struct se llena igual con el
// valor vacío del tipo. Es la falla más traicionera posible para una columna
// nueva, porque el camino SIN geo la devuelve perfecta.
//
// Hoy el código usa `pets.*`, así que no hay lista que se pueda olvidar. Este
// test NO guarda esa lista —no existe— sino el ACUERDO entre los dos caminos de
// Search, que es la propiedad que la lista rompía y la que cualquier reemplazo
// futuro tiene que seguir cumpliendo.
//
// LO QUE ESTE TEST NO HACE, para que nadie se apoye en algo que no sostiene:
// sólo afirma sobre `last_reported_at`. Si mañana alguien vuelve a enumerar
// columnas y omite una distinta, acá NO se pone rojo. Cubrir esa clase entera
// necesitaría comparar los dos structs completos, y eso todavía no está escrito.
func TestPetRepository_Search_GeoNoPierdeColumnas(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test — requires PostGIS")
	}
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:      uuid.New(),
		OwnerID: ptrUUID(owner.ID),
		Name:    "Perdido",
		Type:    "perro",
		Status:  domain.PetStatusLost,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	visto := time.Now().Add(-3 * 24 * time.Hour).UTC().Truncate(time.Second)
	if err := petRepo.TouchLastReported(pet.ID.String(), visto); err != nil {
		t.Fatalf("TouchLastReported: %v", err)
	}

	rep := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	// Camino SIN geo: no hay JOIN, no hay DISTINCT, vuelven todas las columnas.
	sinGeo, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search sin geo: %v", err)
	}
	if len(sinGeo) != 1 || sinGeo[0].LastReportedAt == nil {
		t.Fatalf("precondición rota: el camino sin geo ya perdía el dato (%d resultados)", len(sinGeo))
	}

	// Camino CON geo: JOIN + DISTINCT con lista explícita de columnas.
	lat, lng, radius := mvdLat, mvdLng, 1000.0
	conGeo, _, err := petRepo.Search(domain.PetSearchCriteria{
		Lat: &lat, Lng: &lng, RadiusMeters: &radius, Page: 1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search con geo: %v", err)
	}
	if len(conGeo) != 1 {
		t.Fatalf("want 1 resultado con geo, got %d", len(conGeo))
	}
	if conGeo[0].LastReportedAt == nil {
		t.Fatal("la búsqueda con geo perdió last_reported_at: falta en la lista de columnas del DISTINCT")
	}
	if !conGeo[0].LastReportedAt.UTC().Truncate(time.Second).Equal(visto) {
		t.Errorf("los dos caminos no coinciden: sin geo %v, con geo %v",
			visto, conGeo[0].LastReportedAt.UTC())
	}
}
