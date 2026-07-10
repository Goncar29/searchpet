package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
	"lost-pets/pkg/storage"
)

// MessageHandler maneja los endpoints HTTP de mensajes.
type MessageHandler struct {
	messageService service.MessageService
	cloudinary     *storage.CloudinaryClient
}

// NewMessageHandler construye el MessageHandler con sus dependencias.
// cloudinary es opcional — si es nil, el endpoint de foto-url responde 503.
func NewMessageHandler(messageService service.MessageService, cloudinary *storage.CloudinaryClient) *MessageHandler {
	return &MessageHandler{
		messageService: messageService,
		cloudinary:     cloudinary,
	}
}

// Send godoc
// POST /api/messages
func (h *MessageHandler) Send(c *gin.Context) {
	senderID := getUserID(c)

	var req dto.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	msg, err := h.messageService.Send(c.Request.Context(), senderID, req)
	if err != nil {
		if errors.Is(err, domain.ErrSelfMessage) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		if errors.Is(err, domain.ErrUserBlocked) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
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
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	// Siempre retornar array (nunca null)
	c.JSON(http.StatusOK, dto.ToMessageListResponse(messages))
}

// GetPhotoSignedURL godoc
// GET /api/messages/:messageId/photo-url
// Genera una URL firmada de Cloudinary para la foto adjunta a un mensaje.
// Solo el sender o receiver del mensaje puede obtener la URL.
func (h *MessageHandler) GetPhotoSignedURL(c *gin.Context) {
	if h.cloudinary == nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrImageSearchUnavailable)
		return
	}

	callerID := getUserID(c)
	messageID := c.Param("messageId")

	msgUUID, err := uuid.Parse(messageID)
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	msg, err := h.messageService.GetMessageByID(c.Request.Context(), msgUUID)
	if err != nil {
		if errors.Is(err, domain.ErrMessageNotFound) {
			writeError(c, http.StatusNotFound, domain.ErrMessageNotFound)
		} else {
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	callerUUID, _ := uuid.Parse(callerID)
	if msg.SenderID != callerUUID && msg.ReceiverID != callerUUID {
		writeError(c, http.StatusForbidden, domain.ErrForbidden)
		return
	}

	if msg.PhotoPublicID == "" {
		writeError(c, http.StatusNotFound, domain.ErrPhotoNotFound)
		return
	}

	url, expiresAt, err := h.cloudinary.GenerateSignedURL(c.Request.Context(), msg.PhotoPublicID, time.Hour)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":        url,
		"expires_at": expiresAt.Format(time.RFC3339),
	})
}

// GetUnreadCount godoc
// GET /api/messages/unread-count
// Retorna la cantidad de mensajes no leídos del usuario autenticado.
// Valor inicial para el badge de mensajes; el WebSocket (badge_update)
// lo mantiene actualizado después.
func (h *MessageHandler) GetUnreadCount(c *gin.Context) {
	userID := getUserID(c)

	count, err := h.messageService.CountUnread(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"count": count})
}

// MarkAsRead godoc
// PATCH /api/messages/:id/read
func (h *MessageHandler) MarkAsRead(c *gin.Context) {
	userID := getUserID(c)
	messageID := c.Param("id")

	err := h.messageService.MarkAsRead(c.Request.Context(), userID, messageID)
	if err != nil {
		if errors.Is(err, domain.ErrMessageNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrNotMessageReceiver) {
			writeError(c, http.StatusForbidden, domain.ErrForbidden)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
