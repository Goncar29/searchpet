# Google Sign-In — Diseño

**Fecha:** 2026-07-22
**Alcance de esta iteración:** Agregar "Iniciar sesión con Google" como opción **adicional** de auth en la **web** (el formulario email+contraseña se mantiene intacto), con captura de ubicación y foto de perfil en el alta. Backend genérico para poder sumar mobile en una iteración futura.

> **Corrección (2026-07-26):** el alcance dice que email+contraseña queda "intacto". Una cosa sí cambió: `GetByEmail` pasó a comparar sin distinguir mayúsculas (migración 000019), porque si no, un usuario registrado como `Carlos@Example.com` que entra con Google terminaba con una **segunda cuenta**. Efecto sobre el login clásico: ahora acepta cualquier combinación de mayúsculas. Es estrictamente más permisivo, nunca menos.

---

## 1. Objetivo

Permitir que un usuario se cree cuenta e inicie sesión con su cuenta de Google — más rápido que llenar el formulario — sin quitar la opción de email+contraseña. En el alta con Google se captura la ubicación del usuario (feature core del proyecto: búsqueda geoespacial de mascotas) y se reutiliza su foto de perfil de Google.

## 2. Decisiones tomadas (brainstorm)

| Decisión | Elección |
|----------|----------|
| Email ya existente con contraseña + login Google mismo email | **Vincular a la cuenta existente** (auto-link por email verificado) |
| Plataformas | **Web primero**; backend genérico para sumar mobile después |
| Captura de ubicación | **GPS del navegador** (`navigator.geolocation`) con **campo ciudad de respaldo** si niega el permiso |
| Flujo OAuth | **Google Identity Services (GIS) + verificación del ID token en el backend** |
| Foto de perfil (solo usuario nuevo) | **Re-subir la foto de Google a Cloudinary** (no hotlink) |

## 3. Fuera de alcance (deliberado)

- **Mobile (Expo).** El backend queda genérico; la UI mobile es una iteración aparte (requiere OAuth clients nativos y dev-build).
- Otros proveedores sociales (Facebook, Apple, etc.).
- Desvincular Google de una cuenta / gestión de proveedores en el perfil.
- Reemplazar el JWT propio por un sistema de identidad externo (Firebase Auth, Auth0).

## 4. Modelo de datos

Cambios en `users` (`backend/internal/domain/models.go`):

- `PasswordHash` deja de ser `NOT NULL`. Vacío = sin contraseña (usuario Google-only). No requiere lógica extra para bloquear login por contraseña: `bcrypt.CompareHashAndPassword("", pw)` falla por sí mismo → `ErrInvalidCredentials`.
- Nueva columna **`GoogleID string`** con `uniqueIndex` (`gorm:"uniqueIndex;size:255"`). Guarda el `sub` de Google (id estable, no cambia aunque cambie el email). Vacío = no vinculado. Un usuario puede tener contraseña **y** `GoogleID` simultáneamente (registró local y luego vinculó).
- Al crear/vincular por Google: `EmailVerified = true` y `VerificationMethod = "google"` (Google ya verificó el email → se saltea el OTP de Brevo).

> **Corrección (2026-07-26, durante la implementación):** el tag GORM real es `gorm:"size:255;index"`, **NO `uniqueIndex`**. Con `uniqueIndex`, el segundo usuario registrado con email+contraseña rompería el insert, porque TODOS comparten `google_id = ''`. La unicidad la da el índice único **parcial** (`WHERE google_id <> ''`) de la migración, que AutoMigrate no sabe expresar. Se llama `uniq_users_google_id` para no colisionar con el `idx_users_google_id` que GORM genera del tag `index`.

**Migración SQL** (golang-migrate, nueva `migrations/<siguiente-número>_google_signin.up.sql` + `.down.sql`, tomando el próximo número secuencial disponible):
- `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`
- `ALTER TABLE users ADD COLUMN google_id VARCHAR(255);`
- `CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id <> '';` (índice único parcial para permitir múltiples vacíos).

> Nota: el backend reconstruye el schema al deployar (AutoMigrate + migraciones SQL, regla #19). AutoMigrate agrega la columna; el `DROP NOT NULL` y el índice parcial van por SQL migration explícita.

## 5. Backend

### 5.1 Endpoint

`POST /api/auth/google` (público, junto a `/register` y `/login` en `router.go`). Body: `{ "id_token": string }`.

Respuesta `200`: `{ user: UserResponse, token: string, is_new_user: bool }` (extiende `AuthResponse` con `is_new_user`).

### 5.2 Servicio

Nuevo método en `AuthService` (`interfaces.go` + `auth_service.go`):

```
LoginWithGoogle(ctx, idToken string) (*domain.User, string, bool, error)
```

Flujo:
1. **Verificar** el ID token con `GoogleTokenVerifier` (interfaz mockeable, implementada con `google.golang.org/api/idtoken`). Chequea firma, `audience == GOOGLE_CLIENT_ID`, expiración, y `email_verified == true`.
2. Extraer `sub`, `email`, `name`, `picture`.
3. Buscar por `GoogleID == sub` → si existe: login de usuario que vuelve (`is_new_user=false`). Verificar `IsBanned` (→ `ErrUserBanned`).
4. Si no, buscar por `email`:
   - Existe (cuenta local) → **vincular**: `GoogleID = sub`, `EmailVerified = true`, `Update`. Verificar `IsBanned`. `is_new_user=false`.
   - No existe → **crear** usuario nuevo (`email`, `name`, `GoogleID=sub`, `EmailVerified=true`, `VerificationMethod="google"`, `PasswordHash=""`). Re-subir la foto de Google a Cloudinary → `ProfilePhotoURL` (best-effort: si falla, se loguea y el alta continúa sin foto). `is_new_user=true`.
5. Emitir nuestro JWT (`jwt.GenerateToken`).

> **Corrección (2026-07-26, durante la implementación):** el paso 4 (vincular) hace tres cosas más que las descritas, todas por hallazgos de review:
> 1. Si la cuenta ya está atada a **otro** `sub` de Google, NO se re-vincula → `ErrGoogleAccountMismatch` (409). Pasa cuando una dirección cambia de dueño.
> 2. Si la cuenta local tiene `EmailVerified=false`, **se descarta su contraseña**. `Register` no exige ninguna prueba de propiedad del email, así que esa cuenta pudo haberla plantado un atacante con el email de la víctima (*account pre-hijacking*). Ojo: no hay flujo de recuperación de contraseña, así que ese usuario queda solo-Google.
> 3. Se setea `IsVerified = true` en vincular y en crear, para respetar el invariante `IsVerified = EmailVerified || PhoneVerified` de `verification_service.go`.

### 5.3 Interfaz del verificador (testabilidad)

```
type GoogleTokenVerifier interface {
    Verify(ctx context.Context, idToken string) (*GoogleClaims, error)
}
type GoogleClaims struct { Sub, Email, Name, Picture string; EmailVerified bool }
```

Implementación real en `pkg/googleauth/` (usa `idtoken.Validate`). En tests se inyecta un mock — mismo patrón de DI del resto del backend.

> **Correcciones (2026-07-26, durante la implementación):**
> - Los tipos se llaman `googleauth.Verifier` y `googleauth.Claims`, no `GoogleTokenVerifier`/`GoogleClaims`: el nombre del paquete ya aporta el prefijo y repetirlo es tartamudeo (`googleauth.GoogleTokenVerifier`).
> - `NewVerifier` devuelve `(Verifier, error)` y **rechaza un clientID vacío**. Motivo: `idtoken.Validate` se saltea el chequeo de audiencia cuando el audience es `""` (`validate.go:160`), dejando solo firma y expiración — cualquier token de Google entraría, incluido uno emitido para la app de un atacante con el email real y verificado de una víctima. Con el auto-link del paso 4 eso es toma de cuenta. La restricción se hace imposible de saltear en el constructor en vez de confiar en que el llamador chequee la env var.
> - `Verify` además valida `iss` (la librería NO lo hace: `Issuer` es solo un campo del struct, nunca se lee) y rechaza `sub` o `email` vacíos, que la librería tampoco exige.

### 5.4 Persistencia de ubicación

Nuevo endpoint chico **`PATCH /api/auth/me/location`** (protegido, JWT): body `{ latitude?, longitude?, city? }`. Setea `Latitude`/`Longitude` (nullables) y/o `City` del usuario autenticado. Reutilizable por cualquier usuario para setear ubicación después, no solo en el onboarding de Google.

### 5.5 Errores (contrato `{code, message}` con `writeError`)

| Situación | Código | HTTP |
|-----------|--------|------|
| ID token inválido/expirado | `google_token_invalid` | 401 |
| `email_verified: false` | `google_email_unverified` | 401 |
| Usuario baneado | `user_banned` (existente) | 403 |
| Email ya vinculado a otra cuenta de Google | `google_account_mismatch` | 409 |
| `GOOGLE_CLIENT_ID` sin configurar (verificador nulo) | `google_signin_unavailable` | 502 |
| Falla re-subida de foto | (best-effort, no error al cliente) | — |

> **Corrección (2026-07-26, durante la implementación):** esta fila decía `google_verify_failed` / "Google inalcanzable al verificar". Se renombró porque `idtoken.Validate` no distingue "token inválido" de "no llegué a Google" — todo fallo de verificación mapea a `google_token_invalid` (401). El 502 quedó reservado para el único caso que sí es distinguible: el servidor no tiene `GOOGLE_CLIENT_ID`. Un mensaje que culpa a la red mandaría a alguien a perseguir un problema de red cuando la causa es una env var sin setear.

## 6. Frontend (web)

- **Librería GIS** cargada en la página; botón oficial "Continuar con Google" en `LoginPage` y `RegisterPage`, arriba del formulario, con divisor "o". El formulario email+contraseña **se mantiene**.
- Callback de GIS → ID token → `POST /api/auth/google` → `{ user, token, is_new_user }`. Token guardado en `AuthContext` (idéntico a login/register).
- **Usuario que vuelve** (`is_new_user=false`) → entra directo a la app.
- **Usuario nuevo** (`is_new_user=true`) → paso de onboarding **"Completá tu ubicación"**:
  - Botón "Usar mi ubicación" → `navigator.geolocation.getCurrentPosition` → lat/lng.
  - Permiso negado o error → campo **ciudad** de respaldo.
  - Guarda con `PATCH /api/auth/me/location`.
  - **Es salteable** ("Omitir por ahora"): no bloquea el alta. La app ya maneja usuarios sin `lat/lng` (nullable), así que un usuario que saltea queda igual que cualquier usuario sin ubicación seteada y puede completarla después desde el perfil.
- **Foto:** resuelta en el backend; el front solo muestra `ProfilePhotoURL`.
- **i18n:** strings nuevas en es/en/pt (botón, paso de ubicación, permiso, errores).

### 6.1 CSP (regla #23)

GIS requiere abrir la CSP en `frontend/packages/web/vercel.json`:
- `script-src`: `https://accounts.google.com/gsi/client`
- `frame-src`: `https://accounts.google.com`
- `connect-src`: `https://accounts.google.com`

Probar en el **preview de Vercel** con la consola abierta antes de mergear (una CSP mal calibrada no rompe el build, rompe la feature en runtime).

## 7. Testing

- **Backend (`auth_service_test.go` con `GoogleTokenVerifier` mock):** usuario nuevo (crea + `EmailVerified=true`), usuario que vuelve (match por `GoogleID`), vinculación de cuenta local (match por email), baneado, `email_verified=false` rechazado, token inválido. Foto: storage mockeado, el fallo no bloquea el alta.
- **Backend handler:** shape de respuesta de `POST /api/auth/google` (`{user, token, is_new_user}`) y de `PATCH /api/auth/me/location`.
- **Web (Vitest):** componente del botón; paso de ubicación (geolocalización OK y negado→ciudad), mockeando `navigator.geolocation` y el api client; integración con `AuthContext`.
- **CSP:** verificación manual en preview de Vercel (no unitaria).

## 8. Setup (una vez, lo hace el owner en Google Cloud Console)

- Crear **OAuth 2.0 Client ID** tipo *Web application*.
- **Authorized JavaScript origins:** `https://searchpet.vercel.app` + `http://localhost:3000`.
- Consent screen básico: nombre, logo (Rastro), scopes `openid email profile` (**no-sensibles** → sin revisión de Google).
- **Env vars:** backend `GOOGLE_CLIENT_ID` (verifica el `audience`), front `VITE_GOOGLE_CLIENT_ID` (inicia GIS). **Sin client secret** (GIS es cliente público).
- Costo: **$0**.

## 9. Consideración de seguridad — vinculación por email

> **Corrección (2026-07-26, durante la implementación): esta sección quedó incompleta y su conclusión es engañosa.** El gate `email_verified` protege una sola dirección — que un tercero reclame la cuenta de un email que NO controla. NO protege la dirección contraria: `Register` no exige prueba del email, así que una cuenta local con `EmailVerified=false` pudo haberla creado un atacante con TU email y una contraseña que él eligió; al vincular, te meteríamos en una cuenta que él también abre. Por eso el gate **no es** la única barrera: al vincular una cuenta no verificada se descarta su contraseña. Ver regla #25 del CLAUDE.md.

La auto-vinculación (paso 4 de 5.2) es segura **porque** solo procede cuando `email_verified == true` en el ID token de Google — es decir, Google confirma que el email es realmente del que firma. Sin ese chequeo, un atacante podría reclamar una cuenta local ajena. El gate `email_verified` es la barrera; por eso se rechaza el token si es `false`.
