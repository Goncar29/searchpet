package service_test

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ============================================================
// Mock: UserRepository (Style A — context + uuid)
// ============================================================

type mockUserRepo struct {
	user       *domain.User
	emailErr   error // error devuelto por GetByEmail
	getByIDErr error // error devuelto por GetByID
	createErr  error
	updateErr  error
}

func (m *mockUserRepo) Create(_ context.Context, user *domain.User) error {
	if m.createErr != nil {
		return m.createErr
	}
	user.ID = uuid.New()
	return nil
}

func (m *mockUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*domain.User, error) {
	return m.user, m.getByIDErr
}

func (m *mockUserRepo) GetByEmail(_ context.Context, _ string) (*domain.User, error) {
	return m.user, m.emailErr
}

func (m *mockUserRepo) Update(_ context.Context, user *domain.User) error {
	return m.updateErr
}

func (m *mockUserRepo) Delete(_ context.Context, _ uuid.UUID) error {
	return nil
}

// ============================================================
// Mock: ReportRepository (Style B — sin context, string IDs)
// ============================================================

type mockReportRepo struct {
	preloaded      *domain.Report  // lo que FindByID devuelve (simula JOIN con Pet)
	reports        []domain.Report // lo que FindByPetID y FindNearby devuelven
	createErr      error
	findErr        error
	capturedRadius float64        // para verificar el radio usado en FindNearby
	createdCount   int            // cuántas veces se llamó a Create
	lastReport     *domain.Report // último reporte pasado a Create
	deleteFn       func(context.Context, uuid.UUID) error
}

func (m *mockReportRepo) Create(report *domain.Report) error {
	m.createdCount++
	m.lastReport = report
	if m.createErr != nil {
		return m.createErr
	}
	report.ID = uuid.New()
	return nil
}

func (m *mockReportRepo) FindByID(_ string) (*domain.Report, error) {
	if m.findErr != nil {
		return nil, m.findErr
	}
	if m.preloaded != nil {
		return m.preloaded, nil
	}
	return &domain.Report{ID: uuid.New()}, nil
}

func (m *mockReportRepo) FindByPetID(_ string) ([]domain.Report, error) {
	return m.reports, m.findErr
}

func (m *mockReportRepo) FindNearby(_, _ float64, radius float64) ([]domain.Report, error) {
	m.capturedRadius = radius
	return m.reports, m.findErr
}

func (m *mockReportRepo) UpdateVerified(_ context.Context, _ uuid.UUID, _ uuid.UUID) error {
	return nil
}

func (m *mockReportRepo) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}
