package domain

import "errors"

// Errores de dominio - centralizados para consistencia
var (
	// Auth
	ErrInvalidCredentials = errors.New("credenciales inválidas")
	ErrEmailAlreadyExists = errors.New("el email ya está registrado")
	ErrUserBanned         = errors.New("usuario bloqueado")

	// User
	ErrUserNotFound            = errors.New("usuario no encontrado")
	ErrCannotModerateAdmin     = errors.New("no se puede moderar a un administrador")

	// Pet
	ErrPetNotFound             = errors.New("mascota no encontrada")
	ErrNotPetOwner             = errors.New("no eres el dueño de esta mascota")
	ErrPetAlreadyFound         = errors.New("mascota ya fue encontrada")
	ErrPetArchived             = errors.New("mascota archivada, no se puede marcar como encontrada")
	ErrPetStatusLocked         = errors.New("mascota con status final, no se puede modificar el estado")
	ErrPetNotFoundStatus       = errors.New("la mascota debe estar marcada como encontrada para crear una historia")
	ErrInvalidStatusTransition = errors.New("invalid_status_transition")
	ErrConflict                = errors.New("conflict")
	ErrOwnerRequiredForStatus  = errors.New("owner_required_for_status")
	ErrInitialReportRequired   = errors.New("initial_report_required")
	ErrInitialReportNotAllowed = errors.New("initial_report_not_allowed")

	// Report
	ErrReportNotFound = errors.New("reporte no encontrado")
	ErrInvalidStatus  = errors.New("status inválido")

	// Message
	ErrUserBlocked        = errors.New("usuario bloqueado, no puedes enviar mensajes")
	ErrSelfMessage        = errors.New("no puedes enviarte mensajes a ti mismo")
	ErrMessageNotFound    = errors.New("mensaje no encontrado")
	ErrNotMessageReceiver = errors.New("no eres el destinatario de este mensaje")

	// Shelter
	ErrShelterNotFound = errors.New("refugio no encontrado")

	// Block
	ErrBlockNotFound = errors.New("bloqueo no encontrado")

	// Photo
	ErrInvalidFileType   = errors.New("tipo de archivo no permitido; solo jpeg, png y webp")
	ErrFileTooLarge      = errors.New("el archivo supera el límite de 5 MB")
	ErrStorageFailed     = errors.New("error al subir la imagen; intenta nuevamente")
	ErrPhotoLimitReached = errors.New("límite de 3 fotos por mascota alcanzado")
	ErrPhotoNotFound     = errors.New("foto no encontrada")

	// Share
	ErrShareLinkNotFound = errors.New("link de compartir no encontrado")
	ErrShareLinkExpired  = errors.New("link de compartir expirado")

	// Alert
	ErrAlertNotFound      = errors.New("alerta no encontrada")
	ErrAlertLimitExceeded = errors.New("límite de 10 alertas activas alcanzado")
	ErrNotAlertOwner      = errors.New("no eres el dueño de esta alerta")

	// Community (V1.3)
	ErrStoryNotFound       = errors.New("historia no encontrada")
	ErrGroupNotFound       = errors.New("grupo no encontrado")
	ErrCityGroupExists     = errors.New("ya existe un grupo para esta ciudad")
	ErrAlreadyMember       = errors.New("ya eres miembro de este grupo")
	ErrNotMember           = errors.New("no eres miembro de este grupo")
	ErrAbuseReportNotFound = errors.New("denuncia no encontrada")
	ErrNotAdmin            = errors.New("forbidden")

	// Verification (V1.3)
	ErrOTPExpired    = errors.New("otp_expired")
	ErrOTPInvalid    = errors.New("otp_invalid")
	ErrPhoneMismatch = errors.New("phone_mismatch")

	// Gamification (V1.4)
	ErrPointsNotFound = errors.New("user points not found")

	// Review (V1.5)
	ErrReviewNotFound  = errors.New("review not found")
	ErrAlreadyReviewed = errors.New("you have already reviewed this user")
	ErrSelfReview      = errors.New("you cannot review yourself")

	// WebSocket
	ErrTicketRequired = errors.New("ticket requerido")
	ErrTicketInvalid  = errors.New("ticket inválido o expirado")

	// General
	ErrUnauthorized      = errors.New("no autorizado")
	ErrForbidden         = errors.New("acceso prohibido")
	ErrInvalidInput      = errors.New("datos de entrada inválidos")
	ErrInternal          = errors.New("error interno del servidor")
	ErrRateLimitExceeded = errors.New("rate limit exceeded")

	// Validation sentinel errors for handler-level input checks
	ErrPhotoFieldRequired     = errors.New("campo 'photo' requerido")
	ErrInvalidSearchRadius    = errors.New("radius debe estar entre 1000 y 50000 metros")
	ErrInvalidDateParam       = errors.New("parámetro de fecha debe ser RFC3339")
	ErrInvalidPageParam       = errors.New("parámetro 'page' debe ser un entero positivo")
	ErrInvalidLimitParam      = errors.New("parámetro 'limit' debe ser un entero positivo")
	ErrInvalidMultipart       = errors.New("multipart form inválido o demasiado grande")
	ErrImageFieldRequired     = errors.New("campo 'image' requerido")
	ErrImageSearchUnavailable = errors.New("servicio de búsqueda por imagen no disponible temporalmente")
	ErrBindingFailed          = errors.New("datos de entrada inválidos")
)

// ErrorCodes maps every sentinel error to its machine-readable snake_case code.
// Used by CodeFor to produce the `code` field in ErrorResponse.
var ErrorCodes = map[error]string{
	// Auth
	ErrInvalidCredentials: "invalid_credentials",
	ErrEmailAlreadyExists: "email_already_exists",
	ErrUserBanned:         "user_banned",

	// User
	ErrUserNotFound:        "user_not_found",
	ErrCannotModerateAdmin: "cannot_moderate_admin",

	// Pet
	ErrPetNotFound:             "pet_not_found",
	ErrNotPetOwner:             "not_pet_owner",
	ErrPetAlreadyFound:         "pet_already_found",
	ErrPetArchived:             "pet_archived",
	ErrPetStatusLocked:         "pet_status_locked",
	ErrPetNotFoundStatus:       "pet_not_found_status",
	ErrInvalidStatusTransition: "invalid_status_transition",
	ErrConflict:                "conflict",
	ErrOwnerRequiredForStatus:  "owner_required_for_status",
	ErrInitialReportRequired:   "initial_report_required",
	ErrInitialReportNotAllowed: "initial_report_not_allowed",

	// Report
	ErrReportNotFound: "report_not_found",
	ErrInvalidStatus:  "invalid_status",

	// Message
	ErrUserBlocked:        "user_blocked",
	ErrSelfMessage:        "self_message",
	ErrMessageNotFound:    "message_not_found",
	ErrNotMessageReceiver: "not_message_receiver",

	// Shelter
	ErrShelterNotFound: "shelter_not_found",

	// Block
	ErrBlockNotFound: "block_not_found",

	// Photo
	ErrInvalidFileType:   "invalid_file_type",
	ErrFileTooLarge:      "file_too_large",
	ErrStorageFailed:     "storage_failed",
	ErrPhotoLimitReached: "photo_limit_reached",
	ErrPhotoNotFound:     "photo_not_found",

	// Share
	ErrShareLinkNotFound: "share_link_not_found",
	ErrShareLinkExpired:  "share_link_expired",

	// Alert
	ErrAlertNotFound:      "alert_not_found",
	ErrAlertLimitExceeded: "alert_limit_exceeded",
	ErrNotAlertOwner:      "not_alert_owner",

	// Community
	ErrStoryNotFound:       "story_not_found",
	ErrGroupNotFound:       "group_not_found",
	ErrCityGroupExists:     "city_group_exists",
	ErrAlreadyMember:       "already_member",
	ErrNotMember:           "not_member",
	ErrAbuseReportNotFound: "abuse_report_not_found",
	ErrNotAdmin:            "not_admin",

	// Verification
	ErrOTPExpired:    "otp_expired",
	ErrOTPInvalid:    "otp_invalid",
	ErrPhoneMismatch: "phone_mismatch",

	// Gamification
	ErrPointsNotFound: "points_not_found",

	// Review
	ErrReviewNotFound:  "review_not_found",
	ErrAlreadyReviewed: "already_reviewed",
	ErrSelfReview:      "self_review",

	// WebSocket
	ErrTicketRequired: "ticket_required",
	ErrTicketInvalid:  "ticket_invalid",

	// General
	ErrUnauthorized:      "unauthorized",
	ErrForbidden:         "forbidden",
	ErrInvalidInput:      "invalid_input",
	ErrInternal:          "internal_error",
	ErrRateLimitExceeded: "rate_limit_exceeded",

	// Validation sentinel errors
	ErrPhotoFieldRequired:     "photo_field_required",
	ErrInvalidSearchRadius:    "invalid_search_radius",
	ErrInvalidDateParam:       "invalid_date_param",
	ErrInvalidPageParam:       "invalid_page_param",
	ErrInvalidLimitParam:      "invalid_limit_param",
	ErrInvalidMultipart:       "invalid_multipart",
	ErrImageFieldRequired:     "image_field_required",
	ErrImageSearchUnavailable: "image_search_unavailable",
	ErrBindingFailed:          "binding_failed",
}

// CodeFor returns the machine-readable error code for err.
// It iterates ErrorCodes using errors.Is to support wrapped errors.
// Returns "internal_error" when no match is found.
func CodeFor(err error) string {
	for sentinel, code := range ErrorCodes {
		if errors.Is(err, sentinel) {
			return code
		}
	}
	return "internal_error"
}
