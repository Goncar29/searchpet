package logger

import (
	"sync"

	"go.uber.org/zap"
)

var (
	instance *zap.Logger
	once     sync.Once
)

// Init initializes the logger once. Call from main() before anything else.
// environment: "production" → JSON structured logs; anything else → development console logs.
func Init(environment string) *zap.Logger {
	once.Do(func() {
		var err error
		if environment == "production" {
			instance, err = zap.NewProduction()
		} else {
			instance, err = zap.NewDevelopment()
		}
		if err != nil {
			// fallback: nop logger (never panic in init)
			instance = zap.NewNop()
		}
	})
	return instance
}

// Get returns the initialized logger. If Init was never called, returns a nop logger.
func Get() *zap.Logger {
	if instance != nil {
		return instance
	}
	return zap.NewNop()
}
