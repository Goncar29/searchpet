# Google Sign-In on mobile — design

**Date:** 2026-07-27
**Status:** approved, ready for implementation planning
**Depends on:** Google Sign-In (web), shipped 2026-07-27 — PR #108 (`ee8b295`), PR #109 (`c616468`)

## Problem

Google Sign-In is live on the web. Mobile still offers only email and password. The backend
was deliberately kept generic during the web work, so the server side is already in place:
`POST /api/auth/google` accepts `{id_token}`, verifies it, and links or creates the account.

## Scope

**In scope:** the mobile app only — acquiring a Google ID token natively and feeding it to
the endpoint that already exists.

**Out of scope, and deliberately so:**

- The backend. No handler, service, or migration changes.
- `frontend/packages/shared/`. The web work already added everything mobile needs there.
- iOS. Android first; the design leaves room for iOS but does not build it.

## What already exists and is reused as-is

| Asset | Location | Added by |
|---|---|---|
| `apiClient.loginWithGoogle(idToken)` | `shared/api/client.ts:233` | web PR #108 |
| `GoogleAuthResponse` (`user`, `token`, `is_new_user`) | `shared/types/index.ts:396` | web PR #108 |
| Error strings `google_*` in es/en/pt | `shared/i18n/locales/*.json` | web PR #108 |
| `PATCH /api/auth/me/location` | backend | web PR #108 |

Mobile adds only the native token acquisition and its own UI.

## Why not Expo Go

Expo Go was the user's normal development flow, and it cannot do this. Verified against
Expo's own documentation on 2026-07-27:

- Google authentication guide: *"These libraries can't be used in Expo Go because they
  require custom native code."* Both libraries Expo lists require a development build.
- AuthSession reference: recommends `@react-native-google-signin/google-signin` for Google
  and no longer documents its own Google provider. In Expo Go the redirect URI is
  `exp://127.0.0.1:8081/--/redirect`, which Google will not accept.

A third option — opening the web login in a browser and deep-linking the JWT back through
the `searchpet` scheme — was rejected. It would work in Expo Go, but on Android another app
can claim the same scheme and intercept the token. That trades a tooling constraint for a
security hole plus bespoke auth code to maintain.

**Consequence:** this project leaves Expo Go for a development build. `eas.json` already
carries a `development` profile with `developmentClient: true`, so the cost is one EAS build
(of 30 free per month). Afterwards `npx expo start --dev-client` keeps the normal hot-reload
workflow; a rebuild is needed only when native dependencies change.

## Architecture

```
login.tsx / register.tsx
  └─ GoogleSignInButton (mobile)
       └─ GoogleSignin.signIn()        ← native, returns idToken
            └─ authStore.loginWithGoogle(idToken)
                 └─ apiClient.loginWithGoogle(idToken)   ← already exists
                      └─ POST /api/auth/google           ← already in production
```

The button owns the native call and nothing else. The store owns session persistence. The
screens own navigation. Each is testable on its own: the button with the native module
mocked, the store with the api client mocked, the screens with the store mocked.

### Load-bearing assumption, verified first

`webClientId` is documented as *"client ID of type WEB for your server. Required to get the
`idToken`"*, which implies the token's `aud` is the **web** client id — the same value
`GOOGLE_CLIENT_ID` already checks on the backend. The library docs do not state the `aud`
explicitly.

**Task 1 of implementation decodes a real token and asserts `aud`.** If it turns out to be
the Android client id instead, the backend must accept multiple audiences and the scope of
this work changes. Finding that out first costs minutes; finding it out last costs the plan.

## Components

**1. Dependency and native config**
`@react-native-google-signin/google-signin` plus its config plugin in `app.json`. Web client
id supplied through `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — public by design, exactly like
`VITE_GOOGLE_CLIENT_ID` on the web (rule #25: GIS is a public client, there is no secret).

**2. Google Cloud**
A new **Android** OAuth client: package `com.searchpet.app` plus the signing key's SHA-1.

This is the step most likely to cost an afternoon. **Every keystore has its own SHA-1**, and
a mismatch fails as a bare `DEVELOPER_ERROR` with no useful detail. Three fingerprints must
be registered:

- the EAS `development` build keystore,
- the EAS `preview` keystore that produces the distributed APK (`build-apk.yml`),
- Google Play's re-signing key, if the app is ever published.

`eas credentials` prints the fingerprints. The implementation plan lists the exact commands.

**3. `store/index.ts` — `loginWithGoogle(idToken)`**
Mirrors the existing `login` action step for step: persist the token in SecureStore, call
`apiClient.setToken`, set the user, then register the FCM token (fire-and-forget, as today).
Returns `is_new_user` so the screen can decide what comes next.

**4. UI**
A mobile `GoogleSignInButton`, used by both `login.tsx` and `register.tsx` — mirroring the
web, where a shared panel serves both pages. When `is_new_user` is true, a location step
using `expo-location`, which is already a dependency and already configured in `app.json`.

**5. Tests**
Jest with the native module mocked. Per rule #17, mobile screen smoke tests mock
`@shared/hooks` hook by hook, so the `login` and `register` tests need the new mock added, and
`pnpm test:run` is the command — never `pnpm test`, which is watch mode.

Coverage: button renders and calls the store; native cancellation is not an error; a
`DEVELOPER_ERROR` surfaces a readable message; the store persists the token and registers
FCM; `is_new_user` routes to the location step.

## Error handling

The native module throws typed status codes. They map to user-facing copy through the
existing `getErrorMessage(err, t)` contract (rule #11) — no raw `err.message` reaches the
user, and no new error vocabulary is invented on the client.

| Native outcome | Behaviour |
|---|---|
| `SIGN_IN_CANCELLED` | Silent. The user chose to back out; it is not an error. |
| `PLAY_SERVICES_NOT_AVAILABLE` | Explain that Google Play services are required. |
| `DEVELOPER_ERROR` | Misconfigured SHA-1 or client id. Generic message to the user, detail to the log — this is a build problem, not a user problem. |
| Backend `{code,message}` | Reuse the `google_*` strings already in `shared/i18n`. |

## Risks

| Risk | Mitigation |
|---|---|
| `aud` is not the web client id | Verified in task 1, before anything is built on the assumption |
| SHA-1 mismatch → `DEVELOPER_ERROR` | Register all three fingerprints; the plan lists the commands |
| Leaving Expo Go slows iteration | One build, then `--dev-client` restores hot reload |
| EAS free tier: 30 builds/month | The design needs one; a second only if native deps change |

## Success criteria

- A real Google login on an Android development build creates or links an account and lands
  in the app authenticated.
- An account created on mobile with Google and then used on the web resolves to the **same**
  account — the `sub` match and case-insensitive email match already guarantee this
  (rules #25 and #26).
- Cancelling the native dialog leaves the app exactly as it was, with no error shown.
- `pnpm test:run` green in `mobile/`.
- Email and password login is untouched and still works.
