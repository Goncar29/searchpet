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

## Las verificaciones

**`/verify` contra el backend REAL** (servidor + Postgres local, no mocks), 11
aserciones sobre el flujo entero: crear → pausar → **sigue en la lista con
`is_active=false`** → reactivar → borrar → no vuelve → un update sobre la
borrada da 404. En la base, la fila borrada quedó con `deleted_at` estampado y
**`is_active` intacto en `true`**. El backfill se vio correr: 6 de 7 filas.

*Cuidado con el server viejo*: el primer `go run` no pudo bindear el 8081 porque
había otro backend corriendo, y ese `health=200` venía de un binario **anterior
al cambio**. Hubo que matarlo y confirmar en el log que el que escucha es el
nuevo. **Un 200 no dice de quién.**

**`/security-review` descartado con medición**: las dos consultas de lista
filtran `user_id = ?`, `GetByID` va seguido del chequeo de ownership en el
servicio, el `userID` sale siempre del JWT (`getUserUUID`), y `DeletedAt` lleva
`json:"-"`. Sin exposición nueva.

## El `/code-review`: 6 hallazgos, 5 reales

**El que importa — `gorm.DeletedAt` convirtió EN SILENCIO dos borrados duros
preexistentes en blandos**: el cascade de `PetRepository.Delete` y
`resetSeedData`. Nadie lo notó porque ningún test miraba la tabla *después* de
borrar una mascota. Los dos llevan `Unscoped()` ahora, con su guard —visto en
rojo: *"want 0 filas tras borrar la mascota, got 1 (quedaron soft-deleted)"*.

*Agregar un `DeletedAt` a un modelo cambia el significado de TODO `Delete` que
lo mencione, en cualquier archivo. Hay que buscarlos.*

**La guarda de la migración fallaba ABIERTO.** Si la columna no estaba, el
`DO $$` no hacía nada, golang-migrate igual registraba la versión 27, el
backfill quedaba imposible de reintentar, y en el arranque siguiente AutoMigrate
creaba `deleted_at` toda en NULL → **cada alerta borrada reaparecía como
pausada**, justo lo que el comentario del archivo llama peor que el bug. Ahora
`RAISE EXCEPTION`. Comprobado en los dos sentidos contra Postgres: dispara con
una columna inexistente, pasa con la real.

**El comentario de `MaxAlertsPerUser` sobreafirmaba.** Decía que el número ya no
puede divergir. Falso para lo que el usuario VE: por la regla #11 el mensaje de
Go nunca le llega, y el 10 está escrito a mano en **seis** JSON de i18n. La
constante unifica el backend; el número visible no lo unifica nadie, y ahora el
comentario lo dice.

**Dos comentarios del servicio quedaron mintiendo** (`Máximo 10 alertas
activas`, `GetAlerts devuelve todas las alertas activas`) y **el copy de mobile
también** — arreglé las tres cadenas de `shared` y me olvidé de
`alerts.introText` en los tres locales de mobile.

**El sexto es falso positivo**: reportaba un diff de `gofmt` en un test. `gofmt
-l ./internal/` lista **154 archivos**, de los que toqué 4 — el repo tiene
`core.autocrlf=true` y gofmt marca todo. No es de este cambio, y "arreglarlo"
sería rehacer el repo entero.

## Next step

PR y merge.
