package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// getUserID lee el userID que el middleware de auth dejó en el contexto de Gin.
// El middleware lo puso como uuid.UUID, acá lo convertimos a string para usar en los services.
func getUserID(c *gin.Context) string {
	userID, _ := c.Get("userID")
	return userID.(uuid.UUID).String()
}

// getUserUUID lee el userID del contexto de Gin y lo retorna directamente como uuid.UUID.
// Útil para handlers que necesitan pasar el UUID sin conversión a string.
func getUserUUID(c *gin.Context) uuid.UUID {
	userID, _ := c.Get("userID")
	return userID.(uuid.UUID)
}
