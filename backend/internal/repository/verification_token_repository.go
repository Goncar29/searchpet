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

// MarkAllUsedByUser invalida todos los tokens activos del usuario en un canal.
// No filtra por expires_at a propósito: un token ya expirado tampoco sirve, y
// marcarlo igual deja el estado sin tokens activos rezagados.
func (r *postgresVerificationTokenRepository) MarkAllUsedByUser(ctx context.Context, userID uuid.UUID, channel string) error {
	return r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("user_id = ? AND channel = ? AND used = false", userID, channel).
		UpdateColumn("used", true).Error
}

// MarkAllUsedByUserExcept es MarkAllUsedByUser preservando exceptID, para poder
// acuñar el token nuevo antes de retirar los viejos. Mismo criterio con
// expires_at: no se filtra, así no quedan activos rezagados.
func (r *postgresVerificationTokenRepository) MarkAllUsedByUserExcept(ctx context.Context, userID uuid.UUID, channel string, exceptID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("user_id = ? AND channel = ? AND used = false AND id <> ?", userID, channel, exceptID).
		UpdateColumn("used", true).Error
}

// CountSince cuenta tokens del canal creados desde `since`. Con userID nil cuenta
// el canal entero (la reserva global); con userID cuenta esa cuenta sola.
//
// NO filtra por `used`, y eso es lo único importante de esta función:
// MarkAllUsedByUserExcept marca los códigos anteriores del usuario como usados
// cada vez que se acuña uno nuevo, así que filtrar por used haría que PEDIR UN
// CÓDIGO NUEVO RESETEE EL CAP y el tope directamente no existiría.
func (r *postgresVerificationTokenRepository) CountSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (int64, error) {
	q := r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", channel, since)
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}

	var n int64
	if err := q.Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// OldestCreatedAtSince retorna el created_at más viejo del canal dentro de la
// ventana, o nil si no hay filas. Con userID nil mide el canal entero.
//
// No filtra por `used` a propósito, por el mismo motivo que CountSince: el cupo
// cuenta códigos EMITIDOS, y un token canjeado ya gastó su mail. Si filtrara,
// este número diría que hay cupo libre antes de que realmente lo haya.
func (r *postgresVerificationTokenRepository) OldestCreatedAtSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (*time.Time, error) {
	q := r.db.WithContext(ctx).
		Model(&domain.VerificationToken{}).
		Where("channel = ? AND created_at >= ?", channel, since)
	if userID != nil {
		q = q.Where("user_id = ?", *userID)
	}

	var oldest []time.Time
	if err := q.Order("created_at ASC").Limit(1).Pluck("created_at", &oldest).Error; err != nil {
		return nil, err
	}
	if len(oldest) == 0 {
		return nil, nil
	}
	return &oldest[0], nil
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

// DeleteByID borra un token puntual, sin condiciones. Existe para el fallo de
// envío: marcarlo usado liberaba el cooldown pero la fila seguía contando para el
// cupo diario, porque CountSince ignora `used`. Un código que nunca salió no está
// en manos de nadie y no debe gastar cupo.
func (r *postgresVerificationTokenRepository) DeleteByID(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("id = ?", id).
		Delete(&domain.VerificationToken{}).Error
}

// TokenRetention es cuánta historia conserva la tabla más allá del vencimiento.
//
// Existe porque el cupo diario de recuperación CUENTA historia sobre estas filas
// y este borrado es DURO: VerificationToken no tiene gorm.DeletedAt. Los OTP
// vencen a los 10 minutos, así que el sweeper horario de router.go, barriendo
// apenas vencían, vaciaba la ventana de conteo entera cada hora y convertía el
// tope de 3 por día en 3 por HORA (~72/día) sin que nada lo delatara.
//
// service.QuotaWindow LEE esta constante en vez de duplicarla, y DeleteExpired no
// toma la retención por parámetro: si fuese configurable, un call site podría
// pasar cero y no habría test que lo cazara — el tope quedaría dependiendo de que
// alguien leyera un comentario. Un solo valor, un solo lector, imposible de
// desalinear.
const TokenRetention = 24 * time.Hour

// DeleteExpired elimina tokens vencidos hace más de TokenRetention y retorna la
// cantidad eliminada.
func (r *postgresVerificationTokenRepository) DeleteExpired(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("expires_at < ?", time.Now().Add(-TokenRetention)).
		Delete(&domain.VerificationToken{})
	return result.RowsAffected, result.Error
}
