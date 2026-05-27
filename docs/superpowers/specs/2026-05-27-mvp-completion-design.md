# SearchPet MVP Completion — Design Document
**Date:** 2026-05-27
**Status:** Approved

---

## Overview

Complete the SearchPet MVP across 7 independent subsystems organized in two parallel tracks. Track 1 handles foundational infrastructure and third-party service wiring. Track 2 handles real-time chat. After both tracks, mobile features, architecture cleanup, and store publish follow sequentially.

---

## Track 1 — Infrastructure + Service Wiring

### 1.1 Infra Baseline

**golang-migrate** added as direct dependency. Migration files live in `backend/migrations/`:
- `001_add_messages_read_at.up/down.sql` — `ALTER TABLE messages ADD COLUMN read_at TIMESTAMPTZ`
- `002_add_ws_ticket_table.up/down.sql` — single-use WS handshake tickets
- `003_add_messages_indexes.up/down.sql` — compound index on `(sender_id, receiver_id, created_at DESC)` + partial index on `(receiver_id, read_at) WHERE read_at IS NULL`
- `004_add_photo_public_id_to_messages.up/down.sql` — `photo_public_id TEXT`, `photo_url TEXT`
- `005_add_conversations_index.up/down.sql` — index supporting the conversations query

`main.go` runs migrations before AutoMigrate. Fails fast (`log.Fatal`) if any migration fails.

**Structured logging** via `go.uber.org/zap`. Singleton in `pkg/logger/logger.go`, injected into handlers and services via constructor. `DEBUG` in dev, `INFO` in prod. Replaces all `log.Printf` calls.

**`.env.example`** fully documented with all required fields: `JWT_SECRET`, `DATABASE_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `FIREBASE_KEY`, `CORS_ALLOWED_ORIGINS`, `ENVIRONMENT`.

**`testdb.SetupTestDB`** runs migrations before AutoMigrate in integration tests.

---

### 1.2 Cloudinary Wiring

`pkg/storage/cloudinary.go` is already implemented. What's missing is wiring:

**`photo_service.go`** receives `*storage.CloudinaryClient` via constructor.

Upload flow:
```
POST /api/pets/:id/photos (multipart/form-data)
  → validate MIME using http.DetectContentType on first 512 bytes (not Content-Type header)
  → validate size ≤ 15MB (Cloudinary handles compression to WebP)
  → photo_service.Upload(ctx, petID, file, filename)
  → cloudinary.UploadImage → (secureURL, publicID)
  → persist Photo{URL: secureURL, CloudinaryID: publicID}
  → return Photo DTO
```

Delete flow:
```
DELETE /api/pets/:id/photos/:photoId
  → cloudinary.Delete(publicID)
  → if Cloudinary fails: log with zap.Error, delete from DB anyway
    (Cloudinary has 30-day trash — no orphaned column needed)
  → delete Photo from DB
```

Chat photo signed URLs:
```
GET /api/messages/:messageId/photo-url (requires auth)
  → find message by messageId
  → verify requester is sender_id OR receiver_id → 403 if not
  → generate Cloudinary signed URL (TTL 1h) using internal photo_public_id
  → return { "url": "...", "expires_at": "iso8601" }
  (publicId never exposed to client)
```

**Tests:** mock `CloudinaryClient` with function pointers. Test: valid MIME passes, invalid MIME → 400, MIME spoofed via header but real bytes wrong → 400, Cloudinary failure on delete → DB deleted + error logged, signed URL 403 for non-participant.

---

### 1.3 Firebase FCM Wiring

`pkg/notification/firebase.go` is already implemented with no-op pattern. What's missing:

**`notification_service.go`** (new) — domain-aware wrapper. Subscribes to EventBus in `main.go`, never injected into other services:

```go
// main.go
notifSvc := notification.NewNotificationService(fcmClient, deviceTokenRepo, logger)
bus.Subscribe("message.sent",   notifSvc.OnMessageSent)
bus.Subscribe("report.created", notifSvc.OnReportCreated)
bus.Subscribe("pet.found",      notifSvc.OnPetFound)
```

Token cleanup: `messaging.IsRegistrationTokenNotRegistered(err)` → delete token silently from DB. Real errors → `zap.Error`. Partial failures in `SendToTokens` → clean invalid tokens, log real failures, don't return error for the notification (best-effort delivery).

**FCM fires only when user is offline** (not connected to WebSocket Hub). Hub exposes `IsConnected(userID) bool` — NotificationService checks before sending.

**Tests:** mock `NotificationClient` + mock Hub. Test: online user → no FCM, offline user → FCM fired, invalid token → deleted from DB, partial failure → valid tokens received notification.

---

## Track 2 — WebSocket Chat

### 2.1 Ticket System (JWT never in URL)

```
POST /api/ws/ticket  (requires JWT)
  → generate UUID, TTL 30s
  → store in sync.Map with expiry + used=false
  → return { "ticket": "uuid" }

GET /api/ws?ticket=uuid
  → validate: exists + not expired + not used → mark used
  → upgrade HTTP → WebSocket (nhooyr.io/websocket)
  → register Client in Hub
```

Background goroutine cleans expired tickets every 60s.

---

### 2.2 Hub

```go
type Hub struct {
    clients      map[uuid.UUID][]*Client  // fan-out to all devices per user
    register     chan *Client
    unregister   chan *Client
    broadcast    chan Envelope
    badgeDebounce map[uuid.UUID]*time.Timer
    badgeMu      sync.Mutex
    mu           sync.RWMutex
    quit         chan struct{}
}

type Client struct {
    userID uuid.UUID
    send   chan []byte  // buffered 256 — full = client disconnected, hub unblocked
    conn   *websocket.Conn
}
```

**Non-blocking send:** if `client.send` is full → force disconnect that client, continue to other devices. Hub never blocks.

**Typing state cleanup on disconnect:** Hub emits synthetic `typing_stop` to all active recipients when a client unregisters mid-typing.

**Badge debounce (500ms):** 50 rapid read receipts → 1 DB query. Payload is always absolute count, never delta.

**Hub.Close():** stops all `badgeDebounce` timers before closing channels. `unregister` path also cleans timer for that specific user.

**Multi-device fan-out:** `map[uuid.UUID][]*Client` — message delivered to all connected devices of the recipient.

---

### 2.3 Message Types

```json
{ "type": "message",      "payload": { "id", "from", "body", "created_at" } }
{ "type": "typing_start", "payload": { "from": "uuid" } }
{ "type": "typing_stop",  "payload": { "from": "uuid" } }
{ "type": "read_receipt", "payload": { "message_id": "uuid", "read_at": "iso8601" } }
{ "type": "badge_update", "payload": { "unread_total": 5 } }
{ "type": "error",        "payload": { "code", "message" } }
```

`typing_start/stop` — ephemeral, never persisted.
`read_receipt` — updates `messages.read_at` via `message_service.MarkRead`.
`badge_update` — absolute count from DB, debounced 500ms.

---

### 2.4 Reconnection + Missed Messages

Client stores `lastMessageID` in `AsyncStorage` / `localStorage`.

Reconnect flow:
```
1. POST /api/ws/ticket
2. GET /api/ws?ticket=... → connect WS → buffer incoming
3. GET /api/messages/:userId?before=latest&limit=50
4. Dedup buffer + history by message_id (Set) → sort → render
5. On scroll to top → GET ?before=<oldest_id>&limit=50
```

Exponential backoff: 1s → 2s → 4s → 8s → max 30s.

---

### 2.5 `GET /api/messages/:userId` marks read

On fetch: `UPDATE messages SET read_at = NOW() WHERE receiver_id = $me AND read_at IS NULL AND sender_id = $userId`. Works offline (REST) and online (WS read_receipt).

---

## After Tracks — Mobile Features

### 3.1 New Backend Endpoints

**`GET /api/conversations`** with composite cursor pagination:
```sql
SELECT 
  CASE WHEN m.sender_id = $me THEN m.receiver_id ELSE m.sender_id END AS other_user_id,
  u.name as other_user_name,
  u.avatar_url as other_user_avatar,
  last_msg.body as last_body,
  last_msg.created_at as last_message_at,
  COUNT(*) FILTER (WHERE m.receiver_id = $me AND m.read_at IS NULL) as unread_count
FROM messages m
JOIN users u ON u.id = CASE WHEN m.sender_id = $me THEN m.receiver_id ELSE m.sender_id END
JOIN LATERAL (
  SELECT body, created_at FROM messages m2
  WHERE (m2.sender_id = $me AND m2.receiver_id = u.id)
     OR (m2.sender_id = u.id AND m2.receiver_id = $me)
  ORDER BY created_at DESC LIMIT 1
) last_msg ON true
WHERE (m.sender_id = $me OR m.receiver_id = $me)
  AND ($cursor_ts IS NULL OR last_msg.created_at < $cursor_ts
    OR (last_msg.created_at = $cursor_ts AND u.id < $cursor_user))
GROUP BY u.id, u.name, u.avatar_url, last_msg.body, last_msg.created_at
ORDER BY last_message_at DESC, other_user_id DESC
LIMIT 20
```
Cursor: `?before_ts=<iso8601>&before_user=<uuid>` — deterministic with timestamp collisions.

**`GET /api/pets/mine`** adds cursor pagination: `?before=<pet_id>&limit=20`.

---

### 3.2 `app/chat/[userId].tsx`

Mount sequence (race condition safe):
```
1. Load pending_uploads from AsyncStorage → show retry bubbles
2. cleanOrphanedUploads() — delete files >24h or without AsyncStorage entry
3. Connect WS → buffer incoming
4. GET /api/messages/:userId?before=latest&limit=50
5. Dedup by message_id → sort → render
6. On scroll to top → load previous page
```

Photo upload (robust):
```
select → copy to FileSystem.documentDirectory/uploads/<uuid>.jpg (persistent)
       → save AsyncStorage entry { id, persistentUri, status: "pending" }
       → show optimistic bubble with spinner
       → check NetInfo.isConnected
         online:  upload to Cloudinary (folder: "chats/", signed)
         offline: show "pending" state, no spinner

useEffect cleanup:
  const unsub = NetInfo.addEventListener(state => {
    if (state.isConnected) retryPendingUploads()
  })
  return () => unsub()  // no leak
```

Signed URL cache (module singleton, not Zustand):
```typescript
const UrlCache = new Map<string, { url: string; expires_at: number }>()
// onViewableItemsChanged + 200ms debounce per item
// proactive refetch if expires_at < now + 5min
// fetch via GET /api/messages/:messageId/photo-url (not publicId)
```

Message bubble states: `sending` → `sent` → `delivered` → `read` (✓ / ✓✓ grey / ✓✓ blue).
Typing indicator: 3s timeout on receiver. Hub emits synthetic `typing_stop` on disconnect as primary mechanism; timeout is fallback.

---

### 3.3 `(tabs)/messages.tsx`

```typescript
// Zustand — cleared on rehydrate, never persisted
activeConversations: Set<string>
onRehydrateStorage: () => (state) => state?.set({ activeConversations: new Set() })

// On WS message:
if (activeConversations.has(msg.from)) → mark read, skip badge
else → badge from badge_update event (absolute count)

// Cursor pagination:
onEndReached → GET /api/conversations?before_ts=<ts>&before_user=<uuid>
```

---

### 3.4 `(tabs)/my-pets.tsx`

```
Infinite scroll: onEndReached → GET /api/pets/mine?before=<last_pet_id>&limit=20

"Marcar como encontrada":
  → confirm modal with onRequestClose={() => setVisible(false)}  // Android back button safe
  → on confirm: save original position in ref → optimistic remove
  → PATCH /api/pets/:id { status: "found" }
  → fail: restore at original position + error toast
  → success: no-op (already removed)
```

---

## Architecture Cleanup (S-1)

Move `CreatePetRequest` from `service/pet_service.go` to `dto/dto.go`.

Before moving:
```bash
grep -r "pet_service.CreatePetRequest\|service\.CreatePetRequest" backend/
```
Update all import paths in one atomic commit. Verify: `go build ./...`.

---

## Store Publish

**`app.json`** — verify `bundleIdentifier` and `package` availability in App Store Connect and Google Play Console before committing (checklist in `DEPLOY.md`).

**`scripts/bump-version.sh`:**
```bash
# increments version in app.json + package.json
# validates JSON before committing
node -e "JSON.parse(require('fs').readFileSync('app.json', 'utf8'))" || exit 1
git commit -m "chore: bump version to $NEW_VERSION [skip ci]"
# [skip ci] prevents infinite loop, JSON validation catches format errors
```

**CI `eas-build` job** (tags `v*.*.*` only):
```yaml
- name: Validate EXPO_TOKEN secret
  run: |
    if [ -z "${{ secrets.EXPO_TOKEN }}" ]; then
      echo "::error::EXPO_TOKEN not set. See DEPLOY.md → CI Setup."
      exit 1
    fi
- name: Validate token and quota
  run: |
    eas whoami          # fast-fail on invalid/expired token
    eas build:list --limit 1  # shows available quota in logs
- name: Build
  run: eas build --platform all --non-interactive --profile production
```

**`DEPLOY.md`** includes:
- How to generate `EXPO_TOKEN` (link to Expo Settings → Access Tokens)
- Bundle ID reservation checklist (links to App Store Connect + Google Play Console)
- First manual publish instructions (`eas submit`)
- Required environment variables per service (Railway, EAS Secrets)

---

## Execution Order

```
Week 1:  Track 1A — Infra baseline (migrations, zap, .env.example)
Week 1:  Track 1B — Cloudinary wiring + FCM wiring (parallel with Track 2)
Week 1:  Track 2  — WS Hub + ticket system + wsHandler (parallel with Track 1)
Week 2:  Track 2  — Chat screens mobile + web (after Hub is done)
Week 2:  Mobile features (conversations list, my pets, chat screen complete)
Week 3:  Architecture cleanup (S-1)
Week 3:  Store publish (EAS config, CI job, DEPLOY.md)
```

---

## Testing Strategy

Every subsystem follows the same pattern as the rest of the project:
- **Backend unit:** mock structs with function pointers, table-driven tests
- **Backend integration:** `testdb.SetupTestDB`, requires `DATABASE_URL`, skip gracefully without it
- **Frontend web:** Vitest + RTL, mock React Query hooks
- **Mobile:** jest-expo + @testing-library/react-native, mock native modules

Key test cases not obvious from the code:
- Hub: online user → no FCM; offline → FCM; slow client (full buffer) → disconnected without blocking Hub
- Ticket: expired ticket → 401; already-used ticket → 401; valid ticket used twice → second use 401
- Signed URL: non-participant → 403; publicId never in response body
- Badge debounce: 50 read receipts → 1 DB query
- Chat mount: WS buffer + HTTP history dedup by message_id
- Orphan cleanup: file >24h without AsyncStorage entry → deleted
- Android modal: `onRequestClose` → state clean
- `eas whoami` in CI: expired token → fast fail with clear message
