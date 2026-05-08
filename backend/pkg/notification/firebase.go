package notification

import (
	"context"
	"fmt"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"google.golang.org/api/option"
)

// FirebaseClient es el wrapper sobre el Firebase Admin SDK para push notifications.
// Espeja el patrón de CloudinaryClient: struct + constructor + método de envío.
type FirebaseClient struct {
	client *messaging.Client
}

// NewFirebaseClient inicializa el cliente Firebase con las credenciales JSON.
// Si credentialsJSON está vacío o es inválido, retorna nil, nil (degradación graceful).
// Esto permite que el servidor arranque sin Firebase configurado.
func NewFirebaseClient(credentialsJSON string) (*FirebaseClient, error) {
	if strings.TrimSpace(credentialsJSON) == "" {
		return nil, nil
	}

	ctx := context.Background()
	opt := option.WithCredentialsJSON([]byte(credentialsJSON))

	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil {
		// No es un error fatal — el sistema puede funcionar sin push notifications
		return nil, nil
	}

	msgClient, err := app.Messaging(ctx)
	if err != nil {
		return nil, nil
	}

	return &FirebaseClient{client: msgClient}, nil
}

// SendPush envía una notificación push a un token FCM específico.
// Si el cliente es nil (Firebase no configurado), retorna sin error.
// Retorna el error original de FCM para que el caller pueda manejar tokens inválidos.
func (fc *FirebaseClient) SendPush(ctx context.Context, token, title, body string, data map[string]string) error {
	if fc == nil || fc.client == nil {
		return nil
	}

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
