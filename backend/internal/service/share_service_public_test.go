// Package service_test — verifies the PUBLIC, idempotent share-link generation
// used by logged-out finders. Sharing lost/stray pets without login is core to
// the app's mission (virality drives reunions); the only authorization is a
// status guard (only lost/stray are publicly shareable) and idempotency bounds
// anonymous abuse (one active link per pet instead of a new row per call).
package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// recordingShareRepo records Create calls and returns preset links from
// GetByPetID so tests can assert idempotency (no new row when one already exists).
type recordingShareRepo struct {
	existing    []domain.ShareLink
	createCalls int
}

func (r *recordingShareRepo) Create(_ context.Context, _ *domain.ShareLink) error {
	r.createCalls++
	return nil
}
func (r *recordingShareRepo) GetByToken(_ context.Context, _ string) (*domain.ShareLink, error) {
	return nil, nil
}
func (r *recordingShareRepo) GetByPetID(_ context.Context, _ uuid.UUID) ([]domain.ShareLink, error) {
	return r.existing, nil
}

// GetOrCreateForPet mirrors the real atomic behavior: return the existing link
// if present (no create), otherwise build + record one create.
func (r *recordingShareRepo) GetOrCreateForPet(_ context.Context, _ uuid.UUID, build func() (*domain.ShareLink, error)) (*domain.ShareLink, error) {
	if len(r.existing) > 0 {
		return &r.existing[0], nil
	}
	link, err := build()
	if err != nil {
		return nil, err
	}
	r.createCalls++
	return link, nil
}
func (r *recordingShareRepo) IncrementViewCount(_ context.Context, _ uuid.UUID) error      { return nil }
func (r *recordingShareRepo) IncrementClickedContact(_ context.Context, _ uuid.UUID) error { return nil }

// findTrackingPetRepo records whether FindByID ran, so we can assert that a
// malformed UUID is rejected BEFORE any repository (DB) lookup.
type findTrackingPetRepo struct {
	mockPetRepo
	findCalled bool
}

func (m *findTrackingPetRepo) FindByID(id string) (*domain.Pet, error) {
	m.findCalled = true
	return m.mockPetRepo.FindByID(id)
}

func TestGetOrCreatePublicLink_MalformedID_RejectedBeforeLookup(t *testing.T) {
	petRepo := &findTrackingPetRepo{mockPetRepo: mockPetRepo{pet: petWithStatus(uuid.New(), domain.PetStatusLost)}}
	svc := service.NewShareLinkService(&recordingShareRepo{}, petRepo, nil)

	_, err := svc.GetOrCreatePublicLink(context.Background(), "not-a-uuid")
	if err != domain.ErrInvalidInput {
		t.Errorf("expected ErrInvalidInput for a malformed pet id, got %v", err)
	}
	if petRepo.findCalled {
		t.Error("FindByID must not run for a malformed UUID — parse first so a non-UUID never reaches the DB (which would 500)")
	}
}

func TestGetOrCreatePublicLink_LostNoExisting_Creates(t *testing.T) {
	owner := uuid.New()
	pet := petWithStatus(owner, domain.PetStatusLost)
	repo := &recordingShareRepo{}
	svc := service.NewShareLinkService(repo, &mockPetRepo{pet: pet}, nil)

	link, err := svc.GetOrCreatePublicLink(context.Background(), pet.ID.String())
	if err != nil {
		t.Fatalf("expected success for a lost pet, got %v", err)
	}
	if link == nil || link.ShareToken == "" {
		t.Fatal("expected a share link with a non-empty token")
	}
	if repo.createCalls != 1 {
		t.Errorf("expected exactly 1 Create call, got %d", repo.createCalls)
	}
}

func TestGetOrCreatePublicLink_Idempotent_ReturnsExisting(t *testing.T) {
	owner := uuid.New()
	pet := petWithStatus(owner, domain.PetStatusStray)
	existing := domain.ShareLink{ShareToken: "existingtoken", PetID: pet.ID}
	repo := &recordingShareRepo{existing: []domain.ShareLink{existing}}
	svc := service.NewShareLinkService(repo, &mockPetRepo{pet: pet}, nil)

	link, err := svc.GetOrCreatePublicLink(context.Background(), pet.ID.String())
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if link.ShareToken != "existingtoken" {
		t.Errorf("expected the existing token, got %q", link.ShareToken)
	}
	if repo.createCalls != 0 {
		t.Errorf("idempotent call must not create a new link, got %d Create calls", repo.createCalls)
	}
}

func TestGetOrCreatePublicLink_NonShareableStatus_NotFound(t *testing.T) {
	owner := uuid.New()
	pet := petWithStatus(owner, domain.PetStatusFound)
	repo := &recordingShareRepo{}
	svc := service.NewShareLinkService(repo, &mockPetRepo{pet: pet}, nil)

	_, err := svc.GetOrCreatePublicLink(context.Background(), pet.ID.String())
	if err != domain.ErrPetNotFound {
		t.Errorf("expected ErrPetNotFound for a non-lost/stray pet, got %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("must not create a link for a non-shareable status, got %d Create calls", repo.createCalls)
	}
}

func TestGetOrCreatePublicLink_PetNotFound_Propagates(t *testing.T) {
	repo := &recordingShareRepo{}
	svc := service.NewShareLinkService(repo, &mockPetRepo{findErr: domain.ErrPetNotFound}, nil)

	_, err := svc.GetOrCreatePublicLink(context.Background(), uuid.New().String())
	if err != domain.ErrPetNotFound {
		t.Errorf("expected ErrPetNotFound to propagate, got %v", err)
	}
}
