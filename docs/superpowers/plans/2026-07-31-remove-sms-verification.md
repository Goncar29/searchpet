# Remove the SMS verification flow — Implementation Plan (Part A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the SMS/Twilio OTP verification flow end to end, so the project has no paid dependency and no unbounded, unrated-limited endpoint that spends money.

**Architecture:** Pure removal, outside-in — UI first, then the shared client, then the backend. Each task must leave the tree building and every suite green. `users.phone_verified` is **kept**.

**Tech Stack:** Go 1.25 + Gin; React + Vite (web); React Native + Expo (mobile); i18next.

**Spec:** `docs/superpowers/specs/2026-07-31-email-verification-quota-design.md`, Part A.

---

## How a removal is verified

There is no failing test to write first. The two acceptance signals are:

1. **Build and suites green**, judged by **exit code** — never by grepping output (`searchpet-verify` skill, CLAUDE.md rule #41).
2. **A grep proving zero live references.** Task 7 runs it repo-wide; each task runs it for its own layer.

`users.phone_verified` and `IsVerified` must keep working. A user who verified a phone before this change stays verified — that is asserted in Task 7.

## File Structure

| File | Action |
|---|---|
| `frontend/packages/mobile/app/verify-phone.tsx` | Delete |
| `frontend/packages/mobile/app/(tabs)/profile.tsx` | Remove SMS state, hooks, sheet, handlers |
| `frontend/packages/mobile/app/_layout.tsx` | Remove the `verify-phone` `Stack.Screen` |
| `frontend/packages/web/src/pages/ProfilePage.tsx` | Remove SMS modal state and the phone-verification block (line ~403) |
| `frontend/packages/shared/hooks/index.ts` | Remove `useSendSmsOTP`, `useConfirmSmsOTP` (~1137-1155) |
| `frontend/packages/shared/api/client.ts` | Remove `sendSmsOtp`, `confirmSmsOtp` (~1041-1048) |
| `frontend/packages/{web/src,mobile}/i18n/locales/{es,en,pt}.json` | Remove SMS keys |
| `backend/internal/app/router.go` | Remove routes 472 and 474; drop `smsSenderClient` |
| `backend/internal/handler/verification_handler.go` | Remove `SendSMS`, `ConfirmSMS` |
| `backend/internal/dto/verification_dto.go` | Remove `SendSMSRequest`, `ConfirmSMSRequest` |
| `backend/internal/service/verification_service.go` | Remove the `sms` branches and the `smsSender` field/param |
| `backend/pkg/sms/` | Delete the package |
| `backend/config/config.go` | Remove the three `Twilio*` fields |
| `backend/tests/verification_*_test.go` | Remove SMS cases |

---

### Task 1: Mobile — remove the SMS UI

**Files:**
- Delete: `frontend/packages/mobile/app/verify-phone.tsx`
- Modify: `frontend/packages/mobile/app/(tabs)/profile.tsx`
- Modify: `frontend/packages/mobile/app/_layout.tsx`

- [ ] **Step 1: Delete the screen**

```bash
git rm frontend/packages/mobile/app/verify-phone.tsx
```

- [ ] **Step 2: Strip the SMS surface from the profile screen**

In `app/(tabs)/profile.tsx` remove, in this order:
- `useSendSmsOTP`, `useConfirmSmsOTP` from the `@shared/hooks` import on line 14 (keep the rest).
- The two hook calls (`sendSmsOTP`, `confirmSmsOTP`, ~lines 31-32).
- The whole `// SMS OTP state` block: `smsSheetVisible`, `smsSheetStep`, `smsOtpCode`, `smsOtpError`, `smsResendCountdown`, `smsUnavailable` (~lines 40-46).
- The `useEffect` driving `smsResendCountdown` (~lines 56-58).
- Every handler and JSX block referencing those names, including the SMS bottom sheet and the button that opens it.
- Any now-unused `StyleSheet` entries whose only consumers were those blocks.

- [ ] **Step 3: Remove the route declaration**

In `app/_layout.tsx`, delete the `<Stack.Screen name="verify-phone" ... />` line. A declaration for a route that no longer exists makes expo-router warn on every launch, and a permanent harmless warning is one people learn to scroll past.

- [ ] **Step 4: Prove the layer is clean**

Run: `cd frontend/packages/mobile && rg -n 'Sms|SMS|verify-phone' app/ components/ store/ || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 5: Run the mobile suite**

Run: `cd frontend/packages/mobile && pnpm test:run; echo "EXIT=$?"`
Expected: `EXIT=0`. **Never `pnpm test`** — that is `jest --watchAll` and never exits (rule #17). If a test file covered `verify-phone`, delete it; if a profile test mocked the SMS hooks, drop those mocks (rule #17: screen smoke tests mock `@shared/hooks` hook by hook).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/packages/mobile
git commit -m "refactor(mobile): quitar la verificacion por SMS de la app"
```

---

### Task 2: Web — remove the SMS UI

**Files:**
- Modify: `frontend/packages/web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: Strip the SMS surface**

Remove the `// SMS OTP modal state` block (~line 40) and the phone-verification section at ~line 403 (`{/* Verificación de teléfono (SMS OTP) ... */}`), plus every handler and import that becomes unused.

- [ ] **Step 2: Prove the layer is clean**

Run: `cd frontend/packages/web && rg -n 'Sms|SMS' src/ || echo "CLEAN"`
Expected: `CLEAN` (locale files are Task 4 — if hits remain only under `src/i18n/locales/`, that is expected here).

- [ ] **Step 3: Run the web and shared suites**

Run: `cd frontend/packages/web && pnpm test:run; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/web/src/pages/ProfilePage.tsx
git commit -m "refactor(web): quitar la verificacion por SMS del perfil"
```

---

### Task 3: Shared — remove the hooks and client methods

**Files:**
- Modify: `frontend/packages/shared/hooks/index.ts`
- Modify: `frontend/packages/shared/api/client.ts`

- [ ] **Step 1: Remove the hooks**

Delete `useSendSmsOTP` (~1137) and `useConfirmSmsOTP` (~1147) with their type parameters.

- [ ] **Step 2: Remove the client methods**

Delete `sendSmsOtp` (~1041) and `confirmSmsOtp` (~1045).

- [ ] **Step 3: Prove the layer is clean**

Run: `cd frontend/packages && rg -n 'SmsOtp|SmsOTP' shared/ web/src/ mobile/ || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 4: Run both frontend suites**

Run: `cd frontend/packages/web && pnpm test:run; echo "WEB=$?"` then `cd ../mobile && pnpm test:run; echo "MOBILE=$?"`
Expected: both `=0`. If `client.test.ts` asserted the SMS methods, delete those cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared
git commit -m "refactor(shared): quitar hooks y cliente de OTP por SMS"
```

---

### Task 4: i18n — remove the SMS keys

**Files:**
- Modify: `frontend/packages/mobile/i18n/locales/{es,en,pt}.json`
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

- [ ] **Step 1: Remove the keys**

Mobile (~lines 111-112, 143-146 in `es.json`, and their siblings in `en`/`pt`): `smsUnavailable`, `smsUnavailableText`, `verifySmsTitle`, `verifySmsCode`, `sendSmsTo`, `checkSmsCode`.
Web: `stepPhoneDesc` (~line 428) and any sibling key of the phone-verification block.
Remove the same key names from all three locales of each package — a key present in one language and missing in another renders as the raw key (rule #21).

- [ ] **Step 2: Validate every file is still JSON**

Run:
```bash
cd frontend/packages && for f in mobile/i18n/locales/{es,en,pt}.json web/src/i18n/locales/{es,en,pt}.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'));console.log('$f ok')"; done
```
Expected: six `ok` lines.

- [ ] **Step 3: Prove the keys are gone and symmetric**

Run: `cd frontend/packages && rg -n 'smsUnavailable|verifySms|sendSmsTo|checkSmsCode|stepPhoneDesc' mobile/i18n web/src/i18n || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 4: Run both frontend suites**

Run: `cd frontend/packages/web && pnpm test:run; echo "WEB=$?"` then `cd ../mobile && pnpm test:run; echo "MOBILE=$?"`
Expected: both `=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/i18n frontend/packages/web/src/i18n
git commit -m "refactor(i18n): quitar los textos de verificacion por SMS"
```

---

### Task 5: Backend — remove the routes, handler and DTOs

**Files:**
- Modify: `backend/internal/app/router.go`
- Modify: `backend/internal/handler/verification_handler.go`
- Modify: `backend/internal/dto/verification_dto.go`

- [ ] **Step 1: Remove the routes**

In `router.go`, delete lines 472 and 474 (`/verification/send-sms`, `/verification/confirm-sms`). Leave `send-email` and `confirm-email` untouched.

- [ ] **Step 2: Remove the handler methods**

Delete `SendSMS` (~line 55) and `ConfirmSMS` (~line 105) with their doc comments.

- [ ] **Step 3: Remove the DTOs**

In `verification_dto.go`, delete `SendSMSRequest` and `ConfirmSMSRequest`.

- [ ] **Step 4: Build and vet**

Run: `cd backend && go build ./... && go vet ./...; echo "EXIT=$?"`
Expected: `EXIT=0`. The service still has its `sms` branches — that is Task 6.

- [ ] **Step 5: Run the backend suite**

Run:
```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/a5.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. Delete any handler test covering the removed endpoints. **`DATABASE_URL` is mandatory** or the integration tests skip silently; **never point it at `lostpets`** — that wipes the local seed.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/app/router.go backend/internal/handler backend/internal/dto backend/tests
git commit -m "refactor(auth): quitar los endpoints de verificacion por SMS"
```

---

### Task 6: Backend — remove the service branches, `pkg/sms` and the Twilio config

**Files:**
- Modify: `backend/internal/service/verification_service.go`
- Modify: `backend/internal/app/router.go`
- Modify: `backend/config/config.go`
- Delete: `backend/pkg/sms/`

- [ ] **Step 1: Collapse the service to a single channel**

In `verification_service.go`:
- Drop the `smsSender` field (line 31) and the `s sms.SMSSender` constructor parameter (line 41) and its assignment (line 48).
- Drop the `lost-pets/pkg/sms` import.
- Replace the `channel != "email" && channel != "sms"` guard with an `email`-only check.
- Remove the phone validation (~line 69), the `channel == "sms"` branch (~line 106), the `case "sms"` send (~lines 120-121), the `TargetPhone` comparison (~line 161) and the `case "sms"` in the verified-flag switch (~line 198).

**Keep** `user.PhoneVerified` in the `IsVerified` invariant (line 207) and in the
`VerificationMethod` switch. It becomes write-once history: nothing can set it any more, but
existing `true` values must keep counting.

- [ ] **Step 2: Update the wiring**

In `router.go`, delete the `smsSenderClient := sms.NewTwilioSender(...)` line, drop the `sms` import, and remove the argument from `service.NewVerificationService(...)`.

- [ ] **Step 3: Delete the package and the config**

```bash
git rm -r backend/pkg/sms
```
In `config/config.go`, remove `TwilioAccountSID`, `TwilioAuthToken`, `TwilioFromNumber` (lines 34-36) and their `getEnv` calls (lines 89-91).

- [ ] **Step 4: Build and vet**

Run: `cd backend && go build ./... && go vet ./...; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Fix and run the tests**

Run:
```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/a6.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. `verification_service_test.go` mocks an SMS sender and covers `channel="sms"`: delete those cases and the mock, and drop the argument from every `NewVerificationService` call. Keep any case asserting that a pre-existing `PhoneVerified` still yields `IsVerified`; add one if none exists.

- [ ] **Step 6: Commit**

```bash
git add -A backend
git commit -m "refactor(auth): quitar pkg/sms y la config de Twilio del servicio"
```

---

### Task 7: Repo-wide proof, docs and PR

**Files:** `CLAUDE.md`, `backend/.env.example`

- [ ] **Step 1: Prove nothing live references SMS verification**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && rg -n 'send-sms|confirm-sms|SmsOtp|SmsOTP|TWILIO_|pkg/sms|verify-phone' --glob '!docs/**' --glob '!CLAUDE.md' . || echo "CLEAN"
```
Expected: `CLEAN`. Docs and `CLAUDE.md` are excluded because they describe history; they are updated in Step 3 rather than emptied.

- [ ] **Step 2: Remove the Twilio entries from the env example**

Delete `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` from `backend/.env.example`. Leaving them invites someone to configure a dependency that no longer exists.

- [ ] **Step 3: Correct `CLAUDE.md`, which currently contradicts this change**

Rule #24's roadmap note says the Twilio code "es **solo para el OTP de verificación** y se queda así" — the 2026-07-29 decision this change supersedes. Rewrite it to state that the OTP path was removed on 2026-07-31, why (the only paid dependency, and the only route in the API with no rate limit), and that `users.phone_verified` was kept as history. Also update the V1.3 roadmap line that claims verification works "+ teléfono vía Twilio".

- [ ] **Step 4: Full verification**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/a7.log 2>&1; echo "BACKEND=$?"
cd ../frontend/packages/web && pnpm test:run; echo "WEB=$?"
cd ../mobile && pnpm test:run; echo "MOBILE=$?"
```
Expected: all three `=0`.

- [ ] **Step 5: E2E against a fresh database**

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS lostpets_test;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE lostpets_test;" -q
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret-e2e go test -tags e2e -count=1 ./tests/e2e/...; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 6: Open the PR**

Run `git log --oneline origin/main..HEAD` first: only this plan's commits plus the spec may appear. More than that means the branch came off the wrong base (rule #30). Then follow the `searchpet-pr` skill. Flag in the body that this removes a public API surface and the only paid dependency, and that `users.phone_verified` was deliberately kept.

---

## Notes for the implementer

- **`users.phone_verified` stays.** Deleting it would silently un-verify real users. The column becomes write-once history and `IsVerified` keeps reading it.
- **Judge every run by its exit code**, never by grepping output for `FAIL` — that pipe reports success when it matched nothing, which is not the same as no failures (rule #41).
- **Mobile is `pnpm test:run`**, never `pnpm test`.
- If a removal makes a test fail, ask whether the test was asserting the removed behaviour (delete it) or something that must survive (fix the code). Do not weaken an assertion to make a deletion pass.
