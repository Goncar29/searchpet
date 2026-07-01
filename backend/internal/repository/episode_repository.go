package repository

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type PostgresEpisodeRepository struct {
	db *gorm.DB
}

func NewEpisodeRepository(db *gorm.DB) EpisodeRepository {
	return &PostgresEpisodeRepository{db: db}
}

// Open creates a new open episode and repoints pets.current_episode_id atomically.
func (r *PostgresEpisodeRepository) Open(petID string) (*domain.SearchEpisode, error) {
	pid, err := uuid.Parse(petID)
	if err != nil {
		return nil, err
	}
	// Pre-generate the ID so we never depend on GORM scanning RETURNING to know
	// ep.ID — that ID is used immediately as a FK stamp on reports (see service layer).
	ep := &domain.SearchEpisode{ID: uuid.New(), PetID: pid}
	err = r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(ep).Error; err != nil {
			return err
		}
		return tx.Model(&domain.Pet{}).
			Where("id = ?", pid).
			Update("current_episode_id", ep.ID).Error
	})
	if err != nil {
		return nil, err
	}
	return ep, nil
}

// CloseCurrent resolves the pet's currently-open episode.
func (r *PostgresEpisodeRepository) CloseCurrent(petID string, resolution string) error {
	now := time.Now()
	return r.db.Model(&domain.SearchEpisode{}).
		Where("pet_id = ? AND ended_at IS NULL", petID).
		Updates(map[string]interface{}{"ended_at": now, "resolution": resolution}).Error
}

// FindCurrent returns the pet's most-recently-started episode (open or closed).
func (r *PostgresEpisodeRepository) FindCurrent(petID string) (*domain.SearchEpisode, error) {
	var ep domain.SearchEpisode
	err := r.db.Where("pet_id = ?", petID).
		Order("started_at DESC, id DESC").
		First(&ep).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ep, nil
}
