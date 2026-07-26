// Package googleauth verifies Google ID tokens. It is the only place in the
// backend that knows Google's token format — everything upstream consumes the
// Verifier interface, which keeps AuthService unit-testable without network.
package googleauth

import (
	"context"
	"errors"
	"fmt"
	"strings"

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

// serviceAccountEmailSuffix marks a Google service-account identity rather than
// a human account. See the rejection in Verify for why it is refused.
const serviceAccountEmailSuffix = ".iam.gserviceaccount.com"

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
	sub := payload.Subject
	email := stringClaim(payload.Claims, "email")
	if err := checkIdentity(payload.Issuer, sub, email); err != nil {
		return nil, err
	}

	return &Claims{
		Sub:           sub,
		Email:         email,
		Name:          stringClaim(payload.Claims, "name"),
		Picture:       stringClaim(payload.Claims, "picture"),
		EmailVerified: boolClaim(payload.Claims, "email_verified"),
	}, nil
}

// checkIdentity applies the policy the idtoken library does NOT: it validates
// the issuer, requires the two identifiers the auth decision hangs on, and
// refuses non-human principals. Kept as a pure function so every rule is
// testable without a real Google token.
func checkIdentity(issuer, sub, email string) error {
	// idtoken never reads `iss` — Issuer is only a struct field there.
	if !googleIssuers[issuer] {
		return fmt.Errorf("googleauth: unexpected issuer %q", issuer)
	}
	// idtoken does not require any claim to be present. An empty value here would
	// otherwise surface deep inside the account-matching logic as a silent
	// mismatch instead of a rejection.
	if sub == "" {
		return errors.New("googleauth: token has no sub claim")
	}
	if email == "" {
		return errors.New("googleauth: token has no email claim")
	}
	// Google's IAM `generateIdToken` mints tokens with a CALLER-CHOSEN audience,
	// signed by the same key set and carrying iss accounts.google.com — so neither
	// the audience check nor the issuer check narrows them. Not takeover (the
	// caller cannot choose a victim's address), but it would let anyone create
	// accounts with a Google-verified email and skip our OTP. No human Google
	// account carries this domain, so refusing it costs the real flow nothing.
	if strings.HasSuffix(strings.ToLower(email), serviceAccountEmailSuffix) {
		return fmt.Errorf("googleauth: service-account token rejected (%s)", email)
	}
	return nil
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
