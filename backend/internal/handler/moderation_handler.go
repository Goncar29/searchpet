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

// ModerationHandler handles admin user-moderation actions.
type ModerationHandler struct {
	moderationService service.ModerationService
}

// NewModerationHandler crea una instancia del ModerationHandler.
func NewModerationHandler(moderationService service.ModerationService) *ModerationHandler {
	return &ModerationHandler{moderationService: moderationService}
}

// BanUser godoc
// PATCH /api/admin/users/:id/ban  (admin only — gated by RequireAdmin)
func (h *ModerationHandler) BanUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.BanUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if err := h.moderationService.BanUser(c.Request.Context(), id, req.Reason); err != nil {
		switch {
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrCannotModerateAdmin):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user banned"})
}

// UnbanUser godoc
// PATCH /api/admin/users/:id/unban  (admin only — gated by RequireAdmin)
func (h *ModerationHandler) UnbanUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.moderationService.UnbanUser(c.Request.Context(), id); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user unbanned"})
}
