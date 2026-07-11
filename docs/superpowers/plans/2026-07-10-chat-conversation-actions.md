# Chat Conversation Actions (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation-level actions to the web chat: delete (hide-for-me), block/unblock, report user, view profile, and mark-as-unread.

**Architecture:** New `conversation_hides` table records per-user hides; `GetConversations`/`CountUnread` exclude conversations whose latest message predates `hidden_at` (new messages resurface them). Two new endpoints under `/api/conversations/:userId`. Web gets a reusable actions menu used by a new `ChatPage` header and by `MessagesPage` rows. Block/report/profile reuse existing endpoints.

**Tech Stack:** Go 1.25 + Gin + GORM (backend), React + Vite + React Query + Tailwind (web), shared hooks/API client in `frontend/packages/shared`.

**Spec:** `docs/superpowers/specs/2026-07-10-chat-conversation-actions-design.md`

**Branch:** `feat/chat-conversation-actions` (already created; spec committed).

**Environment notes:**
- Backend integration tests use `testdb.SetupTestDB(t)` (package `lost-pets/tests/testdb`), which AutoMigrates from `database.Models`. Run them from `backend/`: `go test ./tests/ -run <Name> -v`. GOTCHA: if `DATABASE_URL` points at the local dev DB (port **5433** on host), `go test` wipes the seed — re-run the seeder afterwards if you use the dev DB manually.
- Web unit tests: run from `frontend/packages/web/`: `pnpm vitest run <file>`.
- The key facts below were verified against the code on 2026-07-10. If a snippet does not match the file when you open it, STOP and re-verify before editing.

**Verified key facts (do not re-derive):**
- Unread = `messages.read_at IS NULL` (`ReadAt *time.Time`). The DTO derives `is_read`.
- `database.Models` in `backend/pkg/database/postgres.go` is the single source of truth for AutoMigrate (prod AND testdb).
- Existing route params: `GET /api/messages/:userId`, `PATCH /api/messages/:id/read`. New endpoints go under `/api/conversations/:userId` to avoid Gin wildcard-name conflicts.
- Handler helpers: `getUserID(c) string`, `getUserUUID(c) uuid.UUID`, `writeError(c, status, err)`.
- Shared hooks: `useBlockStatus(userId)` → `{isBlocked, isLoading}` (bidirectional), `useBlockUser`, `useUnblockUser`, `useBlockedUsers` (my blocks; `BlockedUser {id, blocked_id, name, blocked_at}`), `usePublicProfile(userID)` (key `['profile', userID]`), `useUnreadCount` (key `['messages', 'unread-count']`).
- API client: `blockUser`, `unblockUser`, `getBlockedUsers`, `submitAbuseReport(data)`, `getPublicProfile(userID)`.
- i18n: `chat` and `messages` namespaces live in the SHARED locales `frontend/packages/shared/i18n/locales/{es,en,pt}.json` (single file per language, namespaces as top-level keys). Web registers them in `web/src/i18n/index.ts` — already registered, no registration change needed.
- Web profile route: `/users/:id` (`UserProfilePage`). Chat route: `/messages/:userId`.

---

### Task 1: `ConversationHide` domain model + AutoMigrate

**Files:**
- Modify: `backend/internal/domain/models.go` (add struct right after the `Message` struct, ~line 154)
- Modify: `backend/pkg/database/postgres.go` (add to `Models` slice, ~line 146)

- [ ] **Step 1: Add the domain struct**

In `backend/internal/domain/models.go`, immediately after the `Message` struct:

```go
// ConversationHide registra que un usuario ocultó su conversación con otro
// usuario ("borrar conversación" estilo WhatsApp: solo desaparece para quien
// la borra). Los mensajes NUNCA se borran — un mensaje nuevo posterior a
// HiddenAt hace reaparecer la conversación.
type ConversationHide struct {
	UserID      uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	OtherUserID uuid.UUID `gorm:"type:uuid;primaryKey" json:"other_user_id"`
	HiddenAt    time.Time `gorm:"not null;default:now()" json:"hidden_at"`
}
```

- [ ] **Step 2: Register in AutoMigrate**

In `backend/pkg/database/postgres.go`, append to the `Models` slice (after `&domain.AdminAuditLog{}`):

```go
	&domain.ConversationHide{},
```

- [ ] **Step 3: Build**

Run: `cd backend && go build ./...`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/domain/models.go backend/pkg/database/postgres.go
git commit -m "feat(messages): ConversationHide domain model + automigrate"
```

---

### Task 2: `ConversationHideRepository` with upsert

**Files:**
- Modify: `backend/internal/repository/interfaces.go` (add interface after `MessageRepository`, ~line 82)
- Create: `backend/internal/repository/conversation_hide_repository.go`
- Modify: `backend/tests/testdb/setup.go` (add `"conversation_hides"` to `allTableNames`, BEFORE `"users"` — children first; put it next to `"messages"`)
- Test: `backend/tests/conversation_hide_repository_test.go`

Integration tests skip gracefully when `DATABASE_URL` is unset. To actually run them locally: `DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run <Name> -v` (host port 5433 per docker-compose; create the `lostpets_test` database first if missing). A skipped test does NOT count as the TDD red/green cycle — if the DB is unavailable, report it instead of treating skips as passes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/conversation_hide_repository_test.go`:

```go
package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestConversationHideRepository_UpsertCreatesAndRefreshes(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)

	// First hide creates the row
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("first Upsert: %v", err)
	}

	var hide domain.ConversationHide
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found: %v", err)
	}
	firstHiddenAt := hide.HiddenAt

	// Second hide refreshes hidden_at instead of failing on the PK
	time.Sleep(50 * time.Millisecond)
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("second Upsert: %v", err)
	}
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found after re-hide: %v", err)
	}
	if !hide.HiddenAt.After(firstHiddenAt) {
		t.Errorf("want hidden_at refreshed: first=%v second=%v", firstHiddenAt, hide.HiddenAt)
	}

	// Only one row exists for the pair
	var count int64
	gormDB.Model(&domain.ConversationHide{}).
		Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).Count(&count)
	if count != 1 {
		t.Errorf("want 1 hide row, got %d", count)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestConversationHideRepository -v`
Expected: FAIL (compile error: `NewConversationHideRepository` undefined).

- [ ] **Step 3: Add the interface**

In `backend/internal/repository/interfaces.go`, right after the `MessageRepository` interface:

```go
// ConversationHideRepository define el contrato para ocultamientos de conversación.
type ConversationHideRepository interface {
	// Upsert crea el ocultamiento (userID oculta su conversación con otherUserID)
	// o refresca hidden_at si ya existía.
	Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error
}
```

- [ ] **Step 4: Implement the repository**

Create `backend/internal/repository/conversation_hide_repository.go`:

```go
package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type postgresConversationHideRepository struct {
	db *gorm.DB
}

// NewConversationHideRepository construye un ConversationHideRepository respaldado por PostgreSQL.
func NewConversationHideRepository(db *gorm.DB) ConversationHideRepository {
	return &postgresConversationHideRepository{db: db}
}

// Upsert crea u actualiza el ocultamiento del par (userID, otherUserID).
// ON CONFLICT sobre la PK compuesta refresca hidden_at — re-ocultar siempre funciona.
func (r *postgresConversationHideRepository) Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error {
	return r.db.WithContext(ctx).Exec(
		`INSERT INTO conversation_hides (user_id, other_user_id, hidden_at)
		 VALUES (?, ?, NOW())
		 ON CONFLICT (user_id, other_user_id) DO UPDATE SET hidden_at = NOW()`,
		userID, otherUserID,
	).Error
}

// Verificación estática: postgresConversationHideRepository satisface ConversationHideRepository.
var _ ConversationHideRepository = (*postgresConversationHideRepository)(nil)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestConversationHideRepository -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/conversation_hide_repository.go backend/tests/conversation_hide_repository_test.go
git commit -m "feat(messages): conversation hide repository with upsert"
```

---

### Task 3: `GetConversations` excludes hidden conversations (and they reappear)

**Files:**
- Modify: `backend/internal/repository/message_repository.go:61-87` (`GetConversations`)
- Test: `backend/tests/message_repository_test.go` (create — no repo-level message tests exist today)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/message_repository_test.go`:

```go
package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
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
	// (add `"gorm.io/gorm"` to this file's imports for gorm.Expr)

	convs, err = msgRepo.GetConversations(ctx, me.ID)
	if err != nil {
		t.Fatalf("GetConversations after new message: %v", err)
	}
	if len(convs) != 1 {
		t.Fatalf("want conversation to reappear, got %d", len(convs))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run TestMessageRepository_GetConversations -v`
Expected: `ExcludesHidden` FAILS at "want 1 conversation after hide, got 2" (hides not filtered yet). `HiddenReappearsOnNewMessage` FAILS at "want 0 conversations while hidden".

- [ ] **Step 3: Update the query**

In `backend/internal/repository/message_repository.go`, replace the raw SQL inside `GetConversations` (keep the surrounding function) with:

```go
	// DISTINCT ON selecciona el mensaje más reciente por conversación; el NOT EXISTS
	// excluye conversaciones que el usuario ocultó DESPUÉS de ese último mensaje.
	// Un mensaje nuevo (created_at > hidden_at) hace reaparecer la conversación.
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).Raw(
		`SELECT id FROM (
			SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
			       id, created_at,
			       CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id
			FROM messages
			WHERE sender_id = ? OR receiver_id = ?
			ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
		) latest
		WHERE NOT EXISTS (
			SELECT 1 FROM conversation_hides ch
			WHERE ch.user_id = ? AND ch.other_user_id = latest.other_id
			  AND ch.hidden_at >= latest.created_at
		)`,
		userID, userID, userID, userID,
	).Scan(&ids).Error
```

The rest of the function (empty check, `Preload` + `WHERE id IN` reload) stays identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./tests/ -run TestMessageRepository_GetConversations -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/repository/message_repository.go backend/tests/message_repository_test.go
git commit -m "feat(messages): exclude hidden conversations from GetConversations"
```

---

### Task 4: `CountUnread` excludes hidden conversations

**Files:**
- Modify: `backend/internal/repository/message_repository.go:122-129` (`CountUnread`)
- Test: `backend/tests/message_repository_test.go` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/message_repository_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestMessageRepository_CountUnread -v`
Expected: FAIL with "want 1 unread after hiding alice, got 2".

- [ ] **Step 3: Update `CountUnread`**

Replace the body of `CountUnread` in `backend/internal/repository/message_repository.go`:

```go
// CountUnread retorna la cantidad de mensajes recibidos por userID que aún no fueron
// leídos, excluyendo los de conversaciones ocultas (el badge no debe contar lo que
// el usuario no puede ver). Un mensaje posterior a hidden_at vuelve a contar.
func (r *postgresMessageRepository) CountUnread(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM messages m
		 WHERE m.receiver_id = ? AND m.read_at IS NULL
		 AND NOT EXISTS (
			SELECT 1 FROM conversation_hides ch
			WHERE ch.user_id = ? AND ch.other_user_id = m.sender_id
			  AND ch.hidden_at >= m.created_at
		 )`,
		userID, userID,
	).Scan(&count).Error
	return count, err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestMessageRepository_CountUnread -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/repository/message_repository.go backend/tests/message_repository_test.go
git commit -m "feat(messages): exclude hidden conversations from unread count"
```

---

### Task 5: `MarkConversationUnread` repository method

**Files:**
- Modify: `backend/internal/repository/interfaces.go` (`MessageRepository` interface)
- Modify: `backend/internal/repository/message_repository.go` (new method after `MarkConversationRead`)
- Modify: `backend/tests/message_service_test.go` (mock gains the method — compile requirement)
- Test: `backend/tests/message_repository_test.go` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/message_repository_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestMessageRepository_MarkConversationUnread -v`
Expected: FAIL (compile error: `MarkConversationUnread` undefined).

- [ ] **Step 3: Add to interface**

In `backend/internal/repository/interfaces.go`, inside `MessageRepository` after `MarkConversationRead`:

```go
	// MarkConversationUnread marca como NO leído el último mensaje recibido por
	// receiverID desde senderID. No-op silencioso si no hay mensajes recibidos.
	MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error
```

- [ ] **Step 4: Implement**

In `backend/internal/repository/message_repository.go`, after `MarkConversationRead`:

```go
// MarkConversationUnread revierte el read_at del último mensaje recibido de una
// conversación ("marcar como no leída"). Solo el más reciente: alcanza para que
// la conversación muestre el punto de no-leído y cuente en el badge.
func (r *postgresMessageRepository) MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error {
	return r.db.WithContext(ctx).Exec(
		`UPDATE messages SET read_at = NULL
		 WHERE id = (
			SELECT id FROM messages
			WHERE receiver_id = ? AND sender_id = ?
			ORDER BY created_at DESC
			LIMIT 1
		 )`,
		receiverID, senderID,
	).Error
}
```

- [ ] **Step 5: Extend the service-test mock (compile requirement)**

In `backend/tests/message_service_test.go`, add to `mockMessageRepository` (fields after `countUnreadFn`, method after `CountUnread`):

```go
	markConvUnreadFn     func(ctx context.Context, receiverID, senderID uuid.UUID) error
	markConvUnreadCalled bool
	markConvUnreadArgs   [2]uuid.UUID
```

```go
func (m *mockMessageRepository) MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error {
	m.markConvUnreadCalled = true
	m.markConvUnreadArgs = [2]uuid.UUID{receiverID, senderID}
	if m.markConvUnreadFn != nil {
		return m.markConvUnreadFn(ctx, receiverID, senderID)
	}
	return nil
}
```

- [ ] **Step 6: Run tests**

Run: `cd backend && go test ./tests/ -run 'TestMessageRepository_MarkConversationUnread' -v && go build ./...`
Expected: PASS + clean build.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/message_repository.go backend/tests/message_repository_test.go backend/tests/message_service_test.go
git commit -m "feat(messages): MarkConversationUnread repository method"
```

---

### Task 6: Service layer — `HideConversation` + `MarkConversationUnread`

**Files:**
- Modify: `backend/internal/service/message_service.go` (interface + impl + constructor)
- Modify: `backend/internal/app/router.go` (constructor call site, ~line 112)
- Modify: `backend/tests/message_service_test.go` (helper + new tests)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/message_service_test.go`:

```go
// ============================================================
// Mock: ConversationHideRepository
// ============================================================

type mockConversationHideRepository struct {
	upsertFn     func(ctx context.Context, userID, otherUserID uuid.UUID) error
	upsertCalled bool
	upsertArgs   [2]uuid.UUID
}

func (m *mockConversationHideRepository) Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error {
	m.upsertCalled = true
	m.upsertArgs = [2]uuid.UUID{userID, otherUserID}
	if m.upsertFn != nil {
		return m.upsertFn(ctx, userID, otherUserID)
	}
	return nil
}

// ============================================================
// HideConversation / MarkConversationUnread tests
// ============================================================

func TestMessageService_HideConversation_CallsUpsert(t *testing.T) {
	msgRepo := &mockMessageRepository{}
	hideRepo := &mockConversationHideRepository{}
	svc := newMessageService(msgRepo, &mockBlockedRepoForMsg{}, hideRepo)

	me := uuid.New()
	other := uuid.New()

	if err := svc.HideConversation(context.Background(), me.String(), other.String()); err != nil {
		t.Fatalf("HideConversation: %v", err)
	}
	if !hideRepo.upsertCalled {
		t.Fatal("want Upsert called")
	}
	if hideRepo.upsertArgs != [2]uuid.UUID{me, other} {
		t.Errorf("want Upsert(%s, %s), got %v", me, other, hideRepo.upsertArgs)
	}
}

func TestMessageService_HideConversation_InvalidIDs(t *testing.T) {
	svc := newMessageService(&mockMessageRepository{}, &mockBlockedRepoForMsg{}, &mockConversationHideRepository{})

	if err := svc.HideConversation(context.Background(), "not-a-uuid", uuid.New().String()); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput for bad userID, got %v", err)
	}
	if err := svc.HideConversation(context.Background(), uuid.New().String(), "not-a-uuid"); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput for bad otherUserID, got %v", err)
	}
}

func TestMessageService_MarkConversationUnread_CallsRepo(t *testing.T) {
	msgRepo := &mockMessageRepository{}
	svc := newMessageService(msgRepo, &mockBlockedRepoForMsg{}, &mockConversationHideRepository{})

	me := uuid.New()
	other := uuid.New()

	if err := svc.MarkConversationUnread(context.Background(), me.String(), other.String()); err != nil {
		t.Fatalf("MarkConversationUnread: %v", err)
	}
	if !msgRepo.markConvUnreadCalled {
		t.Fatal("want MarkConversationUnread called on repo")
	}
	if msgRepo.markConvUnreadArgs != [2]uuid.UUID{me, other} {
		t.Errorf("want (receiver=%s, sender=%s), got %v", me, other, msgRepo.markConvUnreadArgs)
	}
}

func TestMessageService_MarkConversationUnread_InvalidIDs(t *testing.T) {
	svc := newMessageService(&mockMessageRepository{}, &mockBlockedRepoForMsg{}, &mockConversationHideRepository{})

	if err := svc.MarkConversationUnread(context.Background(), "nope", uuid.New().String()); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}
```

- [ ] **Step 2: Update the `newMessageService` helper signature**

In the same file, replace the existing helper (line ~112) with:

```go
func newMessageService(
	msgRepo *mockMessageRepository,
	blockedRepo *mockBlockedRepoForMsg,
	hideRepo *mockConversationHideRepository,
) service.MessageService {
	bus := event.NewEventBus()
	return service.NewMessageService(msgRepo, blockedRepo, hideRepo, bus)
}
```

Then update every existing call `newMessageService(x, y)` in this file to `newMessageService(x, y, &mockConversationHideRepository{})` (search for `newMessageService(`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run TestMessageService -v`
Expected: FAIL (compile error: `NewMessageService` arg count / `HideConversation` undefined).

- [ ] **Step 4: Implement in the service**

In `backend/internal/service/message_service.go`:

Add to the `MessageService` interface (after `CountUnread`):

```go
	// HideConversation oculta la conversación con otherUserID SOLO para userID.
	HideConversation(ctx context.Context, userID string, otherUserID string) error
	// MarkConversationUnread marca la conversación como no leída para userID.
	MarkConversationUnread(ctx context.Context, userID string, otherUserID string) error
```

Add the field and constructor param:

```go
type messageService struct {
	messageRepo repository.MessageRepository
	blockedRepo repository.BlockedUserRepository
	hideRepo    repository.ConversationHideRepository
	eventBus    *event.EventBus
}

// NewMessageService construye el MessageService con sus dependencias.
// eventBus es opcional — si es nil, los eventos no se publican (zero behavior change).
func NewMessageService(
	messageRepo repository.MessageRepository,
	blockedRepo repository.BlockedUserRepository,
	hideRepo repository.ConversationHideRepository,
	eventBus *event.EventBus,
) MessageService {
	return &messageService{
		messageRepo: messageRepo,
		blockedRepo: blockedRepo,
		hideRepo:    hideRepo,
		eventBus:    eventBus,
	}
}
```

Add the methods (after `CountUnread`):

```go
// HideConversation oculta la conversación de userID con otherUserID (estilo WhatsApp:
// solo desaparece para quien la oculta; un mensaje nuevo la hace reaparecer).
func (s *messageService) HideConversation(ctx context.Context, userID string, otherUserID string) error {
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	otherUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	return s.hideRepo.Upsert(ctx, userUUID, otherUUID)
}

// MarkConversationUnread marca como no leído el último mensaje recibido de la
// conversación. Idempotente; no-op si no hay mensajes recibidos.
func (s *messageService) MarkConversationUnread(ctx context.Context, userID string, otherUserID string) error {
	receiverUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	senderUUID, err := uuid.Parse(otherUserID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	return s.messageRepo.MarkConversationUnread(ctx, receiverUUID, senderUUID)
}
```

- [ ] **Step 5: Wire the new dependency in `router.go`**

In `backend/internal/app/router.go` (~line 98-112 area), add after `blockedUserRepo := ...`:

```go
	conversationHideRepo := repository.NewConversationHideRepository(db)
```

and change the constructor call:

```go
	messageService := service.NewMessageService(messageRepo, blockedUserRepo, conversationHideRepo, bus)
```

- [ ] **Step 6: Fix the handler-test mock (compile requirement)**

`backend/tests/message_handler_test.go` has `mockMessageService` implementing `service.MessageService` — add stubs:

```go
func (m *mockMessageService) HideConversation(ctx context.Context, userID, otherUserID string) error {
	if m.hideConversationFn != nil {
		return m.hideConversationFn(ctx, userID, otherUserID)
	}
	return nil
}

func (m *mockMessageService) MarkConversationUnread(ctx context.Context, userID, otherUserID string) error {
	if m.markConvUnreadFn != nil {
		return m.markConvUnreadFn(ctx, userID, otherUserID)
	}
	return nil
}
```

and the two function fields on the struct:

```go
	hideConversationFn func(ctx context.Context, userID, otherUserID string) error
	markConvUnreadFn   func(ctx context.Context, userID, otherUserID string) error
```

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./tests/ -v -count=1 2>&1 | tail -20`
Expected: `ok` — everything compiles, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/service/message_service.go backend/internal/app/router.go backend/tests/message_service_test.go backend/tests/message_handler_test.go
git commit -m "feat(messages): hide-conversation and mark-unread service methods"
```

---

### Task 7: HTTP handlers + routes

**Files:**
- Modify: `backend/internal/handler/message_handler.go` (two handlers at the end)
- Modify: `backend/internal/app/router.go` (two routes in the `protected` group, after line 335)
- Test: `backend/tests/message_handler_test.go` (append; reuse `setupMessageRouter` — check its route table and add the two new routes there)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/message_handler_test.go` (adjust `setupMessageRouter` first: register `r.DELETE("/api/conversations/:userId", h.HideConversation)` and `r.PATCH("/api/conversations/:userId/unread", h.MarkConversationUnread)` in the same way the existing routes are registered there):

```go
func TestMessageHandler_HideConversation_Returns204(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	var gotUser, gotOther string
	svc := &mockMessageService{
		hideConversationFn: func(_ context.Context, userID, otherUserID string) error {
			gotUser, gotOther = userID, otherUserID
			return nil
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/"+otherID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d — body: %s", w.Code, w.Body.String())
	}
	if gotUser != callerID.String() || gotOther != otherID.String() {
		t.Errorf("service called with (%s, %s)", gotUser, gotOther)
	}
}

func TestMessageHandler_HideConversation_InvalidID_Returns400(t *testing.T) {
	svc := &mockMessageService{
		hideConversationFn: func(_ context.Context, _, _ string) error {
			return domain.ErrInvalidInput
		},
	}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodDelete, "/api/conversations/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestMessageHandler_MarkConversationUnread_Returns204(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	svc := &mockMessageService{}
	h := handler.NewMessageHandler(svc, nil)
	r := setupMessageRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPatch, "/api/conversations/"+otherID.String()+"/unread", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d — body: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run 'TestMessageHandler_HideConversation|TestMessageHandler_MarkConversationUnread' -v`
Expected: FAIL (compile error: `HideConversation` undefined on handler).

- [ ] **Step 3: Implement the handlers**

Append to `backend/internal/handler/message_handler.go`:

```go
// HideConversation godoc
// DELETE /api/conversations/:userId
// Oculta la conversación con :userId solo para el usuario autenticado.
func (h *MessageHandler) HideConversation(c *gin.Context) {
	userID := getUserID(c)
	otherUserID := c.Param("userId")

	if err := h.messageService.HideConversation(c.Request.Context(), userID, otherUserID); err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.Status(http.StatusNoContent)
}

// MarkConversationUnread godoc
// PATCH /api/conversations/:userId/unread
// Marca la conversación con :userId como no leída (último mensaje recibido).
func (h *MessageHandler) MarkConversationUnread(c *gin.Context) {
	userID := getUserID(c)
	otherUserID := c.Param("userId")

	if err := h.messageService.MarkConversationUnread(c.Request.Context(), userID, otherUserID); err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.Status(http.StatusNoContent)
}
```

- [ ] **Step 4: Register the routes**

In `backend/internal/app/router.go`, inside the `protected` group next to the message routes (after `protected.GET("/messages/photo-url/:messageId", ...)`):

```go
		// CONVERSATION-LEVEL ACTIONS (hide / mark unread)
		protected.DELETE("/conversations/:userId", messageHandler.HideConversation)
		protected.PATCH("/conversations/:userId/unread", messageHandler.MarkConversationUnread)
```

- [ ] **Step 5: Run tests + build**

Run: `cd backend && go build ./... && go test ./tests/ -run TestMessageHandler -v -count=1 2>&1 | tail -8`
Expected: PASS (new and pre-existing handler tests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/message_handler.go backend/internal/app/router.go backend/tests/message_handler_test.go
git commit -m "feat(messages): conversation hide and mark-unread endpoints"
```

---

### Task 8: Shared API client + hooks

**Files:**
- Modify: `frontend/packages/shared/api/client.ts` (MESSAGES section, after `markAsRead`/nearby message methods ~line 640)
- Modify: `frontend/packages/shared/hooks/index.ts` (after `useSendMessageTo`, ~line 460)

No unit tests here: both hooks are useMutation passthroughs with invalidation only, which this codebase deliberately does not test (see CLAUDE.md testing notes). They get covered through the page tests in Tasks 11–12.

- [ ] **Step 1: Add API client methods**

In `frontend/packages/shared/api/client.ts`, MESSAGES section:

```ts
  async hideConversation(userId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/conversations/${userId}`);
  }

  async markConversationUnread(userId: string): Promise<void> {
    return this.request<void>('PATCH', `/api/conversations/${userId}/unread`);
  }
```

- [ ] **Step 2: Add hooks**

In `frontend/packages/shared/hooks/index.ts`, after `useSendMessageTo`:

```ts
// useHideConversation — DELETE /api/conversations/:userId. Hides the conversation
// for the current user only; a new incoming message resurfaces it.
export const useHideConversation = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => apiClient.hideConversation(userId),
    onSuccess: () => {
      // Covers ['messages'] (list) and ['messages', 'unread-count'] (badge).
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

// useMarkConversationUnread — PATCH /api/conversations/:userId/unread.
export const useMarkConversationUnread = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => apiClient.markConversationUnread(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};
```

- [ ] **Step 3: Typecheck + existing web tests still green**

Run: `cd frontend/packages/web && pnpm tsc --noEmit && pnpm vitest run src/pages/MessagesPage.test.tsx`
Expected: no type errors; existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/api/client.ts frontend/packages/shared/hooks/index.ts
git commit -m "feat(shared): hideConversation and markConversationUnread client + hooks"
```

---

### Task 9: Shared i18n keys (es/en/pt)

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json` (`chat` namespace)
- Modify: `frontend/packages/shared/i18n/locales/en.json`
- Modify: `frontend/packages/shared/i18n/locales/pt.json`

New keys live in the SHARED `chat` namespace so the future mobile batch reuses them. No `web/src/i18n/index.ts` change needed (`chat` is already registered — rule #21 satisfied).

- [ ] **Step 1: Add the keys**

Inside the existing `"chat"` object of each file, add an `"actions"` block (merge, do not replace existing keys):

`es.json`:

```json
"actions": {
  "menuLabel": "Opciones de conversación",
  "viewProfile": "Ver perfil",
  "markUnread": "Marcar como no leída",
  "block": "Bloquear usuario",
  "unblock": "Desbloquear usuario",
  "report": "Denunciar usuario",
  "delete": "Borrar conversación",
  "deleteConfirmTitle": "¿Borrar esta conversación?",
  "deleteConfirmBody": "Desaparecerá de tu lista. Si recibís un mensaje nuevo, volverá a aparecer.",
  "blockConfirmTitle": "¿Bloquear a {{name}}?",
  "blockConfirmBody": "No podrán enviarse mensajes entre sí.",
  "confirm": "Confirmar",
  "cancel": "Cancelar",
  "reportTitle": "Denunciar a {{name}}",
  "reportReasonLabel": "Motivo de la denuncia",
  "reportReasonPlaceholder": "Contanos qué pasó…",
  "reportSubmit": "Enviar denuncia",
  "reportSuccess": "Denuncia enviada. Gracias por ayudar a cuidar la comunidad.",
  "blockedBanner": "No podés enviar mensajes en esta conversación.",
  "unblockCta": "Desbloquear"
}
```

`en.json`:

```json
"actions": {
  "menuLabel": "Conversation options",
  "viewProfile": "View profile",
  "markUnread": "Mark as unread",
  "block": "Block user",
  "unblock": "Unblock user",
  "report": "Report user",
  "delete": "Delete conversation",
  "deleteConfirmTitle": "Delete this conversation?",
  "deleteConfirmBody": "It will disappear from your list. If you receive a new message, it will come back.",
  "blockConfirmTitle": "Block {{name}}?",
  "blockConfirmBody": "You will not be able to message each other.",
  "confirm": "Confirm",
  "cancel": "Cancel",
  "reportTitle": "Report {{name}}",
  "reportReasonLabel": "Reason for the report",
  "reportReasonPlaceholder": "Tell us what happened…",
  "reportSubmit": "Submit report",
  "reportSuccess": "Report submitted. Thanks for helping keep the community safe.",
  "blockedBanner": "You cannot send messages in this conversation.",
  "unblockCta": "Unblock"
}
```

`pt.json`:

```json
"actions": {
  "menuLabel": "Opções da conversa",
  "viewProfile": "Ver perfil",
  "markUnread": "Marcar como não lida",
  "block": "Bloquear usuário",
  "unblock": "Desbloquear usuário",
  "report": "Denunciar usuário",
  "delete": "Apagar conversa",
  "deleteConfirmTitle": "Apagar esta conversa?",
  "deleteConfirmBody": "Ela desaparecerá da sua lista. Se você receber uma nova mensagem, ela voltará a aparecer.",
  "blockConfirmTitle": "Bloquear {{name}}?",
  "blockConfirmBody": "Vocês não poderão trocar mensagens.",
  "confirm": "Confirmar",
  "cancel": "Cancelar",
  "reportTitle": "Denunciar {{name}}",
  "reportReasonLabel": "Motivo da denúncia",
  "reportReasonPlaceholder": "Conte o que aconteceu…",
  "reportSubmit": "Enviar denúncia",
  "reportSuccess": "Denúncia enviada. Obrigado por ajudar a cuidar da comunidade.",
  "blockedBanner": "Você não pode enviar mensagens nesta conversa.",
  "unblockCta": "Desbloquear"
}
```

- [ ] **Step 2: Validate JSON**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ChatPage.test.tsx`
Expected: PASS (i18n init parses the JSON; a syntax error fails every test).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(i18n): conversation action keys in chat namespace (es/en/pt)"
```

---

### Task 10: `ConversationActionsMenu` component (kebab + dialogs + report modal)

**Files:**
- Create: `frontend/packages/web/src/components/ConversationActionsMenu.tsx`
- Test: `frontend/packages/web/src/components/ConversationActionsMenu.test.tsx`

One self-contained component: kebab button → dropdown → per-action confirm dialogs and report modal. Used by both pages. Before writing the test, open an existing page test (e.g. `src/pages/MessagesPage.test.tsx`) and mirror its render helpers (QueryClientProvider + MemoryRouter + i18n setup) and its `@shared/hooks` mocking style exactly — add the new hooks to that mock.

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/web/src/components/ConversationActionsMenu.test.tsx`. Mirror the setup of `MessagesPage.test.tsx` (imports, providers, `vi.mock('@shared/hooks', ...)`). Cover these behaviors:

```tsx
// Sketch — adapt render helpers to the project's existing test setup.
// Mock '@shared/hooks' with: useHideConversation, useMarkConversationUnread,
// useBlockStatus, useBlockUser, useUnblockUser, useBlockedUsers.
// Mock '@shared/api/client' for submitAbuseReport.

describe('ConversationActionsMenu', () => {
  it('opens the menu and shows the five actions', async () => {
    // render <ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />
    // click the kebab (aria-label = chat:actions.menuLabel)
    // expect menu items: viewProfile, markUnread, block, report, delete
  });

  it('delete shows confirm dialog and calls hide mutation on confirm', async () => {
    // click delete → dialog visible → click confirm → expect hideMutation.mutate('u2')
  });

  it('block shows confirm dialog and calls block mutation on confirm', async () => {
    // click block → confirm → expect blockMutation.mutate({ userId: 'u2' })
  });

  it('shows Unblock instead of Block when I already blocked the user', async () => {
    // useBlockedUsers returns [{ blocked_id: 'u2', ... }] → menu shows unblock
    // click unblock → expect unblockMutation.mutate('u2') (no confirm dialog)
  });

  it('report opens modal and submits abuse report with reason', async () => {
    // click report → modal → type reason → submit →
    // expect apiClient.submitAbuseReport({ target_user_id: 'u2', reason: '...' })
  });

  it('mark unread calls the mutation', async () => {
    // click markUnread → expect markUnreadMutation.mutate('u2')
  });
});
```

Write these as real tests (full render + `@testing-library/react` interactions), not comments — the sketch above only fixes the behavior list and mock surface.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/ConversationActionsMenu.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `frontend/packages/web/src/components/ConversationActionsMenu.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  useHideConversation,
  useMarkConversationUnread,
  useBlockUser,
  useUnblockUser,
  useBlockedUsers,
} from '@shared/hooks';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';

interface ConversationActionsMenuProps {
  otherUserId: string;
  otherUserName: string;
  /** Called after the conversation is hidden (ChatPage navigates back). */
  onHidden?: () => void;
  /** Hide the "mark unread" entry (e.g. if ever irrelevant in a context). */
  showMarkUnread?: boolean;
}

type Dialog = 'none' | 'delete' | 'block' | 'report';

export function ConversationActionsMenu({
  otherUserId,
  otherUserName,
  onHidden,
  showMarkUnread = true,
}: ConversationActionsMenuProps) {
  const { t } = useTranslation(['chat', 'errors']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hideConversation = useHideConversation();
  const markUnread = useMarkConversationUnread();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const { data: blockedUsers } = useBlockedUsers();
  const iBlockedThem = blockedUsers?.some((b) => b.blocked_id === otherUserId) ?? false;

  const closeAll = () => {
    setOpen(false);
    setDialog('none');
    setError(null);
  };

  const handleDelete = () => {
    hideConversation.mutate(otherUserId, {
      onSuccess: () => {
        closeAll();
        onHidden?.();
      },
      onError: (err) => setError(getErrorMessage(err, t)),
    });
  };

  const handleBlockToggle = () => {
    if (iBlockedThem) {
      unblockUser.mutate(otherUserId, {
        onSuccess: closeAll,
        onError: (err) => setError(getErrorMessage(err, t)),
      });
      return;
    }
    blockUser.mutate(
      { userId: otherUserId },
      {
        onSuccess: closeAll,
        onError: (err) => setError(getErrorMessage(err, t)),
      }
    );
  };

  const handleReport = async () => {
    try {
      await apiClient.submitAbuseReport({ target_user_id: otherUserId, reason: reason.trim() });
      setFeedback(t('chat:actions.reportSuccess'));
      setReason('');
      closeAll();
    } catch (err) {
      setError(getErrorMessage(err, t));
    }
  };

  const handleMarkUnread = () => {
    markUnread.mutate(otherUserId, { onSettled: closeAll });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={t('chat:actions.menuLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-20"
        >
          <MenuItem onClick={() => { closeAll(); navigate(`/users/${otherUserId}`); }}>
            {t('chat:actions.viewProfile')}
          </MenuItem>
          {showMarkUnread && (
            <MenuItem onClick={handleMarkUnread}>{t('chat:actions.markUnread')}</MenuItem>
          )}
          <MenuItem onClick={() => (iBlockedThem ? handleBlockToggle() : setDialog('block'))}>
            {iBlockedThem ? t('chat:actions.unblock') : t('chat:actions.block')}
          </MenuItem>
          <MenuItem onClick={() => setDialog('report')}>{t('chat:actions.report')}</MenuItem>
          <MenuItem destructive onClick={() => setDialog('delete')}>
            {t('chat:actions.delete')}
          </MenuItem>
        </div>
      )}

      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('chat:actions.deleteConfirmTitle')}
          body={t('chat:actions.deleteConfirmBody')}
          confirmLabel={t('chat:actions.confirm')}
          cancelLabel={t('chat:actions.cancel')}
          pending={hideConversation.isPending}
          error={error}
          onConfirm={handleDelete}
          onCancel={closeAll}
        />
      )}

      {dialog === 'block' && (
        <ConfirmDialog
          title={t('chat:actions.blockConfirmTitle', { name: otherUserName })}
          body={t('chat:actions.blockConfirmBody')}
          confirmLabel={t('chat:actions.confirm')}
          cancelLabel={t('chat:actions.cancel')}
          pending={blockUser.isPending}
          error={error}
          onConfirm={handleBlockToggle}
          onCancel={closeAll}
        />
      )}

      {dialog === 'report' && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t('chat:actions.reportTitle', { name: otherUserName })}
            </h2>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('chat:actions.reportReasonLabel')}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('chat:actions.reportReasonPlaceholder')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={closeAll} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                {t('chat:actions.cancel')}
              </button>
              <button
                type="button"
                disabled={!reason.trim()}
                onClick={handleReport}
                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {t('chat:actions.reportSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-xl bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          {feedback}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
        destructive ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{body}</p>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-3 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

NOTE for the implementer: `useUnblockUser`'s mutate signature must be checked at `frontend/packages/shared/hooks/index.ts:616` — if it takes `{ userId }` instead of a bare string, adapt the call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/ConversationActionsMenu.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/ConversationActionsMenu.tsx frontend/packages/web/src/components/ConversationActionsMenu.test.tsx
git commit -m "feat(web): conversation actions menu component"
```

---

### Task 11: `ChatPage` header + blocked-state banner

**Files:**
- Modify: `frontend/packages/web/src/pages/ChatPage.tsx`
- Modify: `frontend/packages/web/src/pages/ChatPage.test.tsx` (extend existing mocks with the new hooks)

- [ ] **Step 1: Write the failing tests**

Add to `ChatPage.test.tsx` (extend the existing `@shared/hooks` mock with `usePublicProfile`, `useBlockStatus`, and the Task 10 hooks):

- header renders the counterpart's name (from `usePublicProfile`) as a link to `/users/:id`
- header renders the actions menu button (`chat:actions.menuLabel`)
- when `useBlockStatus` returns `isBlocked: true`, the message input is NOT rendered and the banner text (`chat:actions.blockedBanner`) is shown

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ChatPage.test.tsx`
Expected: new tests FAIL (no header/banner yet); pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `ChatPage.tsx`:

1. Add imports:

```tsx
import { Link, useNavigate, useParams } from 'react-router';
import { usePublicProfile, useBlockStatus } from '@shared/hooks';
import { ConversationActionsMenu } from '../components/ConversationActionsMenu';
```

2. Inside the component, after `sendMessageTo`:

```tsx
  const navigate = useNavigate();
  const { data: profile } = usePublicProfile(userId!);
  const { isBlocked } = useBlockStatus(userId);
  const otherName = profile?.name ?? t('common:unknownUser');
```

3. Add the header as the FIRST child of the root `div` (before the message list):

```tsx
      {/* Conversation header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
        <Link to={`/users/${userId}`} className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold uppercase">
            {otherName.charAt(0)}
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{otherName}</span>
        </Link>
        <ConversationActionsMenu
          otherUserId={userId!}
          otherUserName={otherName}
          onHidden={() => navigate('/messages')}
        />
      </div>
```

4. Replace the send `<form>` block: when blocked, render the banner instead:

```tsx
      {isBlocked ? (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('chat:actions.blockedBanner')}
        </div>
      ) : (
        <form /* existing form unchanged */>
          …
        </form>
      )}
```

(The unblock path lives in the actions menu — no extra button here; the menu already flips to "Unblock" when I am the blocker.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/ChatPage.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/ChatPage.tsx frontend/packages/web/src/pages/ChatPage.test.tsx
git commit -m "feat(web): chat header with conversation actions and blocked banner"
```

---

### Task 12: `MessagesPage` per-row actions

**Files:**
- Modify: `frontend/packages/web/src/pages/MessagesPage.tsx`
- Modify: `frontend/packages/web/src/pages/MessagesPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `MessagesPage.test.tsx` (extend its `@shared/hooks` mock with the Task 10 hooks):

- each conversation row renders an actions menu button
- clicking the kebab does NOT navigate to the chat (event does not bubble to the row `Link`)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MessagesPage.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

In `MessagesPage.tsx`:

1. Import the component:

```tsx
import { ConversationActionsMenu } from '../components/ConversationActionsMenu';
```

2. Restructure each `<li>`: the row becomes a flex container with the existing `Link` taking `flex-1` and the menu OUTSIDE the link (so menu clicks never navigate):

```tsx
              <li key={msg.id} className="flex items-center gap-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 pr-2 hover:shadow-md transition-shadow">
                <Link
                  to={`/messages/${otherUserId}`}
                  className="flex items-center gap-4 flex-1 min-w-0 px-4 py-3"
                >
                  {/* existing avatar + content blocks — unchanged, but WITHOUT the old
                      card styling on the Link (it moved to the <li>) */}
                </Link>
                <ConversationActionsMenu
                  otherUserId={otherUserId}
                  otherUserName={otherUserName}
                />
              </li>
```

- [ ] **Step 4: Run tests + full web suite**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MessagesPage.test.tsx && pnpm test:run`
Expected: PASS (including shared config suite — `test:run` chains it).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/MessagesPage.tsx frontend/packages/web/src/pages/MessagesPage.test.tsx
git commit -m "feat(web): conversation actions in messages list"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend full suite**

Run: `cd backend && go build ./... && go test ./tests/ -count=1 2>&1 | tail -5`
Expected: `ok  lost-pets/tests`

- [ ] **Step 2: Web full suite + typecheck + build**

Run: `cd frontend/packages/web && pnpm tsc --noEmit && pnpm test:run && pnpm build`
Expected: all green.

- [ ] **Step 3: Manual smoke (local)**

Per the local-run-setup notes: DB on host port 5433, `make backend`, `make web`, seeded users. Flow to verify by hand:
1. Login as user A, open a conversation with user B → header shows B's name.
2. Delete the conversation → it disappears from `/messages`; navbar badge drops if it had unread.
3. As B, send A a new message → conversation reappears in A's list.
4. Mark as unread → dot + badge reappear.
5. Block B from the menu → chat input replaced by banner; unblock from the menu restores it.
6. Report B with a reason → row appears in `/admin/abuse-reports`.
7. Re-seed the dev DB if `go test` ran against it.

- [ ] **Step 4: Final commit (if fixups were needed) and stop**

Do NOT push or open a PR — that is a separate explicit step (searchpet-pr skill) after review.
```
