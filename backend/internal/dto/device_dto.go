package dto

// RegisterDeviceTokenRequest es el payload para POST /api/devices/token.
// Registra o actualiza el token FCM de un dispositivo para el usuario autenticado.
type RegisterDeviceTokenRequest struct {
	Token    string `json:"token" binding:"required"`
	Platform string `json:"platform" binding:"required"`
}
