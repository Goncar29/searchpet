// Package googleauth verifies Google ID tokens. It is the only place in the
// backend that knows Google's token format — everything upstream consumes the
// Verifier interface, which keeps AuthService unit-testable without network.
package googleauth

import (
	"context"
	"errors"
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
//
// clientID is the OAuth 2.0 Web client id, checked as the token audience —
// that check is what stops a token minted for a DIFFERENT application from
// being replayed against us. It is rejected when empty rather than defaulted,
// because idtoken.Validate skips the audience check entirely on an empty
// audience: a misconfigured deploy would otherwise accept any Google token.
func NewVerifier(clientID string) (Verifier, error) {
	if clientID == "" {
		return nil, errors.New("googleauth: clientID is required; an empty audience disables the audience check")
	}
	return &idTokenVerifier{clientID: clientID}, nil
}

// googleIssuers are the two `iss` values Google mints ID tokens with. The
// idtoken library does NOT check the issuer — it validates signature, expiry
// and audience only — so we check it here.
var googleIssuers = map[string]bool{
	"accounts.google.com":         true,
	"https://accounts.google.com": true,
}

func (v *idTokenVerifier) Verify(ctx context.Context, token string) (*Claims, error) {
	// Validate checks the signature, expiry, and audience. It does NOT check
	// the issuer or require any claim to be present — both are handled below.
	payload, err := idtoken.Validate(ctx, token, v.clientID)
	if err != nil {
		return nil, fmt.Errorf("googleauth: invalid id token: %w", err)
	}
	if !googleIssuers[payload.Issuer] {
		return nil, fmt.Errorf("googleauth: unexpected issuer %q", payload.Issuer)
	}

	// sub and email are the two identifiers the whole auth decision hangs on.
	// idtoken does not require either to be present, so a malformed token would
	// otherwise surface as an empty string deep inside the account-matching
	// logic instead of as a rejection here.
	sub := payload.Subject
	if sub == "" {
		return nil, fmt.Errorf("googleauth: token has no sub claim")
	}
	email := stringClaim(payload.Claims, "email")
	if email == "" {
		return nil, fmt.Errorf("googleauth: token has no email claim")
	}

	return &Claims{
		Sub:           sub,
		Email:         email,
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
