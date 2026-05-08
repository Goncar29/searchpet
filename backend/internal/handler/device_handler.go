package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

var allowedPlatforms = map[string]bool{
	"ios":     true,
	"android": true,
	"web":     true,
}

// DeviceHandler expone el endpoint para registrar tokens FCM de dispositivos.
type DeviceHandler struct {
	deviceTokenRepo repository.DeviceTokenRepository
}

// NewDeviceHandler construye el DeviceHandler con sus dependencias.
func NewDeviceHandler(deviceTokenRepo repository.DeviceTokenRepository) *DeviceHandler {
	return &DeviceHandler{deviceTokenRepo: deviceTokenRepo}
}

// RegisterToken maneja POST /api/devices/token.
// Registra o actualiza el token FCM del dispositivo del usuario autenticado.
func (h *DeviceHandler) RegisterToken(c *gin.Context) {
	var req dto.RegisterDeviceTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token y platform son requeridos"})
		return
	}

	if req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token no puede estar vacío"})
		return
	}

	if !allowedPlatforms[req.Platform] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "platform debe ser ios, android o web"})
		return
	}

	userID := getUserUUID(c)

	token := &domain.DeviceToken{
		UserID:   userID,
		Token:    req.Token,
		Platform: req.Platform,
	}

	if err := h.deviceTokenRepo.Upsert(context.Background(), token); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al registrar el token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
