package logger

import (
	"sync"

	"go.uber.org/zap"

	"lost-pets/config"
)

var (
	instance *zap.Logger
	once     sync.Once
)

// Init initializes the logger once. Call from main() before anything else.
// Production → JSON structured logs; anything else → development console logs.
//
// The production test is config.IsProduction and NOT a local string compare:
// this used to read `environment == "production"`, which disagreed with the
// mailer's case-insensitive guard, so ENVIRONMENT=Production produced console
// logs in a deployment the mailer was treating as production.
func Init(environment string) *zap.Logger {
	once.Do(func() {
		var err error
		if config.IsProduction(environment) {
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
