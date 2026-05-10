package service

import (
	"context"
	"mime/multipart"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// AuthService define el contrato para la lógica de autenticación
type AuthService interface {
	// Register crea un nuevo usuario y retorna el usuario + JWT
	// Retorna error si el email ya existe o si los datos son inválidos
	Register(ctx context.Context, email, password, name string) (*domain.User, string, error)

	// Login verifica las credenciales y retorna el usuario + JWT
	// Retorna error si las credenciales son inválidas o el usuario está baneado
	Login(ctx context.Context, email, password string) (*domain.User, string, error)

	// GetUser obtiene los datos de un usuario por su ID
	// Retorna error si el usuario no existe
	GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error)

	// UpdateProfile actualiza el nombre y teléfono del usuario
	UpdateProfile(ctx context.Context, id uuid.UUID, name, phone string) (*domain.User, error)

	// UpdateProfilePhoto sube la foto de perfil a Cloudinary y actualiza la URL en BD
	UpdateProfilePhoto(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error)
}
