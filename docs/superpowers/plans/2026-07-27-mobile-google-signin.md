# Mobile Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a mobile user sign in with Google, reaching the `POST /api/auth/google` endpoint that already runs in production.

**Architecture:** The native SDK returns a Google ID token. A button component owns that native call, the Zustand auth store owns session persistence, and the screens own navigation. The backend, `shared/api/client.ts`, `shared/types`, and the `google_*` i18n strings are already in place from the web work and are not touched.

**Tech Stack:** Expo SDK 52.0.49, React Native 0.76.5, `@react-native-google-signin/google-signin@16.1.4`, Zustand, expo-secure-store, Jest + jest-expo.

**Design:** `docs/superpowers/specs/2026-07-27-mobile-google-signin-design.md`

---

## Verified facts this plan is built on

Checked on 2026-07-27; do not re-derive:

- `@react-native-google-signin/google-signin@16.1.4`, peer `expo >=52.0.40`. Installed Expo is **52.0.49** — satisfied.
- `signIn()` returns a **discriminated union**, it does NOT throw on cancellation:
  - `{ type: 'success', data: { idToken: string | null, user: {...} } }`
  - `{ type: 'cancelled', data: null }`
- `apiClient.loginWithGoogle(idToken)` already exists at `shared/api/client.ts:233` and returns `GoogleAuthResponse` = `{ user, token, is_new_user }`.
- Mobile tests are run with **`pnpm test:run`**. `pnpm test` is watch mode and never exits (CLAUDE.md rule #17).

## File structure

| File | Responsibility |
|---|---|
| `mobile/package.json` | Adds the dependency |
| `mobile/app.json` | Registers the config plugin |
| `mobile/.env.example` | Documents `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| `mobile/__mocks__/google-signin.js` | Native module stub so Jest can run |
| `mobile/jest.config.js` | Maps the native module to the stub |
| `mobile/store/index.ts` | `loginWithGoogle` action — session persistence only |
| `mobile/components/GoogleSignInButton.tsx` | Owns the native call and its failure modes |
| `mobile/app/login.tsx`, `mobile/app/register.tsx` | Mount the button, route on the result |
| `mobile/app/google-location.tsx` | One-time location step for new accounts |
| `mobile/__tests__/*.test.tsx` | Tests per unit |

---

### Task 1: Add the dependency and native configuration

**Files:**
- Modify: `frontend/packages/mobile/package.json`
- Modify: `frontend/packages/mobile/app.json`
- Create: `frontend/packages/mobile/.env.example`

- [ ] **Step 1: Install**

```bash
cd frontend/packages/mobile
pnpm add @react-native-google-signin/google-signin@16.1.4
```

- [ ] **Step 2: Confirm the installed API shape matches this plan**

```bash
node -p "Object.keys(require('@react-native-google-signin/google-signin'))"
```

Expected: an array containing `GoogleSignin` and `statusCodes`. If `signIn()` in the installed version returns the user object directly instead of `{type, data}`, STOP — the version differs from 16.1.4 and every code block below that reads `result.type` must be adjusted.

- [ ] **Step 3: Register the config plugin**

In `app.json`, the `plugins` array becomes:

```json
    "plugins": [
      "expo-router",
      "expo-location",
      "expo-image-picker",
      "expo-camera",
      "expo-secure-store",
      "expo-notifications",
      "@react-native-google-signin/google-signin"
    ],
```

- [ ] **Step 4: Document the env var**

Create `frontend/packages/mobile/.env.example`:

```
# Google Sign-In — the SAME OAuth 2.0 Web client id the backend verifies as the
# token audience, and the same value the web uses in VITE_GOOGLE_CLIENT_ID.
# Public by design (CLAUDE.md rule #25: GIS is a public client, there is no secret).
# Leave empty to hide the Google button entirely.
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/package.json frontend/packages/mobile/pnpm-lock.yaml frontend/packages/mobile/app.json frontend/packages/mobile/.env.example
git commit -m "build(mobile): add the Google Sign-In native dependency"
```

---

### Task 2: Make the native module testable

Jest cannot load the native module. Everything downstream depends on this stub existing first.

**Files:**
- Create: `frontend/packages/mobile/__mocks__/google-signin.js`
- Modify: `frontend/packages/mobile/jest.config.js`

- [ ] **Step 1: Create the stub**

```javascript
// Native module stub. The real one cannot load under Jest.
// Mirrors @react-native-google-signin/google-signin@16: signIn() RESOLVES with a
// discriminated union and does not throw on cancellation.
const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  DEVELOPER_ERROR: 'DEVELOPER_ERROR',
};

module.exports = {
  statusCodes,
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
};
```

- [ ] **Step 2: Map it in Jest**

In `jest.config.js`, inside `moduleNameMapper`, add as the FIRST entry:

```javascript
    '^@react-native-google-signin/google-signin$': '<rootDir>/__mocks__/google-signin.js',
```

- [ ] **Step 3: Verify the suite still passes**

```bash
cd frontend/packages/mobile && pnpm test:run
```

Expected: all suites pass, unchanged count.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/mobile/__mocks__/google-signin.js frontend/packages/mobile/jest.config.js
git commit -m "test(mobile): stub the Google Sign-In native module"
```

---

### Task 3: `loginWithGoogle` in the auth store

Mirrors the existing `login` action exactly: SecureStore, api token, state, FCM registration. Returns `is_new_user` so the caller can route.

**Files:**
- Modify: `frontend/packages/mobile/store/index.ts`
- Modify: `frontend/packages/mobile/__mocks__/shared-api-client.js`
- Create: `frontend/packages/mobile/__tests__/authStore.google.test.ts`

- [ ] **Step 1: Add `loginWithGoogle` to the api client mock**

In `__mocks__/shared-api-client.js`, the `apiClient` object gains one line:

```javascript
    loginWithGoogle: jest.fn(),
```

- [ ] **Step 2: Write the failing test**

```typescript
import { useAuthStore } from '../store';
import { apiClient } from '../../shared/api/client';
import * as SecureStore from 'expo-secure-store';
import { registerPushToken } from '../utils/notifications';

const RESPONSE = {
  user: { id: 'u1', name: 'Carlos', email: 'c@example.com' },
  token: 'jwt-token',
  is_new_user: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

test('persists the session and reports a new user', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockResolvedValue(RESPONSE);

  const isNew = await useAuthStore.getState().loginWithGoogle('google-id-token');

  expect(isNew).toBe(true);
  expect(apiClient.loginWithGoogle).toHaveBeenCalledWith('google-id-token');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'jwt-token');
  expect(apiClient.setToken).toHaveBeenCalledWith('jwt-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(useAuthStore.getState().user).toEqual(RESPONSE.user);
});

test('registers the push token like the password login does', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockResolvedValue({ ...RESPONSE, is_new_user: false });

  const isNew = await useAuthStore.getState().loginWithGoogle('google-id-token');

  expect(isNew).toBe(false);
  expect(registerPushToken).toHaveBeenCalled();
});

test('leaves the session untouched when the backend rejects the token', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockRejectedValue(new Error('401'));

  await expect(useAuthStore.getState().loginWithGoogle('bad')).rejects.toThrow();

  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
```

- [ ] **Step 2b: Run it and watch it fail**

```bash
cd frontend/packages/mobile && pnpm test:run -- authStore.google
```

Expected: FAIL — `loginWithGoogle is not a function`.

- [ ] **Step 3: Implement**

In `store/index.ts`, add to the `AuthState` interface, directly under `login`:

```typescript
  loginWithGoogle: (idToken: string) => Promise<boolean>;
```

And add the action directly after the `login` action:

```typescript
  loginWithGoogle: async (idToken) => {
    // Mismo contrato que `login`: persistir, setear el token del cliente y
    // registrar FCM. Devuelve is_new_user para que la pantalla decida si hay
    // que pedir ubicación.
    const response = await apiClient.loginWithGoogle(idToken);
    await SecureStore.setItemAsync('auth_token', response.token);
    await SecureStore.setItemAsync('user_data', JSON.stringify(response.user));
    apiClient.setToken(response.token);

    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });

    // Registrar token FCM — falla silenciosamente si el usuario denegó permisos
    registerPushToken();

    return response.is_new_user;
  },
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd frontend/packages/mobile && pnpm test:run -- authStore.google
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/store/index.ts frontend/packages/mobile/__mocks__/shared-api-client.js frontend/packages/mobile/__tests__/authStore.google.test.ts
git commit -m "feat(mobile): add loginWithGoogle to the auth store"
```

---

### Task 4: `GoogleSignInButton`

Owns the native call and every way it can fail. Renders nothing when the client id is absent, mirroring the web component.

**Files:**
- Create: `frontend/packages/mobile/components/GoogleSignInButton.tsx`
- Create: `frontend/packages/mobile/__tests__/GoogleSignInButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
});

afterAll(() => {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = ORIGINAL_ENV;
});

test('renders nothing when the client id is not configured', () => {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = '';
  const { queryByRole } = render(<GoogleSignInButton onToken={jest.fn()} />);
  expect(queryByRole('button')).toBeNull();
});

test('hands the id token to onToken', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token', user: { email: 'c@example.com' } },
  });
  const onToken = jest.fn();

  const { getByRole } = render(<GoogleSignInButton onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(onToken).toHaveBeenCalledWith('google-id-token'));
});

test('cancelling is silent — it is a choice, not an error', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: null });
  const onToken = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(GoogleSignin.signIn).toHaveBeenCalled());
  expect(onToken).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('a success response with a null idToken is treated as a failure', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: null, user: { email: 'c@example.com' } },
  });
  const onToken = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(onToken).not.toHaveBeenCalled();
});

test('reports missing Play services', async () => {
  const err: Error & { code?: string } = new Error('no play services');
  err.code = statusCodes.PLAY_SERVICES_NOT_AVAILABLE;
  (GoogleSignin.signIn as jest.Mock).mockRejectedValue(err);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton onToken={jest.fn()} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(alert).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/mobile && pnpm test:run -- GoogleSignInButton
```

Expected: FAIL — cannot resolve `../components/GoogleSignInButton`.

- [ ] **Step 3: Implement**

```typescript
// ============================================================
// SearchPet - Google Sign-In button (mobile)
// ============================================================

import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

interface Props {
  /** Called with the Google ID token once the native flow succeeds. */
  onToken: (idToken: string) => void | Promise<void>;
}

/**
 * Renders nothing when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset, so a build
 * without the credential simply has no Google button instead of a broken one.
 */
export function GoogleSignInButton({ onToken }: Props) {
  const { t } = useTranslation('auth');
  const [isLoading, setIsLoading] = useState(false);
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    // webClientId is what makes the returned idToken addressed to OUR backend:
    // its audience is this web client id, the same value GOOGLE_CLIENT_ID checks.
    GoogleSignin.configure({ webClientId: clientId });
  }, [clientId]);

  if (!clientId) return null;

  const handlePress = async () => {
    setIsLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();

      // v16 resolves with a discriminated union — cancelling is NOT an exception.
      if (result.type === 'cancelled') return;

      const idToken = result.data?.idToken;
      if (!idToken) {
        // Success without a token means the webClientId is missing or wrong;
        // there is nothing to send to the backend.
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.failed'));
        return;
      }

      await onToken(idToken);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.playServices'));
      } else if (code === statusCodes.IN_PROGRESS) {
        // A second tap while the first dialog is open. Nothing to report.
      } else {
        // DEVELOPER_ERROR lands here: a SHA-1 or client-id misconfiguration.
        // The user cannot act on it, so keep the message generic and log the detail.
        console.warn('[GoogleSignInButton] sign-in failed:', error);
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.failed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={styles.button}
      onPress={handlePress}
      disabled={isLoading}
    >
      {isLoading ? (
        <ActivityIndicator color={COLORS.textPrimary} />
      ) : (
        <Text style={styles.label}>{t('google.signIn')}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
  },
  label: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});
```

Constants used here were checked against `mobile/constants/index.ts` on 2026-07-27 and all exist:
`COLORS.border`, `COLORS.textPrimary`, `COLORS.white`, `COLORS.primary`, `COLORS.background`,
`COLORS.textSecondary`, `FONTS.sizes.md`, `FONTS.sizes.xl`, `SPACING.{sm,md,lg,xl}`, `RADIUS.md`.
Note there is **no** `FONTS.body`, no `FONTS.h2`, no `COLORS.text` and no `COLORS.textLight` — those are the names to avoid.

- [ ] **Step 4: Add the i18n strings**

In `frontend/packages/shared/i18n/locales/es.json`, inside the existing `auth.google` object, add:

```json
        "signIn": "Continuar con Google",
        "failed": "No pudimos iniciar sesión con Google. Intentá de nuevo.",
        "playServices": "Necesitás Google Play services para entrar con Google."
```

In `en.json`:

```json
        "signIn": "Continue with Google",
        "failed": "We couldn't sign you in with Google. Please try again.",
        "playServices": "Google Play services is required to sign in with Google."
```

In `pt.json`:

```json
        "signIn": "Continuar com o Google",
        "failed": "Não foi possível entrar com o Google. Tente novamente.",
        "playServices": "O Google Play services é necessário para entrar com o Google."
```

Check first whether `signIn` already exists in that object from the web work — if so, reuse it and add only the missing keys.

- [ ] **Step 5: Run and watch it pass**

```bash
cd frontend/packages/mobile && pnpm test:run -- GoogleSignInButton
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/mobile/components/GoogleSignInButton.tsx frontend/packages/mobile/__tests__/GoogleSignInButton.test.tsx frontend/packages/shared/i18n/locales
git commit -m "feat(mobile): add the Google sign-in button"
```

---

### Task 5: Mount the button on the login screen

**Files:**
- Modify: `frontend/packages/mobile/app/login.tsx`
- Create: `frontend/packages/mobile/__tests__/login.google.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import LoginScreen from '../app/login';
import { useAuthStore } from '../store';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
});

test('an existing user signing in with Google is sent back, not to onboarding', async () => {
  const loginWithGoogle = jest.fn().mockResolvedValue(false);
  useAuthStore.setState({ loginWithGoogle } as never);
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token' },
  });

  const { getByText } = render(<LoginScreen />);
  fireEvent.press(getByText('google.signIn'));

  await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledWith('google-id-token'));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/mobile && pnpm test:run -- login.google
```

Expected: FAIL — no element with text `google.signIn`.

- [ ] **Step 3: Implement**

In `app/login.tsx`, add the imports:

```typescript
import { GoogleSignInButton } from '../components/GoogleSignInButton';
```

Add the store selector next to the existing `login` one:

```typescript
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);
```

Add the handler after `handleLogin`:

```typescript
  const handleGoogleToken = async (idToken: string) => {
    try {
      const isNewUser = await loginWithGoogle(idToken);
      // Un usuario nuevo pasa por el paso de ubicación; uno que vuelve, no.
      if (isNewUser) {
        router.replace('/google-location');
      } else {
        router.back();
      }
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    }
  };
```

And mount the button directly after the submit `TouchableOpacity`, before the register link:

```tsx
        <GoogleSignInButton onToken={handleGoogleToken} />
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd frontend/packages/mobile && pnpm test:run -- login.google
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/app/login.tsx frontend/packages/mobile/__tests__/login.google.test.tsx
git commit -m "feat(mobile): offer Google sign-in on the login screen"
```

---

### Task 6: Mount the button on the register screen

Same wiring, different screen. The code is repeated in full deliberately — do not write "same as Task 5".

**Files:**
- Modify: `frontend/packages/mobile/app/register.tsx`
- Create: `frontend/packages/mobile/__tests__/register.google.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import RegisterScreen from '../app/register';
import { useAuthStore } from '../store';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
});

test('signing up with Google routes a new account to the location step', async () => {
  const loginWithGoogle = jest.fn().mockResolvedValue(true);
  useAuthStore.setState({ loginWithGoogle } as never);
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token' },
  });

  const { getByText } = render(<RegisterScreen />);
  fireEvent.press(getByText('google.signIn'));

  await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledWith('google-id-token'));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/mobile && pnpm test:run -- register.google
```

Expected: FAIL — no element with text `google.signIn`.

- [ ] **Step 3: Implement**

Open `app/register.tsx` and read its existing imports and handler names before editing — it follows the same shape as `login.tsx` but is a longer form. Add:

```typescript
import { GoogleSignInButton } from '../components/GoogleSignInButton';
```

```typescript
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);
```

```typescript
  const handleGoogleToken = async (idToken: string) => {
    try {
      const isNewUser = await loginWithGoogle(idToken);
      if (isNewUser) {
        router.replace('/google-location');
      } else {
        router.back();
      }
    } catch (error) {
      Alert.alert(i18next.t('common:error'), getErrorMessage(error, (key) => i18next.t(key)));
    }
  };
```

Mount `<GoogleSignInButton onToken={handleGoogleToken} />` directly after the submit button.

If `register.tsx` does not already import `Alert`, `i18next`, or `getErrorMessage`, add those imports too — match the import block in `login.tsx`.

- [ ] **Step 4: Run and watch it pass**

```bash
cd frontend/packages/mobile && pnpm test:run -- register.google
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/app/register.tsx frontend/packages/mobile/__tests__/register.google.test.tsx
git commit -m "feat(mobile): offer Google sign-in on the register screen"
```

---

### Task 7: Location step for accounts created with Google

A Google account arrives with no location, and nearby search is the point of the app. This screen asks once and is skippable.

**Files:**
- Create: `frontend/packages/mobile/app/google-location.tsx`
- Create: `frontend/packages/mobile/__tests__/google-location.test.tsx`

The method already exists — verified 2026-07-27 at `shared/api/client.ts:251`:

```typescript
  async updateMyLocation(data: UpdateLocationRequest): Promise<User> {
    return this.request<User>('PATCH', '/api/auth/me/location', data);
  }
```

It is `updateMyLocation`, **not** `updateLocation`. Nothing to add to the shared client.

- [ ] **Step 1: Add the method to the api client mock**

In `__mocks__/shared-api-client.js`, add to `apiClient`:

```javascript
    updateMyLocation: jest.fn(),
```

- [ ] **Step 2: Write the failing test**

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { apiClient } from '../../shared/api/client';
import GoogleLocationScreen from '../app/google-location';

beforeEach(() => jest.clearAllMocks());

test('sends the coordinates when permission is granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: -34.9011, longitude: -56.1645 },
  });
  (apiClient.updateMyLocation as jest.Mock).mockResolvedValue({});

  const { getByText } = render(<GoogleLocationScreen />);
  fireEvent.press(getByText('google.location.allow'));

  await waitFor(() =>
    expect(apiClient.updateMyLocation).toHaveBeenCalledWith({
      latitude: -34.9011,
      longitude: -56.1645,
    }),
  );
});

test('skipping does not call the api', async () => {
  const { getByText } = render(<GoogleLocationScreen />);
  fireEvent.press(getByText('google.location.skip'));

  await waitFor(() => expect(apiClient.updateMyLocation).not.toHaveBeenCalled());
});

test('a denied permission is not an error — the user moves on', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

  const { getByText } = render(<GoogleLocationScreen />);
  fireEvent.press(getByText('google.location.allow'));

  await waitFor(() => expect(apiClient.updateMyLocation).not.toHaveBeenCalled());
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd frontend/packages/mobile && pnpm test:run -- google-location
```

Expected: FAIL — cannot resolve `../app/google-location`.

- [ ] **Step 5: Implement**

```typescript
// ============================================================
// SearchPet - Location step for accounts created with Google
// ============================================================

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../shared/api/client';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

/**
 * A Google account arrives without a location, and nearby search is the point of
 * the app. Asked once, always skippable: a denied permission is a choice, not a
 * failure, so it never blocks the user from reaching the app.
 */
export default function GoogleLocationScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [isLoading, setIsLoading] = useState(false);

  const finish = () => router.replace('/');

  const handleAllow = async () => {
    setIsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        finish();
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      await apiClient.updateMyLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch {
      // Best-effort: la ubicación se puede setear después desde el perfil.
    } finally {
      setIsLoading(false);
      finish();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('google.location.title')}</Text>
      <Text style={styles.subtitle}>{t('google.location.subtitle')}</Text>

      <TouchableOpacity style={styles.primary} onPress={handleAllow} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.primaryLabel}>{t('google.location.allow')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={finish} disabled={isLoading}>
        <Text style={styles.skip}>{t('google.location.skip')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: SPACING.xl, backgroundColor: COLORS.background },
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  subtitle: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, marginBottom: SPACING.xl },
  primary: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  primaryLabel: { color: COLORS.white, fontSize: FONTS.sizes.md, fontWeight: '600' },
  skip: { textAlign: 'center', marginTop: SPACING.lg, color: COLORS.textSecondary },
});
```

- [ ] **Step 6: Add the i18n strings**

In `shared/i18n/locales/es.json`, inside `auth.google`, add a `location` object:

```json
        "location": {
          "title": "¿Dónde buscás?",
          "subtitle": "Usamos tu ubicación para mostrarte mascotas perdidas cerca tuyo.",
          "allow": "Usar mi ubicación",
          "skip": "Ahora no"
        }
```

`en.json`:

```json
        "location": {
          "title": "Where are you searching?",
          "subtitle": "We use your location to show you lost pets nearby.",
          "allow": "Use my location",
          "skip": "Not now"
        }
```

`pt.json`:

```json
        "location": {
          "title": "Onde você está procurando?",
          "subtitle": "Usamos sua localização para mostrar animais perdidos perto de você.",
          "allow": "Usar minha localização",
          "skip": "Agora não"
        }
```

- [ ] **Step 7: Run and watch it pass**

```bash
cd frontend/packages/mobile && pnpm test:run -- google-location
```

Expected: 3 passed.

- [ ] **Step 8: Run the whole suite**

```bash
cd frontend/packages/mobile && pnpm test:run
```

Expected: every suite green.

- [ ] **Step 9: Commit**

```bash
git add frontend/packages/mobile/app/google-location.tsx frontend/packages/mobile/__tests__/google-location.test.tsx frontend/packages/mobile/__mocks__/shared-api-client.js frontend/packages/shared/i18n/locales
git commit -m "feat(mobile): ask new Google accounts for their location"
```

---

### Task 8: [REQUIRES THE ACCOUNT OWNER] Google Cloud credentials

Nothing above can be exercised on a device until this exists. It cannot be done by an agent — it needs the project owner's Google Cloud and Expo accounts.

- [ ] **Step 1: Read the signing fingerprints**

```bash
cd frontend/packages/mobile
npx eas credentials
```

Choose Android, then the `development` profile, and note the **SHA-1 Fingerprint**. Repeat for the `preview` profile — the one `build-apk.yml` distributes. They are usually different keystores, and **each needs its own entry**.

- [ ] **Step 2: Create the Android OAuth client**

In Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID:
- Application type: **Android**
- Package name: `com.searchpet.app`
- SHA-1: the `development` fingerprint from Step 1

Repeat for the `preview` fingerprint. If the app is ever published, add Google Play's app-signing SHA-1 as a third.

**A missing fingerprint fails as a bare `DEVELOPER_ERROR` with no detail.** If sign-in fails on a device but the code is untouched, this is the first thing to check.

- [ ] **Step 3: Set the client id**

Create `frontend/packages/mobile/.env` (gitignored) with the **web** client id — the same one the web uses, NOT the Android one just created:

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=436771110102-mo3o9c55flh5i8brebhfk5231ebbvo5g.apps.googleusercontent.com
```

Add the same variable to the `development` and `preview` `env` blocks in `eas.json` so EAS builds carry it.

---

### Task 9: [REQUIRES THE ACCOUNT OWNER] Build, verify the audience, test end to end

- [x] **Step 1: Build**

```bash
cd frontend/packages/mobile
npx eas build --profile development --platform android
```

Install the resulting APK, then `npx expo start --dev-client`.

Done 2026-07-28, build `9bad5bd9-1816-4986-9994-073066f180e7`. Three earlier
attempts died in the `Run gradlew` phase. Cause: the Kotlin Gradle plugin
resolved to 1.9.24 (from `@react-native/gradle-plugin@0.76.5`) while the Expo
SDK 52 template declared `ext.kotlinVersion = 1.9.25`, which made
`expo-modules-core` select a Compose Compiler that demanded 1.9.25. Fixed in
`af34806` by pinning `android.kotlinVersion` to 1.9.24 through
`expo-build-properties`. The `sed` in `build-apk.yml` that had been patching
the same classpath — only ever in GitHub Actions, which is why the APK
pipeline built and EAS did not — was removed in the same commit.

- [x] **Step 2: Verify the load-bearing assumption**

Sign in with Google. Before the token reaches the backend, print its audience — temporarily add this inside `handlePress` in `GoogleSignInButton.tsx`, right after `idToken` is read:

```typescript
      console.log('[aud]', JSON.parse(atob(idToken.split('.')[1])).aud);
```

Expected: the **web** client id (`436771110102-…`), matching `GOOGLE_CLIENT_ID` on the backend.

If it prints the **Android** client id instead, STOP. The backend must then accept several audiences, which is a change to `pkg/googleauth` and outside this plan. Record the finding and re-plan.

Remove the log line once confirmed.

**CONFIRMED 2026-07-28.** Read on device, twice, with a clean reinstall between
the two runs:

```
aud            = 436771110102-mo3o9c55flh5i8brebhfk5231ebbvo5g.apps.googleusercontent.com
iss            = https://accounts.google.com
email_verified = true
```

`aud` is the **web** client id, matching `GOOGLE_CLIENT_ID` on the backend. The
single-audience check in `pkg/googleauth` stands; no backend change is needed.
The temporary log has been removed.

- [ ] **Step 3: Test the flows**

Run against the **production** backend on Render, so the cross-client check
compares mobile against the live web.

- [x] New account: sign in with a Google account never used here → lands on the location step → reaches the app authenticated. Verified 2026-07-28.

  Both halves were checked, not just the visible one. The backend really did
  take the create path — a new `users` row appeared with the Google `sub` — and
  the app really did land on the location screen, so `router.replace` in
  `login.tsx` fired on `is_new_user: true`.

  Run against a **local** backend rather than production. `is_new_user` is
  decided by the database, so pointing the app at a database that has never seen
  the account makes an ordinary Google account new again — no throwaway account
  needed, and no test user left behind in production. See the note below on
  freeing the email.
- [x] Returning: sign in again → straight into the app, no location step. Verified 2026-07-28 on device, twice.
- [x] Cross-client: log in on the web with the same Google account → **the same account**, with the pets created on mobile (guaranteed by the `sub` match and case-insensitive email, rules #25 and #26). Verified 2026-07-28 against production.

  Run with an account that was created with email and password and linked to
  Google afterwards, which is the stronger case: it exercises the linking path
  in `LoginWithGoogle`, whereas an account created by Google never reaches it.
- [ ] Cancel: dismiss the native dialog → the screen is unchanged, no alert.
- [x] Email and password login still works. Verified 2026-07-28, after the account had been linked to Google.

  Worth recording *why* it still works: the password survived because the
  account was already email-verified when Google linked to it. `LoginWithGoogle`
  wipes `PasswordHash` when `!existing.EmailVerified` (`auth_service.go:315-317`),
  and the backend has no password-recovery flow, so an unverified account would
  have become Google-only permanently. This test passing on a *verified* account
  says nothing about the unverified path — that one is covered by unit tests, not
  here.

**Ordering constraint found during bring-up.** `is_new_user` is decided by the
backend, so the "new account" case is single-shot: once a Google account signs
in, it is a returning user forever. Test it with an account that has never
touched SearchPet on either client. Note that revoking third-party access from
the Google account does **not** reset this — the SearchPet user and its stored
`GoogleID` are untouched; it only forces the consent screen to reappear.

**Device note.** With a single Google account on the phone and consent already
granted, Android signs in with no dialog at all, so the cancel case cannot be
triggered. Either add a second Google account to the device or revoke access at
`myaccount.google.com` to bring the consent screen back. The cancel case needs
no backend at all — cancelling never sends a token anywhere — so it can be run
against production with no setup.

**Making an account new again, locally.** `LoginWithGoogle` only returns
`is_new_user: true` when the row is absent by *both* `google_id` and email, so
freeing the email is enough; deleting the user and cascading through its
foreign keys is not necessary:

```sql
UPDATE users SET email = '<archived>@local.test', google_id = '' WHERE id = '<id>';
```

To restore afterwards, delete the row the test created **first** — it holds the
real email, and the unique index will reject the restore otherwise.

- [ ] **Step 4: Commit any fixes found during bring-up**

---

### Task 10: Open the pull request

- [ ] **Step 1: Confirm the branch base**

```bash
git fetch origin
git log --oneline origin/main..HEAD
```

Expected: only this feature's commits. Anything else means the branch came off the wrong base — see CLAUDE.md rule #30.

- [ ] **Step 2: Full suite**

```bash
cd frontend/packages/mobile && pnpm test:run
```

- [ ] **Step 3: Open the PR**

Follow the `searchpet-pr` skill: conventional title, body with **Resumen**, **Cambios**, **Plan de prueba**, and a sensitive-surface note because this touches authentication. No AI attribution. **Do not merge** — the user controls that.
