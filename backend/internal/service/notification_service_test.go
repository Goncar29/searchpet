package service_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

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

// ============================================================
// mockFCMClient — implementa notification.NotificationClient
// ============================================================

type mockFCMCall struct {
	token string
	title string
	body  string
	data  map[string]string
}

type mockFCMClient struct {
	mu        sync.Mutex
	calls     []mockFCMCall
	returnErr error
	callCh    chan struct{}
}

func newMockFCMClient(bufSize int) *mockFCMClient {
	return &mockFCMClient{callCh: make(chan struct{}, bufSize)}
}

func (m *mockFCMClient) SendPush(_ context.Context, token, title, body string, data map[string]string) error {
	m.mu.Lock()
	m.calls = append(m.calls, mockFCMCall{token: token, title: title, body: body, data: data})
	err := m.returnErr
	m.mu.Unlock()
	m.callCh <- struct{}{}
	return err
}

func (m *mockFCMClient) SendToTokens(_ context.Context, _ []string, _, _ string, _ map[string]string) error {
	return nil
}

// waitCalls bloquea hasta recibir n señales de SendPush o hasta que venza el timeout.
func (m *mockFCMClient) waitCalls(n int, timeout time.Duration) bool {
	for i := 0; i < n; i++ {
		select {
		case <-m.callCh:
		case <-time.After(timeout):
			return false
		}
	}
	return true
}

func (m *mockFCMClient) getCalls() []mockFCMCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]mockFCMCall, len(m.calls))
	copy(result, m.calls)
	return result
}

// ============================================================
// Tests: onPetFound
// ============================================================

func TestNotificationService_OnPetFound_EnviaAlOwner(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	fcm := newMockFCMClient(2)

	ownerID := uuid.New()
	petID := uuid.New()
	repo.tokens[ownerID] = []domain.DeviceToken{
		{UserID: ownerID, Token: "token-android", Platform: "android"},
		{UserID: ownerID, Token: "token-ios", Platform: "ios"},
	}

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)
	bus.Subscribe("pet.found", func(_ interface{}) { wg.Done() })

	bus.Publish("pet.found", event.PetFoundEvent{
		PetID:   petID,
		OwnerID: ownerID,
		PetName: "Luna",
	})

	wg.Wait()
	if !fcm.waitCalls(2, 2*time.Second) {
		t.Fatal("timeout: esperaba 2 llamadas a SendPush")
	}

	calls := fcm.getCalls()
	if len(calls) != 2 {
		t.Fatalf("esperaba 2 llamadas a SendPush, got %d", len(calls))
	}
	for _, c := range calls {
		if c.title != "¡Tu mascota fue encontrada! 🎉" {
			t.Errorf("título incorrecto: %q", c.title)
		}
		if c.body != fmt.Sprintf("Tu mascota %s fue encontrada", "Luna") {
			t.Errorf("body incorrecto: %q", c.body)
		}
		if c.data["type"] != "pet_found" {
			t.Errorf("data.type incorrecto: %q", c.data["type"])
		}
		if c.data["entityId"] != petID.String() {
			t.Errorf("data.entityId incorrecto: %q (esperaba %q)", c.data["entityId"], petID.String())
		}
	}
}

func TestNotificationService_OnPetFound_TokenInvalido_SeElimina(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	fcm := newMockFCMClient(1)
	fcm.returnErr = fmt.Errorf("not registered")

	ownerID := uuid.New()
	repo.tokens[ownerID] = []domain.DeviceToken{
		{UserID: ownerID, Token: "stale-token", Platform: "android"},
	}

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)
	bus.Subscribe("pet.found", func(_ interface{}) { wg.Done() })

	bus.Publish("pet.found", event.PetFoundEvent{
		PetID:   uuid.New(),
		OwnerID: ownerID,
		PetName: "Max",
	})

	wg.Wait()
	if !fcm.waitCalls(1, 2*time.Second) {
		t.Fatal("timeout: esperaba 1 llamada a SendPush")
	}

	// Esperar que el goroutine llame a DeleteByToken después del SendPush
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		repo.mu.Lock()
		n := len(repo.deletedTokens)
		repo.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	repo.mu.Lock()
	deleted := repo.deletedTokens
	repo.mu.Unlock()

	if len(deleted) != 1 || deleted[0] != "stale-token" {
		t.Errorf("esperaba eliminación de 'stale-token', got: %v", deleted)
	}
}

func TestNotificationService_OnPetFound_SinTokens(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	fcm := newMockFCMClient(1)

	ownerID := uuid.New()
	// Sin tokens registrados para el owner

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)
	bus.Subscribe("pet.found", func(_ interface{}) { wg.Done() })

	bus.Publish("pet.found", event.PetFoundEvent{
		PetID:   uuid.New(),
		OwnerID: ownerID,
		PetName: "Coco",
	})

	wg.Wait()
	time.Sleep(50 * time.Millisecond) // darle tiempo a cualquier goroutine inesperado

	calls := fcm.getCalls()
	if len(calls) != 0 {
		t.Errorf("sin tokens no debe haber llamadas a SendPush, got %d", len(calls))
	}
}

func TestNotificationService_OnPetFound_PayloadInvalido(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	fcm := newMockFCMClient(1)

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	var wg sync.WaitGroup
	wg.Add(1)
	bus.Subscribe("pet.found", func(_ interface{}) { wg.Done() })

	// Payload con tipo incorrecto — debe loguearse y retornar sin crash ni push
	bus.Publish("pet.found", "payload-invalido")

	wg.Wait()
	time.Sleep(50 * time.Millisecond)

	calls := fcm.getCalls()
	if len(calls) != 0 {
		t.Errorf("payload inválido no debe enviar push, got %d llamadas", len(calls))
	}
}
