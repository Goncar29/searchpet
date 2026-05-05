package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

type ReportHandler struct {
	reportService service.ReportService
}

// NewReportHandler crea una instancia del handler con sus dependencias.
func NewReportHandler(reportService service.ReportService) *ReportHandler {
	return &ReportHandler{reportService: reportService}
}

// CreateReport godoc
// POST /api/reports
func (h *ReportHandler) CreateReport(c *gin.Context) {
	reporterID := getUserID(c)

	var req service.CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	report, err := h.reportService.CreateReport(reporterID, req)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) || errors.Is(err, domain.ErrInvalidStatus) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToReportResponse(report))
}

// GetReport godoc
// GET /api/reports/:id
func (h *ReportHandler) GetReport(c *gin.Context) {
	id := c.Param("id")

	report, err := h.reportService.GetReportByID(id)
	if err != nil {
		if errors.Is(err, domain.ErrReportNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToReportResponse(report))
}

// GetReportsByPet godoc
// GET /api/reports/pet/:petId
func (h *ReportHandler) GetReportsByPet(c *gin.Context) {
	petID := c.Param("petId")

	reports, err := h.reportService.GetReportsByPet(petID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"reports": dto.ToReportListResponse(reports)})
}

// GetNearbyReports godoc
// GET /api/reports/nearby?lat=-34.9011&lng=-56.1645&radius=5000
func (h *ReportHandler) GetNearbyReports(c *gin.Context) {
	// Leemos los query params de la URL
	lat, err := strconv.ParseFloat(c.Query("lat"), 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lat inválido"})
		return
	}

	lng, err := strconv.ParseFloat(c.Query("lng"), 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lng inválido"})
		return
	}

	// Radio opcional — si no viene usamos el default del service (5000m)
	var radius float64
	if r := c.Query("radius"); r != "" {
		radius, err = strconv.ParseFloat(r, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "radius inválido"})
			return
		}
	}

	reports, err := h.reportService.GetNearbyReports(lat, lng, radius)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"reports": dto.ToReportListResponse(reports)})
}
