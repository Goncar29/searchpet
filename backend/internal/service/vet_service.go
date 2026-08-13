package service

import (
	"context"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

const (
	defaultVetRadiusMeters = 5000
	maxVetRadiusMeters     = 50000
	// Techo de seguridad del payload, NO un tope de negocio: con 50 recortaba de
	// verdad. El recorte se aplica DESPUES de ordenar por distancia (ver
	// vet_repository.go), asi que las mas lejanas desaparecian del mapa sin error,
	// sin contador y sin log — y quien miraba concluia que no existian.
	//
	// El numero esta medido, no elegido: OpenStreetMap tiene 181 amenity=veterinary
	// en TODO Uruguay (Overpass, 2026-08-12) y el radio esta topeado en 50 km mas
	// arriba, asi que 500 es ~2,7 veces el pais entero y no puede recortar en la
	// practica. En el peor caso son ~93 KB de respuesta. Si algun dia la tabla deja
	// de venir sola de OSM, este numero hay que volver a medirlo.
	vetResultLimit = 500
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
