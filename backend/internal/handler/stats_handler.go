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
	var totalUsers, totalPets, totalReports, foundPets int64

	if err := h.db.Model(&domain.User{}).Count(&totalUsers).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "service unavailable"})
		return
	}

	if err := h.db.Model(&domain.Pet{}).Count(&totalPets).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "service unavailable"})
		return
	}

	// Contamos mascotas únicas que han sido reportadas — un mismo animal
	// perdido y encontrado varias veces sigue siendo 1 reporte publicado.
	if err := h.db.Model(&domain.Report{}).Distinct("pet_id").Count(&totalReports).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "service unavailable"})
		return
	}

	if err := h.db.Model(&domain.Pet{}).Where("status = ?", "found").Count(&foundPets).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "service unavailable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"total_users":   totalUsers,
		"total_pets":    totalPets,
		"total_reports": totalReports,
		"found_pets":    foundPets,
	})
}
