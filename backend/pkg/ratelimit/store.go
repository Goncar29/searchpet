package ratelimit

import "time"

// Store defines the contract for rate limit backends.
// All implementations must be safe for concurrent use.
type Store interface {
	// Allow reports whether the caller identified by key may proceed.
	// limit is the maximum number of requests allowed per window duration.
	// Returns true to allow the request, false to reject it.
	Allow(key string, limit int, window time.Duration) bool
}
