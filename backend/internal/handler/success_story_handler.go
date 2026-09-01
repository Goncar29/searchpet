package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

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

// UploadPhoto godoc
// POST /api/stories/photos
// Acepta multipart/form-data con los campos "photo" y "pet_id".
// Requiere autenticación JWT.
//
// Devuelve `{"url": "..."}` y NO persiste nada: la URL vuelve al formulario y se
// manda dentro de CreateStoryRequest.photo_after. El `pet_id` es obligatorio
// porque el service repite con él la autorización de Create — ver el comentario
// de `successStoryService.UploadPhoto` para por qué ese gate no es opcional.
//
// La validación de tamaño y MIME es la MISMA que la de `PhotoHandler.Upload`,
// reusando `maxUploadSize` y `allowedMIMETypes` de ese archivo: dos endpoints
// que aceptan imágenes del público no pueden diferir en qué consideran una
// imagen aceptable. El MIME se detecta leyendo los bytes, nunca del header que
// manda el cliente.
func (h *SuccessStoryHandler) UploadPhoto(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize+1024)
	if err := c.Request.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}

	petID := c.Request.FormValue("pet_id")
	if petID == "" {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrPhotoFieldRequired)
		return
	}
	defer file.Close()

	if header.Size > maxUploadSize {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}

	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}
	if !allowedMIMETypes[strings.Split(http.DetectContentType(buf[:n]), ";")[0]] {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidFileType)
		return
	}
	if _, err := file.Seek(0, 0); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	userID, err := uuid.Parse(getUserID(c))
	if err != nil {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	url, err := h.storyService.UploadPhoto(c.Request.Context(), userID, petID, file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrPetNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrForbidden):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrPetNotFoundStatus):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrStoryAlreadyExists):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrStorageFailed):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"url": url})
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
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	story, err := h.storyService.Create(c.Request.Context(), callerID, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrPetNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrPetNotFoundStatus):
			writeError(c, http.StatusUnprocessableEntity, err)
		// `ErrForbidden` NO estaba mapeado: el service lo devuelve desde su
		// chequeo de `canManagePet`, pero acá caía en el `default` y salía como
		// 500 "ocurrió un error inesperado". Quien intentaba escribir la
		// historia de una mascota ajena leía un error de servidor en vez de
		// enterarse de que no le corresponde — y el código `internal_error` le
		// dice al frontend que reintente algo que nunca va a funcionar.
		case errors.Is(err, domain.ErrForbidden):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrStoryAlreadyExists):
			writeError(c, http.StatusConflict, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
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
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
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
