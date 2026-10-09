package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// ModerationService owns admin user-moderation actions (ban/unban).
// Admin-only enforcement is done in the handler via RequireAdmin.
type ModerationService interface {
	BanUser(ctx context.Context, targetID uuid.UUID, reason string) error
	UnbanUser(ctx context.Context, targetID uuid.UUID) error
}

type moderationService struct {
	userRepo       repository.UserRepository
	disconnectUser func(userID uuid.UUID)
}

// NewModerationService construye el ModerationService.
//
// disconnectUser closes the user's open WebSockets. The middleware rejects a
// banned user's next HTTP request, but a socket authenticates once, at the
// upgrade, and nobody checks it again (CLAUDE.md rule #38), so without this a
// banned user keeps receiving messages. It may be nil: the ban still works,
// it just leaves live sockets up.
func NewModerationService(userRepo repository.UserRepository, disconnectUser func(userID uuid.UUID)) ModerationService {
	return &moderationService{userRepo: userRepo, disconnectUser: disconnectUser}
}

// BanUser marca al usuario como baneado (IsBanned + BanReason).
// Rechaza banear a un admin (cubre también el auto-ban de un admin).
func (s *moderationService) BanUser(ctx context.Context, targetID uuid.UUID, reason string) error {
	user, err := s.userRepo.GetByID(ctx, targetID)
	if err != nil {
		return err // ErrUserNotFound se propaga
	}
	if user.IsAdmin {
		return domain.ErrCannotModerateAdmin
	}
	user.IsBanned = true
	user.BanReason = reason
	if err := s.userRepo.Update(ctx, user); err != nil {
		return err
	}
	// Only after the ban is saved: cutting the sockets of a ban that failed
	// would leave the user offline with nothing changed.
	if s.disconnectUser != nil {
		s.disconnectUser(targetID)
	}
	return nil
}

// UnbanUser limpia el baneo. Idempotente: desbanear a uno no baneado es no-op success.
func (s *moderationService) UnbanUser(ctx context.Context, targetID uuid.UUID) error {
	user, err := s.userRepo.GetByID(ctx, targetID)
	if err != nil {
		return err
	}
	user.IsBanned = false
	user.BanReason = ""
	return s.userRepo.Update(ctx, user)
}
