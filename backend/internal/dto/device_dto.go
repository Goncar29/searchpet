package dto

// RegisterDeviceTokenRequest es el payload para POST /api/devices/token.
// Registra o actualiza el token FCM de un dispositivo para el usuario autenticado.
// El `max` replica device_tokens.token (size:500). Platform no lo necesita: ya
// está acotado por la allowlist de device_handler.go, que es más estricta que
// su columna.
type RegisterDeviceTokenRequest struct {
	Token    string `json:"token" binding:"required,max=500"`
	Platform string `json:"platform" binding:"required"`
}
