package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lost-pets/pkg/jwt"
)

// Auth valida el JWT en el header Authorization y pone el userID en el contexto
func Auth(secretKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token requerido"})
			return
		}

		// El header debe ser: "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "formato de token inválido"})
			return
		}

		userID, err := jwt.ValidateToken(parts[1], secretKey)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token inválido o expirado"})
			return
		}

		// Pone el userID en el contexto para que los handlers lo puedan leer
		c.Set("userID", userID)
		c.Next()
	}
}
