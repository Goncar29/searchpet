# WebSocket compartido — una conexión por sesión

## Objective

Que cada pestaña (web) o app (mobile) abra **una sola** conexión WebSocket por
sesión, compartida por todos los componentes que la usan, y que cada
`chat_message` dispare **una** consulta por query afectada en vez de varias.

## Problem

`frontend/packages/shared/hooks/useWebSocket.ts` abre una conexión **por
montaje** (su propio ticket, su propio backoff). Medido el 2026-09-24:

- **Web, chat abierto:** `MainLayout` (siempre montado) + `ChatPage` = **2
  sockets en producción**. En desarrollo se ve un **tercero**: `React.StrictMode`
  (`web/src/main.tsx`) monta el efecto dos veces y el hook tiene una carrera —
  el remontaje vuelve `mountedRef` a `true` antes de que resuelva el
  `issueWsTicket` del primer montaje, así que ese socket se abre igual y queda
  huérfano. El síntoma es sólo de dev, pero el defecto es del hook.
- **Mobile:** `(tabs)/messages.tsx` queda montado debajo de `chat/[userId]`
  (el Stack no desmonta) → 2 sockets.
- **GET duplicados (web):** por cada `chat_message`, `MainLayout` invalida el
  prefijo `['messages']` (lista + todos los hilos) y `ChatPage` vuelve a
  invalidar `['messages']` exact y `['messages', userId]`. Lista e hilo se piden
  dos veces. `MessagesPage` repite lo de `MainLayout` para la lista.

## Why

Menos conexiones abiertas contra Render free, menos consultas contra Neon, un
solo backoff cuando el backend se cae, y presencia fiel (el Hub hoy cuenta a
una persona como 2–3 sesiones). Decisión del usuario del 2026-09-24, después
de ver ventajas y riesgos.

## Scope

- `shared/hooks/useWebSocket.ts`: conexión compartida con contador de
  suscriptores. **Misma interfaz pública** `useWebSocket({ enabled, onMessage })
  → { connectionState, sendEnvelope }`: ninguna pantalla ni mock cambia por
  esto.
- Invalidaciones web: `ChatPage` y `MessagesPage` dejan de invalidar ante
  `chat_message` lo que ya invalida `MainLayout`; conservan lo que
  `MainLayout` no cubre (`badge_update` → lista) y el tipeo.
- Mobile: sin cambios de pantallas (el hook compartido ya las unifica).

**Fuera de alcance:** backend (el Hub ya soporta N conexiones), cambios de UI,
`connectionState` como feature (hoy nadie lo lee; se conserva por contrato).

## Constraints

- TDD **on** (CLAUDE.md global, "Strict TDD Mode: enabled"). Runners: web y
  shared `cd frontend/packages/web && pnpm test:run` (encadena
  `vitest.shared.config.ts`); mobile `cd frontend/packages/mobile && pnpm
  test:run` (nunca `pnpm test`).
- Rama `refactor/websocket-compartido` desde `origin/main` (regla #30).
- Regla #38: `Hub.DisconnectUser` corta los sockets al revocar sesión; el
  cliente tiene que seguir reconectando con backoff y NO reconectar cuando no
  hay sesión.
- El logout / session-expired tiene que cerrar la conexión compartida: en web
  `isAuthenticated` pasa a false (y session_expired recarga); en mobile no hay
  recarga, así que depende de que todos los consumidores pasen a
  `enabled=false` y suelten la conexión.

## Tasks

- [x] **T1 — Conexión compartida en `useWebSocket`.** Gestor de módulo con
  contador de suscriptores habilitados: conecta con el primero, cierra con el
  último; despacha cada envelope a todos; `sendEnvelope` usa la conexión
  compartida; backoff único. Contador de **generación** para descartar un
  `connect` asíncrono viejo (arregla la fuga de StrictMode). Tests unitarios
  nuevos del hook (hoy no existe ninguno) con un `WebSocket` falso y
  `issueWsTicket` mockeado: dos consumidores → un solo `new WebSocket`; los dos
  reciben el envelope; el último que se va cierra; montaje/desmontaje/montaje
  con el ticket pendiente → un solo socket abierto; `enabled=false` no conecta;
  cierre inesperado → reconecta; todos deshabilitados → no reconecta.
  _Ruta: delegated direct (writer), 2+ archivos no triviales._
- [x] **T2 — Invalidaciones sin duplicar (web).** `ChatPage` y `MessagesPage`
  dejan de invalidar ante `chat_message` (lo cubre el prefijo de
  `MainLayout`); conservan `badge_update` → lista. Actualizar
  `ChatPage.test.tsx` / `MessagesPage.test.tsx` para afirmar las dos mitades
  (qué sigue invalidando y qué ya no), y `MainLayout.test.tsx` para fijar que
  `chat_message` invalida el prefijo `['messages']` — es el invariante del que
  ahora dependen las otras dos. _Ruta: delegated direct (writer)._
- [x] **T3 — Verificación en runtime.** `/verify`: con el chat abierto, UN
  socket a `/api/ws` por pestaña (también en dev con StrictMode) y UN GET por
  query por mensaje; el mensaje aparece en vivo; logout cierra el socket y no
  reconecta. Suites completas web + mobile.

## Acceptance criteria

- Web y mobile: 1 conexión a `/api/ws` por sesión, medida en runtime.
- Web: por cada `chat_message` con el chat abierto, 1 GET a la lista y 1 al
  hilo.
- Logout: la conexión se cierra y no reconecta.
- Tipeo, badge y chat en vivo siguen funcionando.

## Checks

TDD con rojo observado antes de cada verde; mutaciones que prueben que cada
test nuevo protege algo; `pnpm test:run` en web y mobile con `EXIT` explícito;
`tsc` sin errores nuevos.

## Progress

- 2026-09-24: exploración hecha (mapeo delegado). Documento creado.
- 2026-09-24: **T1 hecho** (writer delegado; ruta delegated direct por 2+
  archivos). Gestor de módulo con contador de suscriptores y generación. Rojo
  observado: 6 de 8 tests en rojo por aserción contra el hook viejo (los 2
  verdes son casos de un solo consumidor que el hook viejo ya resolvía).
  **`<StrictMode>` no duplica efectos en este Vitest/React** (probado): el test
  del remontaje usa `enabled` false→true sobre el mismo fiber, que es la misma
  secuencia subscribe/unsubscribe/subscribe; contra el hook viejo reproduce la
  fuga (2 sockets abiertos). Mutaciones: sin el re-chequeo de generación → cae
  el test 4; sin `stop()` al quedar en 0 → cae el 3; conexión por suscriptor →
  cae el 1. Suites: web 1030 + shared 325 + mobile 259, todo `EXIT=0`; `tsc`
  web 0→0, mobile 44→44.
  Revisión nativa `review-449545faa85b1772` aprobada con **2 advertencias**
  (los tests 3 y 5 afirmaban "no reconecta" con timers reales tras dos
  microtareas, y la reconexión es un `setTimeout` ≥1 s: ciegos) y 2
  sugerencias. **Todas aplicadas** en el commit de seguimiento: 13 tests
  (antes 8) con fake timers; backoff 1→2→4→8→16→30 s con tope y reset;
  último suscriptor que se va durante un backoff; `onerror`; y
  `connectionState` emite `'disconnected'` al cerrar (como el hook viejo) y
  queda documentado como estado COMPARTIDO. Hallazgos del writer: las guardas
  de "no reconectar" son redundantes a propósito (hubo que sacar tres a la
  vez para que la mutación mordiera) y la rama de generación vieja en
  `onopen` es inalcanzable desde la API pública (`stop()` desengancha antes);
  se testeó la garantía real en vez de mutar código muerto. Suites: web 1030
  + shared 330 + mobile 259 `EXIT=0`; `tsc` web 0, mobile 44 (sin cambio).
  **Para T2:** tres comentarios quedaron desactualizados (`MainLayout`,
  `MessagesPage`, `MessagesShell`) — afirman "useWebSocket abre una conexión
  por montaje" (regla #37).

- 2026-09-27: test 11 del hook (sugerencia de la revisión
  `review-817541ea84c197c0`, que aprobó T1 completo): un testigo con
  `enabled=false` afirma que un socket abandonado no deja el estado en
  `'connected'` (`37fda3f2`; mutación → `expected 'connected' to be
  'disconnected'`).
- 2026-09-27: **T2 hecho** (writer delegado). `ChatPage` y `MessagesPage` ya no
  invalidan ante `chat_message` (lo cubre el prefijo de `MainLayout`);
  conservan `badge_update` → lista. Comentarios falsos reescritos en
  `ChatPage`, `MessagesPage`, `MainLayout` y `MessagesShell`. Tests de las dos
  mitades; `MainLayout.test` fija que `chat_message` invalida el PREFIJO;
  guard nuevo `App.routeNesting.test.tsx` (las dos rutas cuelgan de
  `MainLayout`). Rojo observado contra el código previo; mutaciones (a)–(d)
  caen por nombre. Suites web 1035 + shared 330 `EXIT=0`, `tsc` 0.
  Nota para T3: el prefijo `['messages']` incluye `['messages',
  'unread-count']`, así que cada `chat_message` también refetchea el contador
  (comportamiento previo, no duplicado).

- 2026-09-27: **T3 hecho.** `/verify` con backend local (8082) y la web en
  dev (4300, **con StrictMode**), usuario B en `/messages/<A>` y A mandando
  por la API. Dos corridas, idénticas:

  | Medición | Antes (2026-09-24) | Ahora |
  |---|---|---|
  | Sockets a `/api/ws` con el chat abierto | 3 (dev) | **1** |
  | Pedidos de ticket al cargar | — | **1** (la carrera de StrictMode no abre huérfanos) |
  | GET del hilo por mensaje | 3 | **1** |
  | GET de la lista por mensaje | — | **1** |
  | GET de `unread-count` por mensaje | — | 1 (prefijo de `MainLayout`, no duplicado) |
  | Mensaje en la burbuja del hilo | 170–225 ms | 69–99 ms |
  | Logout sin recarga (`auth:session-expired` con `unauthorized`) | — | socket cerrado al instante; **0** tickets y **0** sockets en 35 s |

  Sonda sin `catch` que traduzca errores (lección de `verify-probe-gotchas`):
  cuenta la burbuja específica del hilo, no el texto de la página. Mobile no
  tiene prueba en runtime acá (no se levanta un device); lo cubre la suite
  (259, `EXIT=0` tras T1) y la interfaz del hook no cambió.

## Next step

Revisión nativa del slice T2 y apertura del PR.
