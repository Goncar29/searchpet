package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

const (
	defaultSearchRadius = 5000
	minSearchRadius     = 1000
	maxSearchRadius     = 50000
)

type ReportHandler struct {
	reportService service.ReportService
	userRepo      repository.UserRepository
}

// NewReportHandler crea una instancia del handler con sus dependencias.
// userRepo es opcional (nil = sin fallback a preferencia de usuario).
func NewReportHandler(reportService service.ReportService, userRepo repository.UserRepository) *ReportHandler {
	return &ReportHandler{reportService: reportService, userRepo: userRepo}
}

// CreateReport godoc
// POST /api/reports
func (h *ReportHandler) CreateReport(c *gin.Context) {
	reporterID := getUserID(c)

	var req service.CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	report, err := h.reportService.CreateReport(reporterID, req)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) || errors.Is(err, domain.ErrInvalidStatus) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToReportListResponse(reports))
}

// VerifyReport godoc
// PATCH /admin/reports/:id/verify  (admin only — gated by RequireAdmin middleware)
func (h *ReportHandler) VerifyReport(c *gin.Context) {
	adminID := getUserUUID(c)

	reportID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.reportService.VerifyReport(c.Request.Context(), reportID, adminID); err != nil {
		if errors.Is(err, domain.ErrReportNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	// Recargar para devolver el DTO actualizado
	report, err := h.reportService.GetReportByID(reportID.String())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "reporte verificado"})
		return
	}

	c.JSON(http.StatusOK, dto.ToReportResponse(report))
}

// DeleteReport godoc
// DELETE /api/admin/reports/:id  (admin only — gated by RequireAdmin)
// Deletes the reported location report as a moderation action.
func (h *ReportHandler) DeleteReport(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.reportService.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, domain.ErrReportNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "report deleted"})
}

// GetNearbyReports godoc
// GET /api/reports/nearby?lat=-34.9011&lng=-56.1645&radius=5000
//
// Precedencia del radio:
//  1. Parámetro explícito `radius` (si está presente y válido)
//  2. Preferencia del usuario autenticado (search_radius_meters)
//  3. Default del sistema: 5000 m
func (h *ReportHandler) GetNearbyReports(c *gin.Context) {
	lat, err := strconv.ParseFloat(c.Query("lat"), 64)
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	lng, err := strconv.ParseFloat(c.Query("lng"), 64)
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	// Resolver radio con precedencia: param explícito > pref de usuario > default
	radiusMeters := defaultSearchRadius

	if r := c.Query("radius"); r != "" {
		// Parámetro explícito presente — validar rango
		explicit, parseErr := strconv.Atoi(r)
		if parseErr != nil {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
			return
		}
		if explicit < minSearchRadius || explicit > maxSearchRadius {
			writeError(c, http.StatusUnprocessableEntity, domain.ErrInvalidSearchRadius)
			return
		}
		radiusMeters = explicit
	} else if userIDVal, ok := c.Get("userID"); ok && h.userRepo != nil {
		// Sin parámetro explícito pero usuario autenticado — usar su preferencia
		if userID, ok := userIDVal.(uuid.UUID); ok {
			if user, repoErr := h.userRepo.GetByID(c.Request.Context(), userID); repoErr == nil {
				pref := user.SearchRadiusMeters
				if pref >= minSearchRadius && pref <= maxSearchRadius {
					radiusMeters = pref
				}
			}
		}
	}

	reports, err := h.reportService.GetNearbyReports(lat, lng, float64(radiusMeters))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.NearbyReportsResponse{
		Data:       dto.ToReportListResponse(reports),
		RadiusUsed: radiusMeters,
	})
}
