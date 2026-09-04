package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// strayVistoHace persiste un callejero cuyo reloj de última vista quedó a la
// distancia pedida. Devuelve la mascota ya con el reloj estampado.
func strayVistoHace(t *testing.T, petRepo repository.PetRepository, reporterID uuid.UUID, nombre string, hace time.Duration) *domain.Pet {
	t.Helper()
	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: ptrUUID(reporterID),
		Name:       nombre,
		Type:       "perro",
		Status:     domain.PetStatusStray,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create %s: %v", nombre, err)
	}
	if err := petRepo.TouchLastReported(pet.ID.String(), time.Now().Add(-hace)); err != nil {
		t.Fatalf("TouchLastReported %s: %v", nombre, err)
	}
	return pet
}

func contiene(pets []domain.Pet, id uuid.UUID) bool {
	for _, p := range pets {
		if p.ID == id {
			return true
		}
	}
	return false
}

// El feed (Search sin filtro de estado) deja de mostrar un callejero que nadie
// vuelve a ver hace más del plazo. Es el sentido entero del issue #218.
//
// El test afirma LAS DOS MITADES a propósito. Con sólo la negativa, un filtro
// escrito de más —que se llevara puestos también los frescos— pasaría igual, y
// ese bug es peor que el que se está arreglando: apaga búsquedas activas.
func TestSearch_ElFeedNoMuestraCallejerosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	fresco := strayVistoHace(t, petRepo, reporter.ID, "Fresco", domain.StraySightingTTL-24*time.Hour)
	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+24*time.Hour)

	results, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}

	if !contiene(results, fresco.ID) {
		t.Error("el filtro se llevó puesto un callejero FRESCO: apaga búsquedas activas")
	}
	if contiene(results, vencido.ID) {
		t.Error("el feed sigue mostrando un callejero vencido")
	}
}

// Una mascota PERDIDA no caduca nunca, por vieja que sea. La caducidad es de
// avistamientos de callejeros: un `lost` tiene un dueño buscándolo, y apagarlo
// por antigüedad sería cerrarle la búsqueda a alguien que no la cerró.
func TestSearch_UnaPerdidaViejaNoCaduca(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:      uuid.New(),
		OwnerID: ptrUUID(owner.ID),
		Name:    "Luna",
		Type:    "perro",
		Status:  domain.PetStatusLost,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := petRepo.TouchLastReported(pet.ID.String(), time.Now().Add(-2*domain.StraySightingTTL)); err != nil {
		t.Fatalf("TouchLastReported: %v", err)
	}

	results, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !contiene(results, pet.ID) {
		t.Error("una mascota perdida caducó: la caducidad es sólo de avistamientos de callejeros")
	}
}

// La búsqueda EXPLÍCITA conserva los vencidos, y ésta es la mitad que justifica
// los 90 días: alguien que perdió su perro llega tres semanas tarde y busca qué
// callejeros se reportaron cerca en la fecha de la pérdida. Si la búsqueda
// también los apagara, el plazo largo no protegería nada.
func TestSearch_LaBusquedaExplicitaConservaLosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+24*time.Hour)

	results, _, err := petRepo.Search(domain.PetSearchCriteria{
		Statuses: []string{domain.PetStatusStray},
		Page:     1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search explícita: %v", err)
	}
	if !contiene(results, vencido.ID) {
		t.Error("la búsqueda explícita perdió un vencido: se rompe el cruce histórico que motiva los 90 días")
	}
}

// Un callejero sin NINGÚN reporte tiene el reloj en NULL, y el lector lo
// resuelve con COALESCE a pets.created_at. O sea que envejece desde su alta:
// tratarlo como "nunca vence" lo dejaría vivo para siempre, que es exactamente
// el bug del issue con otro disfraz.
func TestSearch_UnCallejeroSinReportesEnvejeceDesdeSuAlta(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: ptrUUID(reporter.ID),
		Name:       "SinReportes",
		Type:       "perro",
		Status:     domain.PetStatusStray,
		CreatedAt:  time.Now().Add(-(domain.StraySightingTTL + 24*time.Hour)),
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}

	results, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if contiene(results, pet.ID) {
		t.Error("un callejero sin reportes y viejo sigue en el feed: el NULL se está tratando como 'nunca vence'")
	}
}

// El mapa (FindNearby) demota igual que el feed. La regla es "el dato viejo es
// viejo en TODAS las superficies": que una mascota aparezca en una pantalla y no
// en otra es peor que cualquiera de las dos respuestas por separado, porque
// ninguna se ve mal sola.
func TestFindNearby_ElMapaNoMuestraCallejerosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	episodeRepo := repository.NewEpisodeRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	// Los dos con reporte en el mismo punto: lo único que los distingue es el reloj.
	conPin := func(nombre string, hace time.Duration) *domain.Pet {
		t.Helper()
		pet := strayVistoHace(t, petRepo, reporter.ID, nombre, hace)
		ep, err := episodeRepo.Open(pet.ID.String())
		if err != nil {
			t.Fatalf("Open episode %s: %v", nombre, err)
		}
		rep := &domain.Report{
			ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting",
			Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &ep.ID,
		}
		if err := reportRepo.Create(rep); err != nil {
			t.Fatalf("Create report %s: %v", nombre, err)
		}
		return pet
	}

	fresco := conPin("Fresco", domain.StraySightingTTL-24*time.Hour)
	vencido := conPin("Vencido", domain.StraySightingTTL+24*time.Hour)

	reports, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	tienePinDe := func(petID uuid.UUID) bool {
		for _, r := range reports {
			if r.PetID == petID {
				return true
			}
		}
		return false
	}
	if !tienePinDe(fresco.ID) {
		t.Error("el mapa perdió un callejero FRESCO")
	}
	if tienePinDe(vencido.ID) {
		t.Error("el mapa sigue mostrando el pin de un callejero vencido")
	}
}

// El perfil público de quien lo reportó también lo demota: es literalmente la
// queja que abre el issue #218, que el avistamiento queda "atribuido a una
// persona con nombre, indefinidamente".
//
// Y se afirma el ACUERDO entre la lista y el conteo, no cada uno por su lado: si
// el filtro entrara en una sola, la pantalla diría "N de M" contando M sobre
// otro conjunto, y ninguno de los dos números se vería mal solo.
func TestPerfilPublico_NoMuestraCallejerosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	fresco := strayVistoHace(t, petRepo, reporter.ID, "Fresco", domain.StraySightingTTL-24*time.Hour)
	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+24*time.Hour)

	lista, err := petRepo.FindPublicByUserID(reporter.ID.String())
	if err != nil {
		t.Fatalf("FindPublicByUserID: %v", err)
	}
	if !contiene(lista, fresco.ID) {
		t.Error("el perfil perdió un callejero FRESCO")
	}
	if contiene(lista, vencido.ID) {
		t.Error("el perfil sigue mostrando un callejero vencido")
	}

	total, err := petRepo.CountPublicByUserID(reporter.ID.String())
	if err != nil {
		t.Fatalf("CountPublicByUserID: %v", err)
	}
	if int(total) != len(lista) {
		t.Errorf("la lista y el conteo no coinciden: lista %d, total %d — el filtro entró en una sola",
			len(lista), total)
	}
}
