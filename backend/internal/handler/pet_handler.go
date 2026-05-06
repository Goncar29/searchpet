package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

type PetHandler struct {
	petService service.PetService
}

// NewPetHandler crea una instancia del handler con sus dependencias.
func NewPetHandler(petService service.PetService) *PetHandler {
	return &PetHandler{petService: petService}
}

// CreatePet godoc
// POST /api/pets
func (h *PetHandler) CreatePet(c *gin.Context) {
	// Obtenemos el userID del contexto — lo puso el middleware de auth
	ownerID := getUserID(c)

	var req service.CreatePetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pet, err := h.petService.CreatePet(ownerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
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
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToPetListResponse(pets))
}

// UpdatePet godoc
// PUT /api/pets/:id
func (h *PetHandler) UpdatePet(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("id")

	var req service.UpdatePetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pet, err := h.petService.UpdatePet(ownerID, petID, req)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
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

	c.JSON(http.StatusOK, gin.H{"message": "mascota eliminada"})
}
