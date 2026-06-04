package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipEntry holds a rate limiter and the last time it was used.
type ipEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// InMemoryStore is a per-key token-bucket rate limiter backed by an in-memory
// map. It is safe for concurrent use. A single background goroutine evicts
// entries that have not been seen for more than 3 minutes.
type InMemoryStore struct {
	mu       sync.Mutex
	limiters map[string]*ipEntry
}

// NewInMemoryStore creates an InMemoryStore and starts its eviction goroutine.
// The goroutine runs for the lifetime of the process — call this once at
// startup, not per-request.
func NewInMemoryStore() *InMemoryStore {
	s := &InMemoryStore{
		limiters: make(map[string]*ipEntry),
	}
	go s.cleanup()
	return s
}

// Allow reports whether key is within the rate limit.
// limit and window are mapped to a token-bucket: rps = limit/window.Seconds(),
// burst = limit.
func (s *InMemoryStore) Allow(key string, limit int, window time.Duration) bool {
	rps := rate.Limit(float64(limit) / window.Seconds())

	s.mu.Lock()
	entry, exists := s.limiters[key]
	if !exists {
		entry = &ipEntry{
			limiter: rate.NewLimiter(rps, limit),
		}
		s.limiters[key] = entry
	}
	entry.lastSeen = time.Now()
	lim := entry.limiter
	s.mu.Unlock()

	return lim.Allow()
}

// cleanup runs every 5 minutes and removes entries not seen in the last
// 3 minutes, preventing unbounded memory growth under sustained traffic.
func (s *InMemoryStore) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		cutoff := time.Now().Add(-3 * time.Minute)
		for key, entry := range s.limiters {
			if entry.lastSeen.Before(cutoff) {
				delete(s.limiters, key)
			}
		}
		s.mu.Unlock()
	}
}
