package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresUserReviewRepository struct {
	db *gorm.DB
}

// NewUserReviewRepository construye un UserReviewRepository respaldado por PostgreSQL.
func NewUserReviewRepository(db *gorm.DB) UserReviewRepository {
	return &postgresUserReviewRepository{db: db}
}

// Create persiste una nueva reseña. Mapea violación de unique constraint a ErrAlreadyReviewed.
func (r *postgresUserReviewRepository) Create(ctx context.Context, review *domain.UserReview) error {
	err := r.db.WithContext(ctx).Create(review).Error
	if err != nil {
		if strings.Contains(err.Error(), "idx_reviewer_reviewee") {
			return domain.ErrAlreadyReviewed
		}
		return err
	}
	return nil
}

// Update actualiza únicamente los campos mutables (stars, text, updated_at).
func (r *postgresUserReviewRepository) Update(ctx context.Context, review *domain.UserReview) error {
	return r.db.WithContext(ctx).
		Model(review).
		Select("stars", "text", "updated_at").
		Updates(review).Error
}

// FindByReviewee retorna las reseñas para un usuario, ordenadas por created_at DESC.
// Precarga solo id, name y profile_photo_url del reviewer para evitar exponer datos sensibles.
func (r *postgresUserReviewRepository) FindByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) ([]domain.UserReview, error) {
	var reviews []domain.UserReview
	err := r.db.WithContext(ctx).
		Where("reviewee_id = ?", revieweeID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Preload("Reviewer", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "name", "profile_photo_url")
		}).
		Find(&reviews).Error
	return reviews, err
}

// FindByReviewerAndReviewee retorna la reseña para un par (reviewer, reviewee).
// Retorna ErrReviewNotFound si no existe.
func (r *postgresUserReviewRepository) FindByReviewerAndReviewee(ctx context.Context, reviewerID, revieweeID uuid.UUID) (*domain.UserReview, error) {
	var review domain.UserReview
	err := r.db.WithContext(ctx).
		Where("reviewer_id = ? AND reviewee_id = ?", reviewerID, revieweeID).
		First(&review).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrReviewNotFound
		}
		return nil, err
	}
	return &review, nil
}

// GetAverageRating retorna el promedio de rating y la cantidad de reseñas para un usuario.
// Usa COALESCE para retornar 0 si no hay reseñas (zero-value safe).
func (r *postgresUserReviewRepository) GetAverageRating(ctx context.Context, revieweeID uuid.UUID) (float64, int, error) {
	var result struct {
		Avg   float64
		Count int
	}
	err := r.db.WithContext(ctx).
		Model(&domain.UserReview{}).
		Select("COALESCE(AVG(stars), 0) as avg, COUNT(*) as count").
		Where("reviewee_id = ?", revieweeID).
		Scan(&result).Error
	return result.Avg, result.Count, err
}

// Delete elimina de forma permanente la reseña del par (reviewerID, revieweeID).
// Retorna ErrReviewNotFound si no existe ninguna fila con ese par.
func (r *postgresUserReviewRepository) Delete(ctx context.Context, reviewerID, revieweeID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Where("reviewer_id = ? AND reviewee_id = ?", reviewerID, revieweeID).
		Delete(&domain.UserReview{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReviewNotFound
	}
	return nil
}

// Verificación estática: postgresUserReviewRepository satisface UserReviewRepository.
var _ UserReviewRepository = (*postgresUserReviewRepository)(nil)
