package websocket

import "encoding/json"

// MessageType identifies the type of a WebSocket message envelope.
type MessageType string

const (
	TypeChatMessage MessageType = "chat_message"
	TypeTypingStart MessageType = "typing_start"
	TypeTypingStop  MessageType = "typing_stop"
	TypeReadReceipt MessageType = "read_receipt"
	TypeBadgeUpdate MessageType = "badge_update"
	TypeDelivered   MessageType = "delivered"
	TypeError       MessageType = "error"
)

// Envelope is the top-level wrapper for all WebSocket messages.
type Envelope struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// ChatMessage is the payload for TypeChatMessage.
type ChatMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Body      string `json:"body,omitempty"`
	PhotoURL  string `json:"photo_url,omitempty"`
	Timestamp string `json:"timestamp"`
}

// TypingEvent is the payload for TypeTypingStart and TypeTypingStop.
type TypingEvent struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// ReadReceipt is the payload for TypeReadReceipt.
type ReadReceipt struct {
	From       string   `json:"from"`
	To         string   `json:"to"`
	MessageIDs []string `json:"message_ids"`
}

// BadgeUpdate is the payload for TypeBadgeUpdate.
type BadgeUpdate struct {
	UserID      string `json:"user_id"`
	UnreadCount int    `json:"unread_count"`
}

// DeliveredAck is the payload for TypeDelivered.
type DeliveredAck struct {
	MessageID string `json:"message_id"`
	To        string `json:"to"`
}

// ErrorPayload is the payload for TypeError.
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
