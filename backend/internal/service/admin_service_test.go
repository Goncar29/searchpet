package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// --- mocks ---

type mockUserRepoForAdmin struct {
	getByEmailFn func(ctx context.Context, email string) (*domain.User, error)
	getByIDFn    func(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

func (m *mockUserRepoForAdmin) Create(context.Context, *domain.User) error { return nil }
func (m *mockUserRepoForAdmin) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return m.getByIDFn(ctx, id)
}
func (m *mockUserRepoForAdmin) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return m.getByEmailFn(ctx, email)
}
func (m *mockUserRepoForAdmin) Update(context.Context, *domain.User) error { return nil }
func (m *mockUserRepoForAdmin) Delete(context.Context, uuid.UUID) error    { return nil }

var _ repository.UserRepository = (*mockUserRepoForAdmin)(nil)

type mockAdminRepo struct {
	count     int64
	setCalled bool
	lastEntry *domain.AdminAuditLog
	setErr    error
}

func (m *mockAdminRepo) SetAdminWithAudit(_ context.Context, _ uuid.UUID, _ bool, entry *domain.AdminAuditLog) error {
	m.setCalled = true
	m.lastEntry = entry
	return m.setErr
}
func (m *mockAdminRepo) CountAdmins(context.Context) (int64, error) { return m.count, nil }
func (m *mockAdminRepo) ListRoleChanges(context.Context, int) ([]domain.AdminAuditLog, error) {
	return nil, nil
}

var _ repository.AdminRepository = (*mockAdminRepo)(nil)

func adminUsers(target *domain.User, actor *domain.User) *mockUserRepoForAdmin {
	return &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return target, nil },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return actor, nil },
	}
}

// --- tests ---

func TestAdminService_Grant_WritesAuditAndFlips(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test"}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: false}
	adminRepo := &mockAdminRepo{count: 1}
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	res, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", true)
	if err != nil {
		t.Fatalf("SetUserAdmin: %v", err)
	}
	if res.NoChange {
		t.Errorf("expected a change")
	}
	if !adminRepo.setCalled || adminRepo.lastEntry.Action != "grant" {
		t.Errorf("expected a grant audit write, got %+v", adminRepo.lastEntry)
	}
	if adminRepo.lastEntry.ActorEmail != actor.Email || adminRepo.lastEntry.TargetEmail != target.Email {
		t.Errorf("audit snapshot emails wrong: %+v", adminRepo.lastEntry)
	}
}

func TestAdminService_RevokeSelf_Rejected(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 5}
	users := &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return actor, nil },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return actor, nil },
	}
	svc := NewAdminService(users, adminRepo)

	_, err := svc.SetUserAdmin(context.Background(), actor.ID, "actor@x.test", false)
	if !errors.Is(err, domain.ErrCannotRevokeSelf) {
		t.Errorf("want ErrCannotRevokeSelf, got %v", err)
	}
	if adminRepo.setCalled {
		t.Errorf("no write should happen on rejected self-revoke")
	}
}

func TestAdminService_RevokeLastAdmin_Rejected(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test", IsAdmin: true}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 1}
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	_, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", false)
	if !errors.Is(err, domain.ErrCannotRevokeLastAdmin) {
		t.Errorf("want ErrCannotRevokeLastAdmin, got %v", err)
	}
	if adminRepo.setCalled {
		t.Errorf("no write should happen on rejected last-admin revoke")
	}
}

func TestAdminService_NoOpWhenAlreadyInState(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test"}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 2}
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	res, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", true)
	if err != nil {
		t.Fatalf("SetUserAdmin: %v", err)
	}
	if !res.NoChange {
		t.Errorf("expected NoChange=true when already admin")
	}
	if adminRepo.setCalled {
		t.Errorf("no audit row on no-op")
	}
}

func TestAdminService_UnknownEmail_NotFound(t *testing.T) {
	users := &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return nil, domain.ErrUserNotFound },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return nil, nil },
	}
	svc := NewAdminService(users, &mockAdminRepo{count: 2})

	_, err := svc.SetUserAdmin(context.Background(), uuid.New(), "nobody@x.test", true)
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestAdminService_EmptyEmail_InvalidInput(t *testing.T) {
	svc := NewAdminService(&mockUserRepoForAdmin{}, &mockAdminRepo{})
	_, err := svc.SetUserAdmin(context.Background(), uuid.New(), "   ", true)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}
