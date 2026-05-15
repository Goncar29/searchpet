package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/pkg/notification"
)

// NotificationService escucha eventos del EventBus y despacha push notifications
// a los tokens FCM registrados de los usuarios relevantes.
type NotificationService struct {
	fcmClient       notification.NotificationClient
	deviceTokenRepo repository.DeviceTokenRepository
}

// NewNotificationService construye el NotificationService con sus dependencias.
// fcmClient implementa NotificationClient — puede ser el FirebaseClient real o el no-op.
func NewNotificationService(
	fcmClient notification.NotificationClient,
	deviceTokenRepo repository.DeviceTokenRepository,
) *NotificationService {
	return &NotificationService{
		fcmClient:       fcmClient,
		deviceTokenRepo: deviceTokenRepo,
	}
}

// RegisterListeners suscribe los handlers al EventBus.
// Debe llamarse una vez durante el arranque del servidor, después de crear el EventBus.
func (ns *NotificationService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", ns.onReportCreated)
	bus.Subscribe("message.sent", ns.onMessageSent)
	bus.Subscribe("alert.triggered", ns.onAlertTriggered)
}

// onReportCreated maneja el evento "report.created".
// Envía push al dueño de la mascota con el nombre del pet y el estado del reporte.
func (ns *NotificationService) onReportCreated(payload interface{}) {
	ev, ok := payload.(event.ReportCreatedEvent)
	if !ok {
		log.Printf("[NotificationService] onReportCreated: tipo de payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	tokens, err := ns.deviceTokenRepo.FindByUserID(ctx, ev.PetOwnerID)
	if err != nil {
		log.Printf("[NotificationService] onReportCreated: error obteniendo tokens para owner %s: %v", ev.PetOwnerID, err)
		return
	}

	if len(tokens) == 0 {
		return
	}

	title := fmt.Sprintf("Alguien vio a %s", ev.PetName)
	body := fmt.Sprintf("Se reportó un avistamiento de %s (%s)", ev.PetName, ev.Status)

	for _, t := range tokens {
		err := ns.fcmClient.SendPush(ctx, t.Token, title, body, map[string]string{
			"type":      "report.created",
			"report_id": ev.ReportID.String(),
			"pet_id":    ev.PetID.String(),
		})
		if err != nil && isStaleTokenError(err) {
			if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
				log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
			}
		}
	}
}

// onAlertTriggered maneja el evento "alert.triggered".
// Recibe los FCM tokens ya resueltos en el payload — no hace lookups a la DB.
// Envía un push a cada token indicando que hay un reporte cerca de la zona de alerta.
// Los envíos son asíncronos entre sí (goroutine por batch o individualmente).
func (ns *NotificationService) onAlertTriggered(payload interface{}) {
	ev, ok := payload.(event.AlertTriggeredEvent)
	if !ok {
		log.Printf("[NotificationService] onAlertTriggered: payload inesperado: %T", payload)
		return
	}

	if len(ev.FCMTokens) == 0 {
		return
	}

	ctx := context.Background()

	// Título y cuerpo según spec FR4.5
	title := "Reporte cerca de tu alerta"
	body := fmt.Sprintf("Se encontró una mascota %s a %.1f km de tu zona de alerta.", ev.PetType, ev.DistanceKm)

	data := map[string]string{
		"type":      "alert.triggered",
		"report_id": ev.ReportID.String(),
		"alert_id":  ev.AlertID.String(),
		"pet_id":    ev.PetID.String(),
		"pet_type":  ev.PetType,
	}

	// Fan-out: envío individual para poder limpiar tokens inválidos
	for _, token := range ev.FCMTokens {
		token := token // captura
		go func() {
			err := ns.fcmClient.SendPush(ctx, token, title, body, data)
			if err != nil {
				if isStaleTokenError(err) {
					if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, token); delErr != nil {
						log.Printf("[NotificationService] error eliminando token inválido %q: %v", token, delErr)
					}
				} else {
					log.Printf("[NotificationService] onAlertTriggered: error enviando push a %q: %v", token, err)
				}
			}
		}()
	}
}

// onMessageSent maneja el evento "message.sent".
// Envía push al receptor del mensaje con un preview del texto.
func (ns *NotificationService) onMessageSent(payload interface{}) {
	ev, ok := payload.(event.MessageSentEvent)
	if !ok {
		log.Printf("[NotificationService] onMessageSent: tipo de payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	tokens, err := ns.deviceTokenRepo.FindByUserID(ctx, ev.ReceiverID)
	if err != nil {
		log.Printf("[NotificationService] onMessageSent: error obteniendo tokens para receiver %s: %v", ev.ReceiverID, err)
		return
	}

	if len(tokens) == 0 {
		return
	}

	title := fmt.Sprintf("Nuevo mensaje de %s", ev.SenderName)
	body := ev.Preview

	for _, t := range tokens {
		err := ns.fcmClient.SendPush(ctx, t.Token, title, body, map[string]string{
			"type":       "message.sent",
			"message_id": ev.MessageID.String(),
			"sender_id":  ev.SenderID.String(),
		})
		if err != nil && isStaleTokenError(err) {
			if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
				log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
			}
		}
	}
}

// isStaleTokenError retorna true si el error de FCM indica un token inválido o expirado.
func isStaleTokenError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "registration-token-not-registered") ||
		strings.Contains(msg, "invalid-registration-token") ||
		strings.Contains(msg, "not registered")
}
