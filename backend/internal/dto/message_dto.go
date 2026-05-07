package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// SendMessageRequest son los datos requeridos para enviar un mensaje.
// ReceiverID viene como string en JSON y se valida en el handler antes de pasar al service.
type SendMessageRequest struct {
	ReceiverID string  `json:"receiver_id" binding:"required"`
	Content    string  `json:"content" binding:"required,max=2000"`
	ReportID   *string `json:"report_id,omitempty"`
}

// MessageResponse son los datos de un mensaje que retornamos al cliente.
// CRÍTICO: domain.Message.Text se expone como "content" en JSON — los campos difieren.
type MessageResponse struct {
	ID         uuid.UUID  `json:"id"`
	SenderID   uuid.UUID  `json:"sender_id"`
	ReceiverID uuid.UUID  `json:"receiver_id"`
	ReportID   *uuid.UUID `json:"report_id,omitempty"`
	Content    string     `json:"content"`
	IsRead     bool       `json:"is_read"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ToMessageResponse convierte un domain.Message en un MessageResponse limpio.
// Mapea domain.Message.Text → MessageResponse.Content.
func ToMessageResponse(msg *domain.Message) MessageResponse {
	return MessageResponse{
		ID:         msg.ID,
		SenderID:   msg.SenderID,
		ReceiverID: msg.ReceiverID,
		ReportID:   msg.ReportID,
		Content:    msg.Text,
		IsRead:     msg.IsRead,
		CreatedAt:  msg.CreatedAt,
	}
}

// ToMessageListResponse convierte un slice de domain.Message en un slice de MessageResponse.
// Siempre retorna un slice inicializado (nunca nil) para que JSON serialice como [] en vez de null.
func ToMessageListResponse(messages []domain.Message) []MessageResponse {
	result := make([]MessageResponse, len(messages))
	for i, msg := range messages {
		result[i] = ToMessageResponse(&msg)
	}
	return result
}
