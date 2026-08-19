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

// conversacionBorradaClause es la regla de visibilidad de "borrar conversación",
// en UNA sola definición. Va con los placeholders en orden (quienPregunta,
// contraparte) y correlaciona contra la tabla `messages` sin alias.
//
// LA REGLA VIVE EN TRES CONSULTAS Y EL BUG FUE TENERLA EN DOS. Por eso las dos
// que comparten esta forma exacta —`GetConversation` y `MarkConversationRead`—
// la toman de acá y no de una copia: el hilo no puede DEVOLVER lo borrado, y
// tampoco puede marcarlo leído.
//
// `CountUnread` tiene su propia versión y no puede usar ésta: abarca a TODOS los
// remitentes (`ch.other_user_id = m.sender_id`, no un `?`) y correlaciona contra
// el alias `m`. Si tocás una, andá a mirar la otra.
const conversacionBorradaClause = `NOT EXISTS (
	SELECT 1 FROM conversation_hides ch
	WHERE ch.user_id = ? AND ch.other_user_id = ?
	  AND ch.hidden_at >= messages.created_at
)`

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
		// "Borrar conversación" tiene que borrar de verdad PARA QUIEN LA BORRÓ.
		//
		// Sin este filtro, el ocultamiento sólo tapaba la FILA de la lista: al
		// reabrirse la conversación —porque cualquiera de los dos escribe— volvía
		// entera, con todo el historial que el usuario creía haber borrado. Un
		// botón que dice "Borrar" y sólo esconde una fila promete lo que no hace,
		// y en esta app la gente lo usa después de un intercambio incómodo con un
		// desconocido que le escribió por su mascota.
		//
		// `userA` es SIEMPRE quien pregunta (el servicio pasa el userID de la
		// sesión primero), así que el filtro es direccional por construcción: la
		// contraparte hace su propia consulta con userA = ella, no tiene fila en
		// `conversation_hides`, y conserva la conversación intacta. Los mensajes
		// NO se borran de la tabla — no puede ser de otra forma, la fila le
		// pertenece a los dos.
		//
		// Es la misma regla que ya usaba `CountUnread` para no contar lo que el
		// usuario no puede ver; acá se reusa para que el hilo diga lo mismo que el
		// badge. Que las dos vistas discrepen es cómo aparecen los "tengo un no
		// leído que no encuentro".
		Where(conversacionBorradaClause, userA, userB).
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
//
// NO MARCA LO QUE EL LECTOR NO PUEDE VER. `GetConversation` lo llama en cada
// apertura del hilo, así que sin este filtro abrir una conversación borrada
// marcaría leídos mensajes anteriores al borrado — que quien borró tiene
// invisibles para siempre. Eso le manda a la contraparte un acuse de lectura por
// algo que demostrablemente nadie leyó: una señal de entrega falsa, y encima
// hacia la única persona que no eligió borrar nada.
//
// Es la misma regla que el hilo y el badge; la definición está arriba, en
// `conversacionBorradaClause`. Los mensajes que quedan sin marcar no ensucian
// nada: `CountUnread` ya los excluye del contador por la misma regla.
func (r *postgresMessageRepository) MarkConversationRead(ctx context.Context, receiverID, senderID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.Message{}).
		Where("receiver_id = ? AND sender_id = ? AND read_at IS NULL", receiverID, senderID).
		Where(conversacionBorradaClause, receiverID, senderID).
		Update("read_at", gorm.Expr("NOW()")).Error
}

// MarkConversationUnread revierte el read_at del último mensaje recibido de una
// conversación ("marcar como no leída"). Solo el más reciente: alcanza para que
// la conversación muestre el punto de no-leído y cuente en el badge.
func (r *postgresMessageRepository) MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error {
	return r.db.WithContext(ctx).Exec(
		`UPDATE messages SET read_at = NULL
		 WHERE id = (
			SELECT id FROM messages
			WHERE receiver_id = ? AND sender_id = ?
			ORDER BY created_at DESC
			LIMIT 1
		 )`,
		receiverID, senderID,
	).Error
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
