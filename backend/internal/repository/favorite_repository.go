package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFavoriteRepository struct {
	db *gorm.DB
}

// NewFavoriteRepository construye un FavoriteRepository respaldado por PostgreSQL.
func NewFavoriteRepository(db *gorm.DB) FavoriteRepository {
	return &postgresFavoriteRepository{db: db}
}

// Create persiste un favorito nuevo.
// Retorna ErrAlreadyFavorited si el par (userID, petID) ya existe (violación de unique index).
func (r *postgresFavoriteRepository) Create(ctx context.Context, favorite *domain.Favorite) error {
	err := r.db.WithContext(ctx).Create(favorite).Error
	if err != nil {
		// Detectar violación de clave única en PostgreSQL (código 23505)
		if strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "idx_user_pet") || strings.Contains(err.Error(), "duplicate key") {
			return domain.ErrAlreadyFavorited
		}
		return err
	}
	return nil
}

// Delete elimina un favorito por (userID, petID).
// Retorna ErrFavoriteNotFound si no existe.
func (r *postgresFavoriteRepository) Delete(ctx context.Context, userID, petID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Where("user_id = ? AND pet_id = ?", userID, petID).
		Delete(&domain.Favorite{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrFavoriteNotFound
	}
	return nil
}

// GetByUserID retorna los favoritos de un usuario con paginación.
func (r *postgresFavoriteRepository) GetByUserID(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Favorite, error) {
	var favorites []domain.Favorite
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&favorites).Error
	return favorites, err
}

// IsFavorited verifica si el par (userID, petID) está en favoritos.
func (r *postgresFavoriteRepository) IsFavorited(ctx context.Context, userID, petID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.Favorite{}).
		Where("user_id = ? AND pet_id = ?", userID, petID).
		Count(&count).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return count > 0, nil
}

// Verificación estática: postgresFavoriteRepository satisface FavoriteRepository.
var _ FavoriteRepository = (*postgresFavoriteRepository)(nil)
