package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomePhotoRepository struct {
	db *gorm.DB
}

func NewFosterHomePhotoRepository(db *gorm.DB) FosterHomePhotoRepository {
	return &postgresFosterHomePhotoRepository{db: db}
}

func (r *postgresFosterHomePhotoRepository) Create(ctx context.Context, p *domain.FosterHomePhoto) error {
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *postgresFosterHomePhotoRepository) CountByFosterHome(ctx context.Context, fhID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.FosterHomePhoto{}).
		Where("foster_home_id = ?", fhID).Count(&n).Error
	return n, err
}

func (r *postgresFosterHomePhotoRepository) FindByFosterHome(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomePhoto, error) {
	var list []domain.FosterHomePhoto
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at ASC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomePhotoRepository) FindByID(ctx context.Context, id uuid.UUID) (*domain.FosterHomePhoto, error) {
	var p domain.FosterHomePhoto
	res := r.db.WithContext(ctx).First(&p, "id = ?", id)
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrPhotoNotFound
	}
	if res.Error != nil {
		return nil, res.Error
	}
	return &p, nil
}

func (r *postgresFosterHomePhotoRepository) DeleteByID(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&domain.FosterHomePhoto{}, "id = ?", id).Error
}

var _ FosterHomePhotoRepository = (*postgresFosterHomePhotoRepository)(nil)
