package service

import (
	"context"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

const (
	defaultVetRadiusMeters = 5000
	maxVetRadiusMeters     = 50000
	vetResultLimit         = 50
)

// VetService defines the business logic for nearby veterinary queries.
type VetService interface {
	FindNearby(ctx context.Context, lat, lng float64, radiusMeters int) ([]domain.VetNearbyResult, error)
}

type vetService struct {
	repo repository.VetRepository
}

// NewVetService constructs a VetService backed by the given repository.
func NewVetService(repo repository.VetRepository) VetService {
	return &vetService{repo: repo}
}

// FindNearby normalizes the radius (default/clamp) and delegates the geographic
// query to the repository.
func (s *vetService) FindNearby(ctx context.Context, lat, lng float64, radiusMeters int) ([]domain.VetNearbyResult, error) {
	if radiusMeters <= 0 {
		radiusMeters = defaultVetRadiusMeters
	}
	if radiusMeters > maxVetRadiusMeters {
		radiusMeters = maxVetRadiusMeters
	}
	return s.repo.FindNearby(ctx, lat, lng, float64(radiusMeters), vetResultLimit)
}
