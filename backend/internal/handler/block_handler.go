package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// BlockHandler maneja las operaciones de bloqueo de usuarios.
type BlockHandler struct {
	blockService service.BlockService
}

// NewBlockHandler crea una instancia del BlockHandler.
func NewBlockHandler(blockService service.BlockService) *BlockHandler {
	return &BlockHandler{blockService: blockService}
}

// Block godoc
// POST /api/users/:id/block
func (h *BlockHandler) Block(c *gin.Context) {
	callerID := getUserUUID(c)

	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id de usuario inválido"})
		return
	}

	var req dto.BlockRequest
	// Body es opcional — ignoramos error de bind si no hay body
	_ = c.ShouldBindJSON(&req)

	err = h.blockService.Block(c.Request.Context(), callerID, targetID)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no podés bloquearte a vos mismo"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "usuario bloqueado"})
}

// Unblock godoc
// DELETE /api/users/:id/block
func (h *BlockHandler) Unblock(c *gin.Context) {
	callerID := getUserUUID(c)

	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id de usuario inválido"})
		return
	}

	if err := h.blockService.Unblock(c.Request.Context(), callerID, targetID); err != nil {
		if errors.Is(err, domain.ErrBlockNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "usuario desbloqueado"})
}

// GetBlocked godoc
// GET /api/users/blocked
func (h *BlockHandler) GetBlocked(c *gin.Context) {
	callerID := getUserUUID(c)

	blocked, err := h.blockService.GetBlocked(c.Request.Context(), callerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	resp := make([]dto.BlockedUserResponse, 0, len(blocked))
	for i := range blocked {
		resp = append(resp, dto.ToBlockedUserResponse(&blocked[i]))
	}

	c.JSON(http.StatusOK, resp)
}
