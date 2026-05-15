package service

import (
	"context"
	"mime/multipart"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// SuccessStoryService define el contrato para historias de éxito.
type SuccessStoryService interface {
	Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	Like(ctx context.Context, id uuid.UUID) error
	SetFeatured(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error
	Delete(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error
}

// BlockService define el contrato para la lógica de bloqueo de usuarios.
type BlockService interface {
	Block(ctx context.Context, blockerID, blockedID uuid.UUID) error
	Unblock(ctx context.Context, blockerID, blockedID uuid.UUID) error
	GetBlocked(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error)
}

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

	// UpdatePreferences actualiza las preferencias de búsqueda del usuario (radio en metros)
	// Retorna error si SearchRadiusMeters está fuera del rango 1000–50000
	UpdatePreferences(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error)
}
