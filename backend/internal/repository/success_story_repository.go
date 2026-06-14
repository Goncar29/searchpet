package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// recomputeLikeCount sets like_count = COUNT(*) from story_likes for the
// given story, inside the provided transaction. It does not check existence —
// callers must verify the story exists first.
func recomputeLikeCount(tx *gorm.DB, storyID uuid.UUID) error {
	return tx.Model(&domain.SuccessStory{}).
		Where("id = ?", storyID).
		UpdateColumn("like_count", gorm.Expr("(SELECT COUNT(*) FROM story_likes WHERE story_id = ?)", storyID)).
		Error
}

// storyExists checks that the story exists and is not soft-deleted.
func storyExists(tx *gorm.DB, storyID uuid.UUID) (bool, error) {
	var count int64
	err := tx.Model(&domain.SuccessStory{}).
		Where("id = ? AND deleted_at IS NULL", storyID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// readLikeCount returns the current like_count for a story.
func readLikeCount(tx *gorm.DB, storyID uuid.UUID) (int, error) {
	var story domain.SuccessStory
	if err := tx.Select("like_count").Where("id = ?", storyID).First(&story).Error; err != nil {
		return 0, err
	}
	return story.LikeCount, nil
}

// AddLike inserts a story_likes row for (storyID, userID) if it doesn't
// already exist (idempotent via ON CONFLICT DO NOTHING), then recomputes
// like_count from the row count, inside a single transaction.
func (r *postgresSuccessStoryRepository) AddLike(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error) {
	var added bool
	var newCount int

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := storyExists(tx, storyID)
		if err != nil {
			return err
		}
		if !exists {
			return domain.ErrStoryNotFound
		}

		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&domain.StoryLike{
			StoryID: storyID,
			UserID:  userID,
		})
		if result.Error != nil {
			return result.Error
		}
		added = result.RowsAffected == 1

		if err := recomputeLikeCount(tx, storyID); err != nil {
			return err
		}

		newCount, err = readLikeCount(tx, storyID)
		return err
	})
	if err != nil {
		return false, 0, err
	}
	return added, newCount, nil
}

// RemoveLike deletes the story_likes row for (storyID, userID) if it exists,
// then recomputes like_count from the row count, inside a single transaction.
func (r *postgresSuccessStoryRepository) RemoveLike(ctx context.Context, storyID, userID uuid.UUID) (bool, int, error) {
	var removed bool
	var newCount int

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := storyExists(tx, storyID)
		if err != nil {
			return err
		}
		if !exists {
			return domain.ErrStoryNotFound
		}

		result := tx.Where("story_id = ? AND user_id = ?", storyID, userID).Delete(&domain.StoryLike{})
		if result.Error != nil {
			return result.Error
		}
		removed = result.RowsAffected == 1

		if err := recomputeLikeCount(tx, storyID); err != nil {
			return err
		}

		newCount, err = readLikeCount(tx, storyID)
		return err
	})
	if err != nil {
		return false, 0, err
	}
	return removed, newCount, nil
}

// LikedStoryIDs returns a set of story IDs (from storyIDs) that userID has liked.
func (r *postgresSuccessStoryRepository) LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	result := make(map[uuid.UUID]bool, len(storyIDs))
	if len(storyIDs) == 0 {
		return result, nil
	}

	var likes []domain.StoryLike
	err := r.db.WithContext(ctx).
		Select("story_id").
		Where("user_id = ? AND story_id IN ?", userID, storyIDs).
		Find(&likes).Error
	if err != nil {
		return nil, err
	}

	for _, l := range likes {
		result[l.StoryID] = true
	}
	return result, nil
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
