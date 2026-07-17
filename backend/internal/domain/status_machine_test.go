package domain_test

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestValidateTransition_AllowedEdges(t *testing.T) {
	cases := []struct {
		from string
		to   string
	}{
		{domain.PetStatusRegistered, domain.PetStatusLost},
		{domain.PetStatusRegistered, domain.PetStatusArchived},
		{domain.PetStatusLost, domain.PetStatusRegistered},
		{domain.PetStatusLost, domain.PetStatusFound},
		{domain.PetStatusLost, domain.PetStatusArchived},
		{domain.PetStatusFound, domain.PetStatusRegistered},
		{domain.PetStatusFound, domain.PetStatusArchived},
		{domain.PetStatusArchived, domain.PetStatusRegistered},
		{domain.PetStatusStray, domain.PetStatusFound},
	}

	for _, tc := range cases {
		t.Run(tc.from+"->"+tc.to, func(t *testing.T) {
			if err := domain.ValidateTransition(tc.from, tc.to); err != nil {
				t.Errorf("expected allowed transition %s→%s, got error: %v", tc.from, tc.to, err)
			}
		})
	}
}

func TestValidateTransition_SameStatus_IsNoOp(t *testing.T) {
	statuses := []string{
		domain.PetStatusRegistered,
		domain.PetStatusLost,
		domain.PetStatusStray,
		domain.PetStatusFound,
		domain.PetStatusArchived,
	}

	for _, s := range statuses {
		t.Run(s+"->"+s, func(t *testing.T) {
			if err := domain.ValidateTransition(s, s); err != nil {
				t.Errorf("same-status no-op should return nil, got: %v", err)
			}
		})
	}
}

func TestValidateTransition_DisallowedEdges(t *testing.T) {
	cases := []struct {
		from string
		to   string
	}{
		// registered cannot jump to found or stray directly
		{domain.PetStatusRegistered, domain.PetStatusFound},
		{domain.PetStatusRegistered, domain.PetStatusStray},
		// stray can only go to found — not back to registered or archived
		{domain.PetStatusStray, domain.PetStatusRegistered},
		{domain.PetStatusStray, domain.PetStatusLost},
		{domain.PetStatusStray, domain.PetStatusArchived},
		// found cannot go to lost directly
		{domain.PetStatusFound, domain.PetStatusLost},
		// archived cannot go to lost, found, or stray
		{domain.PetStatusArchived, domain.PetStatusLost},
		{domain.PetStatusArchived, domain.PetStatusFound},
		{domain.PetStatusArchived, domain.PetStatusStray},
	}

	for _, tc := range cases {
		t.Run(tc.from+"->"+tc.to, func(t *testing.T) {
			err := domain.ValidateTransition(tc.from, tc.to)
			if err == nil {
				t.Errorf("expected ErrInvalidStatusTransition for %s→%s, got nil", tc.from, tc.to)
			}
			if err != domain.ErrInvalidStatusTransition {
				t.Errorf("expected ErrInvalidStatusTransition, got %v", err)
			}
		})
	}
}

func TestAdoptionClusterTransitions(t *testing.T) {
	allowed := [][2]string{
		{domain.PetStatusAdoption, domain.PetStatusAdopted},
		{domain.PetStatusAdopted, domain.PetStatusAdoption},
		{domain.PetStatusAdoption, domain.PetStatusArchived},
		{domain.PetStatusAdopted, domain.PetStatusArchived},
	}
	for _, tc := range allowed {
		if err := domain.ValidateTransition(tc[0], tc[1]); err != nil {
			t.Errorf("expected %s->%s allowed, got %v", tc[0], tc[1], err)
		}
	}

	// Isolation: no edges between the adoption cluster and the lost cluster.
	forbidden := [][2]string{
		{domain.PetStatusLost, domain.PetStatusAdoption},
		{domain.PetStatusAdoption, domain.PetStatusLost},
		{domain.PetStatusRegistered, domain.PetStatusAdoption},
		{domain.PetStatusAdoption, domain.PetStatusFound},
		{domain.PetStatusStray, domain.PetStatusAdoption},
		{domain.PetStatusFound, domain.PetStatusAdopted},
	}
	for _, tc := range forbidden {
		if err := domain.ValidateTransition(tc[0], tc[1]); err == nil {
			t.Errorf("expected %s->%s rejected, got nil", tc[0], tc[1])
		}
	}

	if !domain.ValidPetStatuses[domain.PetStatusAdoption] || !domain.ValidPetStatuses[domain.PetStatusAdopted] {
		t.Error("adoption statuses must be in ValidPetStatuses")
	}
	// Isolation: adoption statuses must NOT be publicly searchable via ?status=.
	if domain.PublicSearchableStatuses[domain.PetStatusAdoption] || domain.PublicSearchableStatuses[domain.PetStatusAdopted] {
		t.Error("adoption statuses must NOT be in PublicSearchableStatuses")
	}
}
