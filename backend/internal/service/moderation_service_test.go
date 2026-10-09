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
func (m *mockUserRepoForMod) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
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
	svc := NewModerationService(repo, nil)

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
	svc := NewModerationService(repo, nil)

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
	svc := NewModerationService(repo, nil)

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
	svc := NewModerationService(repo, nil)

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
	svc := NewModerationService(repo, nil)

	err := svc.UnbanUser(context.Background(), uuid.New())
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

// recordDisconnect returns a disconnect func and the ids it was called with.
func recordDisconnect() (func(uuid.UUID), *[]uuid.UUID) {
	var got []uuid.UUID
	return func(id uuid.UUID) { got = append(got, id) }, &got
}

// A ban must also end the user's open WebSockets: a socket authenticates once,
// at the upgrade, so the middleware never sees it again.
func TestModerationService_BanUser_DisconnectsTheTargetAfterSaving(t *testing.T) {
	id := uuid.New()
	saved := false
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id}, nil
		},
		updateFn: func(_ context.Context, _ *domain.User) error { saved = true; return nil },
	}
	disconnect, got := recordDisconnect()
	var savedWhenDisconnected bool
	svc := NewModerationService(repo, func(u uuid.UUID) { savedWhenDisconnected = saved; disconnect(u) })

	if err := svc.BanUser(context.Background(), id, "spam"); err != nil {
		t.Fatalf("BanUser: %v", err)
	}
	if len(*got) != 1 || (*got)[0] != id {
		t.Fatalf("disconnected %v, want exactly [%s]", *got, id)
	}
	if !savedWhenDisconnected {
		t.Fatal("disconnected before the ban was saved")
	}
}

// Cutting sockets on a ban that did not happen would leave the user offline
// with nothing changed.
func TestModerationService_BanUser_FailedSaveDisconnectsNobody(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id}, nil
		},
		updateFn: func(_ context.Context, _ *domain.User) error { return errors.New("db down") },
	}
	disconnect, got := recordDisconnect()
	svc := NewModerationService(repo, disconnect)

	if err := svc.BanUser(context.Background(), uuid.New(), "spam"); err == nil {
		t.Fatal("BanUser: want the save error")
	}
	if len(*got) != 0 {
		t.Fatalf("disconnected %v after a failed save, want nobody", *got)
	}
}

func TestModerationService_BanUser_AdminTargetDisconnectsNobody(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsAdmin: true}, nil
		},
	}
	disconnect, got := recordDisconnect()
	svc := NewModerationService(repo, disconnect)

	if err := svc.BanUser(context.Background(), uuid.New(), "spam"); !errors.Is(err, domain.ErrCannotModerateAdmin) {
		t.Fatalf("BanUser: err = %v, want ErrCannotModerateAdmin", err)
	}
	if len(*got) != 0 {
		t.Fatalf("disconnected %v, want nobody", *got)
	}
}

func TestModerationService_UnbanUser_DisconnectsNobody(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsBanned: true}, nil
		},
	}
	disconnect, got := recordDisconnect()
	svc := NewModerationService(repo, disconnect)

	if err := svc.UnbanUser(context.Background(), uuid.New()); err != nil {
		t.Fatalf("UnbanUser: %v", err)
	}
	if len(*got) != 0 {
		t.Fatalf("disconnected %v on unban, want nobody", *got)
	}
}

func TestModerationService_BanUser_NilDisconnectStillBans(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id}, nil
		},
	}
	if err := NewModerationService(repo, nil).BanUser(context.Background(), uuid.New(), "spam"); err != nil {
		t.Fatalf("BanUser with nil disconnect: %v", err)
	}
}
