package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// writeError looks up the error code from the domain ErrorCodes map and writes
// a standardized ErrorResponse JSON body. Falls back to "internal_error" when
// the error is not mapped.
func writeError(c *gin.Context, status int, err error) {
	code := domain.CodeFor(err)
	c.JSON(status, dto.ErrorResponse{Code: code, Message: err.Error()})
}

// getUserID lee el userID que el middleware de auth dejó en el contexto de Gin.
// El middleware lo puso como uuid.UUID, acá lo convertimos a string para usar en los services.
// Retorna "" si el valor no está presente o no es un uuid.UUID válido.
func getUserID(c *gin.Context) string {
	userID, _ := c.Get("userID")
	id, ok := userID.(uuid.UUID)
	if !ok {
		return ""
	}
	return id.String()
}

// getUserUUID lee el userID del contexto de Gin y lo retorna directamente como uuid.UUID.
// Útil para handlers que necesitan pasar el UUID sin conversión a string.
func getUserUUID(c *gin.Context) uuid.UUID {
	userID, ok := c.Get("userID")
	if !ok {
		return uuid.Nil
	}
	id, ok := userID.(uuid.UUID)
	if !ok {
		return uuid.Nil
	}
	return id
}
