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
	petIDStr := c.Param("petId")
	if petIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "petId requerido"})
		return
	}

	// Limitar el tamaño del body antes de parsear multipart
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize+1024)

	// Parsear multipart — si el body supera el límite, ParseMultipartForm devuelve error
	if err := c.Request.ParseMultipartForm(maxUploadSize); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": domain.ErrFileTooLarge.Error()})
		return
	}

	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campo 'photo' requerido"})
		return
	}
	defer file.Close()

	// Validar tamaño explícito (por si ParseMultipartForm no lo cortó a tiempo)
	if header.Size > maxUploadSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": domain.ErrFileTooLarge.Error()})
		return
	}

	// Detectar MIME real leyendo los primeros 512 bytes (http.DetectContentType)
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no se pudo leer el archivo"})
		return
	}
	detectedMIME := http.DetectContentType(buf[:n])

	// Normalizar: DetectContentType puede devolver "image/jpeg; charset=..." en algunos casos
	mimeBase := strings.Split(detectedMIME, ";")[0]

	if !allowedMIMETypes[mimeBase] {
		c.JSON(http.StatusBadRequest, gin.H{"error": domain.ErrInvalidFileType.Error()})
		return
	}

	// Volver al inicio del archivo para que el service pueda leerlo completo
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	uploaderID := getUserID(c)

	photo, err := h.photoService.UploadPhoto(c.Request.Context(), petIDStr, uploaderID, file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrPetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, domain.ErrNotPetOwner):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case errors.Is(err, domain.ErrInvalidFileType):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, domain.ErrFileTooLarge):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, domain.ErrStorageFailed):
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, dto.ToPhotoResponse(photo))
}

// List godoc
// GET /api/pets/:petId/photos
// Retorna todas las fotos de una mascota. Endpoint público.
func (h *PhotoHandler) List(c *gin.Context) {
	petIDStr := c.Param("petId")

	photos, err := h.photoService.GetPhotosByPet(petIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToPhotoListResponse(photos))
}
