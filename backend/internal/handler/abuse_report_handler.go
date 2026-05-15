package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// AbuseReportHandler maneja las operaciones de denuncias de fraude/abuso.
type AbuseReportHandler struct {
	abuseService service.AbuseReportService
}

// NewAbuseReportHandler crea una instancia del AbuseReportHandler.
func NewAbuseReportHandler(abuseService service.AbuseReportService) *AbuseReportHandler {
	return &AbuseReportHandler{abuseService: abuseService}
}

// Submit godoc
// POST /api/abuse-reports  (protected)
func (h *AbuseReportHandler) Submit(c *gin.Context) {
	reporterID := getUserUUID(c)

	var req dto.CreateAbuseReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	report, err := h.abuseService.Submit(c.Request.Context(), reporterID, req)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "se requiere target_user_id o target_report_id"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToAbuseReportResponse(report))
}

// List godoc
// GET /api/abuse-reports?resolved=true&limit=20&offset=0  (admin only)
func (h *AbuseReportHandler) List(c *gin.Context) {
	var resolved *bool
	if r := c.Query("resolved"); r != "" {
		b := r == "true"
		resolved = &b
	}

	limit := 20
	offset := 0
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	reports, err := h.abuseService.List(c.Request.Context(), resolved, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToAbuseReportListResponse(reports))
}

// GetByID godoc
// GET /api/abuse-reports/:id  (admin only)
func (h *AbuseReportHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	report, err := h.abuseService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrAbuseReportNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToAbuseReportResponse(report))
}

// Resolve godoc
// PATCH /admin/abuse-reports/:id/resolve  (admin only — gated by RequireAdmin)
func (h *AbuseReportHandler) Resolve(c *gin.Context) {
	adminID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	var req dto.ResolveAbuseReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.abuseService.Resolve(c.Request.Context(), id, adminID, req.Status); err != nil {
		if errors.Is(err, domain.ErrAbuseReportNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status debe ser 'resolved' o 'dismissed'"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "denuncia resuelta"})
}
