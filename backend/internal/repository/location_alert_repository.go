package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// El índice espacial de FindActiveAlertsNear vive en la migración 000026
// (`idx_location_alerts_geog`), junto con los de `reports` y `vets`.
//
// Acá había una nota que RECOMENDABA crearlo "ejecutar una vez, fuera de
// AutoMigrate", y nunca se ejecutó: describía un índice que no existía. Si tocás
// la expresión geográfica de la consulta de abajo, tocá también la del índice —
// si dejan de coincidir Postgres no lo usa, y un índice que el planner ignora es
// peor que ninguno porque parece resuelto.
//
// Lo protegen DOS tests, y ninguno de los dos es el de `reports`: este comentario
// llegó a citar TestGeoIndexes_ElPlannerUsaElDeReports, que sólo siembra y
// explica la consulta de reports — no habría visto nada de acá.
// TestGeoIndexes_ElPlannerUsaElDeAlertas mira el plan de ESTA consulta, y
// TestFindActiveAlertsNear_ElPrefiltroNoDescartaElRadioMaximo cuida que el
// prefiltro no se coma alertas válidas.

type locationAlertRepository struct {
	db *gorm.DB
}

// NewLocationAlertRepository crea una instancia del repositorio.
func NewLocationAlertRepository(db *gorm.DB) LocationAlertRepository {
	return &locationAlertRepository{db: db}
}

func (r *locationAlertRepository) Create(ctx context.Context, alert *domain.LocationAlert) error {
	return r.db.WithContext(ctx).Create(alert).Error
}

func (r *locationAlertRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocationAlert, error) {
	var alert domain.LocationAlert
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&alert).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrAlertNotFound
		}
		return nil, err
	}
	return &alert, nil
}

func (r *locationAlertRepository) GetByUserID(ctx context.Context, userID uuid.UUID) ([]domain.LocationAlert, error) {
	var alerts []domain.LocationAlert
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND is_active = true", userID).
		Order("created_at DESC").
		Find(&alerts).Error
	return alerts, err
}

func (r *locationAlertRepository) Update(ctx context.Context, alert *domain.LocationAlert) error {
	return r.db.WithContext(ctx).Save(alert).Error
}

// Delete hace soft-delete: marca is_active = false.
func (r *locationAlertRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.LocationAlert{}).
		Where("id = ?", id).
		Update("is_active", false).Error
}

// FindActiveAlertsNear retorna todas las alertas activas cuyo centro se encuentra
// dentro del radio de la alerta respecto al punto del reporte.
//
// La consulta usa ST_DWithin con tipo geography para cálculo geodésico preciso.
// El filtro de petType es opcional: si es "" coincide con cualquier tipo de mascota.
//
// Semántica: ST_DWithin(alert_point, report_point, radius_km * 1000)
// — retorna verdadero si la distancia geodésica entre el centro de la alerta
// y el punto del reporte es <= radius_km km.
//
// El índice espacial es `idx_location_alerts_geog` (migración 000026), y esta
// consulta sólo puede usarlo gracias al prefiltro constante de abajo.
//
// Acá había un DDL "sugerido (ejecutar una vez, fuera de AutoMigrate)" que
// nombraba `idx_location_alerts_geo` — SIN la g final, o sea un nombre distinto
// del que la migración crea. Su `IF NOT EXISTS` no habría disparado: quien lo
// siguiera se quedaba con DOS índices GiST byte por byte iguales, pagando dos
// veces la escritura. Se borró.
func (r *locationAlertRepository) FindActiveAlertsNear(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error) {
	var alerts []domain.LocationAlert

	// DOS condiciones geográficas, y la primera existe SÓLO para que el índice
	// sirva. No es una optimización de más: sin ella el plan es un Seq Scan
	// sobre la tabla entera, medido.
	//
	// El motivo es que el radio real es una COLUMNA (`radius_km * 1000`), y
	// PostGIS expande ST_DWithin a `geog && _ST_Expand(punto, d)`: cuando `d`
	// depende de la fila, la cláusula deja de ser indexable y degrada a filtro.
	// El prefiltro usa una cota CONSTANTE —el radio máximo que una alerta puede
	// pedir— y por eso sí entra por el índice; después la condición exacta
	// descarta las que quedaron dentro de la cota pero fuera de su propio radio.
	//
	// La cota sale de domain.MaxAlertRadiusKm, la MISMA que valida la entrada.
	// Si fueran dos números, subir el máximo sin tocar acá dejaría de disparar
	// las alertas del rango nuevo EN SILENCIO — sin error y sin lentitud.
	query := r.db.WithContext(ctx).
		Where("is_active = true").
		Where(
			"ST_DWithin("+
				"ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography, "+
				"ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, "+
				"?"+
				")",
			lng, lat, domain.MaxAlertRadiusKm*1000,
		).
		Where(
			"ST_DWithin("+
				"ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography, "+
				"ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, "+
				"radius_km * 1000"+
				")",
			lng, lat,
		)

	// Si petType está especificado, sólo coincide alertas sin tipo o con el tipo exacto.
	// pet_type = '' significa "cualquier tipo" — no filtra.
	if petType != "" {
		query = query.Where("(pet_type = '' OR pet_type = ?)", petType)
	}

	err := query.Find(&alerts).Error
	return alerts, err
}

// CountActiveByUserID cuenta alertas activas de un usuario.
func (r *locationAlertRepository) CountActiveByUserID(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.LocationAlert{}).
		Where("user_id = ? AND is_active = true", userID).
		Count(&count).Error
	return count, err
}
