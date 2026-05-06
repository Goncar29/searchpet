package repository

import (
	"errors"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// ReportRepository define el CONTRATO para acceder a datos de reportes.
type ReportRepository interface {
	Create(report *domain.Report) error
	FindByID(id string) (*domain.Report, error)
	FindByPetID(petID string) ([]domain.Report, error)
	FindNearby(lat, lng float64, radiusMeters float64) ([]domain.Report, error)
}

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
func (r *PostgresReportRepository) FindByPetID(petID string) ([]domain.Report, error) {
	var reports []domain.Report
	err := r.db.Preload("Pet").Preload("Reporter").
		Where("pet_id = ?", petID).
		Order("created_at DESC").
		Find(&reports).Error
	return reports, err
}

// FindNearby busca reportes dentro de un radio usando PostGIS.
// ST_DWithin verifica si dos puntos están dentro del radio en metros.
// ST_Distance calcula la distancia exacta para ordenar los resultados del más cercano al más lejano.
func (r *PostgresReportRepository) FindNearby(lat, lng float64, radiusMeters float64) ([]domain.Report, error) {
	var reports []domain.Report

	err := r.db.Preload("Pet").Preload("Reporter").
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, lng, lat, radiusMeters).
		Order(gorm.Expr(`
			ST_Distance(
				ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
			) ASC
		`, lng, lat)).
		Find(&reports).Error

	return reports, err
}
