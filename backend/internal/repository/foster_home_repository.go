package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomeRepository struct {
	db *gorm.DB
}

func NewFosterHomeRepository(db *gorm.DB) FosterHomeRepository {
	return &postgresFosterHomeRepository{db: db}
}

func (r *postgresFosterHomeRepository) Create(ctx context.Context, fh *domain.FosterHome) error {
	return r.db.WithContext(ctx).Create(fh).Error
}

func (r *postgresFosterHomeRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.FosterHome, error) {
	var fh domain.FosterHome
	res := r.db.WithContext(ctx).Preload("Photos").First(&fh, "id = ?", id)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrFosterHomeNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &fh, nil
}

func (r *postgresFosterHomeRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.FosterHome, error) {
	var fh domain.FosterHome
	res := r.db.WithContext(ctx).Preload("Photos").First(&fh, "owner_user_id = ?", ownerID)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrFosterHomeNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &fh, nil
}

func (r *postgresFosterHomeRepository) GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error) {
	var list []domain.FosterHome
	q := r.db.WithContext(ctx).Model(&domain.FosterHome{}).
		Preload("Photos").
		Where("status = ?", domain.FosterHomeStatusApproved)
	if city != "" {
		q = q.Where("city = ?", city)
	}
	if animalType != "" {
		q = q.Where("animal_types @> ARRAY[?]::text[]", animalType)
	}
	err := q.Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeRepository) GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error) {
	var list []domain.FosterHome
	err := r.db.WithContext(ctx).
		Where("status = ?", domain.FosterHomeStatusPending).
		Order("created_at ASC").
		Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeRepository) Update(ctx context.Context, fh *domain.FosterHome) error {
	return r.db.WithContext(ctx).Save(fh).Error
}

var _ FosterHomeRepository = (*postgresFosterHomeRepository)(nil)
