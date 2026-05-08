package service_test

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// mockDeviceTokenRepo implementa repository.DeviceTokenRepository para tests.
type mockDeviceTokenRepo struct {
	mu            sync.Mutex
	tokens        map[uuid.UUID][]domain.DeviceToken
	deletedTokens []string
}

func newMockDeviceTokenRepo() *mockDeviceTokenRepo {
	return &mockDeviceTokenRepo{
		tokens: make(map[uuid.UUID][]domain.DeviceToken),
	}
}

func (m *mockDeviceTokenRepo) Upsert(_ context.Context, token *domain.DeviceToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[token.UserID] = append(m.tokens[token.UserID], *token)
	return nil
}

func (m *mockDeviceTokenRepo) FindByUserID(_ context.Context, userID uuid.UUID) ([]domain.DeviceToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tokens[userID], nil
}

func (m *mockDeviceTokenRepo) DeleteByToken(_ context.Context, token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deletedTokens = append(m.deletedTokens, token)
	// También eliminamos del mapa para consistencia
	for userID, tokens := range m.tokens {
		filtered := tokens[:0]
		for _, t := range tokens {
			if t.Token != token {
				filtered = append(filtered, t)
			}
		}
		m.tokens[userID] = filtered
	}
	return nil
}

func TestNotificationService_SkipWhenFcmClientNil(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()

	ownerID := uuid.New()
	repo.tokens[ownerID] = []domain.DeviceToken{
		{UserID: ownerID, Token: "valid-token", Platform: "android"},
	}

	// fcmClient nil → ningún error, no se intenta enviar nada
	ns := service.NewNotificationService(nil, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)

	// Usamos un handler adicional para saber cuándo el evento fue procesado
	bus.Subscribe("report.created", func(_ interface{}) {
		wg.Done()
	})

	bus.Publish("report.created", event.ReportCreatedEvent{
		PetOwnerID: ownerID,
		PetName:    "Firulais",
	})

	wg.Wait()
	// Si llegamos aquí sin panic ni error, el test pasa
}

func TestNotificationService_UsuarioSinTokens(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()

	// Usuario sin tokens registrados
	ownerID := uuid.New()

	ns := service.NewNotificationService(nil, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)
	bus.Subscribe("report.created", func(_ interface{}) {
		wg.Done()
	})

	bus.Publish("report.created", event.ReportCreatedEvent{
		PetOwnerID: ownerID,
		PetName:    "Rex",
	})

	wg.Wait()
	// Sin tokens y sin fcmClient → silencioso, sin error
}
