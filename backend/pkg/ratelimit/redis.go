package ratelimit

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisStore is a fixed-window rate limiter backed by Redis.
// Algorithm: INCR + EXPIRE per window slot.
// Key format: {key}:{windowSlot} where windowSlot = Unix() / window.Seconds().
// On Redis error it fails open (allows the request) so that a Redis outage
// never causes HTTP 429 responses.
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore parses redisURL, creates a client, and verifies connectivity
// with a 5-second Ping. Returns an error if the URL is malformed or if Redis
// is unreachable — the caller decides whether to fatal or fall back.
func NewRedisStore(redisURL string) (*RedisStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	return &RedisStore{client: client}, nil
}

// Allow reports whether the caller identified by key may proceed under a
// fixed-window limit of `limit` requests per `window` duration.
// If Redis is unreachable it returns true (fail-open).
func (s *RedisStore) Allow(key string, limit int, window time.Duration) bool {
	ctx := context.Background()
	windowSecs := int64(window.Seconds())
	if windowSecs == 0 {
		windowSecs = 1
	}
	slot := time.Now().Unix() / windowSecs
	redisKey := key + ":" + strconv.FormatInt(slot, 10)

	count, err := s.client.Incr(ctx, redisKey).Result()
	if err != nil {
		// Fail-open: Redis error must not cause a 429.
		return true
	}
	// Set TTL only when the key is first created to avoid resetting it.
	if count == 1 {
		s.client.Expire(ctx, redisKey, window+time.Second) //nolint:errcheck
	}
	return count <= int64(limit)
}

// Close releases the underlying Redis connection.
func (s *RedisStore) Close() error {
	return s.client.Close()
}
