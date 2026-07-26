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
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
	"lost-pets/pkg/googleauth"
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
	// fosterHomeService is OPTIONAL (may be nil): when wired, UpdateProfile uses it
	// to record owner contact changes on the user's foster home forensic history.
	// A nil value makes the hook a no-op.
	fosterHomeService FosterHomeService
	// googleVerifier is OPTIONAL (may be nil): nil means GOOGLE_CLIENT_ID is not
	// configured, and LoginWithGoogle fails closed with ErrGoogleSignInUnavailable.
	googleVerifier googleauth.Verifier
}

// NewAuthService crea una instancia del servicio de auth con sus dependencias.
// fosterHomeService puede ser nil (hook de contacto es no-op en ese caso).
// googleVerifier puede ser nil (login con Google deshabilitado).
func NewAuthService(
	userRepo repository.UserRepository,
	secretKey string,
	storage *storage.CloudinaryClient,
	fosterHomeService FosterHomeService,
	googleVerifier googleauth.Verifier,
) AuthService {
	return &authService{
		userRepo:          userRepo,
		secretKey:         secretKey,
		storage:           storage,
		fosterHomeService: fosterHomeService,
		googleVerifier:    googleVerifier,
	}
}

// Register crea un nuevo usuario, hashea su password y retorna el usuario + JWT
func (s *authService) Register(ctx context.Context, email, password, name, city string) (*domain.User, string, error) {
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
		City:         city,
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

	secureURL, _, err := s.storage.UploadImage(ctx, file, publicID, "searchpet")
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

// UpdatePreferences actualiza las preferencias de búsqueda del usuario.
// Valida que SearchRadiusMeters esté en el rango 1000–50000.
func (s *authService) UpdatePreferences(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error) {
	if req.SearchRadiusMeters < 1000 || req.SearchRadiusMeters > 50000 {
		return nil, domain.ErrInvalidInput
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	user.SearchRadiusMeters = req.SearchRadiusMeters
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	return &dto.UserPreferencesResponse{
		SearchRadiusMeters: user.SearchRadiusMeters,
	}, nil
}

// UpdateProfile actualiza el nombre y teléfono del usuario. Si el usuario dueño
// tiene un hogar transitorio, los cambios de contacto (name/phone) se registran
// en el historial forense del hogar vía RecordOwnerContactChange (best-effort:
// nunca hace fallar el update de perfil).
func (s *authService) UpdateProfile(ctx context.Context, id uuid.UUID, name, phone, city string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	oldName := user.Name
	oldPhone := user.Phone

	if name != "" {
		user.Name = name
	}
	user.Phone = phone
	if city != "" {
		user.City = city
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	if s.fosterHomeService != nil {
		changed := map[string][2]string{}
		if user.Name != oldName {
			changed["name"] = [2]string{oldName, user.Name}
		}
		if user.Phone != oldPhone {
			changed["phone"] = [2]string{oldPhone, user.Phone}
		}
		if len(changed) > 0 {
			if err := s.fosterHomeService.RecordOwnerContactChange(ctx, id, changed); err != nil {
				log.Printf("[auth_service] failed to record owner contact change for %s: %v", id, err)
			}
		}
	}

	return user, nil
}

// LoginWithGoogle resuelve un ID token de Google a una sesión nuestra.
//
// Tres caminos, en orden:
//  1. GoogleID conocido  → login de usuario que vuelve.
//  2. Email conocido     → vincula Google a la cuenta local existente.
//  3. Nada conocido      → crea el usuario.
//
// SEGURIDAD: los caminos 2 y 3 solo se alcanzan con claims.EmailVerified == true.
// Ese gate impide que un tercero reclame la cuenta de un email que NO controla.
// NO alcanza por sí solo para el camino 2: Register no exige ninguna prueba del
// email, así que una cuenta local con EmailVerified=false pudo haberla plantado
// un atacante. Por eso al vincular una cuenta no verificada se descarta su
// contraseña (ver el comentario en ese bloque).
func (s *authService) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error) {
	if s.googleVerifier == nil {
		log.Println("[auth_service] login con Google solicitado pero GOOGLE_CLIENT_ID no está configurado")
		return nil, "", false, domain.ErrGoogleSignInUnavailable
	}

	claims, err := s.googleVerifier.Verify(ctx, idToken)
	if err != nil {
		log.Printf("[auth_service] google: verificación de id token falló: %v", err)
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}
	if !claims.EmailVerified {
		return nil, "", false, domain.ErrGoogleEmailUnverified
	}
	if claims.Sub == "" || claims.Email == "" {
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))

	// 1. Usuario que vuelve — match por el `sub` estable de Google.
	existing, err := s.userRepo.GetByGoogleID(ctx, claims.Sub)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 2. Cuenta local con el mismo email (verificado por Google) — vincular.
	existing, err = s.userRepo.GetByEmail(ctx, email)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		// Una cuenta ya vinculada a OTRA cuenta de Google no se re-vincula por
		// coincidencia de email: eso pasa cuando una dirección cambia de dueño
		// (buzón de Workspace reasignado, cuenta de Google borrada y reemitida).
		// Sin esto, el nuevo dueño del email se queda con la cuenta del anterior.
		if existing.GoogleID != "" && existing.GoogleID != claims.Sub {
			return nil, "", false, domain.ErrGoogleAccountMismatch
		}
		// SEGURIDAD — pre-hijacking: Register no exige ninguna prueba de que el
		// email sea tuyo, así que una cuenta con EmailVerified=false pudo haberla
		// creado un atacante con TU email y una contraseña que él eligió. Si
		// dejáramos vivir esa contraseña, al vincular te meteríamos en una cuenta
		// que el atacante también puede abrir. Se descarta: quien acaba de probar
		// el email ante Google es el dueño legítimo, y entra por Google.
		if !existing.EmailVerified {
			existing.PasswordHash = ""
		}
		existing.GoogleID = claims.Sub
		existing.EmailVerified = true
		// Invariante del codebase (verification_service.go): IsVerified es
		// EmailVerified || PhoneVerified. Sin esto, todo usuario de Google
		// quedaría sin insignia de verificado en la UI.
		existing.IsVerified = true
		if err := s.userRepo.Update(ctx, existing); err != nil {
			return nil, "", false, err
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 3. Usuario nuevo.
	user := &domain.User{
		Email:              email,
		Name:               claims.Name,
		GoogleID:           claims.Sub,
		PasswordHash:       "", // sin contraseña: bcrypt contra "" siempre falla → login por password bloqueado
		EmailVerified:      true,
		IsVerified:         true, // invariante: EmailVerified || PhoneVerified
		VerificationMethod: "google",
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, "", false, err
	}

	// Foto: best-effort. Nunca bloquea el alta.
	if photoURL := s.importGooglePhoto(ctx, user.ID, claims.Picture); photoURL != "" {
		user.ProfilePhotoURL = photoURL
		if err := s.userRepo.Update(ctx, user); err != nil {
			log.Printf("[auth_service] google: no se pudo persistir la foto de perfil de %s: %v", user.ID, err)
			user.ProfilePhotoURL = ""
		}
	}

	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", false, err
	}
	return user, token, true, nil
}

// issueToken genera nuestro JWT y normaliza el error a ErrInternal.
func (s *authService) issueToken(user *domain.User) (string, error) {
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return "", domain.ErrInternal
	}
	return token, nil
}

// importGooglePhoto es reemplazada por la implementación real en la tarea 6.
func (s *authService) importGooglePhoto(_ context.Context, _ uuid.UUID, _ string) string {
	return ""
}
