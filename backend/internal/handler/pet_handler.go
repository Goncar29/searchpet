package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

type PetHandler struct {
	petService       service.PetService
	embeddingService *service.EmbeddingService
}

// NewPetHandler crea una instancia del handler con sus dependencias.
func NewPetHandler(petService service.PetService, embeddingService *service.EmbeddingService) *PetHandler {
	return &PetHandler{
		petService:       petService,
		embeddingService: embeddingService,
	}
}

// CreatePet godoc
// POST /api/pets
func (h *PetHandler) CreatePet(c *gin.Context) {
	// Obtenemos el userID del contexto — lo puso el middleware de auth
	ownerID := getUserID(c)

	var req dto.CreatePetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	pet, err := h.petService.CreatePet(ownerID, req)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusCreated, dto.ToPetResponse(pet))
}

// GetPet godoc
// GET /api/pets/:id
func (h *PetHandler) GetPet(c *gin.Context) {
	id := c.Param("id")

	pet, err := h.petService.GetPetByID(id)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetResponse(pet))
}

// GetMyPets godoc
// GET /api/pets/mine
func (h *PetHandler) GetMyPets(c *gin.Context) {
	ownerID := getUserID(c)

	pets, err := h.petService.GetMyPets(ownerID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetListResponse(pets))
}

// UpdatePet godoc
// PUT /api/pets/:id
func (h *PetHandler) UpdatePet(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("id")

	var req dto.UpdatePetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	pet, err := h.petService.UpdatePet(ownerID, petID, req)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		if errors.Is(err, domain.ErrPetStatusLocked) {
			writeError(c, http.StatusConflict, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetResponse(pet))
}

// DeletePet godoc
// DELETE /api/pets/:id
func (h *PetHandler) DeletePet(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("id")

	err := h.petService.DeletePet(ownerID, petID)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
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

	c.Status(http.StatusNoContent)
}

// SearchPets godoc
// GET /api/pets/search
// Parámetros opcionales: type, breed, color, status, from (RFC3339), to (RFC3339), page, limit
// Ruta pública — no requiere autenticación.
func (h *PetHandler) SearchPets(c *gin.Context) {
	criteria := domain.PetSearchCriteria{}

	criteria.Type = c.Query("type")
	criteria.Breed = c.Query("breed")
	criteria.Color = c.Query("color")
	criteria.Status = c.Query("status")

	// Parseo de from/to como RFC3339
	if fromStr := c.Query("from"); fromStr != "" {
		t, err := time.Parse(time.RFC3339, fromStr)
		if err != nil {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidDateParam)
			return
		}
		criteria.From = &t
	}
	if toStr := c.Query("to"); toStr != "" {
		t, err := time.Parse(time.RFC3339, toStr)
		if err != nil {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidDateParam)
			return
		}
		criteria.To = &t
	}

	// Parseo de page (default 1)
	if pageStr := c.Query("page"); pageStr != "" {
		p, err := strconv.Atoi(pageStr)
		if err != nil || p < 1 {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidPageParam)
			return
		}
		criteria.Page = p
	} else {
		criteria.Page = 1
	}

	// Parseo de limit (default 20, max 100)
	if limitStr := c.Query("limit"); limitStr != "" {
		l, err := strconv.Atoi(limitStr)
		if err != nil || l < 1 {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidLimitParam)
			return
		}
		if l > 100 {
			l = 100
		}
		criteria.Limit = l
	} else {
		criteria.Limit = 20
	}

	result, err := h.petService.SearchPets(criteria)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, result)
}

// MarkAsFound godoc
// PATCH /api/pets/:id/found
// Marca una mascota como encontrada. Solo el dueño puede llamarlo.
// Idempotente si el status ya es "found". 409 si está archivada.
func (h *PetHandler) MarkAsFound(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("id")

	pet, err := h.petService.MarkAsFound(ownerID, petID)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		if errors.Is(err, domain.ErrPetAlreadyFound) || errors.Is(err, domain.ErrPetArchived) {
			writeError(c, http.StatusConflict, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetResponse(pet))
}

// SearchByImage godoc
// POST /api/pets/search/image
// Recibe una foto por multipart (campo "image"), genera un embedding CLIP y retorna
// las mascotas perdidas más similares. La foto NUNCA se persiste en Cloudinary ni en BD.
func (h *PetHandler) SearchByImage(c *gin.Context) {
	// Limitar tamaño del form a 10 MB
	if err := c.Request.ParseMultipartForm(10 << 20); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidMultipart)
		return
	}

	file, _, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrImageFieldRequired)
		return
	}
	defer file.Close()

	imageBytes, err := io.ReadAll(file)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	// Generar embedding y buscar similares — si HF falla retornamos 503
	results, err := h.embeddingService.SearchSimilar(c.Request.Context(), imageBytes, 10)
	if err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrImageSearchUnavailable)
		return
	}

	items := make([]dto.ImageSearchResultDTO, 0, len(results))
	for _, r := range results {
		items = append(items, dto.ImageSearchResultDTO{
			PetID:      r.PetID.String(),
			Name:       r.PetName,
			Type:       r.PetType,
			PhotoURL:   r.PrimaryURL,
			Similarity: r.Similarity,
			OwnerID:    r.OwnerID.String(),
		})
	}

	c.JSON(http.StatusOK, dto.ImageSearchResponse{Results: items})
}
