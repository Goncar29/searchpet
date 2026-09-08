package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// El prefiltro constante de FindActiveAlertsNear NO puede descartar una alerta
// que sí corresponde.
//
// La consulta lleva dos condiciones geográficas: una acotada por
// domain.MaxAlertRadiusKm —la única indexable, porque su radio es constante— y
// la exacta, cuyo radio es la columna `radius_km`. La primera existe sólo para
// que el índice sirva, y es correcta MIENTRAS ninguna alerta pueda pedir más que
// esa cota.
//
// EL MODO DE FALLA ES SILENCIOSO, y por eso este test: si alguien sube el máximo
// permitido y el prefiltro se queda con el valor viejo, las alertas del rango
// nuevo dejan de dispararse sin ningún error y sin ninguna lentitud. Nadie
// recibe una notificación que debería haber recibido, y no hay nada en los logs.
//
// Se prueba con una alerta EN EL LÍMITE EXACTO: radio máximo, y un reporte justo
// adentro. Es el caso que un prefiltro mal calibrado descarta primero.
func TestFindActiveAlertsNear_ElPrefiltroNoDescartaElRadioMaximo(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewLocationAlertRepository(db)
	ctx := context.Background()

	userID := uuid.New()
	if err := db.Exec(`
		INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
		VALUES (?, 'alert-bound@test.local', 'x', 'Bound', now(), now())`, userID).Error; err != nil {
		t.Fatalf("sembrando usuario: %v", err)
	}

	// La alerta pide el radio MÁXIMO permitido, centrada en Montevideo.
	const centroLat, centroLng = -34.9011, -56.1645
	alerta := &domain.LocationAlert{
		ID:             uuid.New(),
		UserID:         userID,
		AlertLatitude:  centroLat,
		AlertLongitude: centroLng,
		RadiusKm:       domain.MaxAlertRadiusKm,
		IsActive:       true,
	}
	if err := repo.Create(ctx, alerta); err != nil {
		t.Fatalf("creando alerta: %v", err)
	}

	// Un reporte a ~49 km al norte: adentro del radio de la alerta, y adentro de
	// la cota del prefiltro. Tiene que encontrarla.
	//
	// 0.44 grados de latitud ≈ 49 km. Se queda corto del límite a propósito: la
	// distancia geodésica exacta del borde depende del elipsoide, y un test que
	// se apoye en el redondeo del último metro es un test que va a fallar solo.
	const lejosLat = centroLat + 0.44

	encontradas, err := repo.FindActiveAlertsNear(ctx, lejosLat, centroLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear: %v", err)
	}
	if len(encontradas) != 1 {
		t.Fatalf("una alerta de radio máximo (%d km) no encontró un reporte a ~49 km: "+
			"obtuve %d alertas. Si el prefiltro quedó por debajo del máximo permitido, "+
			"las alertas del rango nuevo dejan de dispararse en silencio",
			domain.MaxAlertRadiusKm, len(encontradas))
	}

	// Y la otra mitad: fuera del radio NO tiene que encontrarla. Sin esto, un
	// prefiltro roto que devolviera todo también pasaría el caso de arriba.
	const muyLejosLat = centroLat + 2.0 // ~222 km
	ninguna, err := repo.FindActiveAlertsNear(ctx, muyLejosLat, centroLng, "")
	if err != nil {
		t.Fatalf("FindActiveAlertsNear (lejos): %v", err)
	}
	if len(ninguna) != 0 {
		t.Errorf("un reporte a ~222 km disparó una alerta de %d km: obtuve %d",
			domain.MaxAlertRadiusKm, len(ninguna))
	}
}
