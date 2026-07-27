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
	City     string `json:"city"`
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
	City            string    `json:"city,omitempty"`
	ProfilePhotoURL string    `json:"profile_photo_url,omitempty"`
	IsVerified      bool      `json:"is_verified"`
	IsAdmin         bool      `json:"is_admin"`
	CreatedAt       time.Time `json:"created_at"`
}

// AuthResponse es lo que retornamos después de register o login
type AuthResponse struct {
	User  UserResponse `json:"user"`
	Token string       `json:"token"`
}

// GoogleAuthRequest es el ID token que el botón de Google Identity Services
// obtiene en el navegador y nos manda para verificar server-side.
type GoogleAuthRequest struct {
	IDToken string `json:"id_token" binding:"required"`
}

// GoogleAuthResponse extiende AuthResponse con IsNewUser, que le dice al cliente
// si tiene que mostrar el paso de onboarding de ubicación.
type GoogleAuthResponse struct {
	User      UserResponse `json:"user"`
	Token     string       `json:"token"`
	IsNewUser bool         `json:"is_new_user"`
}

// UpdateLocationRequest — todos los campos son opcionales, pero lat y lng viajan
// como par: una sin la otra es una coordenada inválida, no un update parcial.
type UpdateLocationRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	City      string   `json:"city"`
}

// UpdateProfileRequest son los datos que el cliente manda para actualizar su perfil
type UpdateProfileRequest struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	City  string `json:"city"`
}

// UpdatePreferencesRequest son los datos para actualizar las preferencias del usuario
type UpdatePreferencesRequest struct {
	SearchRadiusMeters int `json:"search_radius_meters" binding:"required"`
}

// UserPreferencesResponse son las preferencias actuales del usuario
type UserPreferencesResponse struct {
	SearchRadiusMeters int `json:"search_radius_meters"`
}

// ToUserResponse convierte un domain.User en un UserResponse (DTO)
func ToUserResponse(user *domain.User) UserResponse {
	return UserResponse{
		ID:              user.ID,
		Email:           user.Email,
		Name:            user.Name,
		Phone:           user.Phone,
		City:            user.City,
		ProfilePhotoURL: user.ProfilePhotoURL,
		IsVerified:      user.IsVerified,
		IsAdmin:         user.IsAdmin,
		CreatedAt:       user.CreatedAt,
	}
}
