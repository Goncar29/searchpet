package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// Spatial index recomendado para FindActiveAlertsNear (ejecutar una vez, fuera de AutoMigrate):
//
//	CREATE INDEX IF NOT EXISTS idx_location_alerts_geo
//	  ON location_alerts USING GIST (
//	    ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography
//	  );

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
// Requiere índice GIST en (alert_longitude, alert_latitude) para performance.
// DDL sugerido (ejecutar una vez, fuera de AutoMigrate):
//
//	CREATE INDEX IF NOT EXISTS idx_location_alerts_geo
//	  ON location_alerts USING GIST (
//	    ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography
//	  );
func (r *locationAlertRepository) FindActiveAlertsNear(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error) {
	var alerts []domain.LocationAlert

	query := r.db.WithContext(ctx).
		Where("is_active = true").
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
