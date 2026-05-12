package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// TODO(PR4): add spatial index on (alert_latitude, alert_longitude) for FindMatchingAlerts.
// ALTER TABLE location_alerts ADD COLUMN coord geography(Point,4326)
//   GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)) STORED;
// CREATE INDEX idx_location_alerts_coord ON location_alerts USING GIST(coord);
//
// The FindMatchingAlerts full PostGIS query (PR4):
// SELECT * FROM location_alerts
// WHERE is_active = true
//   AND ST_DWithin(
//     ST_SetSRID(ST_MakePoint(alert_longitude, alert_latitude), 4326)::geography,
//     ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
//     radius_km * 1000
//   )
//   AND (pet_type = '' OR pet_type = $petType)

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

// FindMatchingAlerts — stub en PR3.
// Retorna slice vacío; la consulta PostGIS ST_DWithin se implementa en PR4.
func (r *locationAlertRepository) FindMatchingAlerts(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error) {
	return []domain.LocationAlert{}, nil
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
