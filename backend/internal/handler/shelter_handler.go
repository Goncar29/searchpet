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

	shelters, err := h.shelterService.GetAll(c.Request.Context(), city)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToShelterResponse(shelter))
}

// Create godoc
// POST /api/admin/shelters
// Requiere JWT + is_admin=true (middleware RequireAdmin aplicado en el grupo de rutas admin).
func (h *ShelterHandler) Create(c *gin.Context) {
	var req dto.CreateShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	shelter := dto.ToCreateShelterDomain(&req)

	if err := h.shelterService.Create(c.Request.Context(), shelter); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusCreated, dto.ToShelterResponse(shelter))
}

// Update godoc
// PUT /api/admin/shelters/:id
// Requiere JWT + is_admin=true (middleware RequireAdmin aplicado en el grupo de rutas admin).
func (h *ShelterHandler) Update(c *gin.Context) {
	id := c.Param("id")

	// Vía admin: carga sin filtro de estado (un admin edita también pending/rejected).
	existing, err := h.shelterService.GetByIDAnyStatus(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	var req dto.UpdateShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	dto.ToUpdateShelterDomain(existing, &req)

	if err := h.shelterService.Update(c.Request.Context(), existing); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToShelterResponse(existing))
}

// RegisterOwn godoc
// POST /api/shelters (JWT)
// Auto-registro del refugio del usuario autenticado. Nace pending.
// 201 | 400 invalid_input/binding_failed | 403 email_not_verified | 409 shelter_already_owned
func (h *ShelterHandler) RegisterOwn(c *gin.Context) {
	var req dto.RegisterShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	shelter := dto.ToRegisterShelterDomain(&req)
	if err := h.shelterService.RegisterOwn(c.Request.Context(), getUserID(c), shelter); err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailNotVerified):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrShelterAlreadyOwned):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, dto.ToMyShelterResponse(shelter))
}

// GetMine godoc
// GET /api/shelters/mine (JWT)
// Vista completa del dueño: status, rejection_reason y links staged incluidos.
func (h *ShelterHandler) GetMine(c *gin.Context) {
	shelter, err := h.shelterService.GetMine(c.Request.Context(), getUserID(c))
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyShelterResponse(shelter))
}

// UpdateMine godoc
// PUT /api/shelters/mine (JWT)
// Edición del dueño. El service decide staging vs aplicación directa según estado.
func (h *ShelterHandler) UpdateMine(c *gin.Context) {
	var req dto.UpdateMyShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	shelter, err := h.shelterService.UpdateMine(c.Request.Context(), getUserID(c), &req)
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyShelterResponse(shelter))
}
