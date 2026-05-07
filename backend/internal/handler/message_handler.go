package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// MessageHandler maneja los endpoints HTTP de mensajes.
type MessageHandler struct {
	messageService service.MessageService
}

// NewMessageHandler construye el MessageHandler con sus dependencias.
func NewMessageHandler(messageService service.MessageService) *MessageHandler {
	return &MessageHandler{messageService: messageService}
}

// Send godoc
// POST /api/messages
func (h *MessageHandler) Send(c *gin.Context) {
	senderID := getUserID(c)

	var req dto.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	msg, err := h.messageService.Send(c.Request.Context(), senderID, req)
	if err != nil {
		if errors.Is(err, domain.ErrSelfMessage) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrUserBlocked) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToMessageResponse(msg))
}

// GetConversations godoc
// GET /api/messages
func (h *MessageHandler) GetConversations(c *gin.Context) {
	userID := getUserID(c)

	messages, err := h.messageService.GetConversations(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	// Siempre retornar array (nunca null)
	c.JSON(http.StatusOK, dto.ToMessageListResponse(messages))
}

// GetConversation godoc
// GET /api/messages/:userId
func (h *MessageHandler) GetConversation(c *gin.Context) {
	userID := getUserID(c)
	otherUserID := c.Param("userId")

	// Parsear limit y offset con defaults
	limit := 20
	offset := 0

	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if o := c.Query("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	messages, err := h.messageService.GetConversation(c.Request.Context(), userID, otherUserID, limit, offset)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	// Siempre retornar array (nunca null)
	c.JSON(http.StatusOK, dto.ToMessageListResponse(messages))
}

// MarkAsRead godoc
// PATCH /api/messages/:id/read
func (h *MessageHandler) MarkAsRead(c *gin.Context) {
	userID := getUserID(c)
	messageID := c.Param("id")

	err := h.messageService.MarkAsRead(c.Request.Context(), userID, messageID)
	if err != nil {
		if errors.Is(err, domain.ErrMessageNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, domain.ErrNotMessageReceiver) {
			c.JSON(http.StatusForbidden, gin.H{"error": domain.ErrForbidden.Error()})
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
