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
	userRepo repository.UserRepository
}

// NewModerationService construye el ModerationService.
func NewModerationService(userRepo repository.UserRepository) ModerationService {
	return &moderationService{userRepo: userRepo}
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
	return s.userRepo.Update(ctx, user)
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
