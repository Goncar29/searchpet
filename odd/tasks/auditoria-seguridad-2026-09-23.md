# Auditoría de seguridad y código basura — 2026-09-23

## Objective

Cerrar los hallazgos verificados de la auditoría del 2026-09-23 (backend,
web/mobile/CI y código basura), uno por PR, en orden de prioridad.

## Origen

Tres análisis de sólo lectura (subagentes) + spot-check contra el código de
los hallazgos principales. Riesgos ya aceptados en `CLAUDE.md` (reserva de
recuperación, key de Jina, `/api/ops/quota`, `phone_verified`) NO entran acá.

## Constraints

- TDD: **on** (CLAUDE.md global). Runner backend: `go test ./... -count=1` con
  `DATABASE_URL` → `lostpets_test`, e2e con `-tags e2e`. Web: `pnpm test:run`.
  Mobile: `pnpm test:run` (nunca `pnpm test`).
- Una rama y un PR por item (o por grupo chico coherente), squash, desde
  `origin/main` (regla #30).
- Verificación de deploy por contenido/comportamiento, nunca `/health` (#46).
- Toda operación remota contra producción requiere autorización explícita.

## Tasks

### Alta
- [x] **S1 — `X-Forwarded-For` spoofeable.** Gin v1.9.1 sin
  `SetTrustedProxies` confía en XFF de cualquiera → los rate limits por IP
  (`middleware/rate_limit.go:31`) se saltean. Fix investigado:
  `SetTrustedProxies([]string{"10.0.0.0/8"})` +
  `RemoteIPHeaders = []string{"CF-Connecting-IP"}` (Render = Cloudflare →
  LB interno 10.x). Loguear `RemoteAddr` para confirmar el CIDR. Verificación
  en prod (requiere OK del usuario): 6 logins fallidos con XFF/CF-Connecting-IP
  distintos → el 6º da 429.
  **Estado:** rama `fix/trusted-proxies-client-ip`, commits `3567d3ec` (fix;
  revisión nativa aprobada, `review-5f2aa5e9f9dad39b`) y `20c938e1`
  (seguimiento de sus avisos: RequestLog por fuera de Recovery + e2e del
  wiring; assess `under_budget`). Mutaciones: vaciar `ConfigureClientIP` → 4
  tests en rojo; sacar la llamada del router → e2e da 401 en vez de 429.
  **Riesgo aceptado:** si al origen de Render se llega sin pasar por
  Cloudflare, un peer 10.x con `CF-Connecting-IP` forjado sería creído. Hoy no
  hay camino conocido (`*.onrender.com` resuelve a Cloudflare).
  Lección: la rama salió de `main` ANTES de mergear #263, y la revisión
  comparó contra un `main` con el fix del teléfono → falsos hallazgos de
  "regresión". Rebasear siempre sobre `origin/main` antes de revisar.

- [x] **S1b — dos sugerencias de la revisión de S1.** (1) `NewBaseEngine`
  arma el engine base (ClientIP + RequestLog por fuera de Recovery) y lo usan
  `SetupRouter` y el test, así que reordenar rompe el test; (2) test del
  camino de error de `ConfigureClientIP` con CIDR inválido, comparando el
  contenido de `RemoteIPHeaders`. Commits `95d6adc7` + `36b7f459`.

### Media
- [x] **S2 — Teléfono del dueño en `GET /api/pets/:id` para cualquier estado.**
  En curso → ver `odd/tasks/telefono-solo-en-busqueda-activa.md`
  (decisión: sólo `lost`/`stray`/`adoption`, o el dueño). **PR #263,
  squash `74d9ee24`**, CI de `main` verde 6/6 con Deploy Backend (run
  35899009452). Verificación por comportamiento en prod: pendiente de un UUID
  `registered` real.
- [x] **S2b — `GET /api/pets/search?status=found` devuelve `owner.phone`.**
  Hecho en `597b6f15`: scrub en `pet_service.SearchPets` (cubre
  `/pets/search` y `/adoptions`) y en la landing `/api/share/:token`. El
  resto de endpoints mapeados no expone el teléfono.
- [ ] **S2c — sugerencias de la revisión de S2b:** agregar una mascota sin
  dueño (callejero) al test de `SearchPets`; el e2e busca sólo en la primera
  página (`limit=100`) — acotar la consulta.
  Hallazgo lateral del writer de S2: la búsqueda pública precarga Owner y
  `found` está fuera de `ContactVisibleStatuses`. Decidir si se aplica el
  mismo scrub a la búsqueda (y revisar feed/mapa/adopciones con el mismo ojo).
- [ ] **S3 — CVEs alcanzables.** `golang-jwt/jwt/v5` 5.2.0→5.2.2
  (GO-2025-3553, en cada request autenticado), `pgx/v5` 5.5.4→5.9.2
  (GO-2026-5004), `go-jose/v4` 4.1.3→4.1.4, y patch del toolchain Go
  (`go.mod` / `go-version-file`). Verificar con `govulncheck ./...`.
- [ ] **S4 — Volante PDF de mobile sin escapar.**
  `mobile/components/PdfFlyerButton.tsx:75-129` interpola `name`, `breed`,
  `color`, `city`, `description` crudos en HTML de `Print.printToFileAsync`.
  Aplicar un `esc()` como el de `web/api/share.js`, con test.
- [x] **S5 — Coordenadas y radio no finitos.** `/reports/nearby` ahora
  llama a `validCoordinates` (400 ante `NaN`, `Inf` o fuera de rango). Barrido
  de la clase —todo `ParseFloat` de query en handlers— encontró uno más que la
  auditoría no vio: `/pets/search?radius=NaN` pasaba `radius <= 0` y el rango
  1000–50000 (toda comparación con NaN da false) y llegaba al servicio; ahora
  `!(radius > 0)`. `validCoordinates` documenta que rechaza NaN/Inf por la
  forma de sus comparaciones. Mutaciones: sacar la llamada → 6 casos rojos;
  volver a `radius <= 0` → el caso NaN rojo; reescribir `validCoordinates`
  como `!(lat < -90 || ...)` (igual para números, acepta NaN) → los casos NaN
  rojos.
- [ ] **S6 — WebSocket `InsecureSkipVerify: true`.**
  `websocket/handler.go:68`. Reemplazar por `OriginPatterns` desde
  `CORSAllowedOrigins`. Mitigado por ticket de un solo uso, pero es defensa
  en profundidad.

### Baja
- [ ] **S7 — `DELETE /api/devices/:token` sin chequeo de dueño.**
  `handler/device_handler.go:32-45`. Cargar el token y comparar `UserID`.
- [ ] **S8 — Comparaciones no constant-time.** `reindex_handler.go:45`,
  `ops_quota_handler.go:46` (header vs token) y
  `verification_service.go:266` (OTP de email) → `subtle.ConstantTimeCompare`
  como ya hace `password_reset_service.go:390`.
- [ ] **S9 — `Register` sin tope de 72 bytes de bcrypt.**
  `auth_service.go:100` → 500 en vez de 400; el comentario de
  `dto/auth_dto.go:16` afirma que ya está cubierto y es falso (regla #36).
- [ ] **S10 — Docker corre como root.** `backend/Dockerfile`: `adduser` +
  `USER`.
- [ ] **S11 — CI sin `permissions:`.** `ci.yml` sin bloque → agregar
  `contents: read`. Considerar pinnear por SHA las actions de terceros,
  sobre todo `softprops/action-gh-release` (corre con `contents: write`).
- [ ] **S12 — `returnUrl` sin validar.** `LoginPage.tsx:53`,
  `useGoogleSignIn.ts:26`: exigir `/` y no `//`. Hoy no explotable
  (`navigate()` no cambia de origen); hardening.

### Info / a decidir
- [ ] **S13 — Advisories sin ignore documentado (web).** `dompurify` (vía
  jsPDF; la app nunca llama `.html()`) y `protobufjs` (vía firestore, no
  importado). Agregar `ignoreGhsas` con motivo escrito (regla #27) o bump.
- [ ] **S14 — 91 advisories en mobile**, casi todos tooling de build
  (`@expo/cli`, `tar`). Evaluar un archivo de ignores con motivo, como web.
- [ ] **S15 — Restricción de keys públicas** (Firebase, MapTiler): confirmar
  en sus consolas que estén restringidas por app. Manual, del usuario.

### Código basura
- [ ] **G1 — `invokeWriteError`** en `backend/tests/write_error_test.go:18`:
  stub que devuelve `nil`, cero llamadas. Borrar.
- [ ] **G2 — 7 imports/variables sin uso en mobile** (`tsc
  --noUnusedLocals`): `(tabs)/messages.tsx:22`, `(tabs)/post.tsx:23`,
  `alerts/index.tsx:12,33`, `pet/[id].tsx:121`, `story/create.tsx:52`,
  `users/[id].tsx:171`.
- [ ] **G3 — ~84 claves i18n huérfanas** (web 14, mobile ~60, shared 10), en
  los tres idiomas. Salen de grep — verificar cada una (claves dinámicas,
  plurales) antes de borrar. Idealmente con un guard AST, no con lista.
- [ ] **G4 — Deprecaciones (decisión, no limpieza):** `nhooyr.io/websocket` →
  `github.com/coder/websocket`; `option.WithCredentialsJSON` en
  `pkg/notification/firebase.go:60`.
- [ ] **G5 — Errores de tipos en mobile** que salieron en `tsc` (~15:
  implicit any, MapLibreGL, import roto en `story/index.tsx`). Fuera del
  alcance de "basura", pero son reales.

## Progress

- 2026-09-23: auditoría hecha; S2 en implementación (writer delegado, rama
  `fix/pet-detail-phone-visibility`). S1 investigado (fuentes: Cloudflare
  docs, código de gin v1.9.1, arcjet/arcjet-js#3899).

- 2026-09-23: S2 mergeado (#263 `74d9ee24`). README centrado aparte (#264
  `952976c1`). S1 en implementación (writer delegado, rama
  `fix/trusted-proxies-client-ip`).

- 2026-09-23: S1 implementado y revisado (`3567d3ec` + `20c938e1`).
- 2026-09-24: **S1 mergeado (#265, squash `7986cee8`)**, CI de `main` 6/6 con
  Deploy (run 35946363831). **Verificado en prod por comportamiento**: antes
  del deploy, 7 logins rotando `X-Forwarded-For` en un minuto → siete 401
  (límite 5, el bug reproducido); después, ronda de 6 → cinco 401 y **429**.
  Hallazgo lateral: Cloudflare rechaza con `error code: 1000` todo request
  que trae su propio `CF-Connecting-IP` — el header no es inyectable desde
  afuera. Pendiente: leer `remote_addr` en los logs de Render para confirmar
  el 10.x (el MCP de Render no conectaba). Sugerencias de la revisión
  diferidas como S1b.
- 2026-09-24: S1b hecho en `fix/client-ip-review-followups` (`95d6adc7` +
  `36b7f459`); S2b hecho en `fix/search-phone-visibility` (`597b6f15`). Las
  dos revisiones nativas aprobadas.

## Next step

Cerrar S2 → S1 → S3…S6 → bajas → basura.
