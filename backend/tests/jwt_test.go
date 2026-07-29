package tests

import (
	"testing"
	"time"

	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	authjwt "lost-pets/pkg/jwt"
)

const jwtTestSecret = "test-secret"

// signWithClaims signs an arbitrary set of claims with jwtTestSecret. It lets
// tests control fields (like IssuedAt) that authjwt.GenerateToken always sets,
// so the failure modes of ValidateToken can be exercised directly.
func signWithClaims(t *testing.T, claims authjwt.Claims) string {
	t.Helper()
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(jwtTestSecret))
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}
	return signed
}

// TestValidateToken_ReturnsIssuedAt pins ValidateToken to the token's actual
// `iat` claim, not to wall-clock time. A prior version of this test only
// asserted "issuedAt is roughly now", which a regression like
// `return claims.UserID, time.Now(), nil` (silently dropping the claim read)
// would still satisfy. Minting the token with an iat one hour in the past and
// asserting exact equality makes that regression fail.
func TestValidateToken_ReturnsIssuedAt(t *testing.T) {
	userID := uuid.New()
	wantIssuedAt := time.Now().Add(-time.Hour).Truncate(time.Second)

	claims := authjwt.Claims{
		UserID: userID,
		RegisteredClaims: jwtlib.RegisteredClaims{
			ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwtlib.NewNumericDate(wantIssuedAt),
		},
	}
	token := signWithClaims(t, claims)

	gotID, issuedAt, err := authjwt.ValidateToken(token, jwtTestSecret)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if gotID != userID {
		t.Fatalf("userID = %v, want %v", gotID, userID)
	}
	if issuedAt.Unix() != wantIssuedAt.Unix() {
		t.Fatalf("issuedAt = %v (unix %d), want exactly %v (unix %d) — ValidateToken must read the token's iat claim, not wall-clock time",
			issuedAt, issuedAt.Unix(), wantIssuedAt, wantIssuedAt.Unix())
	}
}

// TestValidateToken_RoundTrip keeps a simpler smoke test via the real
// GenerateToken/ValidateToken pair, on top of the exact-iat test above.
func TestValidateToken_RoundTrip(t *testing.T) {
	userID := uuid.New()
	before := time.Now().Add(-2 * time.Second)

	token, err := authjwt.GenerateToken(userID, jwtTestSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	gotID, issuedAt, err := authjwt.ValidateToken(token, jwtTestSecret)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if gotID != userID {
		t.Fatalf("userID = %v, want %v", gotID, userID)
	}
	if issuedAt.Before(before) {
		t.Fatalf("issuedAt = %v, want at or after %v", issuedAt, before)
	}
	if issuedAt.After(time.Now().Add(time.Second)) {
		t.Fatalf("issuedAt = %v is in the future", issuedAt)
	}
}

// TestValidateToken_MissingIssuedAt_ReturnsErrorAndZeroTime covers the guard
// in ValidateToken that rejects a token without an iat claim. Without this
// test, deleting that guard leaves the whole suite green, and it looks like
// dead code to the next person.
func TestValidateToken_MissingIssuedAt_ReturnsErrorAndZeroTime(t *testing.T) {
	claims := authjwt.Claims{
		UserID: uuid.New(),
		RegisteredClaims: jwtlib.RegisteredClaims{
			ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(72 * time.Hour)),
			// IssuedAt deliberately omitted.
		},
	}
	token := signWithClaims(t, claims)

	_, issuedAt, err := authjwt.ValidateToken(token, jwtTestSecret)
	if err == nil {
		t.Fatal("expected an error for a token without an iat claim")
	}
	if !issuedAt.IsZero() {
		t.Fatalf("issuedAt = %v, want zero time on error", issuedAt)
	}
}

// TestValidateToken_InvalidToken_ReturnsZeroTime pins the zero-time contract
// on the parse-failure error path (garbage input, not just a well-formed
// token missing a claim).
func TestValidateToken_InvalidToken_ReturnsZeroTime(t *testing.T) {
	_, issuedAt, err := authjwt.ValidateToken("garbage", jwtTestSecret)
	if err == nil {
		t.Fatal("expected an error for a malformed token")
	}
	if !issuedAt.IsZero() {
		t.Fatalf("issuedAt = %v, want zero time on error", issuedAt)
	}
}
