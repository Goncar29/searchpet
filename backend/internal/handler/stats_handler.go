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
	// Contamos mascotas únicas que han sido reportadas — un mismo animal
	// perdido y encontrado varias veces sigue siendo 1 reporte publicado.
	h.db.Model(&domain.Report{}).Distinct("pet_id").Count(&totalReports)
	h.db.Model(&domain.Pet{}).Where("status = ?", "found").Count(&foundPets)

	c.JSON(http.StatusOK, gin.H{
		"total_users":   totalUsers,
		"total_pets":    totalPets,
		"total_reports": totalReports,
		"found_pets":    foundPets,
	})
}
