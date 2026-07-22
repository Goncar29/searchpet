package handler

import (
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// monthlyRecordCap bounds each record list so a busy month cannot return an
// unbounded payload. When a list is capped, Truncated is set so the UI can hint
// "there are more".
const monthlyRecordCap = 50

// monthlyCacheMax bounds the per-month cache. month is validated to YYYY-MM, so
// an unbounded key set is possible in principle; clearing at the cap keeps
// memory bounded. In practice only ~12 months are ever queried.
const monthlyCacheMax = 24

// monthRe validates the month query param.
var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

// MonthlyTotals are the event-sourced counts for a single calendar month.
type MonthlyTotals struct {
	Reunions int64 `json:"reunions"`
	NewUsers int64 `json:"new_users"`
	Reports  int64 `json:"reports"`
}

// MonthlyReunion is one pet reunited in the month (a pet_found event joined to
// its pet). ReunitedAt is the event time.
type MonthlyReunion struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Type       string    `json:"type"`
	ReunitedAt time.Time `json:"reunited_at"`
}

// MonthlyReport is one report created in the month, with its pet's name.
type MonthlyReport struct {
	ID        uuid.UUID `json:"id"`
	PetName   string    `json:"pet_name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type MonthlyResponse struct {
	Month        string           `json:"month"`
	Totals       MonthlyTotals    `json:"totals"`
	ReunitedPets []MonthlyReunion `json:"reunited_pets"`
	Reports      []MonthlyReport  `json:"reports"`
	Truncated    bool             `json:"truncated"`
}

type monthlyCacheEntry struct {
	payload    *MonthlyResponse
	computedAt time.Time
}

// MonthlyImpactHandler serves the admin-only monthly drill-down at
// GET /api/stats/impact/monthly. The route is mounted behind Auth+RequireAdmin.
type MonthlyImpactHandler struct {
	db    *gorm.DB
	mu    sync.Mutex
	cache map[string]monthlyCacheEntry
}

func NewMonthlyImpactHandler(db *gorm.DB) *MonthlyImpactHandler {
	return &MonthlyImpactHandler{db: db, cache: make(map[string]monthlyCacheEntry)}
}

// GetMonthly godoc
// GET /api/stats/impact/monthly?month=YYYY-MM
func (h *MonthlyImpactHandler) GetMonthly(c *gin.Context) {
	month := c.Query("month")
	if month == "" {
		month = time.Now().UTC().Format("2006-01")
	}
	if !monthRe.MatchString(month) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidMonthParam)
		return
	}
	start, err := time.Parse("2006-01", month)
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidMonthParam)
		return
	}
	start = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)

	h.mu.Lock()
	if e, ok := h.cache[month]; ok && time.Since(e.computedAt) < impactCacheTTL {
		payload := e.payload
		h.mu.Unlock()
		c.JSON(http.StatusOK, payload)
		return
	}
	h.mu.Unlock()

	payload, err := h.compute(month, start, end)
	if err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	h.mu.Lock()
	if len(h.cache) >= monthlyCacheMax {
		h.cache = make(map[string]monthlyCacheEntry)
	}
	h.cache[month] = monthlyCacheEntry{payload: payload, computedAt: time.Now()}
	h.mu.Unlock()

	c.JSON(http.StatusOK, payload)
}

func (h *MonthlyImpactHandler) compute(month string, start, end time.Time) (*MonthlyResponse, error) {
	var totals MonthlyTotals

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ? AND created_at >= ? AND created_at < ?", domain.StatEventPetFound, start, end).
		Count(&totals.Reunions).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.User{}).
		Where("created_at >= ? AND created_at < ?", start, end).
		Count(&totals.NewUsers).Error; err != nil {
		return nil, err
	}
	if err := h.db.Model(&domain.Report{}).
		Where("created_at >= ? AND created_at < ?", start, end).
		Count(&totals.Reports).Error; err != nil {
		return nil, err
	}

	// Reunited pets: pet_found events in the month joined to their pet. Fetch one
	// past the cap to detect truncation. The JOIN drops events whose pet was
	// deleted, so this list can be shorter than totals.Reunions — expected.
	reunited := make([]MonthlyReunion, 0, monthlyRecordCap)
	if err := h.db.Table("platform_events AS pe").
		Select("p.id AS id, p.name AS name, p.type AS type, pe.created_at AS reunited_at").
		Joins("JOIN pets p ON p.id = pe.pet_id").
		Where("pe.event_type = ? AND pe.created_at >= ? AND pe.created_at < ?", domain.StatEventPetFound, start, end).
		Order("pe.created_at DESC").
		Limit(monthlyRecordCap + 1).
		Scan(&reunited).Error; err != nil {
		return nil, err
	}

	reports := make([]MonthlyReport, 0, monthlyRecordCap)
	if err := h.db.Table("reports AS r").
		Select("r.id AS id, p.name AS pet_name, r.status AS status, r.created_at AS created_at").
		Joins("JOIN pets p ON p.id = r.pet_id").
		Where("r.created_at >= ? AND r.created_at < ?", start, end).
		Order("r.created_at DESC").
		Limit(monthlyRecordCap + 1).
		Scan(&reports).Error; err != nil {
		return nil, err
	}

	truncated := false
	if len(reunited) > monthlyRecordCap {
		reunited = reunited[:monthlyRecordCap]
		truncated = true
	}
	if len(reports) > monthlyRecordCap {
		reports = reports[:monthlyRecordCap]
		truncated = true
	}

	return &MonthlyResponse{
		Month:        month,
		Totals:       totals,
		ReunitedPets: reunited,
		Reports:      reports,
		Truncated:    truncated,
	}, nil
}
