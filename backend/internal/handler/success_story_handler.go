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

// SuccessStoryHandler maneja las operaciones de historias de éxito.
type SuccessStoryHandler struct {
	storyService service.SuccessStoryService
}

// NewSuccessStoryHandler crea una instancia del SuccessStoryHandler.
func NewSuccessStoryHandler(storyService service.SuccessStoryService) *SuccessStoryHandler {
	return &SuccessStoryHandler{storyService: storyService}
}

// Create godoc
// POST /api/stories
func (h *SuccessStoryHandler) Create(c *gin.Context) {
	callerID := getUserUUID(c)

	var req dto.CreateStoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	story, err := h.storyService.Create(c.Request.Context(), callerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToStoryResponse(story))
}

// List godoc
// GET /api/stories?featured=true&limit=20&offset=0
func (h *SuccessStoryHandler) List(c *gin.Context) {
	var featured *bool
	if f := c.Query("featured"); f != "" {
		b := f == "true"
		featured = &b
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

	stories, err := h.storyService.List(c.Request.Context(), featured, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToStoryListResponse(stories))
}

// GetByID godoc
// GET /api/stories/:id
func (h *SuccessStoryHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	story, err := h.storyService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToStoryResponse(story))
}

// Like godoc
// POST /api/stories/:id/like
func (h *SuccessStoryHandler) Like(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	if err := h.storyService.Like(c.Request.Context(), id); err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "like registrado"})
}

// Delete godoc
// DELETE /api/stories/:id
func (h *SuccessStoryHandler) Delete(c *gin.Context) {
	callerID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	// isAdmin se determina desde el contexto (seteado por RequireAdmin si aplica).
	// Acá no hay admin middleware — cualquier usuario puede intentar borrar su propia historia.
	// El service verifica ownership.
	isAdmin, _ := c.Get("isAdmin")
	admin, _ := isAdmin.(bool)

	if err := h.storyService.Delete(c.Request.Context(), id, callerID, admin); err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "historia eliminada"})
}

// SetFeatured godoc
// PATCH /admin/stories/:id/featured  (admin only — gated by RequireAdmin middleware)
func (h *SuccessStoryHandler) SetFeatured(c *gin.Context) {
	adminID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}

	var req dto.SetFeaturedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.storyService.SetFeatured(c.Request.Context(), id, req.Featured, adminID); err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "historia actualizada"})
}
