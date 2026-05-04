package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/jwt"
)

type authService struct {
	userRepo  repository.UserRepository
	secretKey string
}

// NewAuthService crea una instancia del servicio de auth con sus dependencias
func NewAuthService(userRepo repository.UserRepository, secretKey string) AuthService {
	return &authService{
		userRepo:  userRepo,
		secretKey: secretKey,
	}
}

// Register crea un nuevo usuario, hashea su password y retorna el usuario + JWT
func (s *authService) Register(ctx context.Context, email, password, name string) (*domain.User, string, error) {
	// 1. Verificar que el email no esté en uso
	_, err := s.userRepo.GetByEmail(ctx, email)
	if err == nil {
		// Si no hubo error, el usuario ya existe
		return nil, "", domain.ErrEmailAlreadyExists
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		// Si el error es distinto a "no encontrado", es un error de BD
		return nil, "", err
	}

	// 2. Hashear el password con bcrypt
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	// 3. Crear el usuario en BD
	user := &domain.User{
		Email:        email,
		PasswordHash: string(hash),
		Name:         name,
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, "", err
	}

	// 4. Generar JWT
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	return user, token, nil
}

// Login verifica las credenciales del usuario y retorna el usuario + JWT
func (s *authService) Login(ctx context.Context, email, password string) (*domain.User, string, error) {
	// 1. Buscar usuario por email
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// No revelamos si el email existe o no (seguridad)
			return nil, "", domain.ErrInvalidCredentials
		}
		return nil, "", err
	}

	// 2. Verificar que no esté baneado
	if user.IsBanned {
		return nil, "", domain.ErrUserBanned
	}

	// 3. Comparar el password con el hash guardado en BD
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, "", domain.ErrInvalidCredentials
	}

	// 4. Generar JWT
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	return user, token, nil
}

// GetUser retorna los datos de un usuario por su ID
func (s *authService) GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return s.userRepo.GetByID(ctx, id)
}
