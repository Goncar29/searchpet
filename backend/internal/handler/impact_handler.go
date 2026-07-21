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
// (Render free tier) from repeated public hits.
const impactCacheTTL = 5 * time.Minute

// impactMonthsWindow is how many trailing calendar months reunions_by_month spans.
const impactMonthsWindow = 12

// ImpactHandler serves the public impact dashboard at GET /api/stats/impact.
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

// MonthlyCount is one point on the reunions-per-month series. Month is "YYYY-MM".
type MonthlyCount struct {
	Month string `json:"month"`
	Count int64  `json:"count"`
}

type ImpactResponse struct {
	Totals          ImpactTotals   `json:"totals"`
	ReunionsByMonth []MonthlyCount `json:"reunions_by_month"`
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
	}

	series, err := h.reunionsByMonth()
	if err != nil {
		return nil, err
	}

	return &ImpactResponse{Totals: totals, ReunionsByMonth: series}, nil
}

// reunionsByMonth returns pet_found counts per calendar month for the trailing
// impactMonthsWindow months, filling months with no events with count:0 so the
// chart line is continuous.
func (h *ImpactHandler) reunionsByMonth() ([]MonthlyCount, error) {
	type row struct {
		Month string
		Count int64
	}
	var rows []row
	err := h.db.Model(&domain.PlatformEvent{}).
		Select("to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*) AS count").
		Where("event_type = ?", domain.StatEventPetFound).
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
