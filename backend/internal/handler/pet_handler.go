package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

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

	var req dto.CreatePetRequest
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

	var req dto.UpdatePetRequest
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
		if errors.Is(err, domain.ErrPetStatusLocked) {
			c.JSON(http.StatusConflict, gin.H{"error": "pet_status_locked"})
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'from' debe ser RFC3339 (ej: 2026-01-01T00:00:00Z)"})
			return
		}
		criteria.From = &t
	}
	if toStr := c.Query("to"); toStr != "" {
		t, err := time.Parse(time.RFC3339, toStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'to' debe ser RFC3339 (ej: 2026-12-31T23:59:59Z)"})
			return
		}
		criteria.To = &t
	}

	// Parseo de page (default 1)
	if pageStr := c.Query("page"); pageStr != "" {
		p, err := strconv.Atoi(pageStr)
		if err != nil || p < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'page' debe ser un entero positivo"})
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'limit' debe ser un entero positivo"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
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
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrPetAlreadyFound) || errors.Is(err, domain.ErrPetArchived) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToPetResponse(pet))
}
