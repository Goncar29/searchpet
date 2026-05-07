package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ShareHandler maneja los endpoints HTTP de links compartibles.
type ShareHandler struct {
	shareLinkService service.ShareLinkService
	appURL           string
}

// NewShareHandler construye el ShareHandler con sus dependencias.
func NewShareHandler(shareLinkService service.ShareLinkService, appURL string) *ShareHandler {
	return &ShareHandler{
		shareLinkService: shareLinkService,
		appURL:           appURL,
	}
}

// GenerateShareLink godoc
// POST /api/share/:petId
func (h *ShareHandler) GenerateShareLink(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("petId")

	link, err := h.shareLinkService.Generate(c.Request.Context(), petID, ownerID)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrNotPetOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	expiresAt := *link.ExpiresAt
	c.JSON(http.StatusCreated, dto.ToGenerateShareLinkResponse(link.ShareToken, h.appURL, expiresAt))
}

// GetByToken godoc
// GET /api/share/:token
func (h *ShareHandler) GetByToken(c *gin.Context) {
	token := c.Param("token")

	link, err := h.shareLinkService.GetByToken(c.Request.Context(), token)
	if err != nil {
		if errors.Is(err, domain.ErrShareLinkNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrShareLinkExpired) {
			c.JSON(http.StatusGone, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToShareLinkPublicResponse(link))
}

// TrackContact godoc
// POST /api/share/:token/contact
func (h *ShareHandler) TrackContact(c *gin.Context) {
	token := c.Param("token")

	err := h.shareLinkService.TrackContact(c.Request.Context(), token)
	if err != nil {
		if errors.Is(err, domain.ErrShareLinkNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
