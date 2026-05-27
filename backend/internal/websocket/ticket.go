package websocket

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type ticket struct {
	userID    string
	expiresAt time.Time
	used      bool
}

// TicketStore is an in-memory single-use ticket store with TTL enforcement.
type TicketStore struct {
	mu      sync.Mutex
	tickets map[string]*ticket
}

// NewTicketStore creates a new TicketStore.
func NewTicketStore() *TicketStore {
	return &TicketStore{tickets: make(map[string]*ticket)}
}

// Issue creates a single-use ticket for the given userID with a 30-second TTL.
// Returns the ticket UUID string.
func (ts *TicketStore) Issue(userID string) string {
	id := uuid.NewString()
	ts.mu.Lock()
	ts.tickets[id] = &ticket{
		userID:    userID,
		expiresAt: time.Now().Add(30 * time.Second),
	}
	ts.mu.Unlock()
	return id
}

// Consume validates and atomically marks a ticket as used.
// Returns the associated userID and true on success.
// Returns ("", false) if the ticket is unknown, already used, or expired.
func (ts *TicketStore) Consume(id string) (string, bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t, ok := ts.tickets[id]
	if !ok || t.used || time.Now().After(t.expiresAt) {
		return "", false
	}
	t.used = true
	return t.userID, true
}

// CleanupLoop removes expired tickets every 60 seconds. Run as a goroutine.
func (ts *TicketStore) CleanupLoop() {
	for range time.Tick(60 * time.Second) {
		ts.mu.Lock()
		for id, t := range ts.tickets {
			if time.Now().After(t.expiresAt) {
				delete(ts.tickets, id)
			}
		}
		ts.mu.Unlock()
	}
}
