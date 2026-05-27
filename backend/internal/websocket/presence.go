package websocket

// PresenceChecker allows other services to query online status without importing Hub directly.
type PresenceChecker interface {
	IsConnected(userID string) bool
}

// Pusher allows other services to push WebSocket envelopes to connected users
// without importing Hub directly. Hub implements this interface.
type Pusher interface {
	SendToUser(userID string, msg []byte)
}
