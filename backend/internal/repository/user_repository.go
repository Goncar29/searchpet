package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// postgresUserRepository implementa la interfaz UserRepository usando PostgreSQL
type postgresUserRepository struct {
	db *gorm.DB
}

// NewUserRepository crea una nueva instancia del repositorio de usuarios
func NewUserRepository(db *gorm.DB) UserRepository {
	return &postgresUserRepository{db: db}
}

// Create inserta un nuevo usuario en la base de datos
// Si el email ya existe, GORM retorna un error de constraint violation
func (r *postgresUserRepository) Create(ctx context.Context, user *domain.User) error {
	if err := r.db.WithContext(ctx).Create(user).Error; err != nil {
		return err
	}
	return nil
}

// GetByID obtiene un usuario por su ID
// Retorna domain.ErrUserNotFound si no existe
func (r *postgresUserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	user := &domain.User{}
	if err := r.db.WithContext(ctx).First(user, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrUserNotFound
		}
		return nil, err
	}
	return user, nil
}

// GetByEmail obtiene un usuario por su email (único)
// Retorna domain.ErrUserNotFound si no existe
func (r *postgresUserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	user := &domain.User{}
	if err := r.db.WithContext(ctx).First(user, "email = ?", email).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrUserNotFound
		}
		return nil, err
	}
	return user, nil
}

// Update actualiza los datos de un usuario existente
// Nota: GORM actualiza solo los campos que cambiaron (smart update)
func (r *postgresUserRepository) Update(ctx context.Context, user *domain.User) error {
	if err := r.db.WithContext(ctx).Save(user).Error; err != nil {
		return err
	}
	return nil
}

// Delete elimina un usuario por su ID (hard delete)
// Nota: Este es un hard delete. Para soft delete usar .Delete() sin .Unscoped()
func (r *postgresUserRepository) Delete(ctx context.Context, id uuid.UUID) error {
	if err := r.db.WithContext(ctx).Delete(&domain.User{}, "id = ?", id).Error; err != nil {
		return err
	}
	return nil
}