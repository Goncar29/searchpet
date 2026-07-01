package domain_test

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestIsActiveSearchStatus(t *testing.T) {
	active := map[string]bool{
		domain.PetStatusLost:  true,
		domain.PetStatusStray: true,
	}
	all := []string{
		domain.PetStatusRegistered, domain.PetStatusLost, domain.PetStatusStray,
		domain.PetStatusFound, domain.PetStatusArchived,
	}
	for _, s := range all {
		if got := domain.IsActiveSearchStatus(s); got != active[s] {
			t.Errorf("IsActiveSearchStatus(%q) = %v, want %v", s, got, active[s])
		}
	}
}
