package service

import (
	"context"
	"mime/multipart"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
)

// VerificationService define el contrato para verificación de identidad via OTP.
type VerificationService interface {
	// SendOTP genera y envía un OTP al usuario por el canal dado ("email" o "sms").
	// phone es el número destino del OTP (solo usado cuando channel="sms"; pasar "" para email).
	// Retorna error rate-limit si ya se envió en el último minuto.
	SendOTP(ctx context.Context, userID uuid.UUID, channel string) error
	// ConfirmOTP verifica el código OTP del usuario.
	// phone es el número que el cliente afirma haber recibido el OTP (solo usado cuando channel="sms"; pasar "" para email).
	// Retorna ErrOTPExpired si el token expiró, ErrOTPInvalid si el código es incorrecto.
	// Al superar 5 intentos fallidos, invalida el token.
	ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code string) error
	// GetStatus retorna el estado de verificación del usuario (email_verified, phone_verified, is_verified).
	GetStatus(ctx context.Context, userID uuid.UUID) (*dto.VerificationStatusResponse, error)
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

// ErrExternalService es retornado cuando un proveedor externo (Brevo, Twilio) falla.
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
	Count(ctx context.Context, resolved *bool) (int64, error)
	Resolve(ctx context.Context, id uuid.UUID, adminID uuid.UUID, status string) error
}

// GroupService define el contrato para grupos locales.
type GroupService interface {
	CreateGroup(ctx context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error)
	List(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error)
	Join(ctx context.Context, groupID, userID uuid.UUID) error
	Leave(ctx context.Context, groupID, userID uuid.UUID) error
	GetMembers(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error)
}

// SuccessStoryService define el contrato para historias de éxito.
type SuccessStoryService interface {
	Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error)
	List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	Count(ctx context.Context, featured *bool) (int64, error)
	// Like ensures the user likes the story (idempotent). Returns the fresh
	// like_count and liked=true on success.
	Like(ctx context.Context, storyID, userID uuid.UUID) (likeCount int, liked bool, err error)
	// Unlike ensures the user does not like the story (idempotent). Returns
	// the fresh like_count and liked=false on success.
	Unlike(ctx context.Context, storyID, userID uuid.UUID) (likeCount int, liked bool, err error)
	// LikedStoryIDs returns the subset of storyIDs that userID has liked.
	LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error)
	SetFeatured(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error
	Delete(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error
}

// BlockService define el contrato para la lógica de bloqueo de usuarios.
type BlockService interface {
	Block(ctx context.Context, blockerID, blockedID uuid.UUID, reason string) error
	Unblock(ctx context.Context, blockerID, blockedID uuid.UUID) error
	GetBlocked(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error)
	// IsBlocked verifica si existe un bloqueo en cualquier dirección entre userA y userB.
	IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error)
}

// GamificationService define el contrato para la lógica de gamificación:
// puntos, badges, leaderboard y perfiles públicos.
type GamificationService interface {
	// RegisterListeners suscribe los handlers al EventBus.
	// Debe llamarse una vez durante el arranque del servidor.
	RegisterListeners(bus *event.EventBus)

	// AwardBadgeIfEligible otorga un badge al usuario si no lo tiene ya.
	// Retorna nil tanto si se crea exitosamente como si ya lo tenía (idempotente).
	AwardBadgeIfEligible(ctx context.Context, userID uuid.UUID, badgeType string) error

	// GetPublicProfile retorna el perfil público del usuario (sin email ni hash).
	GetPublicProfile(ctx context.Context, userID uuid.UUID) (*dto.UserProfileResponse, error)

	// GetLeaderboard retorna el ranking de usuarios por ciudad, ordenado por puntos DESC.
	// limit se clampea entre 1 y 50, default 10.
	GetLeaderboard(ctx context.Context, city string, limit int) ([]dto.LeaderboardEntry, error)

	// GetMyBadges retorna todos los badges del usuario autenticado.
	GetMyBadges(ctx context.Context, userID uuid.UUID) ([]dto.BadgeResponse, error)
}

// ReviewService define el contrato para la lógica de reseñas de usuarios.
type ReviewService interface {
	// Create crea una reseña del reviewerID al revieweeID.
	// Guards: self-review, blocked, duplicate, rating range, body vacío.
	Create(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.CreateReviewRequest) (*dto.ReviewResponse, error)
	// Update actualiza la reseña existente del par (reviewerID, revieweeID).
	// Solo el reviewer original puede modificar su propia reseña.
	Update(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.UpdateReviewRequest) (*dto.ReviewResponse, error)
	// GetByReviewee retorna las reseñas paginadas para un usuario con estadísticas agregadas.
	GetByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) (*dto.ReviewListResponse, error)
	// Delete elimina la reseña del par (reviewerID, revieweeID).
	// Solo el reviewer original puede eliminar su propia reseña.
	// Retorna ErrReviewNotFound si no existe y ErrForbidden si reviewerID no es el autor.
	Delete(ctx context.Context, reviewerID, revieweeID uuid.UUID) error
}

// PasswordResetService recupera el acceso a una cuenta probando control del
// email con un OTP. Es anónimo: no hay sesión cuando arranca.
type PasswordResetService interface {
	// RequestReset envía un OTP al email si corresponde.
	//
	// SECURITY: devuelve nil para TODO resultado observable por el llamador —
	// email inexistente, usuario baneado, cooldown activo, fallo del mailer, y
	// también cualquier fallo de base POSTERIOR a la búsqueda del usuario.
	// Cualquier diferencia visible convierte al endpoint en un oráculo de qué
	// direcciones están registradas.
	//
	// El ÚNICO error que devuelve es un fallo al buscar el usuario por email:
	// ese es el único que no puede depender de si la dirección existe. Los
	// posteriores sí — solo se alcanzan para cuentas reales — así que se
	// loguean y se tragan.
	RequestReset(ctx context.Context, email string) error

	// ConfirmReset valida el código y fija la contraseña nueva.
	//
	// SECURITY: devuelve domain.ErrOTPInvalid para código errado, token vencido,
	// ausencia de token, email inexistente, usuario baneado y fallos de base
	// posteriores a la búsqueda del usuario, todos por igual. Distinguir el
	// vencimiento del código errado —o un 500 de un 400— permitiría sondear qué
	// cuentas existen mandando un código cualquiera.
	//
	// Igual que en RequestReset, el único error propagado tal cual es un fallo al
	// buscar el usuario por email.
	ConfirmReset(ctx context.Context, email, code, newPassword string) error
}

// AuthService define el contrato para la lógica de autenticación
type AuthService interface {
	// Register crea un nuevo usuario y retorna el usuario + JWT
	// Retorna error si el email ya existe o si los datos son inválidos
	Register(ctx context.Context, email, password, name, city string) (*domain.User, string, error)

	// Login verifica las credenciales y retorna el usuario + JWT
	// Retorna error si las credenciales son inválidas o el usuario está baneado
	Login(ctx context.Context, email, password string) (*domain.User, string, error)

	// LoginWithGoogle verifica un ID token de Google y retorna el usuario, un JWT
	// propio, y si el usuario fue creado en esta llamada (para el onboarding).
	// Vincula automáticamente por email SOLO si Google reporta email_verified.
	LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error)

	// GetUser obtiene los datos de un usuario por su ID
	// Retorna error si el usuario no existe
	GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error)

	// UpdateProfile actualiza el nombre y teléfono del usuario
	UpdateProfile(ctx context.Context, id uuid.UUID, name, phone, city string) (*domain.User, error)

	// UpdateLocation setea la ubicación del usuario (coordenadas y/o ciudad).
	// lat y lng son un par: mandar una sin la otra es ErrInvalidInput.
	UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error)

	// UpdateProfilePhoto sube la foto de perfil a Cloudinary y actualiza la URL en BD
	UpdateProfilePhoto(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error)

	// UpdatePreferences actualiza las preferencias de búsqueda del usuario (radio en metros)
	// Retorna error si SearchRadiusMeters está fuera del rango 1000–50000
	UpdatePreferences(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error)
}
