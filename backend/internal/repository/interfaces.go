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

// PhotoRepository define el contrato para acceder a datos de fotos de mascotas.
type PhotoRepository interface {
	// Create persiste una nueva foto en la BD.
	Create(photo *domain.Photo) error

	// FindByPetID retorna todas las fotos de una mascota, ordenadas por created_at ASC.
	FindByPetID(petID string) ([]domain.Photo, error)

	// HasPrimaryPhoto informa si la mascota ya tiene una foto marcada como primaria.
	HasPrimaryPhoto(petID string) (bool, error)
}
