# Chat Conversation Actions (Web) — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

The web chat has no conversation-level actions at all. `MessagesPage` renders a
plain list of conversations and `ChatPage` renders messages without even a
header showing who you are talking to. A user cannot delete a conversation,
block or report the other user, or jump to their profile — actions that already
exist (block, abuse report, public profile) in the backend and in parts of
mobile, but have zero web UI.

## Goal

Add a conversation actions menu to the web chat with five actions:

1. **Delete conversation** — hide it from *my* list only (WhatsApp semantics).
2. **Block / Unblock user** — reuse existing endpoints.
3. **Report user** — reuse existing abuse-report endpoint.
4. **View public profile** — link to the existing profile page.
5. **Mark as unread** — flag the conversation for later attention.

Scope is **web only** for the UI. All new backend and shared-hooks work is
platform-agnostic so mobile can adopt it in a follow-up.

## Decisions

1. **Delete = hide for me, evidence preserved.** Messages are never deleted or
   mutated. A `conversation_hides` row `(user_id, other_user_id, hidden_at)`
   records that *I* hid the conversation at a point in time. The other user's
   view is untouched, and abuse reports keep their evidence.

2. **Reappear on new activity.** `GetConversations` excludes a conversation
   only when its latest message is older than (or equal to) `hidden_at`. A new
   message is newer than `hidden_at`, so the conversation resurfaces with no
   extra logic. Hiding again just upserts a fresh `hidden_at`.

3. **Unread badge respects hides.** `CountUnread` (navbar badge, PR #80)
   excludes unread messages sent before `hidden_at` by a hidden counterpart.
   Otherwise the badge would count conversations the user cannot see.

4. **New `/conversations` route root.** The `PATCH /api/messages/:id/read`
   route already uses `:id` = *message id*. Adding `PATCH /messages/:userId/…`
   would conflict with that wildcard in Gin's route tree and overload the
   param meaning. Conversation-level actions get their own root:
   - `DELETE /api/conversations/:userId` — hide the conversation with that user
   - `PATCH /api/conversations/:userId/unread` — mark it unread

5. **Mark-as-unread is minimal and idempotent.** It sets `is_read = false` on
   the *latest* message where `receiver = me AND sender = :userId`. If no such
   message exists (e.g. I sent every message), it is a successful no-op.
   Opening the chat later re-marks it read via the existing auto-read in
   `GetConversation` — same behavior as WhatsApp.

6. **Block state is visible inside the chat.** `ChatPage` shows a banner and
   disables the input when a block exists in either direction (reusing the
   shared `blockStatus` hook mobile already uses). The "Unblock" button appears
   only when the current user is the blocker.

## Data Model

```sql
CREATE TABLE conversation_hides (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, other_user_id)
);
```

GORM model in `internal/domain/models.go`, created via AutoMigrate like the
other tables. Hiding is an upsert (`ON CONFLICT … DO UPDATE SET hidden_at`).

## API

| Method | Route | Behavior | Errors |
|---|---|---|---|
| DELETE | `/api/conversations/:userId` | Upsert hide row for (me, userId) | `invalid_input` (bad UUID) |
| PATCH | `/api/conversations/:userId/unread` | Latest received message from userId → `is_read = false`; no-op if none | `invalid_input` (bad UUID) |

Both protected (JWT). All errors via `writeError(c, status, err)` →
`{code, message}` (CLAUDE.md rule #11). No new error codes are expected beyond
existing ones.

Existing endpoints reused with no changes: `POST/DELETE /api/users/:id/block`,
`GET /api/users/:id/block-status`, `POST /api/abuse-reports`,
`GET /api/users/:id/profile`.

## Backend Changes

- `domain/models.go`: `ConversationHide` struct.
- `repository/interfaces.go` + new `conversation_hide_repository.go`:
  `Upsert(ctx, userID, otherUserID)`, `FindByUserID(ctx, userID)` (map for
  filtering).
- `repository/message_repository.go`:
  - `GetConversations` — anti-join against `conversation_hides` (exclude when
    latest message `created_at <= hidden_at`).
  - `CountUnread` — same exclusion.
  - `MarkConversationUnread(ctx, receiverID, senderID)` — update latest
    received message.
- `service/message_service.go`: `HideConversation`, `MarkConversationUnread`
  (parse/validate IDs, delegate). No events published — these are private,
  single-user actions.
- `handler/message_handler.go` (or a small `conversation_handler.go`): the two
  handlers + routes in `router.go` under the protected group.

## Web UI

- **`ChatPage` header (new):** avatar + counterpart name linking to
  `/users/:id/profile`, plus a kebab (`⋯`) menu with the five actions. On
  delete: confirm dialog → mutation → navigate back to `/messages`.
- **Block banner:** when `blockStatus` reports a block in either direction,
  replace the send form with a banner (i18n) and, if I am the blocker, an
  "Unblock" button.
- **`MessagesPage`:** kebab button per conversation row (stops link
  navigation) with the same actions. "Mark as unread" shows the unread dot
  immediately (invalidate queries).
- **Report modal:** textarea for the reason → `POST /api/abuse-reports` with
  `target_user_id`. Success/failure feedback inline.
- **Confirmations:** delete and block use a simple confirm dialog; unblock,
  report, profile, and mark-unread act directly.

## State, Errors, i18n

- New shared hooks in `frontend/packages/shared/hooks`: `useHideConversation`,
  `useMarkConversationUnread` (plus API client methods `hideConversation`,
  `markConversationUnread`). Kept in shared so mobile reuses them later.
- After hide/block/unblock: invalidate `['messages']` and the block-status
  query. After mark-unread: invalidate `['messages']` and the unread-count
  query.
- All user-facing errors via `getErrorMessage(err, t)` (rule #11).
- i18n keys in the existing `chat` and `messages` namespaces for es/en/pt
  (already registered in `web/src/i18n/index.ts`, rule #21). UI strings in
  English keys, translated per locale.

## Testing

- **Go (service):** hide → conversation excluded; new message → reappears;
  re-hide works; `CountUnread` excludes hidden; `MarkConversationUnread` flips
  the latest received message and no-ops cleanly.
- **Go (handler):** both endpoints — happy path, bad UUID, missing auth.
- **Web (Vitest):** `ChatPage.test.tsx` — header renders counterpart, menu
  actions fire mutations, blocked state disables input. `MessagesPage.test.tsx`
  — kebab menu, delete confirm flow, mark-unread invalidation.
- **Shared hooks:** only hooks with real logic get tests in
  `hooks/index.test.ts` (per existing convention, passthrough mutations are
  not tested).

## Out of Scope

- Mobile UI (follow-up batch; backend + shared hooks will already support it).
- Per-message deletion (rejected — YAGNI; hide-conversation covers the need).
- "Delete for both" semantics (destroys abuse-report evidence).
- Muting/notification preferences per conversation.
