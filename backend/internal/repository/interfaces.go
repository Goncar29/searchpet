package repository

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// UserRepository define el contrato para acceder a datos de usuarios
type UserRepository interface {
	// Create inserta un nuevo usuario en la BD
	Create(ctx context.Context, user *domain.User) error

	// GetByID obtiene un usuario por su ID
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)

	// GetByEmail obtiene un usuario por su email (único)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)

	// Update actualiza los datos de un usuario existente
	Update(ctx context.Context, user *domain.User) error

	// Delete elimina un usuario por su ID
	Delete(ctx context.Context, id uuid.UUID) error
}
