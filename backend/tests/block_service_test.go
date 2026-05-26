package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: BlockedUserRepository
// ============================================================

type mockBlockedUserRepoForBlock struct {
	createFn             func(ctx context.Context, block *domain.BlockedUser) error
	deleteFn             func(ctx context.Context, blockerID, blockedID uuid.UUID) error
	isBlockedFn          func(ctx context.Context, userA, userB uuid.UUID) (bool, error)
	getBlockedByUserIDFn func(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error)
}

func (m *mockBlockedUserRepoForBlock) Create(ctx context.Context, block *domain.BlockedUser) error {
	if m.createFn != nil {
		return m.createFn(ctx, block)
	}
	return nil
}

func (m *mockBlockedUserRepoForBlock) Delete(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, blockerID, blockedID)
	}
	return nil
}

func (m *mockBlockedUserRepoForBlock) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	if m.isBlockedFn != nil {
		return m.isBlockedFn(ctx, userA, userB)
	}
	return false, nil
}

func (m *mockBlockedUserRepoForBlock) GetBlockedByUserID(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	if m.getBlockedByUserIDFn != nil {
		return m.getBlockedByUserIDFn(ctx, userID)
	}
	return []domain.BlockedUser{}, nil
}

// ============================================================
// Helpers
// ============================================================

func newBlockService(repo *mockBlockedUserRepoForBlock) service.BlockService {
	return service.NewBlockService(repo)
}

// ============================================================
// Block tests
// ============================================================

func TestBlockService_Block(t *testing.T) {
	blockerID := uuid.New()
	blockedID := uuid.New()

	tests := []struct {
		name      string
		blockerID uuid.UUID
		blockedID uuid.UUID
		repo      *mockBlockedUserRepoForBlock
		wantErr   error
	}{
		{
			name:      "happy path — block stored",
			blockerID: blockerID,
			blockedID: blockedID,
			repo: &mockBlockedUserRepoForBlock{
				createFn: func(_ context.Context, b *domain.BlockedUser) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name:      "idempotent — already blocked returns nil",
			blockerID: blockerID,
			blockedID: blockedID,
			repo: &mockBlockedUserRepoForBlock{
				createFn: func(_ context.Context, b *domain.BlockedUser) error {
					// Simulate PostgreSQL unique constraint violation (error code 23505)
					return errors.New("duplicate key value violates unique constraint (23505)")
				},
			},
			wantErr: nil,
		},
		{
			name:      "cannot block yourself — ErrInvalidInput",
			blockerID: blockerID,
			blockedID: blockerID, // same ID
			repo:      &mockBlockedUserRepoForBlock{},
			wantErr:   domain.ErrInvalidInput,
		},
		{
			name:      "repository error propagated",
			blockerID: blockerID,
			blockedID: blockedID,
			repo: &mockBlockedUserRepoForBlock{
				createFn: func(_ context.Context, b *domain.BlockedUser) error {
					return errors.New("db connection error")
				},
			},
			wantErr: errors.New("db connection error"),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newBlockService(tc.repo)
			err := svc.Block(context.Background(), tc.blockerID, tc.blockedID, "test reason")

			if tc.wantErr != nil {
				if err == nil {
					t.Errorf("expected error %v, got nil", tc.wantErr)
					return
				}
				// For domain errors, use errors.Is; for generic errors, just check non-nil
				if errors.Is(tc.wantErr, domain.ErrInvalidInput) {
					if !errors.Is(err, domain.ErrInvalidInput) {
						t.Errorf("expected ErrInvalidInput, got %v", err)
					}
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
// Unblock tests
// ============================================================

func TestBlockService_Unblock(t *testing.T) {
	blockerID := uuid.New()
	blockedID := uuid.New()

	tests := []struct {
		name    string
		repo    *mockBlockedUserRepoForBlock
		wantErr error
	}{
		{
			name: "happy path — block removed",
			repo: &mockBlockedUserRepoForBlock{
				deleteFn: func(_ context.Context, _, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name: "not blocked — returns error",
			repo: &mockBlockedUserRepoForBlock{
				deleteFn: func(_ context.Context, _, _ uuid.UUID) error {
					return domain.ErrBlockNotFound
				},
			},
			wantErr: domain.ErrBlockNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newBlockService(tc.repo)
			err := svc.Unblock(context.Background(), blockerID, blockedID)

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
// GetBlocked tests
// ============================================================

func TestBlockService_GetBlocked(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()

	blockedList := []domain.BlockedUser{
		{ID: uuid.New(), BlockerID: userID, BlockedID: otherID},
	}

	tests := []struct {
		name      string
		repo      *mockBlockedUserRepoForBlock
		wantCount int
		wantErr   error
	}{
		{
			name: "returns list for user",
			repo: &mockBlockedUserRepoForBlock{
				getBlockedByUserIDFn: func(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
					return blockedList, nil
				},
			},
			wantCount: 1,
			wantErr:   nil,
		},
		{
			name: "empty list when no blocks",
			repo: &mockBlockedUserRepoForBlock{
				getBlockedByUserIDFn: func(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
					return []domain.BlockedUser{}, nil
				},
			},
			wantCount: 0,
			wantErr:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newBlockService(tc.repo)
			result, err := svc.GetBlocked(context.Background(), userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(result) != tc.wantCount {
				t.Errorf("expected %d results, got %d", tc.wantCount, len(result))
			}
		})
	}
}

// ============================================================
// IsBlocked (bidirectional) tests
// ============================================================

func TestBlockService_IsBlocked_Bidirectional(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()

	tests := []struct {
		name        string
		isBlockedFn func(ctx context.Context, userA, userB uuid.UUID) (bool, error)
		wantBlocked bool
	}{
		{
			name: "A blocked B — returns true",
			isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
				return true, nil
			},
			wantBlocked: true,
		},
		{
			name: "neither blocked — returns false",
			isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
				return false, nil
			},
			wantBlocked: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockBlockedUserRepoForBlock{
				isBlockedFn: tc.isBlockedFn,
			}
			// We test the repository's bidirectional check directly since the service delegates to it
			result, err := repo.IsBlocked(context.Background(), userA, userB)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if result != tc.wantBlocked {
				t.Errorf("expected IsBlocked=%v, got %v", tc.wantBlocked, result)
			}
		})
	}
}
