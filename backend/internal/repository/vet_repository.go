package repository

import (
	"context"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type postgresVetRepository struct {
	db *gorm.DB
}

// NewVetRepository construye un VetRepository respaldado por PostgreSQL/PostGIS.
func NewVetRepository(db *gorm.DB) VetRepository {
	return &postgresVetRepository{db: db}
}

// Upsert inserta una veterinaria o la actualiza si ya existe (mismo osm_type+osm_id).
// Hace idempotente la importación: re-correr el import nunca duplica filas.
func (r *postgresVetRepository) Upsert(ctx context.Context, vet *domain.Vet) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "osm_type"}, {Name: "osm_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"name", "latitude", "longitude", "address",
				"phone", "website", "opening_hours", "last_synced_at", "updated_at",
			}),
		}).
		Create(vet).Error
}

// FindNearby retorna las veterinarias dentro de radiusMeters, ordenadas por
// distancia ascendente, con la distancia exacta en metros. Mismo patrón PostGIS
// que ReportRepository.FindNearby (ST_DWithin para filtrar, ST_Distance para ordenar).
func (r *postgresVetRepository) FindNearby(ctx context.Context, lat, lng, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error) {
	var results []domain.VetNearbyResult

	// float64 embebido directamente (no user-controlled text → sin riesgo de inyección);
	// gorm.Expr con ? params puede perder el ORDER BY en expresiones PostGIS.
	distExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography)",
		lng, lat,
	)

	err := r.db.WithContext(ctx).
		Model(&domain.Vet{}).
		Select("vets.*, "+distExpr+" AS distance_meters").
		Where(
			"ST_DWithin(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)",
			lng, lat, radiusMeters,
		).
		Order(distExpr + " ASC").
		Limit(limit).
		Scan(&results).Error

	return results, err
}

var _ VetRepository = (*postgresVetRepository)(nil)
