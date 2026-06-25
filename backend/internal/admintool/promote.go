// Package admintool holds small operational helpers run from CLI commands
// (cmd/promote-admin), kept here so the logic is unit-testable instead of
// living inside an untestable main().
package admintool

import (
	"context"
	"strings"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// Result describes the outcome of a SetAdmin call.
type Result struct {
	UserID string
	Name   string
	Email  string
	// NoChange is true when the user was already in the requested admin state,
	// so no write happened (idempotent no-op success).
	NoChange bool
}

// SetAdmin sets (or clears) the is_admin flag for the user with the given email.
//
// Matching is exact against the stored email (only surrounding whitespace is
// trimmed) because registration stores emails verbatim, without case folding.
// Idempotent: if the user is already in the requested state, no write happens
// and Result.NoChange is true. Returns domain.ErrInvalidInput for an empty
// email and domain.ErrUserNotFound when no user matches.
func SetAdmin(ctx context.Context, repo repository.UserRepository, email string, admin bool) (Result, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return Result{}, domain.ErrInvalidInput
	}

	user, err := repo.GetByEmail(ctx, email)
	if err != nil {
		return Result{}, err // ErrUserNotFound propagates
	}

	res := Result{UserID: user.ID.String(), Name: user.Name, Email: user.Email}
	if user.IsAdmin == admin {
		res.NoChange = true
		return res, nil
	}

	user.IsAdmin = admin
	if err := repo.Update(ctx, user); err != nil {
		return Result{}, err
	}
	return res, nil
}
