package tests

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"lost-pets/pkg/ratelimit"
)

// setupMiniredis starts an in-process Redis server and returns both the
// miniredis handle (for time manipulation) and a connected RedisStore.
// The store is closed automatically when the test ends.
func setupMiniredis(t *testing.T) (*miniredis.Miniredis, *ratelimit.RedisStore) {
	t.Helper()
	mr := miniredis.RunT(t)
	store, err := ratelimit.NewRedisStore("redis://" + mr.Addr())
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}
	t.Cleanup(func() { store.Close() }) //nolint:errcheck
	return mr, store
}

// TestRedisStore_BurstExceeded verifies that after exhausting the limit, the
// next request is rejected (returns false).
func TestRedisStore_BurstExceeded(t *testing.T) {
	_, store := setupMiniredis(t)
	limit, window := 3, 1*time.Minute

	for i := 0; i < limit; i++ {
		if !store.Allow("ip:10.0.0.1", limit, window) {
			t.Fatalf("request %d should be allowed (within limit)", i+1)
		}
	}

	if store.Allow("ip:10.0.0.1", limit, window) {
		t.Error("request beyond limit should be rejected (false), but Allow returned true")
	}
}

// TestRedisStore_DifferentKeys verifies that two distinct keys have independent
// counters — exhausting one does not affect the other.
func TestRedisStore_DifferentKeys(t *testing.T) {
	_, store := setupMiniredis(t)
	limit, window := 1, 1*time.Minute

	// Key A: first request allowed, second rejected.
	if !store.Allow("ip:A", limit, window) {
		t.Error("IP A first request should be allowed")
	}
	if store.Allow("ip:A", limit, window) {
		t.Error("IP A second request should be rejected")
	}

	// Key B is independent: first request must be allowed.
	if !store.Allow("ip:B", limit, window) {
		t.Error("IP B should be allowed (independent counter)")
	}
}

// TestRedisStore_WindowExpiry verifies that after the window expires, the key
// counter resets and requests are allowed again.
func TestRedisStore_WindowExpiry(t *testing.T) {
	mr, store := setupMiniredis(t)
	limit, window := 1, 1*time.Minute

	if !store.Allow("ip:X", limit, window) {
		t.Fatal("first request should be allowed")
	}
	if store.Allow("ip:X", limit, window) {
		t.Fatal("second request should be rejected (limit exhausted)")
	}

	// Fast-forward the miniredis clock past the window so the key expires.
	mr.FastForward(window + time.Second)

	if !store.Allow("ip:X", limit, window) {
		t.Error("request after window expiry should be allowed (counter reset)")
	}
}

// TestRedisStore_FailOpen verifies that when Redis is unreachable, Allow
// returns true (fail-open) and does not panic.
func TestRedisStore_FailOpen(t *testing.T) {
	mr, store := setupMiniredis(t)

	// Stop the in-process Redis server to simulate an outage.
	mr.Close()

	// Allow must return true (fail-open) even when Redis is down.
	if !store.Allow("ip:Y", 5, 1*time.Minute) {
		t.Error("Allow should return true (fail-open) when Redis is unreachable")
	}
}
