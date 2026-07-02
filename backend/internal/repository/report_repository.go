package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// PostgresReportRepository es la implementación concreta que habla con PostgreSQL.
type PostgresReportRepository struct {
	db *gorm.DB
}

// NewReportRepository es el constructor.
func NewReportRepository(db *gorm.DB) ReportRepository {
	return &PostgresReportRepository{db: db}
}

// Create inserta un nuevo reporte en la BD.
func (r *PostgresReportRepository) Create(report *domain.Report) error {
	return r.db.Create(report).Error
}

// FindByID busca un reporte por su UUID y carga la mascota y el reporter.
func (r *PostgresReportRepository) FindByID(id string) (*domain.Report, error) {
	var report domain.Report
	err := r.db.Preload("Pet").Preload("Reporter").Where("id = ?", id).First(&report).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrReportNotFound
		}
		return nil, err
	}
	return &report, nil
}

// FindByPetID devuelve todos los reportes de una mascota, del más reciente al más viejo.
// Usa COALESCE(occurred_at, created_at) para que las fechas reales de avistamiento
// tengan prioridad sobre la fecha de creación del reporte.
func (r *PostgresReportRepository) FindByPetID(petID string) ([]domain.Report, error) {
	var reports []domain.Report
	err := r.db.Preload("Pet").Preload("Reporter").
		Where("pet_id = ?", petID).
		Order("COALESCE(occurred_at, created_at) DESC").
		Find(&reports).Error
	return reports, err
}

// UpdateVerified marca un reporte como verificado (admin action).
// Persiste verified = true, verified_by = verifiedBy, verified_at = now.
func (r *PostgresReportRepository) UpdateVerified(ctx context.Context, id uuid.UUID, verifiedBy uuid.UUID) error {
	now := time.Now()
	result := r.db.WithContext(ctx).
		Model(&domain.Report{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"is_verified": true,
			"verified_by": verifiedBy,
			"verified_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReportNotFound
	}
	return nil
}

// Delete elimina un reporte por id (acción de moderación admin).
// Hard delete: el report es una fila casi-hoja (las fotos cuelgan del Pet y
// Message.ReportID es un puntero nullable sin FK que bloquee).
func (r *PostgresReportRepository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Where("id = ?", id).Delete(&domain.Report{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReportNotFound
	}
	return nil
}

// SetEpisodeID stamps an existing report with its search episode ID.
func (r *PostgresReportRepository) SetEpisodeID(reportID string, episodeID uuid.UUID) error {
	return r.db.Model(&domain.Report{}).Where("id = ?", reportID).
		Update("episode_id", episodeID).Error
}

// FindNearby busca reportes dentro de un radio usando PostGIS.
// ST_DWithin verifica si dos puntos están dentro del radio en metros.
// ST_Distance calcula la distancia exacta para ordenar los resultados del más cercano al más lejano.
func (r *PostgresReportRepository) FindNearby(lat, lng float64, radiusMeters float64) ([]domain.Report, error) {
	var reports []domain.Report

	// ORDER BY uses fmt.Sprintf to embed float64 values directly — gorm.Expr with ?
	// params can silently drop ordering for PostGIS expressions in some GORM versions.
	// Embedding float64 is safe: no injection risk since the type is not user-controlled text.
	orderExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography) ASC",
		lng, lat,
	)

	// JOIN pets and filter on the pet's CURRENT status (MapVisibleStatuses:
	// lost, stray, found). A report belongs to the nearby feed only while its
	// pet is an active search OR was just recovered (found) — without this,
	// stale reports of re-registered/archived pets would keep surfacing,
	// leaking closed cases and others' now-private pets. The JOIN assumes the
	// pets table has no soft-delete scope (it currently doesn't); if Pet ever
	// gains gorm.DeletedAt, this needs an explicit deleted_at IS NULL guard.
	//
	// The episode scope ensures that when a pet is re-lost, only the NEW
	// episode's pins appear on the map. Reports with a NULL episode_id (or
	// whose episode_id differs from pets.current_episode_id) are excluded.
	// CloseCurrent intentionally leaves current_episode_id intact so that a
	// just-found pet's "recovered here" marker remains visible.
	err := r.db.Preload("Pet").Preload("Reporter").
		Joins("JOIN pets ON pets.id = reports.pet_id").
		Where("pets.status IN (?)", domain.MapVisibleStatuses).
		Where("reports.episode_id = pets.current_episode_id").
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, lng, lat, radiusMeters).
		Order(orderExpr).
		Find(&reports).Error

	return reports, err
}
