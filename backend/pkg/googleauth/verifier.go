// Package googleauth verifies Google ID tokens. It is the only place in the
// backend that knows Google's token format — everything upstream consumes the
// Verifier interface, which keeps AuthService unit-testable without network.
package googleauth

import (
	"context"
	"fmt"

	"google.golang.org/api/idtoken"
)

// Claims are the fields we consume from a verified Google ID token.
type Claims struct {
	Sub           string // stable Google user id; survives an email change
	Email         string
	Name          string
	Picture       string
	EmailVerified bool
}

// Verifier validates a Google ID token and returns its claims.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (*Claims, error)
}

type idTokenVerifier struct {
	clientID string
}

// NewVerifier returns a Verifier backed by google.golang.org/api/idtoken.
// clientID is the OAuth 2.0 Web client id; idtoken.Validate checks it as the
// token audience, which is what stops a token minted for another app from
// being replayed against us.
func NewVerifier(clientID string) Verifier {
	return &idTokenVerifier{clientID: clientID}
}

func (v *idTokenVerifier) Verify(ctx context.Context, token string) (*Claims, error) {
	// Validate checks signature, issuer, expiry and audience.
	payload, err := idtoken.Validate(ctx, token, v.clientID)
	if err != nil {
		return nil, fmt.Errorf("googleauth: invalid id token: %w", err)
	}
	return &Claims{
		Sub:           payload.Subject,
		Email:         stringClaim(payload.Claims, "email"),
		Name:          stringClaim(payload.Claims, "name"),
		Picture:       stringClaim(payload.Claims, "picture"),
		EmailVerified: boolClaim(payload.Claims, "email_verified"),
	}, nil
}

func stringClaim(claims map[string]any, key string) string {
	v, _ := claims[key].(string)
	return v
}

// boolClaim tolerates both shapes Google has shipped for email_verified:
// a JSON boolean and the string "true".
func boolClaim(claims map[string]any, key string) bool {
	switch v := claims[key].(type) {
	case bool:
		return v
	case string:
		return v == "true"
	}
	return false
}
