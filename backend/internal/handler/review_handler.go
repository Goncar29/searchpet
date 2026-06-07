package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ReviewHandler maneja los endpoints de reseñas de usuarios.
type ReviewHandler struct {
	svc service.ReviewService
}

// NewReviewHandler crea una instancia del handler con sus dependencias.
func NewReviewHandler(svc service.ReviewService) *ReviewHandler {
	return &ReviewHandler{svc: svc}
}

// GetReviews godoc
// GET /api/users/:id/reviews — público, no requiere auth
// Parámetros de query: page (default 1), page_size (default 20, máx 100).
func (h *ReviewHandler) GetReviews(c *gin.Context) {
	revieweeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	page := 1
	if p := c.Query("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}

	pageSize := 20
	if ps := c.Query("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			if v > 100 {
				v = 100
			}
			pageSize = v
		}
	}

	offset := (page - 1) * pageSize

	result, err := h.svc.GetByReviewee(c.Request.Context(), revieweeID, pageSize, offset)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

// CreateReview godoc
// POST /api/users/:id/reviews — requiere JWT
// El usuario autenticado es el reviewer; :id es el reviewee.
func (h *ReviewHandler) CreateReview(c *gin.Context) {
	reviewerID := getUserUUID(c)

	revieweeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.CreateReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	review, err := h.svc.Create(c.Request.Context(), reviewerID, revieweeID, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSelfReview):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrAlreadyReviewed):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserBlocked):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, review)
}

// DeleteReview godoc
// DELETE /api/users/:id/reviews — requiere JWT
// El usuario autenticado es el reviewer; :id es el reviewee.
// Solo el reviewer original puede eliminar su propia reseña.
func (h *ReviewHandler) DeleteReview(c *gin.Context) {
	reviewerID := getUserUUID(c)

	revieweeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.svc.Delete(c.Request.Context(), reviewerID, revieweeID); err != nil {
		switch {
		case errors.Is(err, domain.ErrReviewNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrForbidden):
			writeError(c, http.StatusForbidden, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.Status(http.StatusNoContent)
}

// UpdateReview godoc
// PUT /api/users/:id/reviews — requiere JWT
// Solo el reviewer original puede actualizar su propia reseña sobre el usuario :id.
func (h *ReviewHandler) UpdateReview(c *gin.Context) {
	reviewerID := getUserUUID(c)

	revieweeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.UpdateReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	review, err := h.svc.Update(c.Request.Context(), reviewerID, revieweeID, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrReviewNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrForbidden):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, review)
}
