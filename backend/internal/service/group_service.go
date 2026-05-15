package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

type groupService struct {
	groupRepo  repository.LocalGroupRepository
	memberRepo repository.GroupMemberRepository
}

// NewGroupService construye el GroupService con sus dependencias.
func NewGroupService(groupRepo repository.LocalGroupRepository, memberRepo repository.GroupMemberRepository) GroupService {
	return &groupService{groupRepo: groupRepo, memberRepo: memberRepo}
}

// CreateGroup crea un grupo local. Admin-only enforcement se hace en el handler.
func (s *groupService) CreateGroup(ctx context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error) {
	group := &domain.LocalGroup{
		City:        req.City,
		Name:        req.Name,
		Description: req.Description,
		CreatedBy:   creatorID,
		MemberCount: 0,
	}

	if err := s.groupRepo.Create(ctx, group); err != nil {
		return nil, err
	}

	return s.groupRepo.GetByID(ctx, group.ID)
}

// GetByID obtiene un grupo por su ID.
func (s *groupService) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
	return s.groupRepo.GetByID(ctx, id)
}

// List retorna grupos con filtro opcional de ciudad.
func (s *groupService) List(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error) {
	return s.groupRepo.GetAll(ctx, city, limit, offset)
}

// Join agrega el usuario al grupo.
// Idempotente: si ya es miembro retorna nil (200 OK).
func (s *groupService) Join(ctx context.Context, groupID, userID uuid.UUID) error {
	// Verificar que el grupo existe
	if _, err := s.groupRepo.GetByID(ctx, groupID); err != nil {
		return err
	}

	// Check idempotencia: si ya es miembro, retornar nil (no duplicar, no cambiar counter)
	isMember, err := s.memberRepo.IsMember(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if isMember {
		return domain.ErrAlreadyMember
	}

	member := &domain.GroupMember{
		GroupID: groupID,
		UserID:  userID,
	}

	if err := s.memberRepo.Create(ctx, member); err != nil {
		return err
	}

	// Incrementar contador de forma atómica
	return s.groupRepo.IncrementMemberCount(ctx, groupID)
}

// Leave elimina el usuario del grupo.
// Retorna ErrNotMember si el usuario no pertenece al grupo.
func (s *groupService) Leave(ctx context.Context, groupID, userID uuid.UUID) error {
	// Verificar que el grupo existe
	if _, err := s.groupRepo.GetByID(ctx, groupID); err != nil {
		return err
	}

	if err := s.memberRepo.Delete(ctx, groupID, userID); err != nil {
		return err
	}

	// Decrementar contador de forma atómica
	return s.groupRepo.DecrementMemberCount(ctx, groupID)
}
