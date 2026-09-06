package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// desplazar mueve una latitud `metros` hacia el norte de Montevideo (mvdLat),
// usando la aproximación estándar 1 grado ≈ 111.320 m. Alcanza para separar
// puntos dentro y fuera del radio de 1 km sin razonar sobre proyecciones.
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

// El radio corta a 1 km: uno adentro aparece, uno afuera no.
func TestStrayCandidates_ElRadioCorta(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	lastSeen := time.Now().Add(-24 * time.Hour)
	cerca := sembrarStray(t, gormDB, "Cerca", "perro", desplazar(300), mvdLng, lastSeen)
	lejos := sembrarStray(t, gormDB, "Lejos", "perro", desplazar(5000), mvdLng, lastSeen)

	cands, err := petRepo.FindStrayCandidates(domain.StrayCandidateCriteria{Lat: mvdLat, Lng: mvdLng})
	if err != nil {
		t.Fatalf("FindStrayCandidates: %v", err)
	}
	if !contieneCandidato(cands, cerca) {
		t.Error("el que está a 300m (adentro del radio de 1km) no apareció")
	}
	if contieneCandidato(cands, lejos) {
		t.Error("el que está a 5km (afuera del radio de 1km) apareció igual")
	}
}

// El tipo acota: pedir "perro" no devuelve al gato sembrado en el mismo punto.
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
	if encontrado.LastSeenAt.IsZero() {
		t.Error("LastSeenAt llegó en cero")
	}
}
