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
	ErrPetNotFound    = errors.New("mascota no encontrada")
	ErrNotPetOwner    = errors.New("no eres el dueño de esta mascota")
	ErrPetAlreadyFound = errors.New("mascota ya fue encontrada")

	// Report
	ErrReportNotFound = errors.New("reporte no encontrado")
	ErrInvalidStatus  = errors.New("status inválido")

	// Message
	ErrUserBlocked     = errors.New("usuario bloqueado, no puedes enviar mensajes")
	ErrSelfMessage     = errors.New("no puedes enviarte mensajes a ti mismo")
	ErrMessageNotFound = errors.New("mensaje no encontrado")

	// Favorite
	ErrAlreadyFavorited = errors.New("la mascota ya está en favoritos")
	ErrFavoriteNotFound = errors.New("favorito no encontrado")

	// Shelter
	ErrShelterNotFound = errors.New("refugio no encontrado")

	// Block
	ErrBlockNotFound = errors.New("bloqueo no encontrado")

	// Photo
	ErrInvalidFileType = errors.New("tipo de archivo no permitido; solo jpeg, png y webp")
	ErrFileTooLarge    = errors.New("el archivo supera el límite de 5 MB")
	ErrStorageFailed   = errors.New("error al subir la imagen; intenta nuevamente")

	// Share
	ErrShareLinkNotFound = errors.New("link de compartir no encontrado")
	ErrShareLinkExpired  = errors.New("link de compartir expirado")

	// General
	ErrUnauthorized = errors.New("no autorizado")
	ErrForbidden    = errors.New("acceso prohibido")
	ErrInvalidInput = errors.New("datos de entrada inválidos")
	ErrInternal     = errors.New("error interno del servidor")
)
