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

// Hub-T-1: register → IsConnected = true; unregister → IsConnected = false.
func TestHub_RegisterIsConnectedUnregister(t *testing.T) {
	hub := NewHub(nil)
	go hub.Run()
	defer hub.Close()

	c := newTestClient("user-1", hub)
	hub.register <- c
	time.Sleep(20 * time.Millisecond)

	if !hub.IsConnected("user-1") {
		t.Fatal("expected user-1 to be connected after register")
	}

	hub.unregister <- c
	time.Sleep(20 * time.Millisecond)

	if hub.IsConnected("user-1") {
		t.Fatal("expected user-1 to be disconnected after unregister")
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
	time.Sleep(20 * time.Millisecond)

	if !hub.IsConnected("user-multi") {
		t.Fatal("expected user-multi to be connected")
	}

	// Unregister one — user still connected (second device).
	hub.unregister <- c1
	time.Sleep(20 * time.Millisecond)

	if !hub.IsConnected("user-multi") {
		t.Fatal("expected user-multi still connected after one device unregistered")
	}

	// Unregister second — now disconnected.
	hub.unregister <- c2
	time.Sleep(20 * time.Millisecond)

	if hub.IsConnected("user-multi") {
		t.Fatal("expected user-multi disconnected after all devices unregistered")
	}
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
	time.Sleep(20 * time.Millisecond)

	// SendToUser triggers the default (force-close) branch.
	hub.SendToUser("slow-user", []byte(`{"test":"msg"}`))
	time.Sleep(50 * time.Millisecond)

	// After force-close, the send channel is closed.
	// Reading from a closed channel returns zero value immediately.
	select {
	case _, ok := <-slowClient.send:
		if ok {
			t.Fatal("expected send channel to be closed after force-close")
		}
	default:
		// Channel not yet closed or hub already processed it — give more time.
		time.Sleep(50 * time.Millisecond)
		select {
		case _, ok := <-slowClient.send:
			if ok {
				t.Fatal("expected send channel to be closed after force-close (retry)")
			}
		default:
			t.Fatal("send channel was not closed — force-close did not trigger")
		}
	}
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
	time.Sleep(20 * time.Millisecond)

	// Fire 10 scheduleBadgeUpdate calls in rapid succession.
	for i := 0; i < 10; i++ {
		hub.scheduleBadgeUpdate("badge-user")
	}

	// Wait for the 500ms debounce timer to fire.
	time.Sleep(700 * time.Millisecond)

	calls := svc.countUnreadCalls.Load()
	if calls != 1 {
		t.Fatalf("expected CountUnread called exactly once, got %d", calls)
	}

	// Verify badge_update was pushed to the client's send channel.
	select {
	case msg := <-c.send:
		if len(msg) == 0 {
			t.Fatal("expected non-empty badge_update message")
		}
	default:
		t.Fatal("expected badge_update on client send channel, but channel was empty")
	}
}
