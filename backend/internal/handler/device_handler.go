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

// DeleteToken maneja DELETE /api/devices/:token.
// Elimina el token FCM del dispositivo — usado al hacer logout.
// Cualquier usuario autenticado puede eliminar su propio token.
func (h *DeviceHandler) DeleteToken(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.deviceTokenRepo.DeleteByToken(context.Background(), token); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RegisterToken maneja POST /api/devices/token.
// Registra o actualiza el token FCM del dispositivo del usuario autenticado.
func (h *DeviceHandler) RegisterToken(c *gin.Context) {
	var req dto.RegisterDeviceTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if req.Token == "" {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if !allowedPlatforms[req.Platform] {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	userID := getUserUUID(c)

	token := &domain.DeviceToken{
		UserID:   userID,
		Token:    req.Token,
		Platform: req.Platform,
	}

	if err := h.deviceTokenRepo.Upsert(context.Background(), token); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
