package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"
)

// MessageServicer defines the minimal message-service contract needed by Hub.
// Implemented by the service layer (wired in main.go).
type MessageServicer interface {
	CountUnread(ctx context.Context, userID string) (int64, error)
	MarkConversationRead(ctx context.Context, userID, senderID string) error
}

type inboundMsg struct {
	client *Client
	data   []byte
}

// Hub is the central registry for all connected WebSocket clients.
// A single goroutine (Run) owns the clients map — no lock needed for that map inside Run.
// IsConnected uses a sync.RWMutex for safe external reads.
type Hub struct {
	// clients maps userID → list of Clients (multi-device).
	clients map[string][]*Client

	register   chan *Client
	unregister chan *Client
	inbound    chan inboundMsg

	badgeDebounce map[string]*time.Timer
	badgeMu       sync.Mutex

	// mu guards clients for external read access (IsConnected).
	mu sync.RWMutex

	quit chan struct{}

	msgSvc   MessageServicer
	clockNow func() time.Time
}

// NewHub creates a Hub. msgSvc may be nil during testing (badge debounce will log errors).
func NewHub(msgSvc MessageServicer) *Hub {
	return &Hub{
		clients:       make(map[string][]*Client),
		register:      make(chan *Client, 8),
		unregister:    make(chan *Client, 8),
		inbound:       make(chan inboundMsg, 256),
		badgeDebounce: make(map[string]*time.Timer),
		quit:          make(chan struct{}),
		msgSvc:        msgSvc,
		clockNow:      time.Now,
	}
}

// Run is the single goroutine that owns and mutates the clients map.
// Call as: go hub.Run()
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c.userID] = append(h.clients[c.userID], c)
			h.mu.Unlock()
			log.Printf("[ws] registered userID=%s total_sessions=%d", c.userID, len(h.clients[c.userID]))

		case c := <-h.unregister:
			h.mu.Lock()
			conns := h.clients[c.userID]
			for i, conn := range conns {
				if conn == c {
					h.clients[c.userID] = append(conns[:i], conns[i+1:]...)
					break
				}
			}
			if len(h.clients[c.userID]) == 0 {
				delete(h.clients, c.userID)
			}
			h.mu.Unlock()

			// Emit synthetic typing_stop to any ongoing typing targets.
			h.broadcastTypingStop(c.userID)
			log.Printf("[ws] unregistered userID=%s", c.userID)

		case msg := <-h.inbound:
			h.handleInbound(msg)

		case <-h.quit:
			// Cancel all badge debounce timers.
			h.badgeMu.Lock()
			for _, t := range h.badgeDebounce {
				t.Stop()
			}
			h.badgeMu.Unlock()
			log.Println("[ws] hub shut down")
			return
		}
	}
}

// Close signals the Run goroutine to stop.
func (h *Hub) Close() {
	close(h.quit)
}

// IsConnected reports whether the user has at least one active connection.
// Safe to call from any goroutine.
func (h *Hub) IsConnected(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

// SendToUser delivers msg to all Clients belonging to userID.
// Non-blocking: if a client's send buffer is full it is force-closed.
func (h *Hub) SendToUser(userID string, msg []byte) {
	h.mu.RLock()
	conns := make([]*Client, len(h.clients[userID]))
	copy(conns, h.clients[userID])
	h.mu.RUnlock()

	for _, c := range conns {
		select {
		case c.send <- msg:
		default:
			// Buffer full — force-close this client.
			log.Printf("[ws] send buffer full, force-closing userID=%s", userID)
			close(c.send)
			h.unregister <- c
		}
	}
}

// handleInbound routes an inbound message to the appropriate handler based on envelope type.
func (h *Hub) handleInbound(msg inboundMsg) {
	var env Envelope
	if err := json.Unmarshal(msg.data, &env); err != nil {
		h.sendError(msg.client, "invalid_envelope", "malformed JSON envelope")
		return
	}

	switch env.Type {
	case TypeTypingStart:
		h.handleTyping(msg.client, env, TypeTypingStart)
	case TypeTypingStop:
		h.handleTyping(msg.client, env, TypeTypingStop)
	case TypeReadReceipt:
		h.handleReadReceipt(msg.client, env)
	default:
		h.sendError(msg.client, "unknown_type", "unsupported message type: "+string(env.Type))
	}
}

func (h *Hub) handleTyping(c *Client, env Envelope, t MessageType) {
	var ev TypingEvent
	if err := json.Unmarshal(env.Payload, &ev); err != nil {
		h.sendError(c, "invalid_payload", "bad typing event payload")
		return
	}
	out, _ := json.Marshal(Envelope{Type: t, Payload: mustMarshal(ev)})
	h.SendToUser(ev.To, out)
}

func (h *Hub) handleReadReceipt(c *Client, env Envelope) {
	var rr ReadReceipt
	if err := json.Unmarshal(env.Payload, &rr); err != nil {
		h.sendError(c, "invalid_payload", "bad read_receipt payload")
		return
	}

	// Persist mark-read in DB.
	if h.msgSvc != nil {
		ctx := context.Background()
		if err := h.msgSvc.MarkConversationRead(ctx, rr.From, rr.To); err != nil {
			log.Printf("[ws] MarkConversationRead err userID=%s senderID=%s: %v", rr.From, rr.To, err)
		}
	}

	// Debounce badge recalculation: reset/create 500ms timer per userID.
	h.scheduleBadgeUpdate(rr.From)
}

// scheduleBadgeUpdate resets (or creates) a 500ms debounce timer that,
// when it fires, queries CountUnread and broadcasts badge_update to the user.
func (h *Hub) scheduleBadgeUpdate(userID string) {
	h.badgeMu.Lock()
	defer h.badgeMu.Unlock()

	if t, exists := h.badgeDebounce[userID]; exists {
		t.Reset(500 * time.Millisecond)
		return
	}

	h.badgeDebounce[userID] = time.AfterFunc(500*time.Millisecond, func() {
		h.badgeMu.Lock()
		delete(h.badgeDebounce, userID)
		h.badgeMu.Unlock()

		if h.msgSvc == nil {
			return
		}
		count, err := h.msgSvc.CountUnread(context.Background(), userID)
		if err != nil {
			log.Printf("[ws] CountUnread err userID=%s: %v", userID, err)
			return
		}
		payload := BadgeUpdate{UserID: userID, UnreadCount: int(count)}
		out, _ := json.Marshal(Envelope{Type: TypeBadgeUpdate, Payload: mustMarshal(payload)})
		h.SendToUser(userID, out)
	})
}

// broadcastTypingStop sends a synthetic typing_stop from disconnectedUserID
// to any users that may have an ongoing typing indicator.
// Simple approach: we broadcast to the disconnecting user's current conversations.
// In practice this is a best-effort cleanup — recipients ignore stale events.
func (h *Hub) broadcastTypingStop(userID string) {
	ev := TypingEvent{From: userID, To: ""}
	out, _ := json.Marshal(Envelope{Type: TypeTypingStop, Payload: mustMarshal(ev)})

	// Broadcast to all currently connected users except the disconnecting one.
	h.mu.RLock()
	var targets []string
	for uid := range h.clients {
		if uid != userID {
			targets = append(targets, uid)
		}
	}
	h.mu.RUnlock()

	for _, uid := range targets {
		h.SendToUser(uid, out)
	}
}

// sendError sends a TypeError envelope back to the client.
func (h *Hub) sendError(c *Client, code, message string) {
	payload := ErrorPayload{Code: code, Message: message}
	out, _ := json.Marshal(Envelope{Type: TypeError, Payload: mustMarshal(payload)})
	select {
	case c.send <- out:
	default:
	}
}

// mustMarshal marshals v to JSON, panicking only if v is not serialisable
// (which won't happen for our value types).
func mustMarshal(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic("websocket: mustMarshal failed: " + err.Error())
	}
	return b
}
