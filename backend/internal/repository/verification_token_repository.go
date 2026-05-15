package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresVerificationTokenRepository struct {
	db *gorm.DB
}

// NewVerificationTokenRepository construye el repositorio de tokens OTP.
func NewVerificationTokenRepository(db *gorm.DB) VerificationTokenRepository {
	return &postgresVerificationTokenRepository{db: db}
}

func (r *postgresVerificationTokenRepository) Create(ctx context.Context, token *domain.VerificationToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

// FindActiveByUser busca un token activo (used=false AND expires_at > NOW()) para el usuario y canal dados.
func (r *postgresVerificationTokenRepository) FindActiveByUser(ctx context.Context, userID uuid.UUID, channel string) (*domain.VerificationToken, error) {
	var token domain.VerificationToken
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND channel = ? AND used = false AND expires_at > ?", userID, channel, time.Now()).
		Order("created_at DESC").
		First(&token).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil // No hay token activo — caller verifica nil
		}
		return nil, err
	}
	return &token, nil
}

// MarkUsed invalida el token (used = true).
func (r *postgresVerificationTokenRepository) MarkUsed(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("id = ?", id).
		UpdateColumn("used", true).Error
}

// IncrementAttempts incrementa el contador de forma atómica y retorna el nuevo valor.
func (r *postgresVerificationTokenRepository) IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error) {
	result := r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("id = ?", id).
		UpdateColumn("attempts", gorm.Expr("attempts + 1"))
	if result.Error != nil {
		return 0, result.Error
	}

	// Leer el nuevo valor después del update
	var token domain.VerificationToken
	if err := r.db.WithContext(ctx).Select("attempts").Where("id = ?", id).First(&token).Error; err != nil {
		return 0, err
	}
	return token.Attempts, nil
}

// DeleteExpired elimina tokens expirados y retorna la cantidad eliminada.
func (r *postgresVerificationTokenRepository) DeleteExpired(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("expires_at < ?", time.Now()).
		Delete(&domain.VerificationToken{})
	return result.RowsAffected, result.Error
}
