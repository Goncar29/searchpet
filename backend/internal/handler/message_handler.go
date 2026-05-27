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

// GetPhotoSignedURL godoc
// GET /api/messages/:messageId/photo-url
// Genera una URL firmada de Cloudinary para la foto adjunta a un mensaje.
// Solo el sender o receiver del mensaje puede obtener la URL.
func (h *MessageHandler) GetPhotoSignedURL(c *gin.Context) {
	if h.cloudinary == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "servicio de imágenes no disponible"})
		return
	}

	callerID := getUserID(c)
	messageID := c.Param("messageId")

	msgUUID, err := uuid.Parse(messageID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "messageId inválido"})
		return
	}

	msg, err := h.messageService.GetMessageByID(c.Request.Context(), msgUUID)
	if err != nil {
		if errors.Is(err, domain.ErrMessageNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "mensaje no encontrado"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": domain.ErrInternal.Error()})
		}
		return
	}

	callerUUID, _ := uuid.Parse(callerID)
	if msg.SenderID != callerUUID && msg.ReceiverID != callerUUID {
		c.JSON(http.StatusForbidden, gin.H{"error": "acceso denegado"})
		return
	}

	if msg.PhotoPublicID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "este mensaje no tiene foto"})
		return
	}

	url, expiresAt, err := h.cloudinary.GenerateSignedURL(c.Request.Context(), msg.PhotoPublicID, time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error generando URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":        url,
		"expires_at": expiresAt.Format(time.RFC3339),
	})
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
