package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// SendMessageRequest son los datos requeridos para enviar un mensaje.
// ReceiverID y ReportID son uuid.UUID — Gin los deserializa vía json.Unmarshal,
// por lo que un UUID inválido retorna 400 antes de llegar al service.
type SendMessageRequest struct {
	ReceiverID uuid.UUID  `json:"receiver_id" binding:"required"`
	Content    string     `json:"content" binding:"required,max=2000"`
	ReportID   *uuid.UUID `json:"report_id,omitempty"`
}

// MessageUserResponse es la info mínima del usuario en un mensaje.
// PRIVACY: solo id + name — nunca email ni phone (regla #3).
type MessageUserResponse struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// MessageResponse son los datos de un mensaje que retornamos al cliente.
// CRÍTICO: domain.Message.Text se expone como "content" en JSON — los campos difieren.
// PhotoPublicID nunca se incluye aquí (json:"-" en el domain model).
type MessageResponse struct {
	ID         uuid.UUID            `json:"id"`
	SenderID   uuid.UUID            `json:"sender_id"`
	ReceiverID uuid.UUID            `json:"receiver_id"`
	ReportID   *uuid.UUID           `json:"report_id,omitempty"`
	Content    string               `json:"content"`
	ReadAt     *time.Time           `json:"read_at,omitempty"`
	IsRead     bool                 `json:"is_read"`
	PhotoURL   string               `json:"photo_url,omitempty"`
	CreatedAt  time.Time            `json:"created_at"`
	Sender     *MessageUserResponse `json:"sender,omitempty"`
	Receiver   *MessageUserResponse `json:"receiver,omitempty"`
}

// toMessageUser mapea la relación precargada; nil si el repo no la trajo
// (User zero-value → ID nil).
func toMessageUser(u domain.User) *MessageUserResponse {
	if u.ID == uuid.Nil {
		return nil
	}
	return &MessageUserResponse{ID: u.ID, Name: u.Name}
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
		ReadAt:     msg.ReadAt,
		IsRead:     msg.ReadAt != nil,
		PhotoURL:   msg.PhotoURL,
		CreatedAt:  msg.CreatedAt,
		Sender:     toMessageUser(msg.Sender),
		Receiver:   toMessageUser(msg.Receiver),
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
