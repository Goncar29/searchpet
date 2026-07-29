package jwt

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const tokenDuration = 72 * time.Hour

// Claims define los datos que viajan dentro del JWT (el payload)
type Claims struct {
	UserID uuid.UUID `json:"user_id"`
	jwt.RegisteredClaims
}

// GenerateToken crea y firma un JWT con el userID adentro
// Expira en 72 horas
func GenerateToken(userID uuid.UUID, secretKey string) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(tokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secretKey))
}

// ValidateToken verifica la firma del JWT y extrae el userID y el momento de
// emisión. El issued-at lo usa el middleware para rechazar tokens anteriores al
// último cambio de credenciales (users.password_changed_at).
// Retorna error si el token es inválido o expiró.
func ValidateToken(tokenString, secretKey string) (uuid.UUID, time.Time, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("método de firma inválido")
		}
		return []byte(secretKey), nil
	})

	if err != nil {
		return uuid.Nil, time.Time{}, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return uuid.Nil, time.Time{}, errors.New("token inválido")
	}

	// GenerateToken always sets IssuedAt. A token without it is not one of ours,
	// and a zero time would silently pass every freshness check.
	if claims.IssuedAt == nil {
		return uuid.Nil, time.Time{}, errors.New("token sin issued-at")
	}

	return claims.UserID, claims.IssuedAt.Time, nil
}
