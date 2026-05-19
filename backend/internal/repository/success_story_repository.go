package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresSuccessStoryRepository struct {
	db *gorm.DB
}

// NewSuccessStoryRepository construye el repositorio de historias de éxito.
func NewSuccessStoryRepository(db *gorm.DB) SuccessStoryRepository {
	return &postgresSuccessStoryRepository{db: db}
}

func (r *postgresSuccessStoryRepository) Create(ctx context.Context, story *domain.SuccessStory) error {
	return r.db.WithContext(ctx).Create(story).Error
}

func (r *postgresSuccessStoryRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	var story domain.SuccessStory
	err := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("User").
		Where("id = ? AND deleted_at IS NULL", id).
		First(&story).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrStoryNotFound
		}
		return nil, err
	}
	return &story, nil
}

func (r *postgresSuccessStoryRepository) GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error) {
	var story domain.SuccessStory
	err := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("User").
		Where("pet_id = ? AND deleted_at IS NULL", petID).
		First(&story).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &story, nil
}

func (r *postgresSuccessStoryRepository) GetAll(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	var stories []domain.SuccessStory
	q := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("User").
		Where("deleted_at IS NULL")

	if featured != nil {
		q = q.Where("featured = ?", *featured)
	}

	if limit <= 0 {
		limit = 20
	}

	err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&stories).Error
	return stories, err
}

// IncrementLikes incrementa el contador de likes de forma atómica (sin read-modify-write).
func (r *postgresSuccessStoryRepository) IncrementLikes(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&domain.SuccessStory{}).
		Where("id = ? AND deleted_at IS NULL", id).
		UpdateColumn("like_count", gorm.Expr("like_count + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrStoryNotFound
	}
	return nil
}

// SetFeatured actualiza el campo featured y registra qué admin lo marcó (audit).
func (r *postgresSuccessStoryRepository) SetFeatured(ctx context.Context, id uuid.UUID, featured bool, featuredBy uuid.UUID) error {
	updates := map[string]interface{}{
		"featured": featured,
	}
	if featured {
		updates["featured_by"] = featuredBy
	} else {
		updates["featured_by"] = nil
	}

	result := r.db.WithContext(ctx).
		Model(&domain.SuccessStory{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrStoryNotFound
	}
	return nil
}

// Delete hace soft-delete seteando deleted_at.
func (r *postgresSuccessStoryRepository) Delete(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	result := r.db.WithContext(ctx).
		Model(&domain.SuccessStory{}).
		Where("id = ? AND deleted_at IS NULL", id).
		UpdateColumn("deleted_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrStoryNotFound
	}
	return nil
}
