package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresGroupMemberRepository struct {
	db *gorm.DB
}

// NewGroupMemberRepository construye el repositorio de miembros de grupos.
func NewGroupMemberRepository(db *gorm.DB) GroupMemberRepository {
	return &postgresGroupMemberRepository{db: db}
}

func (r *postgresGroupMemberRepository) Create(ctx context.Context, member *domain.GroupMember) error {
	return r.db.WithContext(ctx).Create(member).Error
}

// Delete elimina la membresía del usuario en el grupo.
func (r *postgresGroupMemberRepository) Delete(ctx context.Context, groupID, userID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Where("group_id = ? AND user_id = ?", groupID, userID).
		Delete(&domain.GroupMember{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrNotMember
	}
	return nil
}

func (r *postgresGroupMemberRepository) IsMember(ctx context.Context, groupID, userID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.GroupMember{}).
		Where("group_id = ? AND user_id = ?", groupID, userID).
		Count(&count).Error
	return count > 0, err
}

func (r *postgresGroupMemberRepository) GetByGroupID(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error) {
	var members []domain.GroupMember
	if limit <= 0 {
		limit = 20
	}
	err := r.db.WithContext(ctx).
		Where("group_id = ?", groupID).
		Order("joined_at ASC").
		Limit(limit).Offset(offset).
		Find(&members).Error
	return members, err
}
