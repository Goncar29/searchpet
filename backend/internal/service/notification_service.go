package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/websocket"
	"lost-pets/pkg/notification"
)

// NotificationService escucha eventos del EventBus y despacha push notifications
// a los tokens FCM registrados de los usuarios relevantes.
type NotificationService struct {
	fcmClient       notification.NotificationClient
	deviceTokenRepo repository.DeviceTokenRepository
	presence        websocket.PresenceChecker // optional — nil means always send FCM
	pusher          websocket.Pusher          // optional — push chat_message to online receivers
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

// SetPresence wires a PresenceChecker so that FCM pushes are skipped for online users.
// Call once after Hub is created in main.go. Safe to call from any goroutine before traffic starts.
func (ns *NotificationService) SetPresence(p websocket.PresenceChecker) {
	ns.presence = p
}

// SetPusher wires a Pusher so that chat messages are delivered to online receivers via WebSocket.
// Call once after Hub is created in main.go, alongside SetPresence.
func (ns *NotificationService) SetPusher(p websocket.Pusher) {
	ns.pusher = p
}

// RegisterListeners suscribe los handlers al EventBus.
// Debe llamarse una vez durante el arranque del servidor, después de crear el EventBus.
func (ns *NotificationService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", ns.onReportCreated)
	bus.Subscribe("message.sent", ns.onMessageSent)
	bus.Subscribe("alert.triggered", ns.onAlertTriggered)
	bus.Subscribe("pet.found", ns.onPetFound)
	bus.Subscribe("shelter.approved", ns.onShelterApproved)
	bus.Subscribe("shelter.rejected", ns.onShelterRejected)
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
			"entityId":  ev.PetID.String(),
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
		"entityId":  ev.PetID.String(),
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
// Si el receptor tiene una conexión WebSocket activa (presence.IsConnected), se omite el FCM.
func (ns *NotificationService) onMessageSent(payload interface{}) {
	ev, ok := payload.(event.MessageSentEvent)
	if !ok {
		log.Printf("[NotificationService] onMessageSent: tipo de payload inesperado: %T", payload)
		return
	}

	// REQ-4: if receiver is online, deliver via WS and skip FCM.
	if ns.presence != nil && ns.presence.IsConnected(ev.ReceiverID.String()) {
		if ns.pusher != nil {
			ns.pushChatMessage(ev)
		}
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
			"entityId":   ev.SenderID.String(),
		})
		if err != nil && isStaleTokenError(err) {
			if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
				log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
			}
		}
	}
}

// onPetFound maneja el evento "pet.found".
// Envía push al dueño de la mascota notificándole que su mascota fue encontrada.
// Los envíos son asíncronos (goroutine fan-out) para no bloquear el EventBus.
func (ns *NotificationService) onPetFound(payload interface{}) {
	ev, ok := payload.(event.PetFoundEvent)
	if !ok {
		log.Printf("[NotificationService] onPetFound: tipo de payload inesperado: %T", payload)
		return
	}

	ctx := context.Background()

	tokens, err := ns.deviceTokenRepo.FindByUserID(ctx, ev.OwnerID)
	if err != nil {
		log.Printf("[NotificationService] onPetFound: error obteniendo tokens para owner %s: %v", ev.OwnerID, err)
		return
	}

	if len(tokens) == 0 {
		return
	}

	title := "¡Tu mascota fue encontrada! 🎉"
	body := fmt.Sprintf("Tu mascota %s fue encontrada", ev.PetName)

	data := map[string]string{
		"type":     "pet_found",
		"entityId": ev.PetID.String(),
	}

	// Fan-out: envío individual para poder limpiar tokens inválidos
	for _, t := range tokens {
		t := t // captura
		go func() {
			err := ns.fcmClient.SendPush(ctx, t.Token, title, body, data)
			if err != nil {
				if isStaleTokenError(err) {
					if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
						log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
					}
				} else {
					log.Printf("[NotificationService] onPetFound: error enviando push a %q: %v", t.Token, err)
				}
			}
		}()
	}
}

// onShelterApproved maneja "shelter.approved": push al dueño del refugio.
// Mismo patrón fan-out que onPetFound (goroutine por token + limpieza de stale).
func (ns *NotificationService) onShelterApproved(payload interface{}) {
	ev, ok := payload.(event.ShelterApprovedEvent)
	if !ok {
		log.Printf("[NotificationService] onShelterApproved: tipo de payload inesperado: %T", payload)
		return
	}
	title := "¡Tu refugio fue aprobado! 🎉"
	body := fmt.Sprintf("%s ya aparece en el directorio de refugios", ev.ShelterName)
	ns.pushToUser(ev.OwnerUserID, title, body, map[string]string{
		"type":       "shelter.approved",
		"shelter_id": ev.ShelterID.String(),
		"entityId":   ev.ShelterID.String(),
	})
}

// onShelterRejected maneja "shelter.rejected": push al dueño con el motivo.
func (ns *NotificationService) onShelterRejected(payload interface{}) {
	ev, ok := payload.(event.ShelterRejectedEvent)
	if !ok {
		log.Printf("[NotificationService] onShelterRejected: tipo de payload inesperado: %T", payload)
		return
	}
	title := fmt.Sprintf("Tu refugio %s necesita cambios", ev.ShelterName)
	body := fmt.Sprintf("Motivo: %s. Corregí los datos y reenvialo desde la app.", ev.Reason)
	ns.pushToUser(ev.OwnerUserID, title, body, map[string]string{
		"type":       "shelter.rejected",
		"shelter_id": ev.ShelterID.String(),
		"entityId":   ev.ShelterID.String(),
	})
}

// pushToUser resuelve los tokens del usuario y hace el fan-out con limpieza de
// tokens inválidos — el cuerpo común de onShelterApproved/onShelterRejected.
func (ns *NotificationService) pushToUser(userID uuid.UUID, title, body string, data map[string]string) {
	ctx := context.Background()

	tokens, err := ns.deviceTokenRepo.FindByUserID(ctx, userID)
	if err != nil {
		log.Printf("[NotificationService] pushToUser: error obteniendo tokens para %s: %v", userID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}

	for _, t := range tokens {
		t := t // captura
		go func() {
			err := ns.fcmClient.SendPush(ctx, t.Token, title, body, data)
			if err != nil {
				if isStaleTokenError(err) {
					if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
						log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
					}
				} else {
					log.Printf("[NotificationService] pushToUser: error enviando push a %q: %v", t.Token, err)
				}
			}
		}()
	}
}

// pushChatMessage builds a WebSocket chat_message envelope and delivers it to the receiver.
// Only called when the receiver is online (PresenceChecker returned true).
func (ns *NotificationService) pushChatMessage(ev event.MessageSentEvent) {
	chatMsg := websocket.ChatMessage{
		ID:        ev.MessageID.String(),
		From:      ev.SenderID.String(),
		To:        ev.ReceiverID.String(),
		Body:      ev.Body,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	payloadBytes, err := json.Marshal(chatMsg)
	if err != nil {
		log.Printf("[NotificationService] pushChatMessage: marshal error: %v", err)
		return
	}
	env := websocket.Envelope{
		Type:    websocket.TypeChatMessage,
		Payload: json.RawMessage(payloadBytes),
	}
	envBytes, err := json.Marshal(env)
	if err != nil {
		log.Printf("[NotificationService] pushChatMessage: marshal envelope error: %v", err)
		return
	}
	ns.pusher.SendToUser(ev.ReceiverID.String(), envBytes)
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
