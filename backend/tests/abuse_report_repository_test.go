package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestAbuseReportRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
	ctx := context.Background()

	reporter := newTestUser(t, userRepo)
	target := newTestUser(t, userRepo)

	report := &domain.ReportAbuse{
		ID:           uuid.New(),
		TargetUserID: &target.ID,
		ReporterID:   reporter.ID,
		Reason:       "Spam / fraude",
		Status:       "pending",
	}
	if err := abuseRepo.Create(ctx, report); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := abuseRepo.GetByID(ctx, report.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Reason != report.Reason {
		t.Errorf("want reason %q, got %q", report.Reason, got.Reason)
	}
	if got.Status != "pending" {
		t.Errorf("want status 'pending', got %q", got.Status)
	}
}

func TestAbuseReportRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
	ctx := context.Background()

	_, err := abuseRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrAbuseReportNotFound) {
		t.Errorf("want ErrAbuseReportNotFound, got %v", err)
	}
}

func TestAbuseReportRepository_List_Admin(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
	ctx := context.Background()

	reporter := newTestUser(t, userRepo)

	// Create 3 pending + 1 resolved
	for i := 0; i < 3; i++ {
		r := &domain.ReportAbuse{
			ID:         uuid.New(),
			ReporterID: reporter.ID,
			Reason:     "Reason",
			Status:     "pending",
		}
		if err := abuseRepo.Create(ctx, r); err != nil {
			t.Fatalf("Create %d: %v", i, err)
		}
	}
	resolved := &domain.ReportAbuse{
		ID:         uuid.New(),
		ReporterID: reporter.ID,
		Reason:     "Resolved reason",
		Status:     "resolved",
	}
	if err := abuseRepo.Create(ctx, resolved); err != nil {
		t.Fatalf("Create resolved: %v", err)
	}
	// Immediately resolve it via the Resolve method
	adminID := uuid.New()
	if err := abuseRepo.Resolve(ctx, resolved.ID, adminID, "resolved"); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	// List all (nil filter)
	all, err := abuseRepo.GetAll(ctx, nil, 20, 0)
	if err != nil {
		t.Fatalf("GetAll (nil): %v", err)
	}
	if len(all) < 4 {
		t.Errorf("want at least 4 reports, got %d", len(all))
	}

	// List only pending
	pending := false
	pendingList, err := abuseRepo.GetAll(ctx, &pending, 20, 0)
	if err != nil {
		t.Fatalf("GetAll (pending): %v", err)
	}
	for _, r := range pendingList {
		if r.Status != "pending" {
			t.Errorf("non-pending report %s appeared in pending filter", r.ID)
		}
	}
}

func TestAbuseReportRepository_Resolve(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
	ctx := context.Background()

	reporter := newTestUser(t, userRepo)
	admin := newTestUser(t, userRepo)

	report := &domain.ReportAbuse{
		ID:         uuid.New(),
		ReporterID: reporter.ID,
		Reason:     "Test",
		Status:     "pending",
	}
	if err := abuseRepo.Create(ctx, report); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := abuseRepo.Resolve(ctx, report.ID, admin.ID, "resolved"); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	got, err := abuseRepo.GetByID(ctx, report.ID)
	if err != nil {
		t.Fatalf("GetByID after resolve: %v", err)
	}
	if got.Status != "resolved" {
		t.Errorf("want status 'resolved', got %q", got.Status)
	}
	if got.ResolvedBy == nil || *got.ResolvedBy != admin.ID {
		t.Errorf("want resolvedBy=%s, got %v", admin.ID, got.ResolvedBy)
	}
	if got.ResolvedAt == nil {
		t.Error("want non-nil resolved_at")
	}
}
