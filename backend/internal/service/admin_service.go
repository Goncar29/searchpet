package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// AdminRoleResult describes the outcome of a SetUserAdmin call.
type AdminRoleResult struct {
	TargetID    uuid.UUID
	TargetEmail string
	TargetName  string
	IsAdmin     bool
	// NoChange is true when the target was already in the requested state, so no
	// write (and no audit row) happened.
	NoChange bool
}

// AdminService owns in-app admin-role changes with their safety guards.
// Admin-only enforcement is done at the route level via RequireAdmin.
type AdminService interface {
	SetUserAdmin(ctx context.Context, actorID uuid.UUID, email string, grant bool) (AdminRoleResult, error)
	RecentRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error)
}

type adminService struct {
	userRepo  repository.UserRepository
	adminRepo repository.AdminRepository
}

// NewAdminService constructs the AdminService.
func NewAdminService(userRepo repository.UserRepository, adminRepo repository.AdminRepository) AdminService {
	return &adminService{userRepo: userRepo, adminRepo: adminRepo}
}

func (s *adminService) SetUserAdmin(ctx context.Context, actorID uuid.UUID, email string, grant bool) (AdminRoleResult, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return AdminRoleResult{}, domain.ErrInvalidInput
	}

	target, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return AdminRoleResult{}, err // ErrUserNotFound propagates
	}

	// Idempotent: already in the requested state → no write, no audit.
	if target.IsAdmin == grant {
		return AdminRoleResult{
			TargetID: target.ID, TargetEmail: target.Email, TargetName: target.Name,
			IsAdmin: target.IsAdmin, NoChange: true,
		}, nil
	}

	// Guards apply only to revokes.
	if !grant {
		if target.ID == actorID {
			return AdminRoleResult{}, domain.ErrCannotRevokeSelf
		}
		count, err := s.adminRepo.CountAdmins(ctx)
		if err != nil {
			return AdminRoleResult{}, err
		}
		if count <= 1 {
			return AdminRoleResult{}, domain.ErrCannotRevokeLastAdmin
		}
	}

	actor, err := s.userRepo.GetByID(ctx, actorID)
	if err != nil {
		return AdminRoleResult{}, err
	}

	action := "revoke"
	if grant {
		action = "grant"
	}
	entry := &domain.AdminAuditLog{
		ActorID:     actorID,
		TargetID:    target.ID,
		ActorEmail:  actor.Email,
		TargetEmail: target.Email,
		Action:      action,
	}
	if err := s.adminRepo.SetAdminWithAudit(ctx, target.ID, grant, entry); err != nil {
		return AdminRoleResult{}, err
	}

	return AdminRoleResult{
		TargetID: target.ID, TargetEmail: target.Email, TargetName: target.Name,
		IsAdmin: grant, NoChange: false,
	}, nil
}

func (s *adminService) RecentRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error) {
	return s.adminRepo.ListRoleChanges(ctx, limit)
}
