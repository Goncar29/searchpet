package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresAbuseReportRepository struct {
	db *gorm.DB
}

// NewAbuseReportRepository construye el repositorio de denuncias de abuso.
func NewAbuseReportRepository(db *gorm.DB) AbuseReportRepository {
	return &postgresAbuseReportRepository{db: db}
}

func (r *postgresAbuseReportRepository) Create(ctx context.Context, report *domain.ReportAbuse) error {
	return r.db.WithContext(ctx).Create(report).Error
}

func (r *postgresAbuseReportRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
	var report domain.ReportAbuse
	err := r.db.WithContext(ctx).
		Preload("Reporter").
		Preload("TargetUser").
		Preload("TargetReport.Pet").
		Preload("FosterHome").
		Where("id = ?", id).
		First(&report).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrAbuseReportNotFound
		}
		return nil, err
	}
	return &report, nil
}

func (r *postgresAbuseReportRepository) GetAll(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
	var reports []domain.ReportAbuse
	q := r.db.WithContext(ctx).
		Preload("Reporter").
		Preload("TargetUser").
		Preload("TargetReport.Pet").
		Preload("FosterHome")

	if resolved != nil {
		if *resolved {
			// "resolved" = status != "pending"
			q = q.Where("status != ?", "pending")
		} else {
			q = q.Where("status = ?", "pending")
		}
	}

	if limit <= 0 {
		limit = 20
	}

	// Tiebreak on id so OFFSET paging is stable when rows share created_at.
	err := q.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&reports).Error
	return reports, err
}

// CountAll returns the total number of abuse reports matching the resolved filter.
func (r *postgresAbuseReportRepository) CountAll(ctx context.Context, resolved *bool) (int64, error) {
	var n int64
	q := r.db.WithContext(ctx).Model(&domain.ReportAbuse{})
	if resolved != nil {
		if *resolved {
			q = q.Where("status != ?", "pending")
		} else {
			q = q.Where("status = ?", "pending")
		}
	}
	err := q.Count(&n).Error
	return n, err
}

// ExistsPendingByReporterAndFosterHome checks whether reporterID already has a
// pending abuse report against fosterHomeID.
func (r *postgresAbuseReportRepository) ExistsPendingByReporterAndFosterHome(ctx context.Context, reporterID, fosterHomeID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.ReportAbuse{}).
		Where("reporter_id = ? AND target_foster_home_id = ? AND status = ?", reporterID, fosterHomeID, "pending").
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// Resolve actualiza el status de la denuncia y persiste quién la resolvió (audit).
func (r *postgresAbuseReportRepository) Resolve(ctx context.Context, id uuid.UUID, resolvedBy uuid.UUID, status string) error {
	now := time.Now()
	result := r.db.WithContext(ctx).
		Model(&domain.ReportAbuse{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":      status,
			"resolved_by": resolvedBy,
			"resolved_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrAbuseReportNotFound
	}
	return nil
}
