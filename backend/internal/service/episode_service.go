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
	// it leaves an active search. No-op otherwise.
	//
	// The episode repository is passed in so callers can supply a transaction-
	// scoped repo (tx.Episodes) and keep the pet-status write and the episode
	// open/close in the SAME transaction — otherwise a partial failure leaves the
	// pet with a status but no current episode, making it invisible on the map.
	//
	// NOT idempotent: it acts purely on the (oldStatus, newStatus) pair without
	// re-reading current state, so callers MUST invoke it only on a real status
	// change. Calling it twice for the same into-active transition would open a
	// second episode and orphan the first.
	HandleTransition(repo repository.EpisodeRepository, petID, oldStatus, newStatus string) error
}

type episodeService struct{}

func NewEpisodeService() EpisodeService {
	return &episodeService{}
}

func (s *episodeService) HandleTransition(repo repository.EpisodeRepository, petID, oldStatus, newStatus string) error {
	wasActive := domain.IsActiveSearchStatus(oldStatus)
	isActive := domain.IsActiveSearchStatus(newStatus)

	switch {
	case !wasActive && isActive:
		_, err := repo.Open(petID)
		return err
	case wasActive && !isActive:
		return repo.CloseCurrent(petID, newStatus)
	default:
		return nil
	}
}
