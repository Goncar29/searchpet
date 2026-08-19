package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// seedMessage inserts a message directly through the repository.
func seedMessage(t *testing.T, msgRepo repository.MessageRepository, senderID, receiverID uuid.UUID, text string) *domain.Message {
	t.Helper()
	msg := &domain.Message{SenderID: senderID, ReceiverID: receiverID, Text: text}
	if err := msgRepo.Create(context.Background(), msg); err != nil {
		t.Fatalf("seedMessage: %v", err)
	}
	return msg
}

func TestMessageRepository_Create(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	sender := newTestUser(t, userRepo)
	receiver := newTestUser(t, userRepo)

	msg := &domain.Message{
		ID:         uuid.New(),
		SenderID:   sender.ID,
		ReceiverID: receiver.ID,
		Text:       "Hello from test",
	}
	if err := msgRepo.Create(ctx, msg); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := msgRepo.GetByID(ctx, msg.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Text != msg.Text {
		t.Errorf("want text %q, got %q", msg.Text, got.Text)
	}
	if got.SenderID != sender.ID {
		t.Errorf("want senderID %s, got %s", sender.ID, got.SenderID)
	}
}

func TestMessageRepository_GetConversation(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	// Exchange three messages
	msgs := []struct {
		from, to *domain.User
		text     string
	}{
		{alice, bob, "Hi Bob"},
		{bob, alice, "Hi Alice"},
		{alice, bob, "How are you?"},
	}
	for _, m := range msgs {
		msg := &domain.Message{
			ID:         uuid.New(),
			SenderID:   m.from.ID,
			ReceiverID: m.to.ID,
			Text:       m.text,
		}
		if err := msgRepo.Create(ctx, msg); err != nil {
			t.Fatalf("Create message %q: %v", m.text, err)
		}
	}

	conversation, err := msgRepo.GetConversation(ctx, alice.ID, bob.ID, 20, 0)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(conversation) != 3 {
		t.Errorf("want 3 messages in conversation, got %d", len(conversation))
	}
}

func TestMessageRepository_GetConversation_BidirectionalIsolation(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)
	carol := newTestUser(t, userRepo)

	// Alice–Bob message
	if err := msgRepo.Create(ctx, &domain.Message{ID: uuid.New(), SenderID: alice.ID, ReceiverID: bob.ID, Text: "AB"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Alice–Carol message (must NOT appear in Alice–Bob conversation)
	if err := msgRepo.Create(ctx, &domain.Message{ID: uuid.New(), SenderID: alice.ID, ReceiverID: carol.ID, Text: "AC"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	conversation, err := msgRepo.GetConversation(ctx, alice.ID, bob.ID, 20, 0)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(conversation) != 1 {
		t.Errorf("want 1 message in Alice–Bob conversation, got %d", len(conversation))
	}
	if conversation[0].Text != "AB" {
		t.Errorf("want text 'AB', got %q", conversation[0].Text)
	}
}

func TestMessageRepository_GetConversations_ExcludesHidden(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "hola de alice")
	seedMessage(t, msgRepo, bob.ID, me.ID, "hola de bob")

	// Before hiding: both conversations visible
	convs, err := msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations: %v", err)
	}
	if len(convs) != 2 {
		t.Fatalf("want 2 conversations before hide, got %d", len(convs))
	}

	// Hide the conversation with alice
	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	convs, err = msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations after hide: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("want 1 conversation after hide, got %d", len(convs))
	}
	if convs[0].SenderID != bob.ID {
		t.Errorf("want bob's conversation to remain, got sender %s", convs[0].SenderID)
	}

	// Alice still sees the conversation (hide is one-sided)
	aliceConvs, err := msgRepo.GetConversations(ctx, alice.ID)
	if err != nil {
		t.Fatalf("GetConversations for alice: %v", err)
	}
	if len(aliceConvs) != 1 {
		t.Errorf("want alice to still see 1 conversation, got %d", len(aliceConvs))
	}
}

func TestMessageRepository_CountUnread_ExcludesHidden(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "no leído de alice")
	seedMessage(t, msgRepo, bob.ID, me.ID, "no leído de bob")

	count, err := msgRepo.CountUnread(ctx, me.ID)
	if err != nil {
		t.Fatalf("CountUnread: %v", err)
	}
	if count != 2 {
		t.Fatalf("want 2 unread before hide, got %d", count)
	}

	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	count, err = msgRepo.CountUnread(ctx, me.ID)
	if err != nil {
		t.Fatalf("CountUnread after hide: %v", err)
	}
	if count != 1 {
		t.Errorf("want 1 unread after hiding alice, got %d", count)
	}
}

func TestMessageRepository_GetConversations_HiddenReappearsOnNewMessage(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, alice.ID, me.ID, "mensaje viejo")
	if err := hideRepo.Upsert(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	convs, err := msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations: %v", err)
	}
	if len(convs) != 0 {
		t.Fatalf("want 0 conversations while hidden, got %d", len(convs))
	}

	// A NEW message (strictly after hidden_at) resurfaces the conversation.
	// NOW() has microsecond resolution; guarantee ordering explicitly:
	newMsg := seedMessage(t, msgRepo, alice.ID, me.ID, "mensaje nuevo")
	gormDB.Model(&domain.Message{}).Where("id = ?", newMsg.ID).
		Update("created_at", gorm.Expr("NOW() + interval '1 second'"))

	convs, err = msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations after new message: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("want conversation to reappear, got %d", len(convs))
	}
}

func TestMessageRepository_MarkConversationUnread(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	alice := newTestUser(t, userRepo)

	m1 := seedMessage(t, msgRepo, alice.ID, me.ID, "primero")
	m2 := seedMessage(t, msgRepo, alice.ID, me.ID, "último")

	// Mark everything read first (existing behavior)
	if err := msgRepo.MarkConversationRead(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("MarkConversationRead: %v", err)
	}

	// Act: mark unread → only the LATEST received message flips back
	if err := msgRepo.MarkConversationUnread(ctx, me.ID, alice.ID); err != nil {
		t.Fatalf("MarkConversationUnread: %v", err)
	}

	reload := func(id uuid.UUID) *domain.Message {
		msg, err := msgRepo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		return msg
	}
	if reload(m1.ID).ReadAt == nil {
		t.Error("first message should STAY read")
	}
	if reload(m2.ID).ReadAt != nil {
		t.Error("latest message should be unread again")
	}

	// Idempotent no-op when there are no received messages
	stranger := newTestUser(t, userRepo)
	if err := msgRepo.MarkConversationUnread(ctx, me.ID, stranger.ID); err != nil {
		t.Errorf("MarkConversationUnread with no messages should be a no-op, got %v", err)
	}
}

// Borrar una conversación tiene que borrarla DE VERDAD para quien la borró, no
// sólo esconder su fila de la lista.
//
// EL DEFECTO QUE CIERRA, reportado por un usuario: borraba la conversación,
// desaparecía, y al volver a escribirle reaparecía CON TODO EL HISTORIAL. El
// ocultamiento sólo se aplicaba a `GetConversations` (la lista) y a
// `CountUnread`; el hilo devolvía siempre todo.
//
// Va contra Postgres real y no contra un mock a propósito: lo que se prueba es
// una cláusula SQL, y un mock de repositorio no tiene SQL que ejecutar — pasaría
// verde con el filtro puesto o sacado (regla #34).
func TestMessageRepository_GetConversation_BorrarOcultaLoAnteriorSoloParaQuienBorro(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	yo := newTestUser(t, userRepo)
	otro := newTestUser(t, userRepo)

	seedMessage(t, msgRepo, yo.ID, otro.ID, "viejo mio")
	seedMessage(t, msgRepo, otro.ID, yo.ID, "viejo suyo")

	// Borro la conversación.
	if err := hideRepo.Upsert(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	mios, err := msgRepo.GetConversation(ctx, yo.ID, otro.ID, 50, 0)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(mios) != 0 {
		t.Errorf("tras borrar, el hilo tiene que estar vacío para mí; vinieron %d mensajes", len(mios))
	}

	// La contraparte NO pierde nada: su consulta pasa userA = ella, y no tiene
	// fila en conversation_hides. Si esto fallara, borrar le estaría borrando
	// mensajes a otra persona.
	suyos, err := msgRepo.GetConversation(ctx, otro.ID, yo.ID, 50, 0)
	if err != nil {
		t.Fatalf("GetConversation (contraparte): %v", err)
	}
	if len(suyos) != 2 {
		t.Errorf("la contraparte tiene que conservar los 2 mensajes, tiene %d", len(suyos))
	}

	// Vuelvo a escribirle: la conversación reaparece, pero EMPIEZA VACÍA — lo
	// anterior al borrado no vuelve nunca.
	seedMessage(t, msgRepo, yo.ID, otro.ID, "nuevo despues de borrar")

	tras, err := msgRepo.GetConversation(ctx, yo.ID, otro.ID, 50, 0)
	if err != nil {
		t.Fatalf("GetConversation (tras reabrir): %v", err)
	}
	if len(tras) != 1 {
		t.Fatalf("al reabrir tengo que ver SOLO el mensaje nuevo, veo %d", len(tras))
	}
	if tras[0].Text != "nuevo despues de borrar" {
		t.Errorf("el único mensaje visible tiene que ser el nuevo, es %q", tras[0].Text)
	}

	// Y la contraparte ahora ve los tres.
	suyos, err = msgRepo.GetConversation(ctx, otro.ID, yo.ID, 50, 0)
	if err != nil {
		t.Fatalf("GetConversation (contraparte, tras reabrir): %v", err)
	}
	if len(suyos) != 3 {
		t.Errorf("la contraparte tiene que ver los 3, ve %d", len(suyos))
	}
}

// Abrir una conversación borrada no puede marcar leído lo que quien borró NO
// puede ver.
//
// EL DEFECTO QUE CIERRA, y lo introdujo el propio filtro del hilo: `GetConversation`
// llama a `MarkConversationRead` en CADA apertura, así que se cambió qué se
// devuelve sin cambiar qué se marca. El resultado era un acuse de lectura hacia
// la contraparte por mensajes que el lector tiene invisibles para siempre — una
// señal de entrega falsa, y encima hacia la única persona que no eligió borrar.
//
// Va contra Postgres real por lo mismo que el test de arriba: lo que se prueba es
// una cláusula SQL, y un mock de repositorio no tiene SQL que ejecutar.
func TestMessageRepository_MarkConversationRead_NoMarcaLoQueElLectorNoVe(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	msgRepo := repository.NewMessageRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	yo := newTestUser(t, userRepo)
	otro := newTestUser(t, userRepo)

	viejo := seedMessage(t, msgRepo, otro.ID, yo.ID, "algo incomodo de antes")

	// Borro la conversación: `viejo` queda invisible para mí, para siempre.
	if err := hideRepo.Upsert(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	// El otro me vuelve a escribir y abro el hilo.
	nuevo := seedMessage(t, msgRepo, otro.ID, yo.ID, "hola de nuevo")
	if err := msgRepo.MarkConversationRead(ctx, yo.ID, otro.ID); err != nil {
		t.Fatalf("MarkConversationRead: %v", err)
	}

	traer := func(id uuid.UUID) *domain.Message {
		t.Helper()
		m, err := msgRepo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		return m
	}

	if traer(viejo.ID).ReadAt != nil {
		t.Error("el mensaje anterior al borrado NO puede quedar marcado como leído: yo no puedo verlo")
	}
	if traer(nuevo.ID).ReadAt == nil {
		t.Error("el mensaje posterior al borrado sí tiene que marcarse leído: ese lo veo")
	}
}
