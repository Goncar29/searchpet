package service

import (
	"context"
	"unicode/utf8"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// MessageService define el CONTRATO de la capa de negocio para mensajes.
// Todos los IDs se reciben como string (desde el handler) y se parsean internamente.
type MessageService interface {
	Send(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error)
	GetConversations(ctx context.Context, userID string) ([]domain.Message, error)
	GetConversation(ctx context.Context, userID string, otherUserID string, limit, offset int) ([]domain.Message, error)
	MarkAsRead(ctx context.Context, userID string, messageID string) error
	GetMessageByID(ctx context.Context, messageID uuid.UUID) (*domain.Message, error)
	MarkConversationRead(ctx context.Context, userID string, otherUserID string) error
	CountUnread(ctx context.Context, userID string) (int64, error)
	// HideConversation oculta la conversación con otherUserID SOLO para userID.
	HideConversation(ctx context.Context, userID string, otherUserID string) error
	// MarkConversationUnread marca la conversación como no leída para userID.
	MarkConversationUnread(ctx context.Context, userID string, otherUserID string) error
}

// messageService es la implementación concreta del MessageService.
type messageService struct {
	messageRepo repository.MessageRepository
	blockedRepo repository.BlockedUserRepository
	hideRepo    repository.ConversationHideRepository
	eventBus    *event.EventBus
}

// NewMessageService construye el MessageService con sus dependencias.
// eventBus es opcional — si es nil, los eventos no se publican (zero behavior change).
func NewMessageService(
	messageRepo repository.MessageRepository,
	blockedRepo repository.BlockedUserRepository,
	hideRepo repository.ConversationHideRepository,
	eventBus *event.EventBus,
) MessageService {
	return &messageService{
		messageRepo: messageRepo,
		blockedRepo: blockedRepo,
		hideRepo:    hideRepo,
		eventBus:    eventBus,
	}
}

// Send envía un mensaje de senderID a receiverID.
// REGLAS DE NEGOCIO:
// 1. No se puede enviar mensajes a uno mismo → ErrSelfMessage (400)
// 2. Si existe un bloqueo en cualquier dirección → ErrUserBlocked (403)
func (s *messageService) Send(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error) {
	senderUUID, err := uuid.Parse(senderID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// ReceiverID ya viene como uuid.UUID desde el DTO — sin parse adicional
	receiverUUID := req.ReceiverID

	// REGLA 1: no auto-mensaje
	if senderUUID == receiverUUID {
		return nil, domain.ErrSelfMessage
	}

	// REGLA 2: verificar bloqueo bidireccional (A bloqueó B ó B bloqueó A)
	// IsBlocked ya hace el check en ambas direcciones en una sola query.
	blocked, err := s.blockedRepo.IsBlocked(ctx, senderUUID, receiverUUID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, domain.ErrUserBlocked
	}

	msg := &domain.Message{
		SenderID:   senderUUID,
		ReceiverID: receiverUUID,
		Text:       req.Content,
	}

	// ReportID ya viene como *uuid.UUID desde el DTO — asignación directa
	if req.ReportID != nil {
		msg.ReportID = req.ReportID
	}

	if err := s.messageRepo.Create(ctx, msg); err != nil {
		return nil, err
	}

	// Recargamos con relaciones para tener Sender.Name disponible para el evento
	loaded, err := s.messageRepo.GetByID(ctx, msg.ID)
	if err != nil {
		return nil, err
	}

	// Publicamos el evento de forma secundaria — un fallo aquí no falla el request
	if s.eventBus != nil {
		preview := loaded.Text
		if utf8.RuneCountInString(preview) > 100 {
			runes := []rune(preview)
			preview = string(runes[:100])
		}
		s.eventBus.Publish("message.sent", event.MessageSentEvent{
			MessageID:  loaded.ID,
			SenderID:   loaded.SenderID,
			ReceiverID: loaded.ReceiverID,
			SenderName: loaded.Sender.Name,
			Body:       loaded.Text,
			Preview:    preview,
		})
	}

	return loaded, nil
}

// GetConversations retorna el último mensaje de cada conversación única del usuario.
func (s *messageService) GetConversations(ctx context.Context, userID string) ([]domain.Message, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	return s.messageRepo.GetConversations(ctx, userUUID)
}

// GetConversation retorna los mensajes entre userID y otherUserID, ordenados cronológicamente ASC.
// Default: limit=20, offset=0 (aplicado en el handler antes de llamar acá).
func (s *messageService) GetConversation(ctx context.Context, userID string, otherUserID string, limit, offset int) ([]domain.Message, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	otherUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	messages, err := s.messageRepo.GetConversation(ctx, userUUID, otherUUID, limit, offset)
	if err != nil {
		return nil, err
	}

	// Marcar la conversación como leída de forma asíncrona — un fallo no interrumpe la respuesta.
	_ = s.messageRepo.MarkConversationRead(ctx, userUUID, otherUUID) // fire-and-forget

	return messages, nil
}

// GetMessageByID retorna un mensaje por su ID. Delega directamente al repositorio.
func (s *messageService) GetMessageByID(ctx context.Context, messageID uuid.UUID) (*domain.Message, error) {
	return s.messageRepo.GetByID(ctx, messageID)
}

// MarkConversationRead marca todos los mensajes no leídos de una conversación como leídos.
// Parsea los IDs string a UUID antes de delegar al repositorio.
func (s *messageService) MarkConversationRead(ctx context.Context, userID string, otherUserID string) error {
	receiverUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	senderUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	return s.messageRepo.MarkConversationRead(ctx, receiverUUID, senderUUID)
}

// CountUnread retorna la cantidad de mensajes no leídos para un usuario.
func (s *messageService) CountUnread(ctx context.Context, userID string) (int64, error) {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return 0, domain.ErrInvalidInput
	}
	return s.messageRepo.CountUnread(ctx, userUUID)
}

// HideConversation oculta la conversación de userID con otherUserID (estilo WhatsApp:
// solo desaparece para quien la oculta; un mensaje nuevo la hace reaparecer).
func (s *messageService) HideConversation(ctx context.Context, userID string, otherUserID string) error {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	otherUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	return s.hideRepo.Upsert(ctx, userUUID, otherUUID)
}

// MarkConversationUnread marca como no leído el último mensaje recibido de la
// conversación. Idempotente; no-op si no hay mensajes recibidos.
func (s *messageService) MarkConversationUnread(ctx context.Context, userID string, otherUserID string) error {
	receiverUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	senderUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	return s.messageRepo.MarkConversationUnread(ctx, receiverUUID, senderUUID)
}

// MarkAsRead marca un mensaje como leído.
// REGLA DE NEGOCIO: solo el destinatario (ReceiverID) puede marcar como leído.
// Retorna ErrNotMessageReceiver si el caller no es el destinatario.
// Retorna ErrMessageNotFound si el mensaje no existe.
func (s *messageService) MarkAsRead(ctx context.Context, userID string, messageID string) error {
	receiverUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}

	msgUUID, err := uuid.Parse(messageID)
	if err != nil {
		return domain.ErrInvalidInput
	}

	// Cargamos el mensaje para verificar que el caller sea el destinatario
	msg, err := s.messageRepo.GetByID(ctx, msgUUID)
	if err != nil {
		return err
	}

	// REGLA: solo el destinatario puede marcar como leído
	if msg.ReceiverID != receiverUUID {
		return domain.ErrNotMessageReceiver
	}

	return s.messageRepo.MarkAsRead(ctx, msgUUID)
}
