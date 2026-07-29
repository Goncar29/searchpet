package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/pkg/jwt"
)

func TestValidateToken_ReturnsIssuedAt(t *testing.T) {
	userID := uuid.New()
	before := time.Now().Add(-2 * time.Second)

	token, err := jwt.GenerateToken(userID, "test-secret")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	gotID, issuedAt, err := jwt.ValidateToken(token, "test-secret")
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
