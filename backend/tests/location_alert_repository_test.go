package tests

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"

	"gorm.io/gorm"
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

// Este test afirmaba el BUG: exigía que tras `Delete` la fila siguiera visible
// por `GetByID` con `is_active = false`. Eso era la conflación misma — borrar
// escribía el estado que produce pausar. Ahora afirma lo contrario, y la
// aserción que más importa es la última: borrar NO toca `is_active`.
func TestLocationAlertRepository_Delete_NoTocaIsActive(t *testing.T) {
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

	if err := alertRepo.Delete(ctx, alert.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	alerts, err := alertRepo.GetByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByUserID after delete: %v", err)
	}
	for _, a := range alerts {
		if a.ID == alert.ID {
			t.Errorf("la alerta borrada %s no puede aparecer en GetByUserID", alert.ID)
		}
	}

	// Una alerta borrada tampoco existe para el resto del servicio: `GetByID`
	// es lo que usan `UpdateAlert` y `DeleteAlert` para chequear ownership.
	if _, err := alertRepo.GetByID(ctx, alert.ID); !errors.Is(err, domain.ErrAlertNotFound) {
		t.Errorf("GetByID de una borrada: want ErrAlertNotFound, got %v", err)
	}

	// LO QUE DE VERDAD SE PRUEBA ACÁ: la fila sigue en la tabla, con
	// `deleted_at` estampado y **`is_active` INTACTO**. Si borrar volviera a
	// escribir `is_active = false`, los dos conceptos estarían fusionados otra
	// vez y este test se cae — que es el único modo de falla que importa.
	var cruda domain.LocationAlert
	if err := gormDB.Unscoped().Where("id = ?", alert.ID).First(&cruda).Error; err != nil {
		t.Fatalf("la fila tiene que seguir existiendo: %v", err)
	}
	if !cruda.DeletedAt.Valid {
		t.Error("want deleted_at estampado tras Delete")
	}
	if !cruda.IsActive {
		t.Error("borrar NO puede tocar is_active: pausar y borrar son cosas distintas")
	}
}

// Pausa una alerta por el MISMO camino que usa la app: `UpdateAlert` con
// `is_active: false`, que abajo es un `Save`.
//
// NO alcanza con crearla con `IsActive: false`. GORM **omite el campo en el
// INSERT** cuando su valor es el zero value y el tag declara `default:true`,
// así que Postgres aplica el default y la fila nace ACTIVA.
//
// Lo destapó el test de `FindActiveAlertsNear` fallando — y los otros dos
// pasaban por esa misma razón equivocada: afirmaban sobre una alerta que creían
// pausada y estaba activa, así que habrían pasado igual con el bug puesto.
func pausarAlerta(
	t *testing.T,
	ctx context.Context,
	repo repository.LocationAlertRepository,
	gormDB *gorm.DB,
	a *domain.LocationAlert,
) {
	t.Helper()
	a.IsActive = false
	if err := repo.Update(ctx, a); err != nil {
		t.Fatalf("pausar: %v", err)
	}
	// La precondición se AFIRMA, no se asume. Sin esto el test puede volver a
	// pasar sobre una alerta que nunca llegó a pausarse.
	var cruda domain.LocationAlert
	if err := gormDB.Where("id = ?", a.ID).First(&cruda).Error; err != nil {
		t.Fatalf("releer la pausada: %v", err)
	}
	if cruda.IsActive {
		t.Fatalf("la alerta no quedó pausada en la base: el test no probaría nada")
	}
}

// El bug que este cambio cierra, en una sola aserción: una alerta PAUSADA se
// sigue viendo. Mientras `GetByUserID` filtraba `is_active = true`, destildar
// "Activa" la hacía desaparecer de la única pantalla que la mostraba, y no
// había forma de volver a encenderla.
func TestLocationAlertRepository_GetByUserID_IncluyeLasPausadas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	activa := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "activa",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: true,
	}
	pausada := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "pausada",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: true,
	}
	for _, a := range []*domain.LocationAlert{activa, pausada} {
		if err := alertRepo.Create(ctx, a); err != nil {
			t.Fatalf("Create %s: %v", a.Name, err)
		}
	}
	pausarAlerta(t, ctx, alertRepo, gormDB, pausada)

	alerts, err := alertRepo.GetByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetByUserID: %v", err)
	}
	vistas := map[uuid.UUID]bool{}
	for _, a := range alerts {
		vistas[a.ID] = true
	}
	if !vistas[activa.ID] {
		t.Error("falta la alerta activa")
	}
	if !vistas[pausada.ID] {
		t.Error("la alerta PAUSADA tiene que verse: si no, no hay forma de reactivarla")
	}
}

// La otra mitad, y sin ella el cambio no está probado: pausar tiene que seguir
// APAGANDO las notificaciones. Si alguien "arregla" el bug sacando `is_active`
// de todas las consultas, el test de arriba pasa igual y una alerta pausada
// sigue avisando — o sea, pausar no serviría para nada.
func TestLocationAlertRepository_FindActiveAlertsNear_IgnoraLasPausadas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	pausada := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "pausada",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 10.0, IsActive: true,
	}
	if err := alertRepo.Create(ctx, pausada); err != nil {
		t.Fatalf("Create: %v", err)
	}
	pausarAlerta(t, ctx, alertRepo, gormDB, pausada)

	// El punto es el centro exacto de su zona: si apareciera, sería por estar
	// activa y no por geografía.
	encontradas, err := alertRepo.FindActiveAlertsNear(ctx, mvdLat, mvdLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear: %v", err)
	}
	for _, a := range encontradas {
		if a.ID == pausada.ID {
			t.Error("una alerta pausada no puede disparar notificaciones")
		}
	}
}

// POR QUÉ EXISTE, y es la garantía que este cambio se llevó puesta sin querer:
// una alerta BORRADA no puede seguir disparando notificaciones.
//
// Antes eso estaba garantizado por accidente: `Delete` escribía
// `is_active = false`, y `FindActiveAlertsNear` filtra por esa columna. Ahora
// `Delete` NO la toca —a propósito, es todo el punto del cambio— así que una
// alerta borrada conserva `is_active = true`. Lo único que la excluye es el
// `deleted_at IS NULL` que GORM agrega solo.
//
// Y ese "solo" es la parte frágil: el día que alguien convierta esta consulta a
// SQL crudo —es una query PostGIS, el candidato natural para eso— el scoping
// desaparece y **cada alerta borrada vuelve a notificar, para siempre y en
// silencio**. Lo levantó la revisión nativa.
func TestLocationAlertRepository_FindActiveAlertsNear_IgnoraLasBorradas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	alert := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "borrada",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 10.0, IsActive: true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := alertRepo.Delete(ctx, alert.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// La precondición se AFIRMA: la fila tiene que seguir con `is_active = true`.
	// Si estuviera en false, este test pasaría por el motivo viejo y no probaría
	// nada de lo que vino a proteger.
	var cruda domain.LocationAlert
	if err := gormDB.Unscoped().Where("id = ?", alert.ID).First(&cruda).Error; err != nil {
		t.Fatalf("releer la borrada: %v", err)
	}
	if !cruda.IsActive {
		t.Fatalf("precondición rota: la borrada quedó con is_active=false, el test no probaría el scoping")
	}

	encontradas, err := alertRepo.FindActiveAlertsNear(ctx, mvdLat, mvdLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear: %v", err)
	}
	for _, a := range encontradas {
		if a.ID == alert.ID {
			t.Error("una alerta BORRADA no puede disparar notificaciones")
		}
	}
}

// POR QUÉ EXISTE: la migración 000027 es lo único que evita que las alertas que
// se borraron ANTES de este cambio reaparezcan en la lista de su dueño como
// pausadas. El propio archivo llama a eso "peor que el bug", y hasta acá su
// correctitud sólo la respaldaba una pasada manual.
//
// El test lee el SQL DEL ARCHIVO en vez de copiarlo: una copia probaría una
// migración que no es la que corre en producción, y las dos podrían divergir
// sin que nada avise.
func TestMigracion000027_BackfilleaLasBorradasViejas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	vieja := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "borrada antes de la migracion",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: true,
	}
	sobreviviente := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, Name: "activa",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: true,
	}
	for _, a := range []*domain.LocationAlert{vieja, sobreviviente} {
		if err := alertRepo.Create(ctx, a); err != nil {
			t.Fatalf("Create %s: %v", a.Name, err)
		}
	}

	// Se reconstruye el estado PRE-migración: así quedaba una fila borrada con
	// el modelo viejo, donde borrar era escribir `is_active = false`.
	if err := gormDB.Exec(
		"UPDATE location_alerts SET is_active = false, deleted_at = NULL WHERE id = ?",
		vieja.ID,
	).Error; err != nil {
		t.Fatalf("simular el estado viejo: %v", err)
	}

	sql, err := os.ReadFile("../migrations/000027_split_alert_paused_from_deleted.up.sql")
	if err != nil {
		t.Fatalf("leer la migración: %v", err)
	}
	if err := gormDB.Exec(string(sql)).Error; err != nil {
		t.Fatalf("correr la migración: %v", err)
	}

	var borrada, intacta domain.LocationAlert
	if err := gormDB.Unscoped().Where("id = ?", vieja.ID).First(&borrada).Error; err != nil {
		t.Fatalf("releer la vieja: %v", err)
	}
	if !borrada.DeletedAt.Valid {
		t.Error("la fila con is_active=false tenía que quedar marcada como borrada")
	}

	// La otra mitad: el backfill NO puede tocar las que estaban bien. Sin esta
	// aserción, un `WHERE` de más marcaría todo y el test pasaría igual.
	if err := gormDB.Unscoped().Where("id = ?", sobreviviente.ID).First(&intacta).Error; err != nil {
		t.Fatalf("releer la activa: %v", err)
	}
	if intacta.DeletedAt.Valid {
		t.Error("el backfill no puede borrar una alerta activa")
	}
}

// POR QUÉ EXISTE: agregarle `gorm.DeletedAt` al modelo convirtió EN SILENCIO
// dos borrados duros preexistentes en soft-deletes. Uno es este, el cascade de
// `PetRepository.Delete`; el otro es `resetSeedData`.
//
// Acá el soft-delete está mal: la mascota se borra de verdad, así que sus
// alertas quedarían con `pet_id` apuntando a una fila que ya no existe, y se
// acumularían para siempre. El soft-delete de alertas existe para que el DUEÑO
// pueda borrar la suya sin perder la distinción con pausarla — nada que
// distinguir cuando se va la mascota entera.
//
// Lo levantó un `/code-review`. No lo vio ningún test porque nadie miraba la
// tabla DESPUÉS de borrar una mascota.
func TestPetRepository_Delete_BorraLasAlertasDeVerdad(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	pet := newTestPet(user.ID)
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	petID := pet.ID
	alert := &domain.LocationAlert{
		ID: uuid.New(), UserID: user.ID, PetID: &petID, Name: "por esta mascota",
		AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: true,
	}
	if err := alertRepo.Create(ctx, alert); err != nil {
		t.Fatalf("Create alert: %v", err)
	}

	if err := petRepo.Delete(pet.ID.String()); err != nil {
		t.Fatalf("Delete pet: %v", err)
	}

	// `Unscoped` a propósito: la pregunta no es si el usuario la ve —no la ve
	// ni soft ni hard— sino si la FILA sigue ahí. Sin `Unscoped` este test
	// pasaría con el borrado blando puesto, que es justo el defecto.
	var quedan int64
	if err := gormDB.Unscoped().Model(&domain.LocationAlert{}).
		Where("pet_id = ?", petID).Count(&quedan).Error; err != nil {
		t.Fatalf("contar alertas: %v", err)
	}
	if quedan != 0 {
		t.Errorf("want 0 filas tras borrar la mascota, got %d (quedaron soft-deleted)", quedan)
	}
}

// El tope cuenta activas Y pausadas —pausar no libera lugar, decidido a
// propósito— pero NO cuenta las borradas. Las dos mitades en un solo test,
// porque contar de más y contar de menos son errores distintos.
func TestLocationAlertRepository_CountByUserID_CuentaPausadasPeroNoBorradas(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	alertRepo := repository.NewLocationAlertRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	nueva := func(nombre string, activa bool) *domain.LocationAlert {
		a := &domain.LocationAlert{
			ID: uuid.New(), UserID: user.ID, Name: nombre,
			AlertLatitude: mvdLat, AlertLongitude: mvdLng, RadiusKm: 3.0, IsActive: activa,
		}
		if err := alertRepo.Create(ctx, a); err != nil {
			t.Fatalf("Create %s: %v", nombre, err)
		}
		return a
	}

	nueva("activa", true)
	pausarAlerta(t, ctx, alertRepo, gormDB, nueva("pausada", true))
	borrada := nueva("borrada", true)
	if err := alertRepo.Delete(ctx, borrada.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	count, err := alertRepo.CountByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("CountByUserID: %v", err)
	}
	if count != 2 {
		t.Errorf("want 2 (activa + pausada, sin la borrada), got %d", count)
	}
}
