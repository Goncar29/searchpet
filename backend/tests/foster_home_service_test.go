package tests

import (
	"context"
	"strings"
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

func TestUpdateMine_WritesChangeLogWithDiff(t *testing.T) {
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
	if _, err := svc.Approve(ctx, uuid.New().String(), fhID); err != nil {
		t.Fatalf("Approve failed: %v", err)
	}

	city := "Salto"
	if _, err := svc.UpdateMine(ctx, ownerID.String(), &dto.UpdateMyFosterHomeRequest{City: &city}); err != nil {
		t.Fatalf("UpdateMine failed: %v", err)
	}

	if len(auditRepo.changeLogs) != 1 {
		t.Fatalf("expected exactly 1 change log, got %d", len(auditRepo.changeLogs))
	}
	logEntry := auditRepo.changeLogs[0]
	if logEntry.ChangeType != domain.FosterHomeChangeListingEdit {
		t.Errorf("expected change type %q, got %q", domain.FosterHomeChangeListingEdit, logEntry.ChangeType)
	}
	if !strings.Contains(logEntry.ChangedFields, "city") ||
		!strings.Contains(logEntry.ChangedFields, "Montevideo") ||
		!strings.Contains(logEntry.ChangedFields, "Salto") {
		t.Errorf("expected ChangedFields to contain city old->new diff, got %q", logEntry.ChangedFields)
	}
}

func TestUpdateMine_NoChangeNoLog(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	auditRepo := &fakeAuditRepo{}
	svc := service.NewFosterHomeService(fhRepo, userRepo, auditRepo, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}

	// Same animal_types, nothing else changed → no change log.
	same := []string{"dog"}
	if _, err := svc.UpdateMine(ctx, ownerID.String(), &dto.UpdateMyFosterHomeRequest{AnimalTypes: same}); err != nil {
		t.Fatalf("UpdateMine failed: %v", err)
	}
	if len(auditRepo.changeLogs) != 0 {
		t.Fatalf("expected no change log for identical update, got %d", len(auditRepo.changeLogs))
	}
}

func TestRecordOwnerContactChange_NoHomeIsNoop(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	auditRepo := &fakeAuditRepo{}
	svc := service.NewFosterHomeService(newFakeFHRepo(), userRepo, auditRepo, nil)

	err := svc.RecordOwnerContactChange(ctx, ownerID, map[string][2]string{"phone": {"111", "222"}})
	if err != nil {
		t.Fatalf("expected nil for user without a foster home, got %v", err)
	}
	if len(auditRepo.changeLogs) != 0 {
		t.Fatalf("expected no change log, got %d", len(auditRepo.changeLogs))
	}
}

func TestRecordOwnerContactChange_WritesLog(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	auditRepo := &fakeAuditRepo{}
	svc := service.NewFosterHomeService(fhRepo, userRepo, auditRepo, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}

	err := svc.RecordOwnerContactChange(ctx, ownerID, map[string][2]string{"phone": {"111", "222"}})
	if err != nil {
		t.Fatalf("RecordOwnerContactChange failed: %v", err)
	}
	if len(auditRepo.changeLogs) != 1 {
		t.Fatalf("expected exactly 1 change log, got %d", len(auditRepo.changeLogs))
	}
	if auditRepo.changeLogs[0].ChangeType != domain.FosterHomeChangeOwnerContact {
		t.Errorf("expected change type %q, got %q", domain.FosterHomeChangeOwnerContact, auditRepo.changeLogs[0].ChangeType)
	}
}

func TestGetApprovedByID_NonApproved404(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	svc := service.NewFosterHomeService(fhRepo, userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	// Home is pending, not approved.
	_, err := svc.GetApprovedByID(ctx, fhRepo.created.ID.String())
	if err != domain.ErrFosterHomeNotFound {
		t.Fatalf("expected ErrFosterHomeNotFound for pending home, got %v", err)
	}
}

func TestInvalidTransition(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	svc := service.NewFosterHomeService(fhRepo, userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	// Suspending a PENDING home is not a valid transition (only approved → suspended).
	_, err := svc.Suspend(ctx, uuid.New().String(), fhRepo.created.ID.String(), "fraude")
	if err != domain.ErrInvalidFosterHomeStatus {
		t.Fatalf("expected ErrInvalidFosterHomeStatus, got %v", err)
	}
}

func TestReject_RequiresReason(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	svc := service.NewFosterHomeService(fhRepo, userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	// Whitespace-only reason must be rejected (trimmed to empty).
	_, err := svc.Reject(ctx, uuid.New().String(), fhRepo.created.ID.String(), "  ")
	if err != domain.ErrRejectionReasonRequired {
		t.Fatalf("expected ErrRejectionReasonRequired for whitespace reason, got %v", err)
	}
}
