package database_test

import (
	"fmt"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/pkg/database"
)

// TestModels_IncludesVerificationToken guards the regression where
// VerificationToken was absent from the production AutoMigrate list, so the
// verification_tokens table was never created in prod (every OTP op failed with
// SQLSTATE 42P01) while the test DB — using its own separate list that DID
// include it — passed. database.Models is now the single source of truth for
// both prod and tests; this test fails fast if the model is dropped again.
func TestModels_IncludesVerificationToken(t *testing.T) {
	want := fmt.Sprintf("%T", &domain.VerificationToken{})
	for _, m := range database.Models {
		if fmt.Sprintf("%T", m) == want {
			return
		}
	}
	t.Fatalf("%s missing from database.Models — its table will never be created in production", want)
}

// TestModels_NoDuplicates ensures no model is registered for AutoMigrate twice.
func TestModels_NoDuplicates(t *testing.T) {
	seen := make(map[string]bool, len(database.Models))
	for _, m := range database.Models {
		name := fmt.Sprintf("%T", m)
		if seen[name] {
			t.Errorf("duplicate model in database.Models: %s", name)
		}
		seen[name] = true
	}
}
