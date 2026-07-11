package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresMessageRepository struct {
	db *gorm.DB
}

// NewMessageRepository construye un MessageRepository respaldado por PostgreSQL.
func NewMessageRepository(db *gorm.DB) MessageRepository {
	return &postgresMessageRepository{db: db}
}

// Create persiste un nuevo mensaje en la BD.
func (r *postgresMessageRepository) Create(ctx context.Context, message *domain.Message) error {
	return r.db.WithContext(ctx).Create(message).Error
}

// GetByID busca un mensaje por su UUID.
// Retorna ErrMessageNotFound si no existe.
func (r *postgresMessageRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.Message, error) {
	var message domain.Message
	result := r.db.WithContext(ctx).
		Preload("Sender").Preload("Receiver").
		First(&message, "id = ?", id)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrMessageNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &message, nil
}

// GetConversation retorna los mensajes entre userA y userB en orden cronológico ascendente.
// La query es bidireccional: incluye mensajes donde A es sender y B es receiver, y viceversa.
func (r *postgresMessageRepository) GetConversation(ctx context.Context, userA, userB uuid.UUID, limit, offset int) ([]domain.Message, error) {
	var messages []domain.Message
	err := r.db.WithContext(ctx).
		Preload("Sender").Preload("Receiver").
		Where(
			"(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			userA, userB, userB, userA,
		).
		Order("created_at ASC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	return messages, err
}

// GetConversations retorna el último mensaje de cada conversación única del usuario.
// Usa DISTINCT ON para seleccionar el mensaje más reciente por par de usuarios (temporalmente correcto).
func (r *postgresMessageRepository) GetConversations(ctx context.Context, userID uuid.UUID) ([]domain.Message, error) {
	// DISTINCT ON selecciona el mensaje más reciente por conversación; el NOT EXISTS
	// excluye conversaciones que el usuario ocultó DESPUÉS de ese último mensaje.
	// Un mensaje nuevo (created_at > hidden_at) hace reaparecer la conversación.
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).Raw(
		`SELECT id FROM (
			SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
			       id, created_at,
			       CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id
			FROM messages
			WHERE sender_id = ? OR receiver_id = ?
			ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
		) latest
		WHERE NOT EXISTS (
			SELECT 1 FROM conversation_hides ch
			WHERE ch.user_id = ? AND ch.other_user_id = latest.other_id
			  AND ch.hidden_at >= latest.created_at
		)`,
		userID, userID, userID, userID,
	).Scan(&ids).Error
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []domain.Message{}, nil
	}

	var messages []domain.Message
	err = r.db.WithContext(ctx).
		Preload("Sender").Preload("Receiver").
		Where("id IN ?", ids).
		Order("created_at DESC").
		Find(&messages).Error
	return messages, err
}

// MarkAsRead marca un mensaje como leído estableciendo read_at = NOW().
// Solo actualiza si read_at IS NULL (idempotente).
// Retorna ErrMessageNotFound si el mensaje no existe.
func (r *postgresMessageRepository) MarkAsRead(ctx context.Context, messageID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&domain.Message{}).
		Where("id = ? AND read_at IS NULL", messageID).
		Update("read_at", gorm.Expr("NOW()"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		// Could be already read or not found — check existence
		var count int64
		r.db.WithContext(ctx).Model(&domain.Message{}).Where("id = ?", messageID).Count(&count)
		if count == 0 {
			return domain.ErrMessageNotFound
		}
	}
	return nil
}

// MarkConversationRead marca como leídos todos los mensajes no leídos de una conversación
// donde receiverID es el destinatario y senderID el remitente.
// Condición WHERE read_at IS NULL garantiza idempotencia.
func (r *postgresMessageRepository) MarkConversationRead(ctx context.Context, receiverID, senderID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.Message{}).
		Where("receiver_id = ? AND sender_id = ? AND read_at IS NULL", receiverID, senderID).
		Update("read_at", gorm.Expr("NOW()")).Error
}

// CountUnread retorna la cantidad de mensajes recibidos por userID que aún no fueron
// leídos, excluyendo los de conversaciones ocultas (el badge no debe contar lo que
// el usuario no puede ver). Un mensaje posterior a hidden_at vuelve a contar.
func (r *postgresMessageRepository) CountUnread(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM messages m
		 WHERE m.receiver_id = ? AND m.read_at IS NULL
		 AND NOT EXISTS (
			SELECT 1 FROM conversation_hides ch
			WHERE ch.user_id = ? AND ch.other_user_id = m.sender_id
			  AND ch.hidden_at >= m.created_at
		 )`,
		userID, userID,
	).Scan(&count).Error
	return count, err
}

// Verificación estática: postgresMessageRepository satisface MessageRepository.
var _ MessageRepository = (*postgresMessageRepository)(nil)
