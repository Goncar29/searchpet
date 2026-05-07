package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresShelterRepository struct {
	db *gorm.DB
}

// NewShelterRepository construye un ShelterRepository respaldado por PostgreSQL.
func NewShelterRepository(db *gorm.DB) ShelterRepository {
	return &postgresShelterRepository{db: db}
}

// Create persiste un nuevo refugio en la BD.
func (r *postgresShelterRepository) Create(ctx context.Context, shelter *domain.Shelter) error {
	return r.db.WithContext(ctx).Create(shelter).Error
}

// GetByID busca un refugio por su UUID.
// Retorna ErrShelterNotFound si no existe.
func (r *postgresShelterRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Shelter, error) {
	var shelter domain.Shelter
	result := r.db.WithContext(ctx).First(&shelter, "id = ?", id)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrShelterNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &shelter, nil
}

// GetAll retorna refugios con filtros opcionales.
// city == "" → sin filtro por ciudad.
// isVerified == nil → sin filtro por verificación.
func (r *postgresShelterRepository) GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error) {
	var shelters []domain.Shelter
	query := r.db.WithContext(ctx).Model(&domain.Shelter{})

	if city != "" {
		query = query.Where("city = ?", city)
	}
	if isVerified != nil {
		query = query.Where("is_verified = ?", *isVerified)
	}

	err := query.Order("name ASC").Find(&shelters).Error
	return shelters, err
}

// Update guarda los cambios de un refugio existente.
func (r *postgresShelterRepository) Update(ctx context.Context, shelter *domain.Shelter) error {
	return r.db.WithContext(ctx).Save(shelter).Error
}

// Verificación estática: postgresShelterRepository satisface ShelterRepository.
var _ ShelterRepository = (*postgresShelterRepository)(nil)
