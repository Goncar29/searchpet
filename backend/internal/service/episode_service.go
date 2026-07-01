package service

import (
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// EpisodeService centralizes the open/close decision for search episodes so
// every pet-status transition site is a single call. Runs inline with the
// status change (NOT via EventBus) because there are no events for archived/
// registered transitions and episode integrity is core data.
type EpisodeService interface {
	// HandleTransition opens an episode when the pet enters an active search
	// (lost/stray) from a non-active state, and closes the current episode when
	// it leaves an active search. No-op otherwise. Idempotent on repeats.
	HandleTransition(petID, oldStatus, newStatus string) error
}

type episodeService struct {
	episodeRepo repository.EpisodeRepository
}

func NewEpisodeService(episodeRepo repository.EpisodeRepository) EpisodeService {
	return &episodeService{episodeRepo: episodeRepo}
}

func (s *episodeService) HandleTransition(petID, oldStatus, newStatus string) error {
	wasActive := domain.IsActiveSearchStatus(oldStatus)
	isActive := domain.IsActiveSearchStatus(newStatus)

	switch {
	case !wasActive && isActive:
		_, err := s.episodeRepo.Open(petID)
		return err
	case wasActive && !isActive:
		return s.episodeRepo.CloseCurrent(petID, newStatus)
	default:
		return nil
	}
}
