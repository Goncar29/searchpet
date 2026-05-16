package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// postgresBadgeRepository implementa la interfaz BadgeRepository usando PostgreSQL.
type postgresBadgeRepository struct {
	db *gorm.DB
}

// NewBadgeRepository crea una nueva instancia del repositorio de badges.
func NewBadgeRepository(db *gorm.DB) BadgeRepository {
	return &postgresBadgeRepository{db: db}
}

// Create inserta un nuevo badge para el usuario.
// La tabla tiene un índice único compuesto (user_id, badge_type), por lo que una
// violación de constraint equivale a un badge ya otorgado — se retorna nil (idempotente).
func (r *postgresBadgeRepository) Create(ctx context.Context, badge *domain.Badge) error {
	if err := r.db.WithContext(ctx).Create(badge).Error; err != nil {
		// Unique constraint violation → badge ya existe, operación idempotente.
		if isUniqueConstraintError(err) {
			return nil
		}
		return err
	}
	return nil
}

// HasBadge retorna true si el usuario ya tiene el badge del tipo indicado.
func (r *postgresBadgeRepository) HasBadge(ctx context.Context, userID uuid.UUID, badgeType string) (bool, error) {
	var badge domain.Badge
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND badge_type = ?", userID, badgeType).
		First(&badge).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// FindByUserID retorna todos los badges del usuario, del más reciente al más antiguo.
func (r *postgresBadgeRepository) FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.Badge, error) {
	var badges []domain.Badge
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("earned_at DESC").
		Find(&badges).Error; err != nil {
		return nil, err
	}
	return badges, nil
}

// isUniqueConstraintError detecta violaciones de constraint único en PostgreSQL.
// PostgreSQL retorna error code 23505 para unique_violation.
func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	return containsAny(err.Error(), "23505", "unique constraint", "duplicate key")
}

// containsAny retorna true si s contiene alguna de las substrings dadas.
func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if len(s) >= len(sub) {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}
