package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// ShelterService define el CONTRATO de la capa de negocio para refugios.
type ShelterService interface {
	GetAll(ctx context.Context, city string) ([]domain.Shelter, error)
	GetByID(ctx context.Context, id string) (*domain.Shelter, error)
}

// shelterService es la implementación concreta del ShelterService.
type shelterService struct {
	repo repository.ShelterRepository
}

// NewShelterService construye el ShelterService con sus dependencias.
func NewShelterService(repo repository.ShelterRepository) ShelterService {
	return &shelterService{repo: repo}
}

// GetAll retorna refugios filtrados por ciudad (opcional).
// city == "" → sin filtro por ciudad.
// MVP: no filtra por isVerified — el repo lo soporta, pero no lo exponemos en esta versión.
func (s *shelterService) GetAll(ctx context.Context, city string) ([]domain.Shelter, error) {
	return s.repo.GetAll(ctx, city, nil)
}

// GetByID busca un refugio por su ID string.
// Parsea el string a uuid.UUID y delega al repositorio.
// Retorna ErrShelterNotFound si no existe.
func (s *shelterService) GetByID(ctx context.Context, id string) (*domain.Shelter, error) {
	shelterUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	return s.repo.GetByID(ctx, shelterUUID)
}
