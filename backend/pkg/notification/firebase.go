package notification

import (
	"context"
	"fmt"
	"log"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/option"
)

// NotificationClient es el contrato para enviar push notifications.
// La implementación concreta usa Firebase FCM; el no-op se usa cuando
// FIREBASE_KEY no está configurado.
type NotificationClient interface {
	// SendPush envía una notificación push a un token FCM específico.
	// Retorna nil si el cliente no está configurado (degradación graceful).
	SendPush(ctx context.Context, token, title, body string, data map[string]string) error
	// SendToTokens envía la misma notificación a múltiples tokens FCM en paralelo.
	// Retorna el primer error encontrado, o nil si todos los envíos tuvieron éxito.
	SendToTokens(ctx context.Context, tokens []string, title, body string, data map[string]string) error
}

// ── no-op implementation ─────────────────────────────────────────────────────

// noopNotificationClient se retorna cuando Firebase no está configurado.
// Implementa NotificationClient sin hacer nada — el servidor arranca normalmente.
type noopNotificationClient struct{}

func (n *noopNotificationClient) SendPush(_ context.Context, token, title, _ string, _ map[string]string) error {
	log.Printf("[FCM no-op] SendPush omitido (Firebase no configurado) — token=%q title=%q", token, title)
	return nil
}

func (n *noopNotificationClient) SendToTokens(_ context.Context, tokens []string, title, _ string, _ map[string]string) error {
	log.Printf("[FCM no-op] SendToTokens omitido (Firebase no configurado) — tokens=%d title=%q", len(tokens), title)
	return nil
}

// ── real Firebase implementation ─────────────────────────────────────────────

// FirebaseClient es el wrapper sobre el Firebase Admin SDK para push notifications.
// Espeja el patrón de CloudinaryClient: struct + constructor + método de envío.
type FirebaseClient struct {
	client *messaging.Client
}

// NewFirebaseClient inicializa el cliente Firebase con las credenciales JSON.
// Si credentialsJSON está vacío, retorna un no-op NotificationClient (degradación graceful).
// Esto permite que el servidor arranque y funcione normalmente sin FCM configurado.
func NewFirebaseClient(credentialsJSON string) (NotificationClient, error) {
	if strings.TrimSpace(credentialsJSON) == "" {
		log.Println("[FCM] FIREBASE_KEY no configurado — usando no-op client")
		return &noopNotificationClient{}, nil
	}

	ctx := context.Background()
	opt := option.WithCredentialsJSON([]byte(credentialsJSON))

	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil {
		log.Printf("[FCM] Error inicializando Firebase app: %v — usando no-op client", err)
		return &noopNotificationClient{}, nil
	}

	msgClient, err := app.Messaging(ctx)
	if err != nil {
		log.Printf("[FCM] Error obteniendo messaging client: %v — usando no-op client", err)
		return &noopNotificationClient{}, nil
	}

	return &FirebaseClient{client: msgClient}, nil
}

// SendPush envía una notificación push a un token FCM específico.
// Retorna el error original de FCM para que el caller pueda detectar tokens inválidos.
func (fc *FirebaseClient) SendPush(ctx context.Context, token, title, body string, data map[string]string) error {
	msg := &messaging.Message{
		Token: token,
		Notification: &messaging.Notification{
			Title: title,
			Body:  body,
		},
		Data: data,
	}

	_, err := fc.client.Send(ctx, msg)
	if err != nil {
		return fmt.Errorf("fcm send error: %w", err)
	}

	return nil
}

// SendToTokens envía la misma notificación a múltiples tokens FCM.
// Usa SendEachForMulticast para batch efficiency.
// Retorna el primer error de envío individual, o nil si todos fueron exitosos.
func (fc *FirebaseClient) SendToTokens(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	if len(tokens) == 0 {
		return nil
	}

	msg := &messaging.MulticastMessage{
		Tokens: tokens,
		Notification: &messaging.Notification{
			Title: title,
			Body:  body,
		},
		Data: data,
	}

	resp, err := fc.client.SendEachForMulticast(ctx, msg)
	if err != nil {
		return fmt.Errorf("fcm multicast error: %w", err)
	}

	// Reportar tokens inválidos (el caller puede decidir si limpiarlos)
	if resp.FailureCount > 0 {
		for i, res := range resp.Responses {
			if res.Error != nil {
				log.Printf("[FCM] SendToTokens: token[%d] error: %v", i, res.Error)
			}
		}
		return fmt.Errorf("fcm multicast: %d de %d envíos fallaron", resp.FailureCount, len(tokens))
	}

	return nil
}
