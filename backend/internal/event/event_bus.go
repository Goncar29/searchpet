package event

import (
	"log"
	"sync"

	"github.com/google/uuid"
)

// EventBus es un bus de eventos in-process. Permite publicar eventos tipados
// y suscribirse a ellos sin acoplamiento directo entre componentes.
// Cada handler se ejecuta en una goroutine separada (fire-and-forget).
// Los panics en handlers son capturados con recover() — el servidor nunca cae.
type EventBus struct {
	subscribers map[string][]func(interface{})
	mu          sync.RWMutex
}

// NewEventBus crea un EventBus listo para usar.
func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string][]func(interface{})),
	}
}

// Subscribe registra un handler para el tipo de evento dado.
// Múltiples handlers pueden registrarse para el mismo evento.
func (eb *EventBus) Subscribe(event string, handler func(interface{})) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	eb.subscribers[event] = append(eb.subscribers[event], handler)
}

// Publish dispara el evento a todos los handlers registrados.
// No bloquea al caller — cada handler corre en su propia goroutine.
// Un panic en un handler es capturado: no propaga y no afecta a los demás.
func (eb *EventBus) Publish(event string, payload interface{}) {
	eb.mu.RLock()
	handlers := eb.subscribers[event]
	eb.mu.RUnlock()

	for _, h := range handlers {
		h := h // captura para la goroutine
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[EventBus] panic recovered in handler for event %q: %v", event, r)
				}
			}()
			h(payload)
		}()
	}
}

// ============================================================
// Payload structs
// ============================================================

// ReportCreatedEvent es el payload publicado cuando se crea un reporte de ubicación.
// Incluye PetType, Lat y Lng para que los subscribers de alertas no necesiten
// un lookup adicional a la base de datos (NFR1.3: subscriber no bloquea el request).
type ReportCreatedEvent struct {
	ReportID   uuid.UUID
	PetID      uuid.UUID
	ReporterID uuid.UUID
	PetOwnerID uuid.UUID
	PetName    string
	PetType    string  // perro, gato, pajaro, otro — usado por el subscriber de alertas
	Status     string  // lost, found, sighting
	Lat        float64 // latitud del reporte — usado para ST_DWithin
	Lng        float64 // longitud del reporte — usado para ST_DWithin
}

// AlertTriggeredEvent es el payload publicado cuando una alerta de ubicación
// coincide con un nuevo reporte. Lleva los tokens FCM para que NotificationService
// pueda enviar el push sin conocer el repositorio de alertas.
type AlertTriggeredEvent struct {
	AlertID    uuid.UUID
	UserID     uuid.UUID // dueño de la alerta (receptor del push)
	ReportID   uuid.UUID
	PetID      uuid.UUID
	PetName    string
	PetType    string
	FCMTokens  []string // tokens del usuario en el momento del evento
	DistanceKm float64  // distancia en km entre el reporte y el centro de la alerta
}

// MessageSentEvent es el payload publicado cuando se envía un mensaje.
type MessageSentEvent struct {
	MessageID  uuid.UUID
	SenderID   uuid.UUID
	ReceiverID uuid.UUID
	SenderName string
	Body       string // full message text (used for WS delivery)
	Preview    string // first 100 chars (used for FCM notification body)
}

// PetFoundEvent es el payload publicado cuando una mascota es marcada como encontrada.
type PetFoundEvent struct {
	PetID   uuid.UUID
	OwnerID uuid.UUID
	PetName string
}

// ShareCreatedEvent es el payload publicado cuando se genera un link compartible.
type ShareCreatedEvent struct {
	UserID uuid.UUID
	PetID  uuid.UUID
}

// ReviewCreatedEvent es el payload publicado cuando un usuario crea una reseña.
type ReviewCreatedEvent struct {
	ReviewID   uuid.UUID
	ReviewerID uuid.UUID
	RevieweeID uuid.UUID
}

// UserVerifiedEvent is published when a user completes identity verification (OTP).
type UserVerifiedEvent struct {
	UserID uuid.UUID
}

// PhotoUploadedEvent is published by PhotoService after a photo is successfully
// persisted to Cloudinary and stored in the database.
// EmbeddingService subscribes to this event to generate CLIP embeddings for lost pets.
type PhotoUploadedEvent struct {
	PetID     uuid.UUID
	PhotoID   uuid.UUID
	SecureURL string // Cloudinary secure URL
}

// PetLostEvent is published by PetService when a pet's status transitions to "lost".
// EmbeddingService subscribes to backfill embeddings for all existing photos.
type PetLostEvent struct {
	PetID uuid.UUID
}

// PetStrayEvent is published by PetService when a stray pet is created (CreatePet
// with status="stray"). EmbeddingService subscribes to backfill embeddings for any
// existing photos, mirroring PetLostEvent — both statuses make a pet eligible for
// image search. Note: the status machine does not allow transitioning an existing
// pet INTO "stray" via UpdatePet, so this only fires at creation time.
type PetStrayEvent struct {
	PetID uuid.UUID
}
