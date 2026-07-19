package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

// pgUniqueViolationCode es el código SQLSTATE de Postgres para "unique_violation".
const pgUniqueViolationCode = "23505"

// isUniqueViolation detecta una violación de constraint único de Postgres.
// GORM no traduce errores acá (postgres.go no setea TranslateError), así que
// el error crudo del driver pgx/v5 llega tal cual hasta este punto.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode
}

type abuseReportService struct {
	repo           repository.AbuseReportRepository
	fosterHomeRepo repository.FosterHomeRepository
}

// NewAbuseReportService construye el AbuseReportService.
func NewAbuseReportService(repo repository.AbuseReportRepository, fosterHomeRepo repository.FosterHomeRepository) AbuseReportService {
	return &abuseReportService{repo: repo, fosterHomeRepo: fosterHomeRepo}
}

// Submit crea una denuncia de abuso.
// REGLA: al menos uno de TargetUserID, TargetReportID o TargetFosterHomeID debe estar presente.
func (s *abuseReportService) Submit(ctx context.Context, reporterID uuid.UUID, req dto.CreateAbuseReportRequest) (*domain.ReportAbuse, error) {
	if req.TargetUserID == nil && req.TargetReportID == nil && req.TargetFosterHomeID == nil {
		return nil, domain.ErrInvalidInput
	}

	if req.TargetUserID != nil && *req.TargetUserID == reporterID {
		return nil, domain.ErrInvalidInput
	}

	if req.TargetFosterHomeID != nil {
		fh, err := s.fosterHomeRepo.GetByID(ctx, *req.TargetFosterHomeID)
		if err != nil {
			return nil, err
		}
		if fh.OwnerUserID == reporterID {
			return nil, domain.ErrSelfAbuseReport
		}
		exists, err := s.repo.ExistsPendingByReporterAndFosterHome(ctx, reporterID, *req.TargetFosterHomeID)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, domain.ErrDuplicateAbuseReport
		}
	}

	report := &domain.ReportAbuse{
		TargetReportID:     req.TargetReportID,
		TargetUserID:       req.TargetUserID,
		TargetFosterHomeID: req.TargetFosterHomeID,
		ReporterID:         reporterID,
		Reason:             req.Reason,
		Status:             "pending",
	}

	if err := s.repo.Create(ctx, report); err != nil {
		// Race: dos requests concurrentes pasan el pre-check ExistsPendingBy...
		// de arriba y ambos llegan a Create; el índice único parcial
		// uniq_abuse_pending_foster_home rechaza al segundo. Traducimos esa
		// violación puntual a ErrDuplicateAbuseReport (409, ya mapeado en el
		// handler) en vez de dejar que se propague como 500.
		if req.TargetFosterHomeID != nil && isUniqueViolation(err) {
			return nil, domain.ErrDuplicateAbuseReport
		}
		return nil, err
	}

	return s.repo.GetByID(ctx, report.ID)
}

// GetByID obtiene una denuncia por su ID.
func (s *abuseReportService) GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
	return s.repo.GetByID(ctx, id)
}

// List retorna denuncias con filtro opcional de estado resuelto.
func (s *abuseReportService) List(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
	return s.repo.GetAll(ctx, resolved, limit, offset)
}

func (s *abuseReportService) Count(ctx context.Context, resolved *bool) (int64, error) {
	return s.repo.CountAll(ctx, resolved)
}

// Resolve actualiza el status de una denuncia (admin-only — enforced en handler).
// Status válidos: "resolved" o "dismissed".
func (s *abuseReportService) Resolve(ctx context.Context, id uuid.UUID, adminID uuid.UUID, status string) error {
	validStatuses := map[string]bool{"resolved": true, "dismissed": true}
	if !validStatuses[status] {
		return domain.ErrInvalidInput
	}

	return s.repo.Resolve(ctx, id, adminID, status)
}
