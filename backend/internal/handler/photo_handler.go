package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

const (
	maxUploadSize = 5 * 1024 * 1024 // 5 MB
)

// allowedMIMETypes define los tipos MIME permitidos para fotos de mascotas.
var allowedMIMETypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// PhotoHandler maneja los endpoints de fotos de mascotas.
type PhotoHandler struct {
	photoService service.PhotoService
}

// NewPhotoHandler crea el handler con sus dependencias.
func NewPhotoHandler(photoService service.PhotoService) *PhotoHandler {
	return &PhotoHandler{photoService: photoService}
}

// Upload godoc
// POST /api/pets/:petId/photos
// Acepta multipart/form-data con campo "photo".
// Requiere autenticación JWT.
func (h *PhotoHandler) Upload(c *gin.Context) {
	petIDStr := c.Param("id")
	if petIDStr == "" {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	// Limitar el tamaño del body antes de parsear multipart
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize+1024)

	// Parsear multipart — si el body supera el límite, ParseMultipartForm devuelve error
	if err := c.Request.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}

	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrPhotoFieldRequired)
		return
	}
	defer file.Close()

	// Validar tamaño explícito (por si ParseMultipartForm no lo cortó a tiempo)
	if header.Size > maxUploadSize {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}

	// Detectar MIME real leyendo los primeros 512 bytes (http.DetectContentType)
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}
	detectedMIME := http.DetectContentType(buf[:n])

	// Normalizar: DetectContentType puede devolver "image/jpeg; charset=..." en algunos casos
	mimeBase := strings.Split(detectedMIME, ";")[0]

	if !allowedMIMETypes[mimeBase] {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidFileType)
		return
	}

	// Volver al inicio del archivo para que el service pueda leerlo completo
	if _, err := file.Seek(0, 0); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	uploaderID := getUserID(c)

	photo, err := h.photoService.UploadPhoto(c.Request.Context(), petIDStr, uploaderID, file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrPetNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrNotPetOwner):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrPhotoLimitReached):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrInvalidFileType):
			writeError(c, http.StatusBadRequest, err)
		case errors.Is(err, domain.ErrFileTooLarge):
			writeError(c, http.StatusBadRequest, err)
		case errors.Is(err, domain.ErrStorageFailed):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, dto.ToPhotoResponse(photo))
}

// Delete godoc
// DELETE /api/pets/:id/photos/:photoId
// Elimina una foto específica de una mascota. Solo el dueño puede eliminarla.
// Requiere autenticación JWT.
func (h *PhotoHandler) Delete(c *gin.Context) {
	petID := c.Param("id")
	photoID := c.Param("photoId")
	uploaderID := getUserID(c)

	if err := h.photoService.DeletePhoto(c.Request.Context(), petID, photoID, uploaderID); err != nil {
		switch {
		case errors.Is(err, domain.ErrPetNotFound), errors.Is(err, domain.ErrPhotoNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrNotPetOwner):
			writeError(c, http.StatusForbidden, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// List godoc
// GET /api/pets/:petId/photos
// Retorna todas las fotos de una mascota. Endpoint público.
func (h *PhotoHandler) List(c *gin.Context) {
	petIDStr := c.Param("id")

	photos, err := h.photoService.GetPhotosByPet(petIDStr)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPhotoListResponse(photos))
}
