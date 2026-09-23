# El teléfono del dueño sale sólo en búsqueda activa

## Objective

`GET /api/pets/:id` (público) devuelve `owner.phone` sólo cuando la mascota
está en `lost`, `stray` o `adoption`. En `registered`, `archived`, `found` y
`adopted` el teléfono no viaja — salvo que quien mira sea el propio dueño.

## Problem

Hallazgo de la auditoría de seguridad del 2026-09-23. `FindByID`
(`pet_repository.go:76`) hace `Preload("Owner")` sin filtro de estado y
`ToPetResponse` (`pet_dto.go:230`) copia `Phone` siempre que el owner esté
cargado. Resultado: con el UUID de una mascota `registered` —que nadie busca—
cualquiera obtiene nombre y teléfono del dueño. Se saltea las cinco allowlists
de `pet_status.go`.

## Why

El teléfono existe para que quien encuentra una mascota contacte al dueño
(decisión del usuario: es a propósito para perdidas). Fuera de búsqueda activa
nadie lo necesita, y exponerlo es el "inventario de qué animales tiene y dónde
vive" que la regla #63 prohíbe para el perfil público. `adoption` entra porque
el interesado necesita contactar a quien ofrece.

## Scope autorizado

- Nueva allowlist en `domain/pet_status.go` para los estados que exponen
  contacto (`lost`, `stray`, `adoption`). **No** parametrizable (regla #40).
- El camino de `GET /api/pets/:id` omite `owner.phone` fuera de esa allowlist,
  salvo para el dueño autenticado.
- Tests (TDD estricto) de las dos mitades: con teléfono en los tres estados,
  sin teléfono en los otros cuatro, y el dueño que sí lo ve.

Fuera de alcance: otros endpoints (share landing, feed, perfil público) — ya
filtran por sus propias allowlists o no cargan el owner.

## Constraints

- TDD: **on** (fuente: CLAUDE.md global "Strict TDD Mode: enabled"). Runner:
  `go test ./... -count=1` desde `backend/` con
  `DATABASE_URL` apuntando a `lostpets_test` (regla #41); e2e con `-tags e2e`.
- El frontend ya contempla `owner.phone` ausente (`PetDetailPage.tsx:593`,
  `AdoptionPetBody.tsx:56`, mobile `pet/[id].tsx:173`).

## Tasks

- [x] T1 — Allowlist + filtro del teléfono en `GET /api/pets/:id` con bypass
  del dueño, con tests RED→GREEN. Route: delegated (writer; toca domain,
  handler/service y tests, ≥2 archivos no triviales). **Commit `43ad02e2`.**

## Acceptance criteria

- Anónimo sobre `lost`/`stray`/`adoption` → `owner.phone` presente.
- Anónimo sobre `registered`/`archived`/`found`/`adopted` → sin `owner.phone`.
- Dueño autenticado sobre su mascota en cualquier estado → con teléfono.
- Suite backend verde por exit code.

## Progress

- 2026-09-23: rama `fix/pet-detail-phone-visibility` desde `origin/main`
  (`89c7f6e8`). Documento creado.

- 2026-09-23: T1 hecho (`43ad02e2`, 9 archivos, +451/−7).
  `domain.ContactVisibleStatuses` + `dto.ScrubOwnerPhoneForViewer`, aplicado
  sólo en `GetPet`; la ruta pasa a un grupo con `OptionalAuth` (falla abierto:
  token inválido = anónimo). Evidencia del writer: RED con aserciones
  nombradas, GREEN, mutación (sacar la allowlist) → rojo en el mismo test;
  `go vet` EXIT=0, `go test ./...` EXIT=0 contra `lostpets_test`, e2e
  `-tags e2e` EXIT=0. Spot-check del parent: 14 tests del cambio, EXIT=0.
  Revisión nativa: riesgo medio, consentida por el usuario, lente
  `review-reliability` sin hallazgos, **aprobada y acknowledged**
  (`review-56de582f8440ff50`). Frontend sin cambios: ya degrada sin phone.
- Hallazgo lateral del writer (fuera de alcance): `GET /api/pets/search?status=found`
  también precarga Owner y devuelve el teléfono → S2b en
  `auditoria-seguridad-2026-09-23.md`.
- Nota: los tests del hub de `internal/websocket` fallaron una vez bajo carga
  y pasan aislados en `origin/main` limpio — flaky preexistente.

## Next step

Push + PR (decisión del usuario), CI verde, squash, verificar CI de `main`.
