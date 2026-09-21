# Pausar una alerta deja de borrarla

## Objective

Separar dos conceptos que hoy viven en la misma columna: **pausada** y
**borrada**. Después de esto, destildar "Activa" pausa la alerta y la deja
visible para volver a encenderla; el botón Eliminar la borra de verdad.

## Problem

`location_alerts.is_active` significa las **dos cosas a la vez**:

- `location_alert_repository.go:66-72` — `Delete` **es** `Update("is_active", false)`,
  con el comentario "hace soft-delete" al lado.
- `location_alert_repository.go:56` — `GetByUserID` filtra `AND is_active = true`.

O sea que destildar el interruptor de la tarjeta aplica **exactamente el mismo
estado** que el botón Eliminar, y como el listado filtra por `is_active`, la
alerta desaparece **sin camino de vuelta**: ningún endpoint devuelve las
inactivas.

Lo reportó el usuario: *"destildo Activa para pausarla y la pierdo para
siempre"*.

**La evidencia de que el diseño siempre quiso otra cosa está en el frontend**:
`AlertsPage` ya dibuja la pill "Inactiva", el interruptor ya manda
`is_active: !alert.is_active`, y `AlertsMap` ya pinta la zona pausada con trazo
punteado. Todo eso está escrito para alertas pausadas que se ven — y nunca se
ve, porque el backend las esconde.

## Why ahora

Es el último bug conocido de la pantalla, y quedó anotado desde el rediseño de
`/alerts`. Con el `deleted_at` de GORM el arreglo es chico y no inventa
conceptos: `vets` ya usa ese mismo mecanismo (`internal/domain/vet.go:37`).

## Scope

Autorizado:

- `internal/domain/models.go` — `DeletedAt` en `LocationAlert`
- `internal/domain/errors.go` — el texto del tope
- `internal/repository/{location_alert_repository.go,interfaces.go}`
- `internal/service/location_alert_service.go`
- `migrations/000027_*` — backfill de las filas existentes
- `frontend/packages/shared/i18n/locales/{es,en,pt}.json` — el mensaje del tope
- sus tests

**Fuera de alcance**: la UI (ya está lista), mobile, y cualquier endpoint nuevo
para listar o restaurar borradas.

## Decisiones tomadas

**El tope de 10 cuenta TODAS las no borradas, pausadas incluidas.** Elegido por
el usuario entre las dos opciones. Consecuencias: pausar **no** libera lugar, el
título `Mis alertas (N/10)` sigue funcionando tal cual, y **el frontend no se
toca**. A cambio hay que reescribir el mensaje del tope, que hoy dice "10
alertas **activas**" y pasaría a ser falso.

**Las filas existentes con `is_active = false` se tratan como BORRADAS**
(`deleted_at = now()`). No es una elección entre dos igualmente válidas:

- Hoy esas filas son invisibles e irrecuperables. Marcarlas borradas
  **preserva exactamente el comportamiento observable de hoy**.
- Dejarlas como pausadas haría **reaparecer** en la lista de cada usuario todo
  lo que alguna vez borró a propósito. Resucitar datos que alguien eliminó es
  peor que el bug que estamos arreglando.

No se puede distinguir cuáles fueron pausa y cuáles borrado: esa información
**nunca se guardó**. Es el costo de que una columna cargue dos conceptos.

## Constraints

- **`FindActiveAlertsNear` sigue filtrando `is_active = true`.** Una alerta
  pausada no puede disparar notificaciones — es la mitad del punto de pausarla.
- **El tag del struct y la migración tienen que decir lo mismo** (regla #35). La
  columna la crea AutoMigrate desde el tag; la migración SQL hace **sólo el
  backfill**, que es lo que AutoMigrate no puede hacer.
- Un método que cambia de semántica cambia de nombre: `CountActiveByUserID`
  pasa a `CountByUserID`. Un nombre que miente es peor que ninguno.

## TDD

Modo no configurado en el proyecto; se aplica la práctica del repo: **el arreglo
se ve en rojo antes de confiar en el verde**, revirtiendo cada cambio por
separado. Runner: `go test ./... -count=1` con `DATABASE_URL` apuntando a
`lostpets_test` (regla #41), y `-tags e2e` cuando toque (nunca por defecto).

## Tasks

- [ ] **T1 — El dominio distingue pausada de borrada.** `DeletedAt` en el
  modelo, `Delete` pasa a ser un borrado real de GORM, `GetByUserID` devuelve
  las no borradas (activas y pausadas), `CountActiveByUserID` → `CountByUserID`,
  y el mensaje del tope deja de decir "activas" en Go y en los tres locales.
  - Checks: `go test ./... -count=1` con `DATABASE_URL=lostpets_test`, leyendo
    el **exit code** y nunca un grep sobre la salida.
- [ ] **T2 — La migración 000027 backfillea las filas viejas.** `deleted_at =
  now()` donde `is_active = false`, con su `.down.sql`.
  - Checks: los tests de repositorio contra Postgres real.

## Acceptance

- Destildar "Activa" deja la alerta en la lista, en gris, y volver a tildarla la
  reactiva.
- Eliminar la saca de la lista y **no vuelve**.
- Una alerta pausada **no** dispara notificaciones.
- El tope de 10 cuenta activas + pausadas, y su mensaje no promete otra cosa.
- Las filas que hoy están en `is_active = false` **no reaparecen**.

## Progress

### T1 y T2 — hechos

`DeletedAt` en el modelo (mismo mecanismo que `vets`), `Delete` pasó a ser un
borrado real de GORM, `GetByUserID` dejó de filtrar `is_active`,
`CountActiveByUserID` → `CountByUserID`, `MaxAlertsPerUser` como única fuente
del número, el texto del error en Go y en los tres locales, y la migración
`000027` con el backfill.

**Cuatro guards nuevos, los cuatro vistos en ROJO** revirtiendo un cambio por
vez y restaurando el árbol entre corridas:

| Reversión | Test que cae |
|---|---|
| `GetByUserID` vuelve a filtrar `is_active` | `GetByUserID_IncluyeLasPausadas` |
| `Delete` vuelve a escribir `is_active = false` | `Delete_NoTocaIsActive` |
| `FindActiveAlertsNear` deja de filtrar `is_active` | `FindActiveAlertsNear_IgnoraLasPausadas` |
| `CountByUserID` vuelve a contar sólo activas | `CountByUserID_CuentaPausadasPeroNoBorradas` |

### El test viejo afirmaba el BUG

`TestLocationAlertRepository_Delete_SoftDelete` exigía que después de `Delete`
la fila siguiera visible por `GetByID` **con `is_active = false`**. O sea que
protegía la conflación misma. Se reescribió, y su aserción central ahora es la
inversa: **borrar NO toca `is_active`**, comprobado con una lectura `Unscoped`.

### La trampa de GORM que casi deja dos tests probando nada

Crear una alerta con `IsActive: false` **no la crea pausada**. GORM **omite el
campo en el INSERT** cuando su valor es el zero value y el tag declara
`default:true`, así que Postgres aplica el default y la fila nace **activa**.

Lo destapó `FindActiveAlertsNear_IgnoraLasPausadas` fallando — y ahí quedó claro
que los otros dos tests **pasaban por esa misma razón equivocada**: afirmaban
sobre una alerta que creían pausada y estaba activa, así que habrían pasado
igual con el bug puesto.

El helper `pausarAlerta` pausa por el camino real (`Update`, que abajo es un
`Save` y sí escribe el `false`) **y afirma la precondición** releyendo la fila.
Sin ese chequeo, el test puede volver a pasar sobre algo que nunca se pausó.

*Un fallo que se ve raro puede estar denunciando a sus tests hermanos.*

## Next step

Verificaciones y PR.
