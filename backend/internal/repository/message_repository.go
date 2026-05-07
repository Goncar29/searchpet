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
	// DISTINCT ON selecciona la primera fila de cada grupo según el ORDER BY.
	// Al ordenar por (conv_key, created_at DESC) obtenemos el mensaje más reciente
	// por conversación de forma temporalmente correcta, sin depender del ordenamiento de UUIDs.
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).Raw(
		`SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)) id
		 FROM messages
		 WHERE sender_id = ? OR receiver_id = ?
		 ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC`,
		userID, userID,
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

// MarkAsRead marca un mensaje como leído.
// Retorna ErrMessageNotFound si el mensaje no existe.
func (r *postgresMessageRepository) MarkAsRead(ctx context.Context, messageID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Model(&domain.Message{}).
		Where("id = ?", messageID).
		Update("is_read", true)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrMessageNotFound
	}
	return nil
}

// Verificación estática: postgresMessageRepository satisface MessageRepository.
var _ MessageRepository = (*postgresMessageRepository)(nil)
