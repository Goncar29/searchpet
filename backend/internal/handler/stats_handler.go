package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type StatsHandler struct {
	db *gorm.DB
}

func NewStatsHandler(db *gorm.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

// GetStats godoc
// GET /api/stats
func (h *StatsHandler) GetStats(c *gin.Context) {
	var totalUsers, totalPets, petsReunited, searchesStarted int64

	// Snapshot numbers — honest "size right now". They may dip when an account
	// or pet is deleted, which is correct: a deleted member is not a member.
	if err := h.db.Model(&domain.User{}).Count(&totalUsers).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}
	if err := h.db.Model(&domain.Pet{}).Count(&totalPets).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	// Lifetime impact numbers come from the append-only platform_events ledger,
	// NOT from COUNT() over pets/reports — those decrease on status changes and
	// hard deletes. Both counters count EPISODES, not distinct pets: pets_reunited
	// counts every reunification (a pet lost & found again adds +1 each time);
	// searches_started counts every lost/stray search opened.
	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventPetFound).
		Count(&petsReunited).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventSearchStarted).
		Count(&searchesStarted).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"total_users":      totalUsers,
		"total_pets":       totalPets,
		"pets_reunited":    petsReunited,
		"searches_started": searchesStarted,
	})
}
