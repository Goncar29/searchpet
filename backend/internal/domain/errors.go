package domain

import "errors"

// Errores de dominio - centralizados para consistencia
var (
	// Auth
	ErrInvalidCredentials = errors.New("credenciales inválidas")
	ErrEmailAlreadyExists = errors.New("el email ya está registrado")
	ErrUserBanned         = errors.New("usuario bloqueado")

	// User
	ErrUserNotFound = errors.New("usuario no encontrado")

	// Pet
	ErrPetNotFound        = errors.New("mascota no encontrada")
	ErrNotPetOwner        = errors.New("no eres el dueño de esta mascota")
	ErrPetAlreadyFound    = errors.New("mascota ya fue encontrada")
	ErrPetArchived        = errors.New("mascota archivada, no se puede marcar como encontrada")
	ErrPetNotFoundStatus  = errors.New("la mascota debe estar marcada como encontrada para crear una historia")

	// Report
	ErrReportNotFound = errors.New("reporte no encontrado")
	ErrInvalidStatus  = errors.New("status inválido")

	// Message
	ErrUserBlocked          = errors.New("usuario bloqueado, no puedes enviar mensajes")
	ErrSelfMessage          = errors.New("no puedes enviarte mensajes a ti mismo")
	ErrMessageNotFound      = errors.New("mensaje no encontrado")
	ErrNotMessageReceiver   = errors.New("no eres el destinatario de este mensaje")

	// Favorite
	ErrAlreadyFavorited = errors.New("la mascota ya está en favoritos")
	ErrFavoriteNotFound = errors.New("favorito no encontrado")

	// Shelter
	ErrShelterNotFound = errors.New("refugio no encontrado")

	// Block
	ErrBlockNotFound = errors.New("bloqueo no encontrado")

	// Photo
	ErrInvalidFileType    = errors.New("tipo de archivo no permitido; solo jpeg, png y webp")
	ErrFileTooLarge       = errors.New("el archivo supera el límite de 5 MB")
	ErrStorageFailed      = errors.New("error al subir la imagen; intenta nuevamente")
	ErrPhotoLimitReached  = errors.New("límite de 3 fotos por mascota alcanzado")

	// Share
	ErrShareLinkNotFound = errors.New("link de compartir no encontrado")
	ErrShareLinkExpired  = errors.New("link de compartir expirado")

	// Alert
	ErrAlertNotFound    = errors.New("alerta no encontrada")
	ErrAlertLimitExceeded = errors.New("límite de 10 alertas activas alcanzado")
	ErrNotAlertOwner    = errors.New("no eres el dueño de esta alerta")

	// Community (V1.3)
	ErrStoryNotFound       = errors.New("historia no encontrada")
	ErrGroupNotFound       = errors.New("grupo no encontrado")
	ErrCityGroupExists     = errors.New("ya existe un grupo para esta ciudad")
	ErrAlreadyMember       = errors.New("ya eres miembro de este grupo")
	ErrNotMember           = errors.New("no eres miembro de este grupo")
	ErrAbuseReportNotFound = errors.New("denuncia no encontrada")
	ErrNotAdmin            = errors.New("forbidden")

	// Verification (V1.3)
	ErrOTPExpired = errors.New("otp_expired")
	ErrOTPInvalid = errors.New("otp_invalid")

	// Gamification (V1.4)
	ErrBadgeAlreadyEarned = errors.New("badge already earned")
	ErrPointsNotFound     = errors.New("user points not found")

	// Review (V1.5)
	ErrReviewNotFound  = errors.New("review not found")
	ErrAlreadyReviewed = errors.New("you have already reviewed this user")
	ErrSelfReview      = errors.New("you cannot review yourself")

	// General
	ErrUnauthorized = errors.New("no autorizado")
	ErrForbidden    = errors.New("acceso prohibido")
	ErrInvalidInput = errors.New("datos de entrada inválidos")
	ErrInternal     = errors.New("error interno del servidor")
)
