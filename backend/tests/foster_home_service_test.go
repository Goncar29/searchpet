package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

type fakeFHRepo struct {
	byOwner map[uuid.UUID]*domain.FosterHome
	created *domain.FosterHome
}

func newFakeFHRepo() *fakeFHRepo { return &fakeFHRepo{byOwner: map[uuid.UUID]*domain.FosterHome{}} }

func (f *fakeFHRepo) Create(_ context.Context, fh *domain.FosterHome) error {
	if fh.ID == (uuid.UUID{}) {
		fh.ID = uuid.New()
	}
	f.created = fh
	f.byOwner[fh.OwnerUserID] = fh
	return nil
}
func (f *fakeFHRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.FosterHome, error) {
	for _, fh := range f.byOwner {
		if fh.ID == id {
			return fh, nil
		}
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fakeFHRepo) GetByOwner(_ context.Context, ownerID uuid.UUID) (*domain.FosterHome, error) {
	if fh, ok := f.byOwner[ownerID]; ok {
		return fh, nil
	}
	return nil, domain.ErrFosterHomeNotFound
}
func (f *fakeFHRepo) GetApproved(_ context.Context, _, _ string) ([]domain.FosterHome, error) {
	return nil, nil
}
func (f *fakeFHRepo) GetPendingQueue(_ context.Context) ([]domain.FosterHome, error) { return nil, nil }
func (f *fakeFHRepo) Update(_ context.Context, fh *domain.FosterHome) error {
	f.byOwner[fh.OwnerUserID] = fh
	return nil
}

type fakeUserRepo struct{ users map[uuid.UUID]*domain.User }

func (f *fakeUserRepo) Create(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepo) GetByID(_ context.Context, id uuid.UUID) (*domain.User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return nil, domain.ErrUserNotFound
}
func (f *fakeUserRepo) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (f *fakeUserRepo) Update(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepo) Delete(context.Context, uuid.UUID) error    { return nil }

type fakeAuditRepo struct {
	modLogs    []*domain.FosterHomeModerationLog
	changeLogs []*domain.FosterHomeChangeLog
}

func (f *fakeAuditRepo) CreateModerationLog(_ context.Context, l *domain.FosterHomeModerationLog) error {
	f.modLogs = append(f.modLogs, l)
	return nil
}
func (f *fakeAuditRepo) ListModerationLogs(context.Context, uuid.UUID) ([]domain.FosterHomeModerationLog, error) {
	return nil, nil
}
func (f *fakeAuditRepo) CreateChangeLog(_ context.Context, l *domain.FosterHomeChangeLog) error {
	f.changeLogs = append(f.changeLogs, l)
	return nil
}
func (f *fakeAuditRepo) ListChangeLogs(context.Context, uuid.UUID) ([]domain.FosterHomeChangeLog, error) {
	return nil, nil
}

func newVerifiedUser() (uuid.UUID, *fakeUserRepo) {
	id := uuid.New()
	return id, &fakeUserRepo{users: map[uuid.UUID]*domain.User{
		id: {ID: id, Email: "u@test.com", EmailVerified: true},
	}}
}

func TestRegisterOwn_RequiresEmailVerified(t *testing.T) {
	ctx := context.Background()
	id := uuid.New()
	userRepo := &fakeUserRepo{users: map[uuid.UUID]*domain.User{
		id: {ID: id, Email: "unverified@test.com", EmailVerified: false},
	}}
	svc := service.NewFosterHomeService(newFakeFHRepo(), userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	err := svc.RegisterOwn(ctx, id.String(), fh)
	if err != domain.ErrEmailNotVerified {
		t.Fatalf("expected ErrEmailNotVerified, got %v", err)
	}
}

func TestRegisterOwn_SecondHomeConflicts(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	svc := service.NewFosterHomeService(newFakeFHRepo(), userRepo, &fakeAuditRepo{}, nil)

	fh1 := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh1); err != nil {
		t.Fatalf("first RegisterOwn should succeed, got %v", err)
	}

	fh2 := &domain.FosterHome{City: "Salto", HousingType: "apartment", AnimalTypes: []string{"cat"}, Capacity: 1, Description: "desc2"}
	err := svc.RegisterOwn(ctx, ownerID.String(), fh2)
	if err != domain.ErrFosterHomeAlreadyOwned {
		t.Fatalf("expected ErrFosterHomeAlreadyOwned, got %v", err)
	}
}

func TestRegisterOwn_BornsPending(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	svc := service.NewFosterHomeService(newFakeFHRepo(), userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	if fh.Status != domain.FosterHomeStatusPending {
		t.Errorf("expected status pending, got %q", fh.Status)
	}
	if fh.OwnerUserID != ownerID {
		t.Errorf("expected owner %s, got %s", ownerID, fh.OwnerUserID)
	}
}

func TestSuspend_RequiresReasonAndLogs(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	auditRepo := &fakeAuditRepo{}
	svc := service.NewFosterHomeService(fhRepo, userRepo, auditRepo, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	fhID := fhRepo.created.ID.String()
	adminID := uuid.New().String()

	if _, err := svc.Approve(ctx, adminID, fhID); err != nil {
		t.Fatalf("Approve failed: %v", err)
	}

	if _, err := svc.Suspend(ctx, adminID, fhID, ""); err != domain.ErrSuspensionReasonRequired {
		t.Fatalf("expected ErrSuspensionReasonRequired, got %v", err)
	}

	got, err := svc.Suspend(ctx, adminID, fhID, "fraude")
	if err != nil {
		t.Fatalf("Suspend failed: %v", err)
	}
	if got.Status != domain.FosterHomeStatusSuspended {
		t.Errorf("expected status suspended, got %q", got.Status)
	}

	found := false
	for _, l := range auditRepo.modLogs {
		if l.Action == domain.FosterHomeActionSuspend && l.Reason == "fraude" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a moderation log with Action=suspend Reason=fraude, got %+v", auditRepo.modLogs)
	}
}

func TestEditSuspended_IsFrozen(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	svc := service.NewFosterHomeService(fhRepo, userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	fhID := fhRepo.created.ID.String()
	adminID := uuid.New().String()

	if _, err := svc.Approve(ctx, adminID, fhID); err != nil {
		t.Fatalf("Approve failed: %v", err)
	}
	if _, err := svc.Suspend(ctx, adminID, fhID, "fraude"); err != nil {
		t.Fatalf("Suspend failed: %v", err)
	}

	city := "Salto"
	_, err := svc.UpdateMine(ctx, ownerID.String(), &dto.UpdateMyFosterHomeRequest{City: &city})
	if err != domain.ErrFosterHomeSuspended {
		t.Fatalf("expected ErrFosterHomeSuspended, got %v", err)
	}
}
