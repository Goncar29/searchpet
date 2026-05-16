package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// postgresUserPointsRepository implementa la interfaz UserPointsRepository usando PostgreSQL.
type postgresUserPointsRepository struct {
	db *gorm.DB
}

// NewUserPointsRepository crea una nueva instancia del repositorio de puntos de usuario.
func NewUserPointsRepository(db *gorm.DB) UserPointsRepository {
	return &postgresUserPointsRepository{db: db}
}

// Upsert crea o incrementa el registro de puntos del usuario de forma atómica.
// pointsDelta se suma al campo points. field indica qué contador específico incrementar
// (valores válidos: "total_reports", "found_count", "share_count").
// Retorna el registro actualizado tras aplicar los cambios.
func (r *postgresUserPointsRepository) Upsert(ctx context.Context, userID uuid.UUID, pointsDelta int, field string) (*domain.UserPoints, error) {
	var points domain.UserPoints

	// FirstOrCreate garantiza que exista un registro para el usuario.
	// Usamos un mapa en lugar de struct para evitar que GORM incluya campos zero-value en el WHERE.
	result := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		FirstOrCreate(&points, map[string]interface{}{"user_id": userID})
	if result.Error != nil {
		return nil, result.Error
	}

	// Construir el mapa de actualizaciones: siempre sumamos puntos + el campo específico.
	updates := map[string]interface{}{
		"points": gorm.Expr("points + ?", pointsDelta),
	}

	// Solo incrementamos el campo del contador si es uno de los válidos.
	switch field {
	case "total_reports":
		updates["total_reports"] = gorm.Expr("total_reports + 1")
	case "found_count":
		updates["found_count"] = gorm.Expr("found_count + 1")
	case "share_count":
		updates["share_count"] = gorm.Expr("share_count + 1")
	}

	// Aplicamos la actualización atómica usando expresiones SQL.
	if err := r.db.WithContext(ctx).
		Model(&domain.UserPoints{}).
		Where("user_id = ?", userID).
		Updates(updates).Error; err != nil {
		return nil, err
	}

	// Recargamos el registro actualizado para retornar el estado real de la BD.
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		First(&points).Error; err != nil {
		return nil, err
	}

	return &points, nil
}

// GetByUserID retorna los puntos del usuario.
// Retorna domain.ErrPointsNotFound si el usuario no tiene registro de puntos aún.
func (r *postgresUserPointsRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.UserPoints, error) {
	var points domain.UserPoints
	if err := r.db.WithContext(ctx).
		First(&points, "user_id = ?", userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrPointsNotFound
		}
		return nil, err
	}
	return &points, nil
}

// FindLeaderboard retorna los usuarios con más puntos en una ciudad, ordenados de mayor a menor.
// Hace JOIN con la tabla users para filtrar por ciudad (case-insensitive) y para precargar
// el nombre e ID del usuario en el resultado.
// limit define cuántos registros retornar (la capa de servicio debe validar y capear).
func (r *postgresUserPointsRepository) FindLeaderboard(ctx context.Context, city string, limit int) ([]domain.UserPoints, error) {
	var results []domain.UserPoints

	err := r.db.WithContext(ctx).
		Joins("JOIN users ON users.id = user_points.user_id").
		Where("LOWER(users.city) = LOWER(?)", city).
		Preload("User").
		Order("user_points.points DESC").
		Limit(limit).
		Find(&results).Error
	if err != nil {
		return nil, err
	}

	return results, nil
}
