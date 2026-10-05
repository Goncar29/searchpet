package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

	// La atomicidad sale de dos sentencias que no pueden fallar por carrera:
	// 1) INSERT ... ON CONFLICT (user_id) DO NOTHING asegura la fila. Un
	//    SELECT seguido de INSERT (FirstOrCreate) dejaba que dos eventos
	//    simultáneos de un usuario nuevo insertaran a la vez y el perdedor
	//    chocaba con idx_user_points_user_id (23505), perdiendo su incremento.
	// 2) El UPDATE con expresiones SQL suma sobre el valor ya commiteado: el
	//    bloqueo de fila serializa los incrementos concurrentes.
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoNothing: true,
		}).
		Create(&domain.UserPoints{UserID: userID}).Error; err != nil {
		return nil, err
	}

	// Construir el mapa de actualizaciones: siempre sumamos puntos + el campo específico.
	updates := map[string]interface{}{
		"points": gorm.Expr("GREATEST(points + ?, 0)", pointsDelta),
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
