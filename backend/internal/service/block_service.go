package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

type blockService struct {
	repo repository.BlockedUserRepository
}

// NewBlockService construye el BlockService con sus dependencias.
func NewBlockService(repo repository.BlockedUserRepository) BlockService {
	return &blockService{repo: repo}
}

// Block bloquea a blockedID por parte de blockerID.
// Idempotente: si ya existe el bloqueo retorna nil (no duplica el registro).
// Previene auto-bloqueo: retorna ErrInvalidInput si blockerID == blockedID.
func (s *blockService) Block(ctx context.Context, blockerID, blockedID uuid.UUID, reason string) error {
	if blockerID == blockedID {
		return domain.ErrInvalidInput
	}

	block := &domain.BlockedUser{
		BlockerID: blockerID,
		BlockedID: blockedID,
		Reason:    reason,
	}

	err := s.repo.Create(ctx, block)
	if err != nil {
		// Unique constraint violation → bloqueo ya existe → idempotente
		if isUniqueConstraintError(err) {
			return nil
		}
		return err
	}

	return nil
}

// Unblock elimina el bloqueo de blockerID sobre blockedID.
func (s *blockService) Unblock(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	return s.repo.Delete(ctx, blockerID, blockedID)
}

// GetBlocked retorna la lista de usuarios bloqueados por userID.
func (s *blockService) GetBlocked(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	return s.repo.GetBlockedByUserID(ctx, userID)
}

// IsBlocked verifica si existe un bloqueo en cualquier dirección entre userA y userB.
func (s *blockService) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	return s.repo.IsBlocked(ctx, userA, userB)
}

// isUniqueConstraintError detecta errores de violación de restricción única en PostgreSQL.
func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "23505")
}
