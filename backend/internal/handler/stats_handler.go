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

	h.db.Model(&domain.User{}).Count(&totalUsers)
	h.db.Model(&domain.Pet{}).Count(&totalPets)
	h.db.Model(&domain.Report{}).Count(&totalReports)
	h.db.Model(&domain.Pet{}).Where("status = ?", "found").Count(&foundPets)

	c.JSON(http.StatusOK, gin.H{
		"total_users":   totalUsers,
		"total_pets":    totalPets,
		"total_reports": totalReports,
		"found_pets":    foundPets,
	})
}
