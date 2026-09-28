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

- [x] **S1c — el rate limit por IP era GLOBAL en producción.** Leyendo los
  logs de Render (2026-09-27, el pendiente de S1 que nunca se había hecho):
  `remote_addr` y `client_ip` son `[::1]` / `::1` en el **100%** de los
  requests, externos incluidos. El proxy de Render le llega a la app por
  **loopback**, no por `10.x` como SUPUSO S1. Con `::1` fuera de
  `TrustedProxyCIDRs`, gin ignoraba `CF-Connecting-IP` y todos los usuarios
  compartían un único balde: cualquiera que fallara 5 logins en un minuto
  dejaba a todos con 429 (igual el envío de OTP y la recuperación). Arreglo:
  `TrustedProxyCIDRs` suma `127.0.0.1/32` y `::1/128` (se conserva
  `10.0.0.0/8`); el loopback es inalcanzable desde afuera. Tests nuevos con el
  peer `[::1]:51006` tal cual lo muestra el log, y el que le faltaba a S1:
  **dos clientes detrás del mismo proxy tienen baldes separados** (rojo
  reproducía el 429 compartido). El e2e de wiring se apoyaba en que
  `127.0.0.1` NO fuera confiable y se rediseñó: mismo `CF-Connecting-IP` con
  XFF rotando → 429; otro `CF-Connecting-IP` → su propio balde. Mutaciones:
  sin `::1/128` o sin `127.0.0.1/32` → caen los tests de middleware; sin
  loopback o sin `ConfigureClientIP` → cae su mitad del e2e.
  **La verificación de S1 era falsa**: "6 logins → el 6º da 429" también da
  así con un balde global; probaba que el límite existe, no que sea por IP.
  Revisión nativa `review-1e5a098f0ae2c8e4` aprobada con 3 sugerencias,
  todas aplicadas: el e2e afirma 401 (no "cualquier cosa menos 429") en las
  dos mitades; el calentamiento del test unitario afirma 200; y un test nuevo
  fija que un request por loopback SIN `CF-Connecting-IP` (o con uno
  inválido) cae al peer `::1` — riesgo aceptado: ese tráfico comparte balde,
  el de usuarios siempre trae el header (mutación leyendo XFF → cae por
  nombre).
  **PR #276, squash `325ca5f1`.** **Verificado en prod** (deploy
  `dep-dasqqph7lnhs73adebg0`, live 2026-09-27 23:59 UTC; sonda a las
  00:08 UTC del 28, o sea 21:08 del 27 en hora de Uruguay): mi sonda a `/api/reports/nearby`
  aparece en el log de Render con `client_ip` = mi IP pública y
  `remote_addr` `[::1]`; el monitor de UptimeRobot, con la suya. Dos clientes,
  dos IPs: esta vez sí distingue por-IP de global.

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
- [x] **S2c — sugerencias de la revisión de S2b.** Test de servicio con una
  página mixta que incluye callejeros sin dueño; el caso filoso es el
  callejero ya `found` (única transición de `stray`, fuera de
  `ContactVisibleStatuses`): sin la guarda de `Owner == nil` el scrub
  paniquea. Un `stray` sin dueño solo NO ejercita esa guarda — la primera
  mutación dio verde y así se vio. El e2e ahora filtra por una raza única por
  corrida en vez de depender de `limit=100`; mutando la raza cae por "no
  apareció entre 0 resultados". El hallazgo lateral (scrub en la búsqueda)
  ya lo había cerrado S2b.
- [x] **S3 — CVEs alcanzables.** `govulncheck ./...` pasó de **26
  vulnerabilidades alcanzables a 0**. Módulos: `golang-jwt/jwt/v5`
  5.2.0→5.2.2, `pgx/v5` 5.5.4→5.9.2, `go-jose/v4` 4.1.3→4.1.4, y cuatro que
  la auditoría no había visto: `grpc` 1.80→1.83.1, `x/image` 0.43→0.45,
  `x/net` 0.53→0.55, `x/text` 0.38→0.41. **Go 1.25.0 → 1.26.8**: con 1.27
  publicado, la línea 1.25 dejó de recibir parches (soportadas: 1.27 y 1.26),
  y CI compilaba con 1.25.0 exacto vía `go-version-file`. El `Dockerfile`
  queda en `golang:1.26.8-alpine` — la imagen trae `GOTOOLCHAIN=local`, así
  que `go.mod` y la imagen se suben juntos o el build falla. Verificado:
  build+vet, `go test ./...` (tests contra Postgres real, 867s, sin skips),
  e2e, `docker build` local y `go version -m` del binario → `go1.26.8`.
  Fuera de alcance: el runtime `alpine:3.19` (EOL) va con S10.
  **Lista completa de lo que se movió** (revisión de 4 lentes
  `review-624fe81f081681e3`): además de los siete módulos de arriba, `go get`
  arrastró como indirectas `x/crypto` 0.50→0.51, `x/sys`, `x/sync`, la
  familia `otel`, `genproto`, `envoy`, `spiffe` y `cel.dev/expr`. Y
  `go-playground/validator/v10` pasó de indirecta a directa **sin cambiar de
  versión**: `go mod tidy` corrigió un `go.mod` que ya estaba desfasado de los
  imports reales (el código lo importaba directo). Por eso CI suma un paso
  `go mod tidy -diff`, que falla si vuelve a desfasarse.
  **`govulncheck` fijado en `v1.8.0`**: es la versión que corrió local
  (`go version -m` del binario) y la que corrió en CI (*"No vulnerabilities
  found"*).
  **Salida de emergencia (decisión del usuario, 2026-09-27)**: la revisión
  advirtió que el paso frena TODO deploy —también un hotfix— ante un CVE
  nuevo o si `vuln.go.dev` está caído. Se mantiene el bloqueo por defecto y se
  agrega `workflow_dispatch` con `skip_vulncheck=true`: corre el resto y
  deploya. `e2e-web` también acepta ese disparo, porque si se salteara, GitHub
  saltearía el deploy que lo espera. Segunda revisión de 4 lentes
  (`review-48d0c39712f0ab1b`): **corregido** que esto cubriera una caída del
  proxy de módulos — no la cubre, `go mod download` corre antes y también lo
  necesita; el salteo quedó acotado a `main` (en otra rama daba un verde sin
  deploy); y el disparo exige un `reason` que queda impreso en el run (una
  sola persona con permiso de escritura puede saltear el control: riesgo
  aceptado, ahora con registro).
  - [x] **S3 post-merge**: disparar `ci.yml` a mano sobre `main` con
    `skip_vulncheck=true` y un `reason`, y confirmar en el run que el salteo
    figura aplicado, que `govulncheck` se saltea y que `Deploy Backend` corre.
    `main` está limpio de CVEs, así que saltear no esconde nada; con `false` el
    camino del salteo nunca se probaría (tercera revisión).
    **Hecho el 2026-09-27**: run `36356785223` (`workflow_dispatch` en `main`)
    — el paso `id: dispatch` (en ese run se llamaba "Motivo del disparo
    manual"; después se renombró a "Decidir salteo de govulncheck y registrar
    el disparo manual") imprimió `skip_vulncheck=true (aplicado: true)`,
    `govulncheck` quedó `skipped`, `E2E Tests (Web)` corrió y `Deploy Backend`
    dio `success`; Render levantó `dep-daspus3bc2fs738bvimg` (`live`, mismo
    commit `14b77e9a`).
- [x] **S4 — Volante PDF de mobile sin escapar.** `mobile/utils/escapeHtml.ts`
  (mismo contrato que `esc()` de `web/api/share.js`, más `'`) aplicado a
  cada valor que no escribimos nosotros. El botón NO es sólo del dueño: el
  texto lo publica una persona y el HTML se dibuja en el teléfono de otra.
  Además de los cinco campos listados, se escaparon dos que la auditoría no
  vio: el `src` de la foto (unas comillas cerraban el atributo) y el tipo —
  sin traducción, i18next devuelve la clave con el valor crudo, probado con
  un i18next real en el test. Test contra el componente real
  (`__tests__/PdfFlyerButton.escape.test.tsx`, lee el HTML que recibe
  `Print.printToFileAsync`). Mutación por sitio: 7 de 9 caen con test con
  nombre; `lastSeenDate` y `shareUrl` quedan verdes porque no los escribe un
  usuario (defensa en profundidad, no cobertura).
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
- [x] **S6 — WebSocket sin chequeo de origen.** `InsecureSkipVerify` →
  `OriginPatterns` de `middleware.WebSocketOriginPatterns`, que sale de la
  MISMA `CORS_ALLOWED_ORIGINS` que CORS (host sin esquema; en development
  suma `localhost:*`). Mobile no se rompe: React Native 0.76 en Android
  manda un Origin con el host de la propia URL del socket
  (`WebSocketModule.getDefaultOrigin`) y `websocket.Accept` acepta el mismo
  host; sin Origin también entra. Tests con handshake real (403 ajeno, 101
  configurado / sin Origin / mismo host). Mutaciones: volver a
  `InsecureSkipVerify` → cae el test del origen ajeno; sacar el filtro de
  host vacío o el comodín de dev → cae su caso. `/verify` con el backend en
  `ENVIRONMENT=production`: el chat web conecta y recibe `chat_message` en
  vivo (5/5 por el socket); `curl` con Origin ajeno → 403, `localhost:3000`
  → 403 (sin comodín en prod), mismo host → 101.
  **CORREGIDO: el "render intermitente" del chat NO existe; era la sonda.**
  El `getByText` de Playwright es estricto: el mensaje aparece DOS veces
  (vista previa de la lista + burbuja del hilo), eso tira error, el `catch`
  lo leía como "no apareció", y la corrida "exitosa" en realidad había
  matcheado sólo la lista. Medido bien (burbujas del hilo + cuerpo de cada
  `GET /api/messages/:id`): 5/5, el hilo lo muestra en 170–225 ms y los GET
  ya lo traen. Lo único real: cada pestaña abre 3 WebSockets y cada mensaje
  dispara 3 GET idénticos (cada `useWebSocket` abre su propia conexión).
  Funciona; es ineficiencia, no defecto.

### Baja
- [x] **S7 — `DELETE /api/devices/:token` sin chequeo de dueño.**
  `DeviceTokenRepository.DeleteByTokenForUser` (`WHERE token = ? AND
  user_id = ?`) lo usa el handler; `DeleteByToken` sin dueño queda sólo para
  la limpieza de tokens que FCM rechaza. Sin usuario → 401 sin tocar el
  repositorio; token ajeno → 200 sin borrar nada (no revela si existe). El
  test `DeleteToken_NoAuth_RepoStillCalled` EXIGÍA borrar sin usuario
  ("doesn't check ownership") — certificaba el hueco; se reemplazó. Test de
  repositorio contra Postgres real (B no borra el token de A).
  **Riesgo aceptado (decisión del usuario, 2026-09-24):** `Upsert` reasigna
  un token existente a quien lo registra. Con el token robado de la víctima,
  un atacante recibiría las notificaciones de ella. No se cambia: es el
  camino legítimo de cerrar sesión y entrar con otra cuenta en el mismo
  teléfono, y un token no se puede probar como propio. Misma precondición
  que S7: conocer un token que ninguna respuesta de la API expone.
  **La "carrera" del logout de mobile NO existe, y ahora un test lo fija.**
  El logout manda el DELETE sin `await` y borra la sesión en la línea
  siguiente, pero `deleteDeviceToken → request → doFetch` arma el header
  `Authorization` antes del primer `await` (una función async corre
  sincrónica hasta ahí). El riesgo era latente: un `await` antes de los
  headers haría salir el DELETE anónimo, y el `.catch(() => {})` del logout
  se tragaría el 401. `shared/api/client.test.ts` lo fija; con un
  `await Promise.resolve()` antes de los headers cae.
- [x] **S8 — Comparaciones no constant-time.** `reindex_handler.go:45`,
  `ops_quota_handler.go:46` (header vs token) y
  `verification_service.go:266` (OTP de email) → `subtle.ConstantTimeCompare`
  como ya hace `password_reset_service.go:390`.
  Hecho con un helper único, `pkg/secret.Equal`: hashea los dos lados con
  SHA-256 y compara los digests con `subtle.ConstantTimeCompare`, porque
  `ConstantTimeCompare` sola devuelve al instante si los largos difieren y
  filtra el largo del token. Lo usan los cuatro sitios (el reset incluido).
  Las guardas de "token no configurado" quedan aparte (regla #18): `Equal("",
  "")` es true a propósito. **Excepción de TDD declarada**: el tiempo no se
  afirma con un test determinista, y `Equal` es indistinguible de `==` por
  comportamiento. Lo que sí tiene rojo es el guard
  `TestNoSecretComparedWithEqualityOperators`: barre todo el módulo backend
  (`internal/`, `pkg/`, `cmd/`; sin `testdata` ni `vendor`) por AST y falla
  ante `==`/`!=`, `bytes.Equal` o `strings.Compare` sobre un header, un
  `CodeHash` o un `token` (no contra literales ni `nil`). Verifica su raíz
  exigiendo haber leído los cuatro sitios por nombre. Rojo observado contra el
  código previo: nombró exactamente los tres sitios de arriba. Tres rondas de
  revisión nativa (`review-248d2fe7a6fb6742`, `review-2e54f5ec5e0be40d`,
  `review-a4519d69436f5b94`), todas aprobadas, 6 sugerencias aplicadas, todas
  sobre el guard o el texto. **PR #277, squash `6a5a0b40`**, deploy
  `dep-dasshhe0tbcc738s3s80` live. Sin discriminador en prod: un token
  equivocado da 404 antes y después.
  **Límite conocido, a conciencia**: una cuarta revisión
  (`review-c7512c0a509a6f36`, aprobada) sugirió cazar también un `switch`
  sobre el header y `strings.EqualFold`. **No se aplicó por decisión del
  usuario**: cada ronda encontraba otra forma de escribir la comparación y el
  ciclo no convergía. El guard decide por la forma y su comentario lo dice.
- [x] **S9 — `Register` sin tope de 72 bytes de bcrypt.**
  `auth_service.go:100` → 500 en vez de 400; el comentario de
  `dto/auth_dto.go:16` afirma que ya está cubierto y es falso (regla #36).
  Hecho: `AuthHandler.Register` chequea `len(req.Password) >
  bcryptMaxPasswordBytes` (la misma constante del reset) y responde 400
  `invalid_input` antes de llamar al servicio. El comentario del DTO ahora dice
  dónde vive el chequeo. Test de las dos mitades: 73 bytes
  ASCII y 37 `ñ` (74 bytes, 37 runas) → 400 sin tocar el servicio; 72 bytes
  ASCII y 36 `ñ` (72 bytes justos) → 201. Rojo observado en las dos primeras;
  mutación `>=` → caen las dos del borde. `Login` no se toca:
  `CompareHashAndPassword` no rechaza por largo.
  **Fuera de alcance, anotado**: ningún formulario (web ni mobile, alta ni
  reset) le pone tope a la contraseña, así que quien use una frase de más de
  72 bytes ve el mensaje genérico de datos inválidos, no uno que diga
  "demasiado larga". Antes veía "error inesperado".
  Revisión nativa de 4 lentes (`review-ef75b419fa66981d`, riesgo alto por
  tocar autenticación) aprobada con 3 sugerencias, aplicadas: la constante
  pasa a `handler/password_limits.go` (la comparten dos handlers), el
  comentario del DTO deja la historia para este documento, y el test afirma
  el código `invalid_input` (mutación a `binding_failed` → cae por nombre).
- [x] **S10 — Docker corre como root.** `backend/Dockerfile`: `adduser` +
  `USER`. Hecho junto con el runtime `alpine:3.19` (EOL 2025-11) →
  `alpine:3.24` (soporte hasta 2028-06): corre como uid 10001, y el binario no
  escribe a disco, así que los archivos quedan de root en sólo lectura. Rojo
  con la imagen vieja (`uid=0`, `3.19.9`); verde con la nueva, y arranca
  contra Postgres real (`/health/ready` 200). Dos revisiones nativas aprobadas
  (`review-50b1eeb506747a91`, `review-423be2f4dcd202ca`); su sugerencia de
  construir la imagen en CI quedó como S11b. **PR #279, squash `a383da73`**,
  deploy `dep-dat9vijncjis73dmqm40` live: el log del build de Render muestra
  `FROM alpine:3.24` y el `adduser -u 10001`. Render construye sin cache
  (`no-cache`), así que en producción la base siempre se baja fresca.
- [x] **S11 — CI sin `permissions:`.** `ci.yml` sin bloque → agregar
  `contents: read`. Considerar pinnear por SHA las actions de terceros,
  sobre todo `softprops/action-gh-release` (corre con `contents: write`).
  Hecho: `permissions: contents: read` a nivel de workflow (ningún job
  escribe en el repo). Las tres actions de terceros (`pnpm/action-setup`,
  `android-actions/setup-android`, `softprops/action-gh-release`) quedan
  fijadas al SHA de la versión exacta que resolvía su tag (`v6.0.10`,
  `v4.0.4`, `v3.0.3`), así que el comportamiento no cambia; las `actions/*`
  de GitHub siguen por tag. `build-apk.yml` sólo corre con tags: sus SHAs se
  prueban en el próximo release.
- [x] **S11b — CI no construye la imagen del backend.** Sugerencia de la
  revisión de S10 (`review-50b1eeb506747a91`, R3-002): hoy un Dockerfile roto
  recién aparece en el deploy de Render. Agregar a `ci.yml` un `docker build`
  + arranque contra el Postgres del job + `/health/ready` = 200, y que
  `deploy-backend` lo espere. Va junto con S11 (mismo archivo).
  Hecho: job `backend-image` con `docker build --pull`, uid 10001 exigido en
  la imagen y en el proceso corriendo, y espera de `/health/ready` con plazo
  por reloj (90s, `curl --max-time 5`) que corta apenas el contenedor muere.
  Los tres caminos probados local: listo (3s), contenedor caído (1s) y
  servidor colgado que acepta la conexión y no responde (94s, en vez de los
  15 min del techo del job). Rojo con la imagen vieja en los dos chequeos de
  uid; verde en CI (run `36457577891`). Revisión de 4 lentes
  `review-1a7c0137972e8e1b` aprobada; sus sugerencias aplicadas salvo una:
  **no se agrega reintento al `docker build`** — el deploy ya dependía del
  registro de imágenes antes de este job (el Postgres de `backend-test` sale
  del mismo registro), así que un reintento acá no quita esa dependencia.
- [x] **S12 — `returnUrl` sin validar.** `LoginPage.tsx:53`,
  `useGoogleSignIn.ts:26`: exigir `/` y no `//`. Hoy no explotable
  (`navigate()` no cambia de origen); hardening.
  Hecho: `web/src/utils/safeReturnPath.ts` acepta sólo un path que empieza
  con UNA `/` y sin caracteres de control; si no, `/`. Rechaza también
  `/\host` (el parser de URL trata la barra invertida como barra) y
  `/<tab>/host` (el parser borra tab y salto de línea, así que queda `//host`),
  dos formas que "exigir `/` y no `//`" dejaba pasar. Son tres puntos de uso,
  no dos: `LoginPage` navega a `returnUrl` tras el submit **y** en el guard de
  "ya tenés sesión". Test de las dos mitades en cada uno, y en el hook tanto al
  terminar el alta como para el usuario que vuelve. Mutaciones: cada punto de
  uso sin validar, sin el chequeo de barra invertida y sin el de control →
  cae un test con nombre en cada caso. Revisión nativa
  `review-e4d21de6151900af` aprobada; su sugerencia (cubrir al usuario de
  Google que vuelve) aplicada. **PR #281.**

### Info / a decidir
- [x] **S13 — Advisories sin ignore documentado (web).** `dompurify` (vía
  jsPDF; la app nunca llama `.html()`) y `protobufjs` (vía firestore, no
  importado). Agregar `ignoreGhsas` con motivo escrito (regla #27) o bump.
  Hecho con **bump, ningún ignore nuevo**: los parches entran en el rango que
  ya pide cada padre. Overrides `dompurify: '>=3.4.13 <4'` (jspdf pide
  ^3.3.1; los cinco advisories llegan hasta 3.4.12) y `protobufjs: '>=7.6.5
  <8'` (@grpc/proto-loader pide ^7.5.5). El audit mostraba además uno que la
  auditoría no listó: `vitest` <4.1.11 (GHSA-82fw-gwwq-j7x9, path traversal
  en `@vitest/mocker`), resuelto subiendo `vitest` y `@vitest/coverage-v8` a
  ^4.1.11. `pnpm audit`: de 10 advisories a 1, el de react-router que ya
  estaba ignorado con motivo. Las cuatro versiones tienen más de 3 días
  (`minimum-release-age=4320`). Suite web 1059 + shared 331 y build verdes.
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
- [ ] **G6 — `pnpm lint` de web apunta a nada.** `web/package.json` tiene
  `"lint": "eslint . --ext ts,tsx"`, pero `eslint` no está instalado, no hay
  config y el CI no lo corre; aun así el código trae
  `eslint-disable-next-line react-hooks/exhaustive-deps` (`AlertsMap.tsx`,
  `SharePanel.tsx`) para un linter que no existe. El valor está sobre todo en
  `react-hooks/exhaustive-deps`: dependencias faltantes en efectos y
  callbacks, que ni `tsc` ni los tests ven. Plan: `eslint` +
  `typescript-eslint` + `eslint-plugin-react-hooks` con config plana y sólo
  las reglas recomendadas + react-hooks; la primera corrida va a marcar
  bastante (el código se escribió sin linter), así que arreglar o documentar
  eso ANTES de sumarlo como paso bloqueante al job `Frontend Web Build`. Las
  dependencias nuevas pasan por el `pnpm audit` del CI (regla #27). Decisión
  del usuario, 2026-09-28.

## Progress

- 2026-09-23: auditoría hecha; S2 en implementación (writer delegado, rama
  `fix/pet-detail-phone-visibility`). S1 investigado (fuentes: Cloudflare
  docs, código de gin v1.9.1, arcjet/arcjet-js#3899).

- 2026-09-23: S2 mergeado (#263 `74d9ee24`). README centrado aparte (#264
  `952976c1`). S1 en implementación (writer delegado, rama
  `fix/trusted-proxies-client-ip`).

- 2026-09-23: S1 implementado y revisado (`3567d3ec` + `20c938e1`).
- 2026-09-24: **S1 mergeado (#265, squash `7986cee8`)**, CI de `main` 6/6 con
  Deploy (run 35946363831). **Verificado en prod por comportamiento** (CORREGIDO
  en S1c: esta prueba no distinguía un límite por IP de uno global): antes
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

- 2026-09-24: S2c hecho en `test/search-phone-review-followups` (sólo tests).
- 2026-09-27: **S2c–S7 mergeados** (squash): #268 S2c `c4d273e4`, #271 S5
  `1f93ca0a`, #270 S4 `4691dd54`, #272 S6 `1a2f268e`, #273 S7 `8bf62224`,
  #269 S3 `14b77e9a` (más #274, el WebSocket compartido, `2faa253a`). CI de
  `main` verde con deploy (run `36356124811`). **Los PRs chocaban** entre sí
  por editar ítems contiguos de este archivo: cada rebase resolvió sólo el
  documento y se verificó que el código fuera byte por byte el revisado. El
  #269 pasó cinco revisiones de 4 lentes sobre `ci.yml`, todas aprobadas.
- 2026-09-27: verificado en producción por contenido — S3: el build del
  deploy vivo usó `FROM golang:1.26.8-alpine`; S5: `nearby?lat=NaN` → 400 y
  `search?...&radius=NaN` → 400 (control válido → 200); salida de emergencia
  de `govulncheck` probada de punta a punta (ver "S3 post-merge"). **S6 no
  se puede sondear sin sesión**: el backend valida el ticket antes que el
  origen, así que sin ticket da 401; el rechazo del origen ajeno está probado
  local con `ENVIRONMENT=production`, y lo que S6 podía romper (el chat
  legítimo) lo confirma el usuario abriendo el chat. Pendiente de S1 que
  sigue abierto: leer `remote_addr` en los logs de Render para confirmar el
  10.x.
- 2026-09-27: el paso `id: dispatch` de `ci.yml` se renombró a "Decidir
  salteo de govulncheck y registrar el disparo manual" (sugerencia de la
  quinta revisión del #269): el nombre viejo sólo hablaba del motivo y
  escondía que ese paso es el que decide el salteo. El `id` no cambió, así
  que la condición de `govulncheck` sigue leyendo la misma salida.

## Next step

S8 (comparaciones constant-time) → S9 (bcrypt 72 bytes en `Register`) → S10
(Docker no-root + `alpine:3.19` EOL) → S11 (CI `permissions:`) → S12
(`returnUrl`) → S13–S15 → G1–G5. **Aprendido**: no marcar el backlog en cada
PR — los ítems contiguos chocan; se actualiza al cerrar, en un commit aparte.
