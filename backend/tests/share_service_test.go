package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: ShareLinkRepository
// ============================================================

type mockShareLinkRepository struct {
	createFn                func(ctx context.Context, link *domain.ShareLink) error
	getByTokenFn            func(ctx context.Context, token string) (*domain.ShareLink, error)
	getByPetIDFn            func(ctx context.Context, petID uuid.UUID) ([]domain.ShareLink, error)
	incrementViewCountFn    func(ctx context.Context, id uuid.UUID) error
	incrementClickedContactFn func(ctx context.Context, id uuid.UUID) error
}

func (m *mockShareLinkRepository) Create(ctx context.Context, link *domain.ShareLink) error {
	if m.createFn != nil {
		return m.createFn(ctx, link)
	}
	link.ID = uuid.New()
	return nil
}

func (m *mockShareLinkRepository) GetByToken(ctx context.Context, token string) (*domain.ShareLink, error) {
	if m.getByTokenFn != nil {
		return m.getByTokenFn(ctx, token)
	}
	return nil, domain.ErrShareLinkNotFound
}

func (m *mockShareLinkRepository) GetByPetID(ctx context.Context, petID uuid.UUID) ([]domain.ShareLink, error) {
	if m.getByPetIDFn != nil {
		return m.getByPetIDFn(ctx, petID)
	}
	return []domain.ShareLink{}, nil
}

func (m *mockShareLinkRepository) IncrementViewCount(ctx context.Context, id uuid.UUID) error {
	if m.incrementViewCountFn != nil {
		return m.incrementViewCountFn(ctx, id)
	}
	return nil
}

func (m *mockShareLinkRepository) IncrementClickedContact(ctx context.Context, id uuid.UUID) error {
	if m.incrementClickedContactFn != nil {
		return m.incrementClickedContactFn(ctx, id)
	}
	return nil
}

// ============================================================
// Mock: PetRepository for share service (reuses Style B interface)
// ============================================================

type mockPetRepoForShare struct {
	findByIDFn func(id string) (*domain.Pet, error)
}

func (m *mockPetRepoForShare) Create(pet *domain.Pet) error                                   { return nil }
func (m *mockPetRepoForShare) FindByOwnerID(ownerID string) ([]domain.Pet, error)             { return nil, nil }
func (m *mockPetRepoForShare) Update(pet *domain.Pet) error                                   { return nil }
func (m *mockPetRepoForShare) UpdateStatus(id string, status string) error                    { return nil }
func (m *mockPetRepoForShare) Delete(id string) error                                         { return nil }
func (m *mockPetRepoForShare) Search(criteria domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}

func (m *mockPetRepoForShare) FindByID(id string) (*domain.Pet, error) {
	if m.findByIDFn != nil {
		return m.findByIDFn(id)
	}
	return nil, domain.ErrPetNotFound
}

// ============================================================
// Helpers
// ============================================================

func newShareService(
	shareLinkRepo *mockShareLinkRepository,
	petRepo *mockPetRepoForShare,
) service.ShareLinkService {
	bus := event.NewEventBus()
	return service.NewShareLinkService(shareLinkRepo, petRepo, bus)
}

// ============================================================
// GenerateLink tests
// ============================================================

func TestShareService_GenerateLink(t *testing.T) {
	ownerID := uuid.New()
	petID := uuid.New()
	otherID := uuid.New()

	ownedPet := &domain.Pet{
		ID:      petID,
		OwnerID: ptrUUID(ownerID),
		Name:    "Buddy",
		Status:  domain.PetStatusRegistered,
	}

	tests := []struct {
		name          string
		petIDStr      string
		ownerIDStr    string
		shareLinkRepo *mockShareLinkRepository
		petRepo       *mockPetRepoForShare
		wantErr       error
	}{
		{
			name:       "happy path — token created",
			petIDStr:   petID.String(),
			ownerIDStr: ownerID.String(),
			shareLinkRepo: &mockShareLinkRepository{
				createFn: func(_ context.Context, link *domain.ShareLink) error {
					link.ID = uuid.New()
					return nil
				},
			},
			petRepo: &mockPetRepoForShare{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return ownedPet, nil
				},
			},
			wantErr: nil,
		},
		{
			name:       "pet not found — ErrPetNotFound",
			petIDStr:   petID.String(),
			ownerIDStr: ownerID.String(),
			shareLinkRepo: &mockShareLinkRepository{},
			petRepo: &mockPetRepoForShare{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return nil, domain.ErrPetNotFound
				},
			},
			wantErr: domain.ErrPetNotFound,
		},
		{
			name:       "non-owner — ErrNotPetOwner",
			petIDStr:   petID.String(),
			ownerIDStr: otherID.String(), // not the owner
			shareLinkRepo: &mockShareLinkRepository{},
			petRepo: &mockPetRepoForShare{
				findByIDFn: func(_ string) (*domain.Pet, error) {
					return ownedPet, nil // owned by ownerID, not otherID
				},
			},
			wantErr: domain.ErrNotPetOwner,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newShareService(tc.shareLinkRepo, tc.petRepo)
			link, err := svc.Generate(context.Background(), tc.petIDStr, tc.ownerIDStr)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if link != nil {
					t.Errorf("expected nil link on error, got %+v", link)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if link == nil {
				t.Error("expected share link, got nil")
				return
			}
			if link.ShareToken == "" {
				t.Error("expected non-empty share token")
			}
			if link.ExpiresAt == nil {
				t.Error("expected ExpiresAt to be set")
			}
		})
	}
}

// ============================================================
// GetByToken tests
// ============================================================

func TestShareService_GetByToken(t *testing.T) {
	linkID := uuid.New()
	petID := uuid.New()

	futureExpiry := time.Now().Add(24 * time.Hour)
	pastExpiry := time.Now().Add(-1 * time.Hour)

	validLink := &domain.ShareLink{
		ID:         linkID,
		PetID:      petID,
		ShareToken: "valid-token-abc",
		ViewCount:  5,
		ExpiresAt:  &futureExpiry,
	}

	expiredLink := &domain.ShareLink{
		ID:         linkID,
		PetID:      petID,
		ShareToken: "expired-token-xyz",
		ViewCount:  2,
		ExpiresAt:  &pastExpiry,
	}

	tests := []struct {
		name          string
		token         string
		shareLinkRepo *mockShareLinkRepository
		wantViewCount int
		wantErr       error
	}{
		{
			name:  "happy path — returns link with incremented view count",
			token: "valid-token-abc",
			shareLinkRepo: &mockShareLinkRepository{
				getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
					copy := *validLink
					return &copy, nil
				},
				incrementViewCountFn: func(_ context.Context, _ uuid.UUID) error {
					return nil
				},
			},
			wantViewCount: 6, // 5 + 1
			wantErr:       nil,
		},
		{
			name:  "expired link — ErrShareLinkExpired",
			token: "expired-token-xyz",
			shareLinkRepo: &mockShareLinkRepository{
				getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
					return expiredLink, nil
				},
			},
			wantErr: domain.ErrShareLinkExpired,
		},
		{
			name:  "token not found — ErrShareLinkNotFound",
			token: "nonexistent-token",
			shareLinkRepo: &mockShareLinkRepository{
				getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
					return nil, domain.ErrShareLinkNotFound
				},
			},
			wantErr: domain.ErrShareLinkNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newShareService(tc.shareLinkRepo, &mockPetRepoForShare{})
			link, err := svc.GetByToken(context.Background(), tc.token)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if link != nil {
					t.Errorf("expected nil link on error, got %+v", link)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if link == nil {
				t.Error("expected link, got nil")
				return
			}
			if link.ViewCount != tc.wantViewCount {
				t.Errorf("expected view_count=%d, got %d", tc.wantViewCount, link.ViewCount)
			}
		})
	}
}

// ============================================================
// TrackContact tests
// ============================================================

func TestShareService_TrackContact(t *testing.T) {
	linkID := uuid.New()
	petID := uuid.New()

	baseLink := &domain.ShareLink{
		ID:         linkID,
		PetID:      petID,
		ShareToken: "abc-token",
		ClickedContact: 0,
	}

	tests := []struct {
		name          string
		token         string
		shareLinkRepo *mockShareLinkRepository
		wantErr       error
	}{
		{
			name:  "sets clicked_contact — increments counter",
			token: "abc-token",
			shareLinkRepo: &mockShareLinkRepository{
				getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
					copy := *baseLink
					return &copy, nil
				},
				incrementClickedContactFn: func(_ context.Context, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name:  "token not found — returns error",
			token: "missing-token",
			shareLinkRepo: &mockShareLinkRepository{
				getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
					return nil, domain.ErrShareLinkNotFound
				},
			},
			wantErr: domain.ErrShareLinkNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newShareService(tc.shareLinkRepo, &mockPetRepoForShare{})
			err := svc.TrackContact(context.Background(), tc.token)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ============================================================
// TrackView (via GetByToken) — view_count increment test
// ============================================================

func TestShareService_TrackView(t *testing.T) {
	linkID := uuid.New()
	petID := uuid.New()
	futureExpiry := time.Now().Add(24 * time.Hour)

	viewCountCalled := false

	svc := newShareService(
		&mockShareLinkRepository{
			getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
				return &domain.ShareLink{
					ID:        linkID,
					PetID:     petID,
					ViewCount: 10,
					ExpiresAt: &futureExpiry,
				}, nil
			},
			incrementViewCountFn: func(_ context.Context, id uuid.UUID) error {
				viewCountCalled = true
				return nil
			},
		},
		&mockPetRepoForShare{},
	)

	link, err := svc.GetByToken(context.Background(), "any-valid-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !viewCountCalled {
		t.Error("expected IncrementViewCount to be called")
	}

	if link.ViewCount != 11 {
		t.Errorf("expected view_count=11, got %d", link.ViewCount)
	}
}
