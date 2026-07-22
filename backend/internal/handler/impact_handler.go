package handler

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// impactCacheTTL is how long a computed payload is served from memory before a
// recompute. Impact numbers do not change per second; this shields the DB
// (Render free tier) from repeated admin-dashboard hits.
const impactCacheTTL = 5 * time.Minute

// impactMonthsWindow is how many trailing calendar months the monthly series span.
const impactMonthsWindow = 12

// ImpactHandler serves the admin-only impact dashboard at GET /api/stats/impact.
// The route is mounted behind Auth + RequireAdmin in the router; the handler
// itself performs no auth so it stays testable in isolation.
type ImpactHandler struct {
	db *gorm.DB

	mu       sync.RWMutex
	cached   *ImpactResponse
	cachedAt time.Time
}

func NewImpactHandler(db *gorm.DB) *ImpactHandler {
	return &ImpactHandler{db: db}
}

// ImpactTotals are the headline numbers. Lifetime counters (pets_reunited,
// searches_started) come from the append-only ledger; total_users/total_pets/
// active_searches are live snapshot counts; reunion_rate is derived.
type ImpactTotals struct {
	PetsReunited    int64   `json:"pets_reunited"`
	SearchesStarted int64   `json:"searches_started"`
	TotalUsers      int64   `json:"total_users"`
	TotalPets       int64   `json:"total_pets"`
	ActiveSearches  int64   `json:"active_searches"`
	ReunionRate     float64 `json:"reunion_rate"`
}

// MonthlyCount is one point on a per-month series. Month is "YYYY-MM".
type MonthlyCount struct {
	Month string `json:"month"`
	Count int64  `json:"count"`
}

// TypeCount is one slice of the pets-by-type breakdown (perro/gato/ave/otro…).
type TypeCount struct {
	Type  string `json:"type"`
	Count int64  `json:"count"`
}

// ModerationStats is a snapshot of everything awaiting admin attention: abuse
// reports (by status) plus the foster-home and shelter approval queues. The
// three *_pending counts answer "what do I still need to review, and where".
type ModerationStats struct {
	AbusePending       int64 `json:"abuse_pending"`
	AbuseResolved      int64 `json:"abuse_resolved"`
	AbuseDismissed     int64 `json:"abuse_dismissed"`
	FosterHomesPending int64 `json:"foster_homes_pending"`
	SheltersPending    int64 `json:"shelters_pending"`
}

type ImpactResponse struct {
	Totals          ImpactTotals    `json:"totals"`
	ReunionsByMonth []MonthlyCount  `json:"reunions_by_month"`
	NewUsersByMonth []MonthlyCount  `json:"new_users_by_month"`
	ReportsByMonth  []MonthlyCount  `json:"reports_by_month"`
	PetsByType      []TypeCount     `json:"pets_by_type"`
	Moderation      ModerationStats `json:"moderation"`
}

// GetImpactStats godoc
// GET /api/stats/impact
func (h *ImpactHandler) GetImpactStats(c *gin.Context) {
	h.mu.RLock()
	if h.cached != nil && time.Since(h.cachedAt) < impactCacheTTL {
		resp := h.cached
		h.mu.RUnlock()
		c.JSON(http.StatusOK, resp)
		return
	}
	h.mu.RUnlock()

	h.mu.Lock()
	// Double-check: another goroutine may have refreshed the cache while we
	// waited for the write lock.
	if h.cached != nil && time.Since(h.cachedAt) < impactCacheTTL {
		resp := h.cached
		h.mu.Unlock()
		c.JSON(http.StatusOK, resp)
		return
	}
	resp, err := h.compute()
	if err != nil {
		h.mu.Unlock()
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}
	h.cached = resp
	h.cachedAt = time.Now()
	h.mu.Unlock()

	c.JSON(http.StatusOK, resp)
}

func (h *ImpactHandler) compute() (*ImpactResponse, error) {
	var totals ImpactTotals

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventPetFound).
		Count(&totals.PetsReunited).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventSearchStarted).
		Count(&totals.SearchesStarted).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.User{}).Count(&totals.TotalUsers).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Pet{}).Count(&totals.TotalPets).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Pet{}).
		Where("status IN ?", []string{domain.PetStatusLost, domain.PetStatusStray}).
		Count(&totals.ActiveSearches).Error; err != nil {
		return nil, err
	}

	if totals.SearchesStarted > 0 {
		totals.ReunionRate = float64(totals.PetsReunited) / float64(totals.SearchesStarted)
		// Clamp to 1.0: historical or backfilled data can hold more found
		// episodes than recorded searches, which must never render as >100%.
		if totals.ReunionRate > 1 {
			totals.ReunionRate = 1
		}
	}

	reunions, err := h.monthlySeries(h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventPetFound))
	if err != nil {
		return nil, err
	}
	newUsers, err := h.monthlySeries(h.db.Model(&domain.User{}))
	if err != nil {
		return nil, err
	}
	reports, err := h.monthlySeries(h.db.Model(&domain.Report{}))
	if err != nil {
		return nil, err
	}

	petsByType, err := h.petsByType()
	if err != nil {
		return nil, err
	}
	moderation, err := h.moderation()
	if err != nil {
		return nil, err
	}

	return &ImpactResponse{
		Totals:          totals,
		ReunionsByMonth: reunions,
		NewUsersByMonth: newUsers,
		ReportsByMonth:  reports,
		PetsByType:      petsByType,
		Moderation:      moderation,
	}, nil
}

// monthlySeries buckets a pre-filtered query by created_at month over the
// trailing impactMonthsWindow calendar months, gap-filling empty months with
// count:0 so the chart line is continuous. The caller supplies the base query
// with its Model (and any WHERE) already set; the created_at column is assumed.
func (h *ImpactHandler) monthlySeries(base *gorm.DB) ([]MonthlyCount, error) {
	type row struct {
		Month string
		Count int64
	}
	var rows []row
	err := base.
		Select("to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*) AS count").
		Group("date_trunc('month', created_at)").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	counts := make(map[string]int64, len(rows))
	for _, r := range rows {
		counts[r.Month] = r.Count
	}

	// Anchor to the first of the current month so AddDate never skips a month.
	now := time.Now().UTC()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	series := make([]MonthlyCount, 0, impactMonthsWindow)
	for i := impactMonthsWindow - 1; i >= 0; i-- {
		key := first.AddDate(0, -i, 0).Format("2006-01")
		series = append(series, MonthlyCount{Month: key, Count: counts[key]})
	}
	return series, nil
}

// petsByType returns the count of pets grouped by their type, biggest first.
// Empty/NULL types collapse into "otro" so the breakdown always sums to
// total_pets. Types are stored as free-ish text ("perro", "gato", "ave", …);
// the frontend maps known keys and shows the rest verbatim.
func (h *ImpactHandler) petsByType() ([]TypeCount, error) {
	var rows []TypeCount
	err := h.db.Model(&domain.Pet{}).
		Select("COALESCE(NULLIF(type, ''), 'otro') AS type, COUNT(*) AS count").
		Group("COALESCE(NULLIF(type, ''), 'otro')").
		Order("count DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// moderation returns everything awaiting admin attention: abuse reports grouped
// by status (pending/resolved/dismissed; unknown statuses ignored) plus the
// count of foster homes and shelters still pending approval.
func (h *ImpactHandler) moderation() (ModerationStats, error) {
	var stats ModerationStats

	type row struct {
		Status string
		Count  int64
	}
	var rows []row
	if err := h.db.Model(&domain.ReportAbuse{}).
		Select("status, COUNT(*) AS count").
		Group("status").
		Scan(&rows).Error; err != nil {
		return ModerationStats{}, err
	}
	for _, r := range rows {
		switch r.Status {
		case "pending":
			stats.AbusePending = r.Count
		case "resolved":
			stats.AbuseResolved = r.Count
		case "dismissed":
			stats.AbuseDismissed = r.Count
		}
	}

	if err := h.db.Model(&domain.FosterHome{}).
		Where("status = ?", domain.FosterHomeStatusPending).
		Count(&stats.FosterHomesPending).Error; err != nil {
		return ModerationStats{}, err
	}

	if err := h.db.Model(&domain.Shelter{}).
		Where("status = ?", domain.ShelterStatusPending).
		Count(&stats.SheltersPending).Error; err != nil {
		return ModerationStats{}, err
	}

	return stats, nil
}
