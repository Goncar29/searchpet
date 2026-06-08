package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/pkg/jwt"
)

func abortUnauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrUnauthorized),
		"message": domain.ErrUnauthorized.Error(),
	})
}

// Auth valida el JWT en el header Authorization y pone el userID en el contexto
func Auth(secretKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			abortUnauthorized(c)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			abortUnauthorized(c)
			return
		}

		userID, err := jwt.ValidateToken(parts[1], secretKey)
		if err != nil {
			abortUnauthorized(c)
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}
