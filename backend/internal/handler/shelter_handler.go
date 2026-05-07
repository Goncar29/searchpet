package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ShelterHandler maneja los endpoints HTTP de refugios.
type ShelterHandler struct {
	shelterService service.ShelterService
}

// NewShelterHandler construye el ShelterHandler con sus dependencias.
func NewShelterHandler(shelterService service.ShelterService) *ShelterHandler {
	return &ShelterHandler{shelterService: shelterService}
}

// GetAll godoc
// GET /api/shelters
// Query param: ?city=Montevideo (opcional)
func (h *ShelterHandler) GetAll(c *gin.Context) {
	city := c.Query("city")

	// MVP: no filtramos por is_verified → pasamos nil al service
	shelters, err := h.shelterService.GetAll(c.Request.Context(), city, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	// Siempre retornar array (nunca null)
	c.JSON(http.StatusOK, dto.ToShelterListResponse(shelters))
}

// GetByID godoc
// GET /api/shelters/:id
func (h *ShelterHandler) GetByID(c *gin.Context) {
	id := c.Param("id")

	shelter, err := h.shelterService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToShelterResponse(shelter))
}
