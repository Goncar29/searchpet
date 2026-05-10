package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// RegisterRequest son los datos que el cliente manda para registrarse
type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Name     string `json:"name" binding:"required"`
}

// LoginRequest son los datos que el cliente manda para iniciar sesión
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// UserResponse son los datos del usuario que retornamos al cliente
// Nunca exponemos PasswordHash ni campos sensibles
type UserResponse struct {
	ID              uuid.UUID `json:"id"`
	Email           string    `json:"email"`
	Name            string    `json:"name"`
	Phone           string    `json:"phone,omitempty"`
	ProfilePhotoURL string    `json:"profile_photo_url,omitempty"`
	IsVerified      bool      `json:"is_verified"`
	CreatedAt       time.Time `json:"created_at"`
}

// AuthResponse es lo que retornamos después de register o login
type AuthResponse struct {
	User  UserResponse `json:"user"`
	Token string       `json:"token"`
}

// UpdateProfileRequest son los datos que el cliente manda para actualizar su perfil
type UpdateProfileRequest struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// ToUserResponse convierte un domain.User en un UserResponse (DTO)
func ToUserResponse(user *domain.User) UserResponse {
	return UserResponse{
		ID:              user.ID,
		Email:           user.Email,
		Name:            user.Name,
		Phone:           user.Phone,
		ProfilePhotoURL: user.ProfilePhotoURL,
		IsVerified:      user.IsVerified,
		CreatedAt:       user.CreatedAt,
	}
}
