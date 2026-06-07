package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// LocationAlertHandler maneja los endpoints CRUD de alertas de ubicación.
type LocationAlertHandler struct {
	alertService service.LocationAlertService
}

// NewLocationAlertHandler crea el handler con sus dependencias.
func NewLocationAlertHandler(alertService service.LocationAlertService) *LocationAlertHandler {
	return &LocationAlertHandler{alertService: alertService}
}

// CreateAlert godoc
// POST /api/alerts
func (h *LocationAlertHandler) CreateAlert(c *gin.Context) {
	userID := getUserUUID(c)

	var req dto.CreateLocationAlertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	resp, err := h.alertService.CreateAlert(c.Request.Context(), userID, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAlertLimitExceeded):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusUnprocessableEntity, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, resp)
}

// GetAlerts godoc
// GET /api/alerts
func (h *LocationAlertHandler) GetAlerts(c *gin.Context) {
	userID := getUserUUID(c)

	alerts, err := h.alertService.GetAlerts(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": alerts})
}

// GetAlert godoc
// GET /api/alerts/:id
func (h *LocationAlertHandler) GetAlert(c *gin.Context) {
	userID := getUserUUID(c)

	alertID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	resp, err := h.alertService.GetAlert(c.Request.Context(), userID, alertID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAlertNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrNotAlertOwner):
			writeError(c, http.StatusForbidden, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, resp)
}

// UpdateAlert godoc
// PUT /api/alerts/:id
func (h *LocationAlertHandler) UpdateAlert(c *gin.Context) {
	userID := getUserUUID(c)

	alertID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.UpdateLocationAlertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	resp, err := h.alertService.UpdateAlert(c.Request.Context(), userID, alertID, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAlertNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrNotAlertOwner):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusUnprocessableEntity, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, resp)
}

// DeleteAlert godoc
// DELETE /api/alerts/:id
func (h *LocationAlertHandler) DeleteAlert(c *gin.Context) {
	userID := getUserUUID(c)

	alertID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.alertService.DeleteAlert(c.Request.Context(), userID, alertID); err != nil {
		switch {
		case errors.Is(err, domain.ErrAlertNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrNotAlertOwner):
			writeError(c, http.StatusForbidden, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.Status(http.StatusNoContent)
}
