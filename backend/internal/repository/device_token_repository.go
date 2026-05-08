package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type postgresDeviceTokenRepository struct {
	db *gorm.DB
}

// NewDeviceTokenRepository construye un DeviceTokenRepository respaldado por PostgreSQL.
func NewDeviceTokenRepository(db *gorm.DB) DeviceTokenRepository {
	return &postgresDeviceTokenRepository{db: db}
}

// Upsert inserta un DeviceToken o lo actualiza si el token ya existe.
// Como Token tiene uniqueIndex global, un mismo token físico nunca pertenece a dos usuarios.
// ON CONFLICT (token) → actualiza user_id y platform (reasignación de token entre usuarios).
func (r *postgresDeviceTokenRepository) Upsert(ctx context.Context, token *domain.DeviceToken) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "token"}},
			DoUpdates: clause.AssignmentColumns([]string{"user_id", "platform", "updated_at"}),
		}).
		Create(token).Error
}

// FindByUserID retorna todos los tokens FCM registrados para un usuario.
func (r *postgresDeviceTokenRepository) FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error) {
	var tokens []domain.DeviceToken
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&tokens).Error
	return tokens, err
}

// DeleteByToken elimina un token FCM por su valor exacto.
// Usado para limpiar tokens inválidos que FCM rechaza con "registration-token-not-registered".
func (r *postgresDeviceTokenRepository) DeleteByToken(ctx context.Context, token string) error {
	return r.db.WithContext(ctx).
		Where("token = ?", token).
		Delete(&domain.DeviceToken{}).Error
}

// Verificación estática: postgresDeviceTokenRepository satisface DeviceTokenRepository.
var _ DeviceTokenRepository = (*postgresDeviceTokenRepository)(nil)
