package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// RequireAdmin verifica que el usuario autenticado sea administrador.
// SECURITY: lee IsAdmin desde la BD via UserRepository — NUNCA desde el JWT claim.
// Debe ejecutarse después del middleware Auth (que setea "userID" en el contexto).
func RequireAdmin(userRepo repository.UserRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		val, exists := c.Get("userID")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
			return
		}

		userUUID, ok := val.(uuid.UUID)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
			return
		}

		user, err := userRepo.GetByID(c.Request.Context(), userUUID)
		if err != nil || !user.IsAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": domain.ErrNotAdmin.Error()})
			return
		}

		// Disponible para handlers que necesiten saber si el caller es admin
		// sin hacer un lookup adicional a la BD.
		c.Set("isAdmin", true)
		c.Next()
	}
}
