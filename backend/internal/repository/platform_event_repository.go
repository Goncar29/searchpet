package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// StatEventRepository writes and counts append-only impact-metric events.
type StatEventRepository interface {
	// Record appends one event. petID may be nil for events not tied to a pet.
	Record(ctx context.Context, eventType string, petID *uuid.UUID) error
	// CountByType returns the total number of rows of the given type.
	CountByType(ctx context.Context, eventType string) (int64, error)
	// CountDistinctPets returns the number of distinct non-null pet_id values
	// for the given type.
	CountDistinctPets(ctx context.Context, eventType string) (int64, error)
}

type statEventRepository struct {
	db *gorm.DB
}

func NewStatEventRepository(db *gorm.DB) StatEventRepository {
	return &statEventRepository{db: db}
}

func (r *statEventRepository) Record(ctx context.Context, eventType string, petID *uuid.UUID) error {
	return r.db.WithContext(ctx).Create(&domain.PlatformEvent{
		EventType: eventType,
		PetID:     petID,
	}).Error
}

func (r *statEventRepository) CountByType(ctx context.Context, eventType string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.PlatformEvent{}).
		Where("event_type = ?", eventType).Count(&n).Error
	return n, err
}

func (r *statEventRepository) CountDistinctPets(ctx context.Context, eventType string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.PlatformEvent{}).
		Where("event_type = ? AND pet_id IS NOT NULL", eventType).
		Distinct("pet_id").Count(&n).Error
	return n, err
}
