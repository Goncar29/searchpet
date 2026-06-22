// Package service_test — verifies stray reporters can generate share links.
// Sharing is the core mission of the app; a stray (no owner) must be shareable
// by the user who reported it.
package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// mockShareLinkRepo is a no-op ShareLinkRepository for authz tests.
type mockShareLinkRepo struct{}

func (m *mockShareLinkRepo) Create(_ context.Context, _ *domain.ShareLink) error { return nil }
func (m *mockShareLinkRepo) GetByToken(_ context.Context, _ string) (*domain.ShareLink, error) {
	return nil, nil
}
func (m *mockShareLinkRepo) GetByPetID(_ context.Context, _ uuid.UUID) ([]domain.ShareLink, error) {
	return nil, nil
}
func (m *mockShareLinkRepo) GetOrCreateForPet(_ context.Context, _ uuid.UUID, build func() (*domain.ShareLink, error)) (*domain.ShareLink, error) {
	return build()
}
func (m *mockShareLinkRepo) IncrementViewCount(_ context.Context, _ uuid.UUID) error     { return nil }
func (m *mockShareLinkRepo) IncrementClickedContact(_ context.Context, _ uuid.UUID) error { return nil }

func TestShareLink_Generate_StrayReporter_Allowed(t *testing.T) {
	reporterID := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	svc := service.NewShareLinkService(&mockShareLinkRepo{}, &mockPetRepo{pet: pet}, nil)

	link, err := svc.Generate(context.Background(), pet.ID.String(), reporterID.String())
	if err != nil {
		t.Fatalf("stray reporter should be allowed to generate a share link, got %v", err)
	}
	if link == nil {
		t.Fatal("expected a share link, got nil")
	}
}

func TestShareLink_Generate_StrayNonReporter_Denied(t *testing.T) {
	reporterID := uuid.New()
	stranger := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	svc := service.NewShareLinkService(&mockShareLinkRepo{}, &mockPetRepo{pet: pet}, nil)

	if _, err := svc.Generate(context.Background(), pet.ID.String(), stranger.String()); err != domain.ErrNotPetOwner {
		t.Errorf("expected ErrNotPetOwner for non-reporter, got %v", err)
	}
}
