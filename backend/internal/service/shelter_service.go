package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// ShelterService define el CONTRATO de la capa de negocio para refugios.
type ShelterService interface {
	GetAll(ctx context.Context, city string) ([]domain.Shelter, error)
	GetByID(ctx context.Context, id string) (*domain.Shelter, error)
	// Create es la vía ADMIN: refugio sin dueño, nace approved.
	Create(ctx context.Context, shelter *domain.Shelter) error
	Update(ctx context.Context, shelter *domain.Shelter) error
	// RegisterOwn es el auto-registro: exige email verificado y máximo un
	// refugio por cuenta; el refugio nace pending y publica shelter.submitted.
	RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error
	// GetMine retorna el refugio del usuario. ErrShelterNotFound si no tiene.
	GetMine(ctx context.Context, userID string) (*domain.Shelter, error)
	// UpdateMine aplica la edición del dueño según el estado (staging de links
	// en approved; edición libre + resubmit en pending/rejected).
	UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error)
	// GetPendingQueue retorna la cola de revisión admin.
	GetPendingQueue(ctx context.Context) ([]domain.Shelter, error)
	// Approve pasa pending → approved y publica shelter.approved.
	Approve(ctx context.Context, id string) (*domain.Shelter, error)
	// Reject pasa pending → rejected con motivo y publica shelter.rejected.
	Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error)
	// ApproveLinks copia Pending* a los campos vivos y los limpia.
	ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error)
	// RejectLinks descarta Pending* sin tocar los campos vivos.
	RejectLinks(ctx context.Context, id string) (*domain.Shelter, error)
}

// shelterService es la implementación concreta del ShelterService.
type shelterService struct {
	repo     repository.ShelterRepository
	userRepo repository.UserRepository
	bus      *event.EventBus
}

// NewShelterService construye el ShelterService con sus dependencias.
// bus puede ser nil (los eventos simplemente no se publican).
func NewShelterService(repo repository.ShelterRepository, userRepo repository.UserRepository, bus *event.EventBus) ShelterService {
	return &shelterService{repo: repo, userRepo: userRepo, bus: bus}
}

// GetAll retorna refugios del directorio público (el repo filtra approved).
// city == "" → sin filtro por ciudad.
func (s *shelterService) GetAll(ctx context.Context, city string) ([]domain.Shelter, error) {
	return s.repo.GetAll(ctx, city, nil)
}

// GetByID busca un refugio por su ID string.
func (s *shelterService) GetByID(ctx context.Context, id string) (*domain.Shelter, error) {
	shelterUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByID(ctx, shelterUUID)
}

// Create persiste un refugio creado por un admin: sin dueño y nace approved
// (los admins ya vetaron los datos — no pasan por la cola).
func (s *shelterService) Create(ctx context.Context, shelter *domain.Shelter) error {
	shelter.Status = domain.ShelterStatusApproved
	return s.repo.Create(ctx, shelter)
}

// Update aplica los cambios de un refugio existente (vía admin).
func (s *shelterService) Update(ctx context.Context, shelter *domain.Shelter) error {
	return s.repo.Update(ctx, shelter)
}

// RegisterOwn registra el refugio del usuario autenticado.
func (s *shelterService) RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}

	user, err := s.userRepo.GetByID(ctx, ownerUUID)
	if err != nil {
		return err
	}
	if !user.EmailVerified {
		return domain.ErrEmailNotVerified
	}

	// Pre-check amable (409 con code claro); el índice único parcial de la
	// migración 000016 es la garantía real contra la carrera.
	if _, err := s.repo.GetByOwner(ctx, ownerUUID); err == nil {
		return domain.ErrShelterAlreadyOwned
	} else if !errors.Is(err, domain.ErrShelterNotFound) {
		return err
	}

	shelter.OwnerUserID = &ownerUUID
	shelter.Status = domain.ShelterStatusPending
	if err := s.repo.Create(ctx, shelter); err != nil {
		return err
	}

	if s.bus != nil {
		s.bus.Publish("shelter.submitted", event.ShelterSubmittedEvent{
			ShelterID:   shelter.ID,
			OwnerUserID: ownerUUID,
			ShelterName: shelter.Name,
		})
	}
	return nil
}

// GetMine retorna el refugio del usuario autenticado.
func (s *shelterService) GetMine(ctx context.Context, userID string) (*domain.Shelter, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByOwner(ctx, ownerUUID)
}

// UpdateMine — lógica real en la siguiente iteración del plan (Task 6).
func (s *shelterService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// GetPendingQueue delega al repositorio.
func (s *shelterService) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	return s.repo.GetPendingQueue(ctx)
}

// Approve — lógica real en Task 7.
func (s *shelterService) Approve(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// Reject — lógica real en Task 7.
func (s *shelterService) Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// ApproveLinks — lógica real en Task 7.
func (s *shelterService) ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// RejectLinks — lógica real en Task 7.
func (s *shelterService) RejectLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}
