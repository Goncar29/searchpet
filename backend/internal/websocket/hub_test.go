package websocket

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// mockMsgSvc is a minimal MessageServicer for hub tests.
type mockMsgSvc struct {
	countUnreadCalls atomic.Int64
	countUnreadRet   int64
}

func (m *mockMsgSvc) CountUnread(_ context.Context, _ string) (int64, error) {
	m.countUnreadCalls.Add(1)
	return m.countUnreadRet, nil
}

func (m *mockMsgSvc) MarkConversationRead(_ context.Context, _, _ string) error {
	return nil
}

// newTestClient creates a Client wired to hub without a real WebSocket conn.
// The conn field is nil — only send channel and hub are used in hub logic.
func newTestClient(userID string, hub *Hub) *Client {
	return &Client{
		userID: userID,
		hub:    hub,
		conn:   nil,
		send:   make(chan []byte, sendBufSize),
	}
}

// eventually polls cond until it holds or 2s pass. The hub mutates its map on
// its own goroutine, so these tests used to sleep 20ms and assert: a bet on the
// scheduler that a loaded machine loses (it did, 2026-09-24, while a browser
// verification ran alongside the suite). Waiting for the state itself is
// deterministic; the deadline only bounds a real hang.
func eventually(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal(msg)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// sessions reports how many clients the hub holds for userID. register and
// unregister are DIFFERENT channels and Run's select picks among ready ones at
// random, so "register c2, then unregister c1" can be processed in the opposite
// order: tests must wait for every registration before unregistering.
func sessions(h *Hub, userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID])
}

// Hub-T-1: register → IsConnected = true; unregister → IsConnected = false.
func TestHub_RegisterIsConnectedUnregister(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	c := newTestClient("user-1", hub)
	hub.register <- c
	eventually(t, func() bool { return hub.IsConnected("user-1") }, "expected user-1 to be connected after register")

	hub.unregister <- c
	eventually(t, func() bool { return !hub.IsConnected("user-1") }, "expected user-1 to be disconnected after unregister")
}

// DisconnectUser drops EVERY session of one user and leaves everybody else alone.
// This is the teardown a password reset depends on: stamping password_changed_at
// invalidates JWTs, but a socket authenticates once with a ticket at upgrade time
// and is never re-checked, so an already-open connection would otherwise keep
// delivering the victim's messages.
func TestHub_DisconnectUser(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	victim1 := newTestClient("user-victim", hub)
	victim2 := newTestClient("user-victim", hub)
	bystander := newTestClient("user-bystander", hub)

	hub.register <- victim1
	hub.register <- victim2
	hub.register <- bystander
	// DisconnectUser snapshots the sessions it finds: calling it before both
	// victim sessions are registered would only close one of them.
	eventually(t, func() bool { return sessions(hub, "user-victim") == 2 && sessions(hub, "user-bystander") == 1 },
		"expected both victim sessions and the bystander to be registered")

	hub.DisconnectUser("user-victim")
	eventually(t, func() bool { return !hub.IsConnected("user-victim") },
		"every session of the reset account must be closed, not just the newest")
	// Blast radius: revoking one account's credentials must not knock anyone else
	// off. A sweep over the whole clients map would pass the assertion above.
	if !hub.IsConnected("user-bystander") {
		t.Fatal("disconnecting one user must not touch another user's sessions")
	}
}

// DisconnectUser on someone with no sessions is a no-op, not a panic. Reachable
// on every reset by a user who simply has no app open.
func TestHub_DisconnectUser_NoSessions(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	hub.DisconnectUser("nobody-here")
	time.Sleep(20 * time.Millisecond)

	if hub.IsConnected("nobody-here") {
		t.Fatal("a user with no sessions must stay disconnected")
	}
}

// Hub-T-2: multi-device — two clients same user, both connected.
func TestHub_MultiDevice(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	c1 := newTestClient("user-multi", hub)
	c2 := newTestClient("user-multi", hub)

	hub.register <- c1
	hub.register <- c2
	eventually(t, func() bool { return sessions(hub, "user-multi") == 2 }, "expected both devices of user-multi to be registered")

	// Unregister one — user still connected (second device).
	hub.unregister <- c1
	eventually(t, func() bool { return sessions(hub, "user-multi") == 1 }, "expected one device left after unregistering the first")
	if !hub.IsConnected("user-multi") {
		t.Fatal("expected user-multi still connected after one device unregistered")
	}

	// Unregister second — now disconnected.
	hub.unregister <- c2
	eventually(t, func() bool { return !hub.IsConnected("user-multi") }, "expected user-multi disconnected after all devices unregistered")
}

// Hub-T-4: full send buffer → client is force-closed; hub unregisters it.
func TestHub_FullBuffer_ForceClose(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	// Create a client with zero-size buffer so it's always "full".
	slowClient := &Client{
		userID: "slow-user",
		hub:    hub,
		conn:   nil,
		send:   make(chan []byte, 0),
	}

	hub.register <- slowClient
	eventually(t, func() bool { return hub.IsConnected("slow-user") }, "expected slow-user to be registered")

	// SendToUser triggers the default (force-close) branch. Today it closes the
	// send channel before returning, but the test polls instead of relying on
	// that: if the close ever moves to Run's goroutine, a no-wait read would
	// become the scheduler-dependent failure this file got rid of.
	hub.SendToUser("slow-user", []byte(`{"test":"msg"}`))

	// A closed channel yields (zero, false) immediately; an open, empty one
	// would block, hence the default.
	eventually(t, func() bool {
		select {
		case _, ok := <-slowClient.send:
			return !ok
		default:
			return false
		}
	}, "send channel was not closed — force-close did not trigger")
	eventually(t, func() bool { return !hub.IsConnected("slow-user") }, "expected the force-closed client to be unregistered")
}

// Hub-T-5: Close() stops the Run goroutine without hanging.
func TestHub_Close_StopsRun(t *testing.T) {
	hub := NewHub(nil)
	done := make(chan struct{})
	go func() {
		hub.Run()
		close(done)
	}()

	hub.Close()

	select {
	case <-done:
		// OK
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Hub.Run() did not stop after Close()")
	}
}

// Badge-T-1: multiple read_receipt events within 500ms → CountUnread called exactly once.
// Uses a real 600ms sleep to let the debounce timer fire.
func TestHub_BadgeDebounce_CollapsesToOneDBCall(t *testing.T) {
	svc := &mockMsgSvc{countUnreadRet: 3}
	hub := NewHub(svc)
	go hub.Run()
	defer hub.Close()

	c := newTestClient("badge-user", hub)
	hub.register <- c
	eventually(t, func() bool { return hub.IsConnected("badge-user") }, "expected badge-user to be registered")

	// Fire 10 scheduleBadgeUpdate calls in rapid succession.
	for i := 0; i < 10; i++ {
		hub.scheduleBadgeUpdate("badge-user")
	}

	// Wait for the 500ms debounce timer to fire, instead of sleeping a fixed
	// 700ms and hoping the timer was on time.
	eventually(t, func() bool { return svc.countUnreadCalls.Load() >= 1 }, "debounce timer never fired CountUnread")

	// The badge_update is pushed right after CountUnread returns.
	select {
	case msg := <-c.send:
		if len(msg) == 0 {
			t.Fatal("expected non-empty badge_update message")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected badge_update on client send channel, but channel was empty")
	}

	// "Exactly once": give a second timer — which must not exist — a full
	// debounce window to show up. This sleep backs a NEGATIVE assertion, so
	// a slow machine can only make it stricter, never flaky.
	time.Sleep(600 * time.Millisecond)
	if calls := svc.countUnreadCalls.Load(); calls != 1 {
		t.Fatalf("expected CountUnread called exactly once, got %d", calls)
	}
}
