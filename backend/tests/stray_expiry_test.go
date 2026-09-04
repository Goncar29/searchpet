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

// Elegir "Callejera" en el desplegable de la HOME no es buscar en el pasado: es
// el feed con un filtro. Los vencidos NO tienen que reaparecer ahí.
//
// Esta era la premisa que sostenía el diseño y era FALSA. La escotilla estaba
// atada a "vino un parámetro de estado", que mide otra cosa: HomePage ofrece
// `stray` en su desplegable, así que un click desde la portada devolvía todos
// los vencidos mezclados con los frescos y sin ningún cartel — o sea la queja
// del #218 servida en la superficie que el PR decía proteger.
func TestSearch_ElDesplegableDeLaHomeNoResucitaLosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	fresco := strayVistoHace(t, petRepo, reporter.ID, "Fresco", domain.StraySightingTTL-24*time.Hour)
	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+24*time.Hour)

	results, _, err := petRepo.Search(domain.PetSearchCriteria{
		Statuses: []string{domain.PetStatusStray},
		Page:     1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !contiene(results, fresco.ID) {
		t.Error("el filtro se llevó puesto un callejero FRESCO")
	}
	if contiene(results, vencido.ID) {
		t.Error("filtrar por callejera desde la home resucitó los vencidos")
	}
}

// Preguntar por una VENTANA DEL PASADO sí conserva los vencidos, y ésta es la
// mitad que justifica los 90 días: alguien perdió su perro el 1 de abril, entra
// en agosto y pide qué callejeros se reportaron esa semana. Todos están
// vencidos por definición — si el rango no los devolviera, el plazo largo no
// protegería absolutamente nada.
//
// La escotilla va atada al rango de fechas y no al estado porque es el rango el
// que expresa "estoy mirando hacia atrás". El estado sólo dice qué tipo de
// mascota, y se puede elegir desde el feed.
func TestSearch_UnRangoDeFechasConservaLosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+30*24*time.Hour)

	visto := time.Now().Add(-(domain.StraySightingTTL + 30*24*time.Hour))
	rep := &domain.Report{
		ID: uuid.New(), PetID: vencido.ID, ReporterID: reporter.ID, Status: "sighting",
		Latitude: mvdLat, Longitude: mvdLng, OccurredAt: &visto,
	}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	desde := visto.Add(-48 * time.Hour)
	hasta := visto.Add(48 * time.Hour)
	results, _, err := petRepo.Search(domain.PetSearchCriteria{
		From: &desde, To: &hasta,
		Page: 1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search con rango: %v", err)
	}
	if !contiene(results, vencido.ID) {
		t.Error("el rango de fechas no devolvió el vencido: se rompe el cruce histórico que motiva los 90 días")
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

// El mapa también levanta la caducidad con un rango de fechas. Es el mismo
// cruce histórico que en Search, sólo que dibujado: alguien pide "qué se vio
// cerca de mi casa la semana que se me escapó", y todo lo que busca está
// vencido por definición.
//
// Aplicarlo incondicional hacía que ese filtro devolviera vacío, y un mapa
// vacío se lee como "nadie vio nada" — una mentira peor que el pin viejo que se
// quería sacar.
func TestFindNearby_UnRangoDeFechasConservaLosVencidos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	episodeRepo := repository.NewEpisodeRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	vencido := strayVistoHace(t, petRepo, reporter.ID, "Vencido", domain.StraySightingTTL+30*24*time.Hour)
	ep, err := episodeRepo.Open(vencido.ID.String())
	if err != nil {
		t.Fatalf("Open episode: %v", err)
	}

	visto := time.Now().Add(-(domain.StraySightingTTL + 30*24*time.Hour))
	rep := &domain.Report{
		ID: uuid.New(), PetID: vencido.ID, ReporterID: reporter.ID, Status: "sighting",
		Latitude: mvdLat, Longitude: mvdLng, OccurredAt: &visto, EpisodeID: &ep.ID,
	}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	desde := visto.Add(-48 * time.Hour)
	hasta := visto.Add(48 * time.Hour)

	// Sin rango: el mapa lo demota.
	sinRango, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
	})
	if err != nil {
		t.Fatalf("FindNearby sin rango: %v", err)
	}
	for _, r := range sinRango {
		if r.PetID == vencido.ID {
			t.Error("el mapa sin rango sigue mostrando un vencido")
		}
	}

	// Con rango: lo devuelve, porque preguntar por el pasado es el cruce.
	conRango, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000, From: &desde, To: &hasta,
	})
	if err != nil {
		t.Fatalf("FindNearby con rango: %v", err)
	}
	encontrado := false
	for _, r := range conRango {
		if r.PetID == vencido.ID {
			encontrado = true
		}
	}
	if !encontrado {
		t.Error("el rango de fechas del mapa devolvió vacío: se lee como 'nadie vio nada' en vez de 'lo escondimos'")
	}
}

// `to` sin `from` NO es preguntar por el pasado: no pone piso, así que la
// ventana llega hasta el origen de los tiempos. La escotilla miraba "vino un
// rango" (`From == nil && To == nil`) y por eso se levantaba igual, devolviendo
// el histórico vencido ENTERO en la superficie que este filtro existe para
// proteger. Y es alcanzable desde la portada: HomePage manda `from` y `to` por
// separado, con dos inputs independientes, así que llenar sólo "Hasta" lo
// dispara.
//
// Lo que expresa "estoy mirando hacia atrás" es la COTA INFERIOR, no que exista
// un rango. Con `from` puesto el propio filtro de fechas ya hace el trabajo: si
// es reciente, los reportes de un vencido quedan fuera solos; si es antiguo, es
// un cruce histórico legítimo. Por eso la guarda mira `From` y nada más.
//
// Se afirman LAS DOS FORMAS a propósito. Con sólo la negativa, una guarda
// escrita de más —que aplicara la caducidad ante cualquier rango— pasaría verde
// y rompería el cruce histórico, que es el bug peor de los dos.
func TestSearch_UnRangoSinCotaInferiorNoLevantaLaCaducidad(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	// Los dos con reporte: sin uno, el JOIN por fechas los dejaría fuera a los
	// dos y el test pasaría sin haber medido la caducidad.
	conReporte := func(nombre string, hace time.Duration) *domain.Pet {
		t.Helper()
		pet := strayVistoHace(t, petRepo, reporter.ID, nombre, hace)
		visto := time.Now().Add(-hace)
		rep := &domain.Report{
			ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting",
			Latitude: mvdLat, Longitude: mvdLng, OccurredAt: &visto,
		}
		if err := reportRepo.Create(rep); err != nil {
			t.Fatalf("Create report %s: %v", nombre, err)
		}
		return pet
	}

	fresco := conReporte("Fresco", 24*time.Hour)
	vencido := conReporte("Vencido", domain.StraySightingTTL+30*24*time.Hour)

	// Sólo `to`: es el feed con techo, no un cruce histórico. Demota.
	ahora := time.Now()
	soloHasta, _, err := petRepo.Search(domain.PetSearchCriteria{
		To:   &ahora,
		Page: 1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search sólo con `to`: %v", err)
	}
	if !contiene(soloHasta, fresco.ID) {
		t.Error("`to` solo se llevó puesto un callejero FRESCO")
	}
	if contiene(soloHasta, vencido.ID) {
		t.Error("`to` sin `from` levantó la caducidad: la ventana no tiene piso, así que devuelve el histórico vencido entero")
	}

	// Sólo `from`: hay cota inferior, o sea que sí se está mirando hacia atrás.
	desde := time.Now().Add(-(domain.StraySightingTTL + 60*24*time.Hour))
	soloDesde, _, err := petRepo.Search(domain.PetSearchCriteria{
		From: &desde,
		Page: 1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Search sólo con `from`: %v", err)
	}
	if !contiene(soloDesde, vencido.ID) {
		t.Error("`from` solo no devolvió el vencido: se rompe el cruce histórico que motiva los 90 días")
	}
}

// El mapa tiene el mismo agujero y se cierra con la misma condición: una sola
// regla para las dos consultas, no dos criterios que se puedan desincronizar.
func TestFindNearby_UnRangoSinCotaInferiorNoLevantaLaCaducidad(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	episodeRepo := repository.NewEpisodeRepository(gormDB)
	reporter := newTestUser(t, userRepo)

	conPin := func(nombre string, hace time.Duration) *domain.Pet {
		t.Helper()
		pet := strayVistoHace(t, petRepo, reporter.ID, nombre, hace)
		ep, err := episodeRepo.Open(pet.ID.String())
		if err != nil {
			t.Fatalf("Open episode %s: %v", nombre, err)
		}
		visto := time.Now().Add(-hace)
		rep := &domain.Report{
			ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting",
			Latitude: mvdLat, Longitude: mvdLng, OccurredAt: &visto, EpisodeID: &ep.ID,
		}
		if err := reportRepo.Create(rep); err != nil {
			t.Fatalf("Create report %s: %v", nombre, err)
		}
		return pet
	}

	fresco := conPin("Fresco", 24*time.Hour)
	vencido := conPin("Vencido", domain.StraySightingTTL+30*24*time.Hour)

	tienePinDe := func(reports []domain.Report, petID uuid.UUID) bool {
		for _, r := range reports {
			if r.PetID == petID {
				return true
			}
		}
		return false
	}

	ahora := time.Now()
	soloHasta, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000, To: &ahora,
	})
	if err != nil {
		t.Fatalf("FindNearby sólo con `to`: %v", err)
	}
	if !tienePinDe(soloHasta, fresco.ID) {
		t.Error("`to` solo se llevó puesto el pin de un callejero FRESCO")
	}
	if tienePinDe(soloHasta, vencido.ID) {
		t.Error("`to` sin `from` levantó la caducidad en el mapa: la ventana no tiene piso")
	}

	desde := time.Now().Add(-(domain.StraySightingTTL + 60*24*time.Hour))
	soloDesde, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000, From: &desde,
	})
	if err != nil {
		t.Fatalf("FindNearby sólo con `from`: %v", err)
	}
	if !tienePinDe(soloDesde, vencido.ID) {
		t.Error("`from` solo no devolvió el pin del vencido: se rompe el cruce histórico en el mapa")
	}
}
