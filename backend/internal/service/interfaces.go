package service

import (
	"context"
	"mime/multipart"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// VerificationService define el contrato para verificación de identidad via OTP.
type VerificationService interface {
	// SendOTP genera y envía un OTP al usuario por el canal dado ("email" o "sms").
	// Retorna error rate-limit si ya se envió en el último minuto.
	// Retorna 422-class error si channel="sms" y el usuario no tiene teléfono.
	SendOTP(ctx context.Context, userID uuid.UUID, channel string) error
	// ConfirmOTP verifica el código OTP del usuario.
	// Retorna ErrOTPExpired si el token expiró, ErrOTPInvalid si el código es incorrecto.
	// Al superar 5 intentos fallidos, invalida el token.
	ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code string) error
}

// ErrRateLimitOTP es retornado cuando se intenta enviar un OTP dentro del período de rate limit.
// RetryAfter indica los segundos que el cliente debe esperar.
type ErrRateLimitOTP struct {
	RetryAfter int
}

func (e *ErrRateLimitOTP) Error() string {
	return "rate limit: espera antes de solicitar otro código"
}

// ErrNoPhoneOnFile es retornado cuando se solicita SMS pero el usuario no tiene teléfono.
type ErrNoPhoneOnFile struct{}

func (e *ErrNoPhoneOnFile) Error() string {
	return "no_phone_on_file"
}

// ErrExternalService es retornado cuando un proveedor externo (SendGrid, Twilio) falla.
// El handler lo mapea a 502 Bad Gateway.
type ErrExternalService struct {
	Cause error
}

func (e *ErrExternalService) Error() string {
	return "error en servicio externo"
}

func (e *ErrExternalService) Unwrap() error {
	return e.Cause
}

// AbuseReportService define el contrato para denuncias de fraude/abuso.
type AbuseReportService interface {
	Submit(ctx context.Context, reporterID uuid.UUID, req dto.CreateAbuseReportRequest) (*domain.ReportAbuse, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error)
	List(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error)
	Resolve(ctx context.Context, id uuid.UUID, adminID uuid.UUID, status string) error
}

// GroupService define el contrato para grupos locales.
type GroupService interface {
	CreateGroup(ctx context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error)
	List(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error)
	Join(ctx context.Context, groupID, userID uuid.UUID) error
	Leave(ctx context.Context, groupID, userID uuid.UUID) error
}

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
