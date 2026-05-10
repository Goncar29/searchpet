package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/jwt"
	"lost-pets/pkg/storage"
)

var reInvalidCharsUser = regexp.MustCompile(`[^a-zA-Z0-9_\-]`)

func sanitizeAvatarPublicID(userID, filename string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	base = reInvalidCharsUser.ReplaceAllString(base, "_")
	if base == "" {
		base = "avatar"
	}
	return fmt.Sprintf("users/%s/%s", userID, base)
}

type authService struct {
	userRepo  repository.UserRepository
	secretKey string
	storage   *storage.CloudinaryClient
}

// NewAuthService crea una instancia del servicio de auth con sus dependencias
func NewAuthService(userRepo repository.UserRepository, secretKey string, storage *storage.CloudinaryClient) AuthService {
	return &authService{
		userRepo:  userRepo,
		secretKey: secretKey,
		storage:   storage,
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

// UpdateProfilePhoto sube la foto a Cloudinary y actualiza la URL en BD
func (s *authService) UpdateProfilePhoto(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error) {
	if s.storage == nil {
		log.Println("[auth_service] Cloudinary no configurado — no se puede subir foto de perfil")
		return nil, domain.ErrStorageFailed
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if seeker, ok := file.(io.Seeker); ok {
		_, _ = seeker.Seek(0, io.SeekStart)
	}

	publicID := sanitizeAvatarPublicID(id.String(), filename)
	log.Printf("[auth_service] Subiendo foto de perfil a Cloudinary — publicID: %s", publicID)

	secureURL, err := s.storage.UploadImage(ctx, file, publicID)
	if err != nil {
		log.Printf("[auth_service] Error en Cloudinary: %v", err)
		return nil, domain.ErrStorageFailed
	}

	user.ProfilePhotoURL = secureURL
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

// UpdateProfile actualiza el nombre y teléfono del usuario
func (s *authService) UpdateProfile(ctx context.Context, id uuid.UUID, name, phone string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		user.Name = name
	}
	user.Phone = phone
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}
