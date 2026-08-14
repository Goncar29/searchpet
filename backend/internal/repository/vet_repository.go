package repository

import (
	"context"
	"fmt"
	"time"

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
//
// deleted_at viaja en DoUpdates a propósito: el registro entrante lo trae en su
// valor cero, así que EXCLUDED.deleted_at es NULL y una veterinaria que vuelve a
// OpenStreetMap RESUCITA sola. Sin esa columna, la fila seguiría marcada como
// borrada y el mapa no la dibujaría nunca más, sin un solo error a la vista.
func (r *postgresVetRepository) Upsert(ctx context.Context, vet *domain.Vet) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "osm_type"}, {Name: "osm_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"name", "latitude", "longitude", "address",
				"phone", "website", "opening_hours", "last_synced_at", "updated_at",
				"deleted_at",
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

// SoftDeleteStaleBefore marca las veterinarias de OSM que la última corrida no
// tocó. GORM traduce Delete a UPDATE ... SET deleted_at = now() y agrega solo
// "deleted_at IS NULL" al WHERE, así que re-barrer es idempotente.
//
// El filtro por source es deliberado y NO es cosmético: acota el radio de acción
// del barrido a las filas que vienen de OpenStreetMap. Una veterinaria cargada a
// mano nunca aparece en la respuesta de Overpass, así que sin este filtro el
// primer import la borraría.
func (r *postgresVetRepository) SoftDeleteStaleBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	res := r.db.WithContext(ctx).
		Where("source = ? AND last_synced_at < ?", "osm", cutoff).
		Delete(&domain.Vet{})
	return res.RowsAffected, res.Error
}

// CountStaleBefore cuenta, sin tocarlas, las filas que SoftDeleteStaleBefore
// barrería con ese mismo cutoff. Deja que el umbral acote lo que REALMENTE se va
// a dar de baja en lugar de inferirlo de cuántas escrituras hizo la corrida.
//
// El WHERE es una copia literal del de SoftDeleteStaleBefore, y tiene que
// seguirlo siendo: si divergen, el barrido borra un conjunto distinto del que el
// umbral aprobó — y ese desacuerdo sería invisible, porque los dos números
// seguirían pareciendo razonables por separado. El scope de borrado suave de
// GORM agrega "deleted_at IS NULL" a las dos consultas por igual.
func (r *postgresVetRepository) CountStaleBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&domain.Vet{}).
		Where("source = ? AND last_synced_at < ?", "osm", cutoff).
		Count(&n).Error
	return n, err
}

// CountActiveOSM cuenta las veterinarias vivas de origen OSM. El scope de borrado
// suave de GORM excluye las marcadas sin que haga falta pedirlo.
func (r *postgresVetRepository) CountActiveOSM(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&domain.Vet{}).
		Where("source = ?", "osm").
		Count(&n).Error
	return n, err
}

var _ VetRepository = (*postgresVetRepository)(nil)
