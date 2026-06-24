package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

type mockUserRepoForMod struct {
	getByIDFn func(ctx context.Context, id uuid.UUID) (*domain.User, error)
	updateFn  func(ctx context.Context, u *domain.User) error
}

func (m *mockUserRepoForMod) Create(context.Context, *domain.User) error { return nil }
func (m *mockUserRepoForMod) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return m.getByIDFn(ctx, id)
}
func (m *mockUserRepoForMod) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, nil
}
func (m *mockUserRepoForMod) Update(ctx context.Context, u *domain.User) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, u)
	}
	return nil
}
func (m *mockUserRepoForMod) Delete(context.Context, uuid.UUID) error { return nil }

var _ repository.UserRepository = (*mockUserRepoForMod)(nil)

func TestModerationService_BanUser_SetsBannedAndReason(t *testing.T) {
	id := uuid.New()
	var saved *domain.User
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsAdmin: false}, nil
		},
		updateFn: func(_ context.Context, u *domain.User) error { saved = u; return nil },
	}
	svc := NewModerationService(repo)

	if err := svc.BanUser(context.Background(), id, "spam"); err != nil {
		t.Fatalf("BanUser: %v", err)
	}
	if saved == nil || !saved.IsBanned || saved.BanReason != "spam" {
		t.Errorf("want banned with reason 'spam', got %+v", saved)
	}
}

func TestModerationService_BanUser_RejectsAdmin(t *testing.T) {
	id := uuid.New()
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsAdmin: true}, nil
		},
	}
	svc := NewModerationService(repo)

	err := svc.BanUser(context.Background(), id, "x")
	if !errors.Is(err, domain.ErrCannotModerateAdmin) {
		t.Errorf("want ErrCannotModerateAdmin, got %v", err)
	}
}

func TestModerationService_BanUser_PropagatesNotFound(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	svc := NewModerationService(repo)

	err := svc.BanUser(context.Background(), uuid.New(), "x")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestModerationService_UnbanUser_ClearsBan(t *testing.T) {
	id := uuid.New()
	var saved *domain.User
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsBanned: true, BanReason: "spam"}, nil
		},
		updateFn: func(_ context.Context, u *domain.User) error { saved = u; return nil },
	}
	svc := NewModerationService(repo)

	if err := svc.UnbanUser(context.Background(), id); err != nil {
		t.Fatalf("UnbanUser: %v", err)
	}
	if saved == nil || saved.IsBanned || saved.BanReason != "" {
		t.Errorf("want unbanned with cleared reason, got %+v", saved)
	}
}

func TestModerationService_UnbanUser_PropagatesNotFound(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	svc := NewModerationService(repo)

	err := svc.UnbanUser(context.Background(), uuid.New())
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}
