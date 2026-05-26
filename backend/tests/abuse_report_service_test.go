package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ============================================================
// Mock repository
// ============================================================

type mockAbuseReportRepository struct {
	createFn   func(ctx context.Context, report *domain.ReportAbuse) error
	getByIDFn  func(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error)
	getAllFn    func(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error)
	resolveFn  func(ctx context.Context, id uuid.UUID, resolvedBy uuid.UUID, status string) error
}

func (m *mockAbuseReportRepository) Create(ctx context.Context, report *domain.ReportAbuse) error {
	if m.createFn != nil {
		return m.createFn(ctx, report)
	}
	report.ID = uuid.New()
	return nil
}

func (m *mockAbuseReportRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, domain.ErrAbuseReportNotFound
}

func (m *mockAbuseReportRepository) GetAll(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
	if m.getAllFn != nil {
		return m.getAllFn(ctx, resolved, limit, offset)
	}
	return []domain.ReportAbuse{}, nil
}

func (m *mockAbuseReportRepository) Resolve(ctx context.Context, id uuid.UUID, resolvedBy uuid.UUID, status string) error {
	if m.resolveFn != nil {
		return m.resolveFn(ctx, id, resolvedBy, status)
	}
	return nil
}

// ============================================================
// Helpers
// ============================================================

func newTestAbuseReportService(repo *mockAbuseReportRepository) service.AbuseReportService {
	return service.NewAbuseReportService(repo)
}

func ptrUUID(id uuid.UUID) *uuid.UUID { return &id }

// ============================================================
// Submit tests
// ============================================================

func TestAbuseReportService_Submit(t *testing.T) {
	reporterID := uuid.New()
	targetUserID := uuid.New()
	targetReportID := uuid.New()

	createdAt := time.Now()

	tests := []struct {
		name       string
		repo       *mockAbuseReportRepository
		reporterID uuid.UUID
		req        dto.CreateAbuseReportRequest
		wantErr    error
	}{
		{
			name: "happy path — target_user_id provided",
			repo: &mockAbuseReportRepository{
				createFn: func(_ context.Context, r *domain.ReportAbuse) error {
					r.ID = uuid.New()
					r.CreatedAt = createdAt
					return nil
				},
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
					return &domain.ReportAbuse{
						ID:           id,
						TargetUserID: ptrUUID(targetUserID),
						ReporterID:   reporterID,
						Reason:       "spam",
						Status:       "pending",
						CreatedAt:    createdAt,
					}, nil
				},
			},
			reporterID: reporterID,
			req: dto.CreateAbuseReportRequest{
				TargetUserID: ptrUUID(targetUserID),
				Reason:       "spam",
			},
			wantErr: nil,
		},
		{
			name: "happy path — target_report_id provided",
			repo: &mockAbuseReportRepository{
				createFn: func(_ context.Context, r *domain.ReportAbuse) error {
					r.ID = uuid.New()
					return nil
				},
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
					return &domain.ReportAbuse{
						ID:             id,
						TargetReportID: ptrUUID(targetReportID),
						ReporterID:     reporterID,
						Reason:         "fake location",
						Status:         "pending",
					}, nil
				},
			},
			reporterID: reporterID,
			req: dto.CreateAbuseReportRequest{
				TargetReportID: ptrUUID(targetReportID),
				Reason:         "fake location",
			},
			wantErr: nil,
		},
		{
			name:       "no target — ErrInvalidInput",
			repo:       &mockAbuseReportRepository{},
			reporterID: reporterID,
			req: dto.CreateAbuseReportRequest{
				Reason: "something",
				// neither TargetUserID nor TargetReportID
			},
			wantErr: domain.ErrInvalidInput,
		},
		{
			name:       "reporter cannot report themselves — ErrInvalidInput",
			repo:       &mockAbuseReportRepository{},
			reporterID: reporterID,
			req: dto.CreateAbuseReportRequest{
				TargetUserID: ptrUUID(reporterID), // same as reporter
				Reason:       "testing self-report",
			},
			wantErr: domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestAbuseReportService(tc.repo)
			result, err := svc.Submit(context.Background(), tc.reporterID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if result != nil {
					t.Error("expected nil result on error")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil {
				t.Fatal("expected result, got nil")
			}
			if result.Status != "pending" {
				t.Errorf("new report should have status 'pending', got %q", result.Status)
			}
			if result.ReporterID != tc.reporterID {
				t.Errorf("ReporterID: want %v, got %v", tc.reporterID, result.ReporterID)
			}
		})
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestAbuseReportService_GetByID(t *testing.T) {
	reportID := uuid.New()

	tests := []struct {
		name    string
		repo    *mockAbuseReportRepository
		id      uuid.UUID
		wantErr error
	}{
		{
			name: "returns report by ID",
			repo: &mockAbuseReportRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
					return &domain.ReportAbuse{ID: id, Status: "pending"}, nil
				},
			},
			id:      reportID,
			wantErr: nil,
		},
		{
			name: "not found — ErrAbuseReportNotFound",
			repo: &mockAbuseReportRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.ReportAbuse, error) {
					return nil, domain.ErrAbuseReportNotFound
				},
			},
			id:      reportID,
			wantErr: domain.ErrAbuseReportNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestAbuseReportService(tc.repo)
			result, err := svc.GetByID(context.Background(), tc.id)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil {
				t.Fatal("expected result, got nil")
			}
		})
	}
}

// ============================================================
// List (GetAll) tests
// ============================================================

func TestAbuseReportService_List(t *testing.T) {
	boolFalse := false
	boolTrue := true

	tests := []struct {
		name     string
		repo     *mockAbuseReportRepository
		resolved *bool
		limit    int
		offset   int
		wantLen  int
		wantErr  error
	}{
		{
			name: "all reports — no filter",
			repo: &mockAbuseReportRepository{
				getAllFn: func(_ context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
					return []domain.ReportAbuse{
						{ID: uuid.New(), Status: "pending"},
						{ID: uuid.New(), Status: "resolved"},
					}, nil
				},
			},
			resolved: nil,
			limit:    10,
			offset:   0,
			wantLen:  2,
			wantErr:  nil,
		},
		{
			name: "only unresolved reports",
			repo: &mockAbuseReportRepository{
				getAllFn: func(_ context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
					if resolved == nil || *resolved != false {
						return nil, errors.New("unexpected resolved filter")
					}
					return []domain.ReportAbuse{
						{ID: uuid.New(), Status: "pending"},
					}, nil
				},
			},
			resolved: &boolFalse,
			limit:    10,
			offset:   0,
			wantLen:  1,
			wantErr:  nil,
		},
		{
			name: "only resolved reports",
			repo: &mockAbuseReportRepository{
				getAllFn: func(_ context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
					if resolved == nil || *resolved != true {
						return nil, errors.New("unexpected resolved filter")
					}
					return []domain.ReportAbuse{
						{ID: uuid.New(), Status: "resolved"},
					}, nil
				},
			},
			resolved: &boolTrue,
			limit:    10,
			offset:   0,
			wantLen:  1,
			wantErr:  nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestAbuseReportService(tc.repo)
			results, err := svc.List(context.Background(), tc.resolved, tc.limit, tc.offset)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(results) != tc.wantLen {
				t.Errorf("expected %d results, got %d", tc.wantLen, len(results))
			}
		})
	}
}

// ============================================================
// Resolve tests
// ============================================================

func TestAbuseReportService_Resolve(t *testing.T) {
	reportID := uuid.New()
	adminID := uuid.New()

	tests := []struct {
		name    string
		repo    *mockAbuseReportRepository
		status  string
		wantErr error
	}{
		{
			name: "resolve with status 'resolved'",
			repo: &mockAbuseReportRepository{
				resolveFn: func(_ context.Context, id, resolvedBy uuid.UUID, status string) error {
					if status != "resolved" {
						return errors.New("wrong status")
					}
					return nil
				},
			},
			status:  "resolved",
			wantErr: nil,
		},
		{
			name: "resolve with status 'dismissed'",
			repo: &mockAbuseReportRepository{
				resolveFn: func(_ context.Context, id, resolvedBy uuid.UUID, status string) error {
					if status != "dismissed" {
						return errors.New("wrong status")
					}
					return nil
				},
			},
			status:  "dismissed",
			wantErr: nil,
		},
		{
			name:    "invalid status — ErrInvalidInput",
			repo:    &mockAbuseReportRepository{},
			status:  "random_status",
			wantErr: domain.ErrInvalidInput,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestAbuseReportService(tc.repo)
			err := svc.Resolve(context.Background(), reportID, adminID, tc.status)

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
