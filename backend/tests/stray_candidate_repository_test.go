package tests

import (
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// desplazar mueve una latitud `metros` hacia el norte de Montevideo (mvdLat),
// usando la aproximación estándar 1 grado ≈ 111.320 m — el valor ECUATORIAL.
// A esta latitud (−34,9°) el metro real por grado es ~0,35% más CORTO, porque
// la Tierra es un esferoide y ST_Distance mide contra él, no contra esta
// aproximación plana: medido contra la base real, desplazar(950) pide 950 m
// pero ST_Distance mide 946,7 m.
//
// Para fixtures muy por debajo o muy por encima del límite que se está
// probando (la vieja pareja 300/5000 contra un radio de 1000) ese sesgo no
// importaba. Pero un test que deriva sus fixtures del propio radio
// (`radio*0.9`, `radio*1.1`, ver TestStrayCandidates_ElRadioCorta) SÍ necesita
// el margen medido: a ±10% del radio, el 0,35% de sesgo queda cómodamente dentro
// sin cruzar el corte real.
func desplazar(metros float64) float64 {
	return mvdLat + metros/111320.0
}

// sembrarStray persiste un callejero con UN reporte en (lat, lng): el reloj de
// última vista de la mascota (LastReportedAt) y el OccurredAt del reporte
// apuntan al mismo `lastSeen`, igual que hace el resto de la suite de
// caducidad (ver strayVistoHace en stray_expiry_test.go, que usa
// TouchLastReported en vez de setear el campo directo — acá se setea directo
// porque además hace falta controlar el punto geográfico del reporte).
func sembrarStray(t *testing.T, db *gorm.DB, nombre, tipo string, lat, lng float64, lastSeen time.Time) uuid.UUID {
	t.Helper()
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)

	reporter := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:             uuid.New(),
		ReporterID:     ptrUUID(reporter.ID),
		Name:           nombre,
		Type:           tipo,
		Status:         domain.PetStatusStray,
		LastReportedAt: &lastSeen,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("sembrarStray Create pet %s: %v", nombre, err)
	}

	rep := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: reporter.ID,
		Status:     "sighting",
		Latitude:   lat,
		Longitude:  lng,
		OccurredAt: &lastSeen,
	}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("sembrarStray Create report %s: %v", nombre, err)
	}

	return pet.ID
}

// agregarReporte suma un reporte ADICIONAL a una mascota ya sembrada, en un
// punto distinto — para las pruebas que necesitan varios reportes por
// mascota (el reporte más cercano tiene que ganar, y la mascota no se puede
// repetir). El reportante es un usuario nuevo: el reporte no necesita venir
// de quien reportó originalmente la mascota.
func agregarReporte(t *testing.T, db *gorm.DB, petID uuid.UUID, lat, lng float64) {
	t.Helper()
	userRepo := repository.NewUserRepository(db)
	reportRepo := repository.NewReportRepository(db)
	reporter := newTestUser(t, userRepo)

	rep := &domain.Report{
		ID:         uuid.New(),
		PetID:      petID,
		ReporterID: reporter.ID,
		Status:     "sighting",
		Latitude:   lat,
		Longitude:  lng,
	}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("agregarReporte: %v", err)
	}
}

// contieneCandidato — homónimo de `contiene` (definido en stray_expiry_test.go
// sobre []domain.Pet) pero para []domain.StrayCandidate. No puede llamarse
// igual: Go no sobrecarga por tipo de parámetro.
func contieneCandidato(cands []domain.StrayCandidate, id uuid.UUID) bool {
	for _, c := range cands {
		if c.PetID == id {
			return true
		}
	}
	return false
}

// El test central: FindStrayCandidates DEBE devolver un avistamiento que el
// feed ya esconde por vencido, y Search DEBE seguir escondiéndolo — las DOS
// mitades sobre LA MISMA fila sembrada, no dos mascotas distintas.
//
// Con sólo la primera mitad, un cambio que apagara la caducidad en TODO el
// proyecto (por ejemplo, borrar la llamada a straySightingNotExpired dentro de
// Search) pasaría en verde: lo que este test prueba no es "la consulta nueva
// encuentra algo", es el DESACUERDO deliberado entre las dos consultas sobre
// la misma fila. Sin la segunda mitad, esta consulta podría terminar
// aplicándose por error a las demás superficies y nadie se enteraría acá.
func TestStrayCandidates_DevuelveLoVencidoQueElFeedEsconde(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-(domain.StraySightingTTL + 30*24*time.Hour))
	id := sembrarStray(t, gormDB, "Vencido", "perro", desplazar(300), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contieneCandidato(cands, id) {
		t.Error("FindStrayCandidates NO devolvió un avistamiento vencido: se supone que ésta es la ÚNICA consulta que lo hace")
	}

	// La otra mitad, sobre la MISMA fila: el feed lo sigue escondiendo.
	pets, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if contiene(pets, id) {
		t.Error("el feed dejó de esconder el vencido: FindStrayCandidates y Search tienen que DESACORDAR sobre esta fila")
	}
}

// Un avistamiento vivo aparece en las dos: FindStrayCandidates no filtra
// "sólo lo vencido", filtra "lo cercano", sin importar la edad.
func TestStrayCandidates_UnAvistamientoVivoApareceEnLasDos(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	id := sembrarStray(t, gormDB, "Fresco", "perro", desplazar(300), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contieneCandidato(cands, id) {
		t.Error("un avistamiento vivo no apareció como candidato")
	}

	pets, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !contiene(pets, id) {
		t.Error("un avistamiento vivo desapareció del feed")
	}
}

// El radio corta en domain.StrayCandidateRadiusMeters: uno adentro aparece,
// uno afuera no.
//
// Los dos puntos se derivan del PROPIO valor de la constante (±10%), no de
// números sueltos: con 300m/5000m hardcodeados contra un radio de 1000m,
// cambiar StrayCandidateRadiusMeters a cualquier cosa entre ~350 y ~4900
// dejaba este test en verde sin que hubiera medido nada — el fixture no
// seguía a lo que se supone que protege. Ver el comentario de desplazar
// sobre por qué ±10% es un margen seguro contra su propio sesgo de ~0,35%.
func TestStrayCandidates_ElRadioCorta(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	cerca := sembrarStray(t, gormDB, "Cerca", "perro", desplazar(domain.StrayCandidateRadiusMeters*0.9), mvdLng, lastSeen)
	lejos := sembrarStray(t, gormDB, "Lejos", "perro", desplazar(domain.StrayCandidateRadiusMeters*1.1), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contieneCandidato(cands, cerca) {
		t.Error("el que está al 90% del radio (adentro) no apareció")
	}
	if contieneCandidato(cands, lejos) {
		t.Error("el que está al 110% del radio (afuera) apareció igual")
	}
}

// El tipo acota: pedir "perro" no devuelve al gato sembrado en el mismo
// punto, PERO no pedir ningún tipo (PetType vacío) sí lo devuelve — es la
// mitad positiva del contrato documentado en stray_candidate.go ("Vacío =
// sin filtro"), y sin ella un PetType que sólo pudiera RESTRINGIR (nunca
// dejar pasar todo) pasaría este test igual.
func TestStrayCandidates_ElTipoAcota(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	perro := sembrarStray(t, gormDB, "Firulais", "perro", desplazar(300), mvdLng, lastSeen)
	gato := sembrarStray(t, gormDB, "Michi", "gato", desplazar(300), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{
		Lat: mvdLat, Lng: mvdLng, PetType: "perro",
	})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contieneCandidato(cands, perro) {
		t.Error("el perro no apareció filtrando por tipo perro")
	}
	if contieneCandidato(cands, gato) {
		t.Error("el gato apareció filtrando por tipo perro")
	}

	sinFiltro, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates sin tipo: %v", err)
	}
	if !contieneCandidato(sinFiltro, gato) {
		t.Error("PetType vacío se llevó puesto al gato: el contrato documentado dice 'vacío = sin filtro'")
	}
}

// Una mascota PERDIDA (lost) tiene un dueño buscándola: ofrecerla como
// candidato invitaría a reportar sobre la búsqueda de otra persona.
func TestStrayCandidates_NoDevuelveMascotasPerdidas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	id := sembrarStray(t, gormDB, "Perdido", "perro", desplazar(300), mvdLng, lastSeen)

	if err := gormDB.Model(&domain.Pet{}).Where("id = ?", id).Update("status", domain.PetStatusLost).Error; err != nil {
		t.Fatalf("actualizar a lost: %v", err)
	}

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if contieneCandidato(cands, id) {
		t.Error("una mascota PERDIDA (lost) apareció como candidato de callejero")
	}
}

// La distancia y la última vista llegan resueltas: la UI no tiene que elegir.
//
// LastSeenAt se afirma contra el VALOR sembrado (±1s), no sólo contra
// "no está en cero": `IsZero()` pasa igual contra el COALESCE correcto,
// contra `created_at` solo, o contra `last_reported_at` solo — porque acá
// ninguno de los dos es cero. La afirmación de valor es la única que
// distingue las tres.
func TestStrayCandidates_TraeDistanciaYUltimaVista(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	id := sembrarStray(t, gormDB, "Conreloj", "perro", desplazar(300), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}

	var encontrado *domain.StrayCandidate
	for i := range cands {
		if cands[i].PetID == id {
			encontrado = &cands[i]
		}
	}
	if encontrado == nil {
		t.Fatalf("no se encontró el candidato sembrado")
	}
	if encontrado.DistanceMeters < 250 || encontrado.DistanceMeters > 350 {
		t.Errorf("DistanceMeters fuera de rango: %v (esperado ~300)", encontrado.DistanceMeters)
	}
	if diff := encontrado.LastSeenAt.Sub(lastSeen); diff < -time.Second || diff > time.Second {
		t.Errorf("LastSeenAt = %v, esperado ~%v (el lastSeen sembrado)", encontrado.LastSeenAt, lastSeen)
	}
}

// El caso que el COALESCE(last_reported_at, created_at) existe para
// resolver: un callejero SIN NINGÚN reloj de última vista propio
// (LastReportedAt nil). El fallback tiene que caer en CreatedAt — y el test
// de arriba no lo cubre, porque sembrarStray siempre estampa LastReportedAt.
func TestStrayCandidates_SinUltimaVistaCaeEnCreatedAt(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)
	userRepo := repository.NewUserRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	lat, lng := desplazar(300), mvdLng

	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: ptrUUID(reporter.ID),
		Name:       "SinUltimaVista",
		Type:       "perro",
		Status:     domain.PetStatusStray,
		// LastReportedAt queda nil A PROPÓSITO: es el caso que resuelve el
		// COALESCE de la consulta.
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	rep := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: reporter.ID,
		Status:     "sighting",
		Latitude:   lat,
		Longitude:  lng,
	}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}

	var encontrado *domain.StrayCandidate
	for i := range cands {
		if cands[i].PetID == pet.ID {
			encontrado = &cands[i]
		}
	}
	if encontrado == nil {
		t.Fatalf("no se encontró el candidato sembrado")
	}
	if diff := encontrado.LastSeenAt.Sub(pet.CreatedAt); diff < -time.Second || diff > time.Second {
		t.Errorf("LastSeenAt = %v, esperado ~CreatedAt (%v): el COALESCE no está cayendo en created_at", encontrado.LastSeenAt, pet.CreatedAt)
	}
}

// El reporte más cercano gana, y la mascota no se repite: DISTINCT ON
// (pets.id) más un ORDER BY interno que arranca por distancia (además de
// pets.id, que Postgres exige primero para DISTINCT ON) son lo que lo
// garantiza. Sin DISTINCT ON esto devuelve TRES filas; con el ORDER BY
// interno mal armado, Postgres puede quedarse con cualquiera de los tres
// reportes, no necesariamente el más cercano — y ningún otro test de este
// archivo siembra más de un reporte por mascota, así que hasta ahora esto
// no tenía cobertura.
func TestStrayCandidates_UnaMascotaConVariosReportesNoSeRepite(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	id := sembrarStray(t, gormDB, "Multireportado", "perro", desplazar(800), mvdLng, lastSeen)
	agregarReporte(t, gormDB, id, desplazar(400), mvdLng)
	agregarReporte(t, gormDB, id, desplazar(100), mvdLng)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}

	var vistos int
	var encontrado *domain.StrayCandidate
	for i := range cands {
		if cands[i].PetID == id {
			vistos++
			encontrado = &cands[i]
		}
	}
	if vistos != 1 {
		t.Fatalf("la mascota con 3 reportes apareció %d veces, se esperaba 1 (DISTINCT ON no está funcionando)", vistos)
	}
	if encontrado.DistanceMeters < 50 || encontrado.DistanceMeters > 150 {
		t.Errorf("DistanceMeters = %v, esperado ~100 (el reporte MÁS CERCANO de los tres): se está quedando con otro reporte", encontrado.DistanceMeters)
	}
}

// El Limit tiene que aplicarse en la consulta EXTERNA, después de reordenar
// por distancia. Aplicado en la interna (antes de que DISTINCT ON reordene)
// cortaría por el orden arbitrario que exige DISTINCT ON (pets.id primero) y
// podría dejar afuera a los MÁS cercanos en vez de a los más lejanos — un bug
// que ningún test anterior podía ver porque ninguno sembraba más candidatos
// que el tope.
func TestStrayCandidates_DevuelveLosMasCercanosYNoMasDeLTope(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	n := domain.StrayCandidateLimit + 2
	ids := make([]uuid.UUID, n)
	// Todos bien adentro del radio (el más lejano queda a 600m contra un
	// radio de 1000m), separados 50m entre sí para que el orden sea nítido.
	for i := 0; i < n; i++ {
		dist := float64(50 * (i + 1))
		ids[i] = sembrarStray(t, gormDB, fmt.Sprintf("Candidato%d", i), "perro", desplazar(dist), mvdLng, lastSeen)
	}

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}

	if len(cands) != domain.StrayCandidateLimit {
		t.Fatalf("len(cands) = %d, esperado %d (el Limit)", len(cands), domain.StrayCandidateLimit)
	}

	for i := 1; i < len(cands); i++ {
		if cands[i].DistanceMeters < cands[i-1].DistanceMeters {
			t.Fatalf("no está ordenado ascendente por distancia: cands[%d]=%v < cands[%d]=%v",
				i, cands[i].DistanceMeters, i-1, cands[i-1].DistanceMeters)
		}
	}

	masLejano := ids[n-1]
	if contieneCandidato(cands, masLejano) {
		t.Error("el más lejano de los sembrados apareció: el Limit se está aplicando en la consulta INTERNA, antes de reordenar por distancia, no en la externa")
	}
}

// Lat/Lng se embeben con fmt.Sprintf("%g", ...) como literal numérico en la
// expresión de distancia — no hay riesgo de INYECCIÓN (el tipo no es texto
// controlado por el usuario), pero "%g" de NaN/+Inf/-Inf imprime
// literalmente "NaN"/"+Inf"/"-Inf", que Postgres interpreta como un
// IDENTIFICADOR de columna suelto y devuelve un 500 (`column "nan" does not
// exist`) en vez de un 400. Y strconv.ParseFloat("NaN", 64) tiene éxito, así
// que un handler futuro que parsee `?lat=NaN` sin chequeo de finitud se lo
// pasa derecho a esta consulta. La guarda vive en el repositorio, no en un
// llamador que todavía no existe.
func TestStrayCandidates_RechazaCoordenadasNoFinitas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	casos := map[string]domain.StrayCandidateCriteria{
		"NaN en Lat":  {Lat: math.NaN(), Lng: mvdLng},
		"NaN en Lng":  {Lat: mvdLat, Lng: math.NaN()},
		"+Inf en Lat": {Lat: math.Inf(1), Lng: mvdLng},
		"-Inf en Lng": {Lat: mvdLat, Lng: math.Inf(-1)},
	}
	for nombre, c := range casos {
		c := c
		t.Run(nombre, func(t *testing.T) {
			_, err := petRepo.FindStrayCandidates(c)
			if !errors.Is(err, domain.ErrInvalidInput) {
				t.Errorf("err = %v, esperado domain.ErrInvalidInput", err)
			}
		})
	}
}
