package websocket

import (
	"testing"
	"time"
)

// Ticket-T-1: expired ticket is rejected by Consume.
func TestTicketStore_Expired(t *testing.T) {
	ts := NewTicketStore()
	id := ts.Issue("user-1")

	// Manually expire the ticket by backdating its expiresAt.
	ts.mu.Lock()
	ts.tickets[id].expiresAt = time.Now().Add(-1 * time.Second)
	ts.mu.Unlock()

	_, ok := ts.Consume(id)
	if ok {
		t.Fatal("Consume should reject an expired ticket")
	}
}

// Ticket-T-2: a valid ticket can only be consumed once.
func TestTicketStore_SingleUse(t *testing.T) {
	ts := NewTicketStore()
	id := ts.Issue("user-2")

	userID, ok := ts.Consume(id)
	if !ok {
		t.Fatal("first Consume should succeed")
	}
	if userID != "user-2" {
		t.Fatalf("expected userID 'user-2', got %q", userID)
	}

	_, ok = ts.Consume(id)
	if ok {
		t.Fatal("second Consume should be rejected (already used)")
	}
}

// Ticket-T-3: unknown ticket UUID is rejected.
func TestTicketStore_UnknownID(t *testing.T) {
	ts := NewTicketStore()
	_, ok := ts.Consume("00000000-0000-0000-0000-000000000000")
	if ok {
		t.Fatal("Consume of unknown ticket should be rejected")
	}
}

// Ticket-T-4: Issue returns distinct IDs for different users.
func TestTicketStore_IssueDistinctIDs(t *testing.T) {
	ts := NewTicketStore()
	id1 := ts.Issue("user-A")
	id2 := ts.Issue("user-B")
	if id1 == id2 {
		t.Fatal("Issue must return distinct IDs")
	}
}

// A ban or a password reset cuts the user's sockets, but a ticket minted just
// before (up to its 30 s TTL) could still open a new one: Connect only consumes
// the ticket and never re-checks the session.
func TestTicketStore_RevokeUserDropsOnlyThatUsersTickets(t *testing.T) {
	ts := NewTicketStore()
	a1 := ts.Issue("user-a")
	a2 := ts.Issue("user-a")
	b := ts.Issue("user-b")

	ts.RevokeUser("user-a")

	if _, ok := ts.Consume(a1); ok {
		t.Fatal("user-a's first ticket still works after RevokeUser")
	}
	if _, ok := ts.Consume(a2); ok {
		t.Fatal("user-a's second ticket still works after RevokeUser")
	}
	if got, ok := ts.Consume(b); !ok || got != "user-b" {
		t.Fatalf("user-b's ticket: got (%q, %v), want (user-b, true)", got, ok)
	}
}

func TestEndUserSessions_RevokesPendingTickets(t *testing.T) {
	ts := NewTicketStore()
	hub := NewHub(nil)
	id := ts.Issue("user-a")

	EndUserSessions(ts, hub, "user-a")

	if _, ok := ts.Consume(id); ok {
		t.Fatal("a ticket minted before EndUserSessions still opens a socket")
	}
}
