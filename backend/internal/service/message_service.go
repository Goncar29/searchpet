package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
)

// MessageService define el CONTRATO de la capa de negocio para mensajes.
// Todos los IDs se reciben como string (desde el handler) y se parsean internamente.
type MessageService interface {
	Send(ctx context.Context, senderID string, req dto.SendMessageRequest) (*domain.Message, error)
	GetConversations(ctx context.Context, userID string) ([]domain.Message, error)
	GetConversation(ctx context.Context, userID string, otherUserID string, limit, offset int) ([]domain.Message, error)
	MarkAsRead(ctx context.Context, userID string, messageID string) error
}

// messageService es la implementación concreta del MessageService.
type messageService struct {
	messageRepo repository.MessageRepository
	blockedRepo repository.BlockedUserRepository
}

// NewMessageService construye el MessageService con sus dependencias.
func NewMessageService(
	messageRepo repository.MessageRepository,
	blockedRepo repository.BlockedUserRepository,
) MessageService {
	return &messageService{
		messageRepo: messageRepo,
		blockedRepo: blockedRepo,
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

	return msg, nil
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

	return s.messageRepo.GetConversation(ctx, userUUID, otherUUID, limit, offset)
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
