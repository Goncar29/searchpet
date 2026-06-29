package handler

import (
	"errors"
	"log"
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
		writeError(c, http.StatusBadRequest, err)
		return
	}

	story, err := h.storyService.Create(c.Request.Context(), callerID, req)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrPetNotFoundStatus) {
			writeError(c, http.StatusUnprocessableEntity, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	viewerID := getUserUUID(c)
	ids := make([]uuid.UUID, 0, len(stories))
	for i := range stories {
		ids = append(ids, stories[i].ID)
	}
	liked, err := h.storyService.LikedStoryIDs(c.Request.Context(), viewerID, ids)
	if err != nil {
		log.Printf("[success_story_handler] List: LikedStoryIDs err viewerID=%s: %v", viewerID, err)
	}

	// Total count in a header keeps the body a plain array (public feed unchanged);
	// the admin page reads X-Total-Count for "page X of Y". The COUNT query runs only
	// when the caller opts in with ?count=true, so the public feed (homepage, mobile)
	// never pays for an extra query it doesn't read. Best-effort.
	if c.Query("count") == "true" {
		if total, err := h.storyService.Count(c.Request.Context(), featured); err == nil {
			c.Header("X-Total-Count", strconv.FormatInt(total, 10))
		}
	}

	c.JSON(http.StatusOK, dto.ToStoryListResponseWithLikes(stories, liked))
}

// GetByID godoc
// GET /api/stories/:id
func (h *SuccessStoryHandler) GetByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	story, err := h.storyService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	viewerID := getUserUUID(c)
	liked, err := h.storyService.LikedStoryIDs(c.Request.Context(), viewerID, []uuid.UUID{story.ID})
	if err != nil {
		log.Printf("[success_story_handler] GetByID: LikedStoryIDs err viewerID=%s storyID=%s: %v", viewerID, story.ID, err)
	}

	c.JSON(http.StatusOK, dto.ToStoryResponseWithLike(story, liked[story.ID]))
}

// Like godoc
// POST /api/stories/:id/like
func (h *SuccessStoryHandler) Like(c *gin.Context) {
	viewerID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	count, liked, err := h.storyService.Like(c.Request.Context(), id, viewerID)
	if err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"like_count": count, "liked": liked})
}

// Unlike godoc
// DELETE /api/stories/:id/like
func (h *SuccessStoryHandler) Unlike(c *gin.Context) {
	viewerID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	count, liked, err := h.storyService.Unlike(c.Request.Context(), id, viewerID)
	if err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"like_count": count, "liked": liked})
}

// Delete godoc
// DELETE /api/stories/:id
func (h *SuccessStoryHandler) Delete(c *gin.Context) {
	callerID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	// isAdmin is set by RequireAdmin middleware on the admin route group.
	// On the protected (non-admin) route this key is absent; the two-value
	// type assertion safely yields false in that case.
	isAdminVal, _ := c.Get("isAdmin")
	admin, _ := isAdminVal.(bool)

	if err := h.storyService.Delete(c.Request.Context(), id, callerID, admin); err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "historia eliminada"})
}

// GetByPetID godoc
// GET /api/stories/pet/:petId
func (h *SuccessStoryHandler) GetByPetID(c *gin.Context) {
	petID, err := uuid.Parse(c.Param("petId"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	story, err := h.storyService.GetByPetID(c.Request.Context(), petID)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrPetNotFoundStatus) {
			writeError(c, http.StatusUnprocessableEntity, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	if story == nil {
		writeError(c, http.StatusNotFound, domain.ErrStoryNotFound)
		return
	}

	viewerID := getUserUUID(c)
	liked, err := h.storyService.LikedStoryIDs(c.Request.Context(), viewerID, []uuid.UUID{story.ID})
	if err != nil {
		log.Printf("[success_story_handler] GetByPetID: LikedStoryIDs err viewerID=%s storyID=%s: %v", viewerID, story.ID, err)
	}

	c.JSON(http.StatusOK, dto.ToStoryResponseWithLike(story, liked[story.ID]))
}

// SetFeatured godoc
// PATCH /admin/stories/:id/featured  (admin only — gated by RequireAdmin middleware)
func (h *SuccessStoryHandler) SetFeatured(c *gin.Context) {
	adminID := getUserUUID(c)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.SetFeaturedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if err := h.storyService.SetFeatured(c.Request.Context(), id, req.Featured, adminID); err != nil {
		if errors.Is(err, domain.ErrStoryNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "historia actualizada"})
}
