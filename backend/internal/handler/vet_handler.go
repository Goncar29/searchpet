package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// VetHandler maneja los endpoints HTTP de veterinarias.
type VetHandler struct {
	vetService service.VetService
}

// NewVetHandler construye el VetHandler con su servicio.
func NewVetHandler(vetService service.VetService) *VetHandler {
	return &VetHandler{vetService: vetService}
}

// GetNearby godoc
// GET /api/vets/nearby?lat={lat}&lng={lng}&radius={meters}   (público, sin auth)
func (h *VetHandler) GetNearby(c *gin.Context) {
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
	if errLat != nil || errLng != nil || !validCoordinates(lat, lng) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	radius := 0
	if rs := c.Query("radius"); rs != "" {
		if r, err := strconv.Atoi(rs); err == nil {
			radius = r
		}
	}

	vets, err := h.vetService.FindNearby(c.Request.Context(), lat, lng, radius)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToVetListResponse(vets))
}
