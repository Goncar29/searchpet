package websocket

// PresenceChecker allows other services to query online status without importing Hub directly.
type PresenceChecker interface {
	IsConnected(userID string) bool
}
