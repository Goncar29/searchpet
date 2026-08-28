# Un hogar suspendido puede corregirse y volver a la cola

**Fecha:** 2026-08-27
**Estado:** diseño aprobado, sin implementar

> Los números de línea son de `main` al 2026-08-27. Van a moverse: al
> implementar, **matchear por el código citado y no por el número**.

## El problema

Un hogar transitorio suspendido es hoy un **callejón sin salida**. El servicio
lo dice con todas las letras (`foster_home_service.go:101`):

```go
// Un hogar suspendido queda CONGELADO: el dueño no puede editarlo.
if fh.Status == domain.FosterHomeStatusSuspended {
    return nil, domain.ErrFosterHomeSuspended
}
```

Pero no hay ninguna forma de salir de ahí. Las cuatro acciones de moderación
—`approve`, `reject`, `suspend`, `reinstate`— las ejecuta **el admin**. El dueño
no tiene resubmit, ni apelación, ni un "ya lo arreglé". Busqué `Resubmit`,
`Appeal` y `RequestReview` en el servicio y el handler: no existe nada.

Y el congelado es además **parcial**, lo que hace que la pantalla mienta:

- el formulario se congela (el `<fieldset disabled>` y el guard del servicio);
- **las fotos no**: viven fuera del `<form>`, y `fosterHomePhotoService.Upload`
  y `.Delete` no miran el estado. Un hogar suspendido puede borrar todas sus
  fotos y subir otras, en las dos capas, mientras la pantalla le dice
  *"No podés editar un hogar suspendido"*.

Un tercer hueco apareció al diseñar: **el motivo de la suspensión no le llega al
dueño**. `transition()` guarda `RejectionReason` sólo cuando la acción es
`reject`; el motivo de una suspensión va al log de moderación, que es admin-only,
y la vista del dueño (`MyFosterHomeResponse`) expone únicamente
`rejection_reason`.

## Qué se decidió

**Suspender significa "esto está mal, arreglalo"**, no una sanción cerrada.
Un hogar suspendido se comporta como uno `rejected`: el dueño corrige, guarda, y
el hogar vuelve a `pending`.

Eso **no es un mecanismo nuevo**. Ya existe para hogares
(`foster_home_service.go:147-151`) y para refugios
(`shelter_service.go`, con el mismo idioma: editar ES re-someter). Lo único que
falta es alcanzar un estado más.

**El resubmit vive en un solo lugar: el botón Guardar.** Las fotos se editan
libres pero no disparan nada por sí solas. El riesgo —que alguien arregle sólo
las fotos y nunca vuelva a la cola— se cierra con el texto de la pantalla, no
con más mecanismo.

**El motivo se muestra**, en el mismo campo que ya usa el rechazo. Sin eso,
"arreglá y volvé" es una adivinanza.

## Los cambios

### Backend — `internal/service/foster_home_service.go`

1. `UpdateMine`: se elimina el bloqueo de `suspended` (líneas 101-104).
2. La rama de resubmit pasa de `if Rejected` a `if Rejected || Suspended`, con
   el mismo cuerpo: `Status = Pending` y `RejectionReason = ""`.
3. `transition()`: la condición que persiste el motivo pasa de
   `action == Reject` a `action == Reject || action == Suspend`.

### Lo que queda muerto y se borra

`domain.ErrFosterHomeSuspended` se usa en exactamente dos lugares —el guard que
desaparece y su mapeo en `foster_home_handler.go:81`— más su entrada en el mapa
de códigos y tres claves i18n en `shared/i18n/locales/*.json`
(`foster_home_suspended`). Con el guard fuera **no puede ocurrir nunca**, y un
error inalcanzable en un `switch` es una trampa: el próximo que lea el handler
va a creer que hay un caso que manejar.

Se borra todo el conjunto, no sólo la línea del servicio.

### Frontend — `pages/MyFosterHomePage.tsx`

- El `<fieldset>` deja de deshabilitarse cuando el hogar está suspendido.
- El botón Guardar aparece también en ese estado, con texto de re-enviar.
  Las claves son **nuevas y del namespace `fosterHomes`**, modeladas sobre
  `shelters:mine.resubmit` y `shelters:mine.resubmitHint` — no se reusan las del
  refugio: un namespace prestado es cómo un cambio de texto en una pantalla
  aparece sin querer en otra.
- El cartel de estado suspendido muestra **el motivo** —igual que ya hace el de
  rechazo, `isRejected && fosterHome.rejection_reason`— y agrega la pista de qué
  hacer: corregir y guardar para volver a revisión.
- Se elimina la clave `fosterHomes:mine.suspendedFrozen`; entran las de re-envío
  y su pista, en es/en/pt.

Las fotos **no se tocan**: ya eran editables y siguen igual.

## Tests

**Backend** (`tests/`): un hogar suspendido que se edita queda en `pending`; y
suspender persiste el motivo donde el dueño lo ve. Los dos vistos en rojo antes
de confiar en el verde.

**Frontend** (`MyFosterHomePage.test.tsx`): se **invierte** el test que hoy
afirma que el formulario queda congelado — pasa a exigir que sea editable y que
se ofrezca re-enviar. Y se **elimina** el test *"pero las fotos NO se congelan"*:
existía para documentar una asimetría entre el formulario y las fotos, y con este
cambio esa asimetría desaparece. Un test que ya no distingue nada es ruido.

## Riesgo aceptado

Un dueño puede rebotar `suspended → pending` cuantas veces quiera, editando.
**Es exactamente el mismo riesgo que ya existe con `rejected`** y se acepta por
el mismo motivo: el hogar nunca vuelve a ser público sin que un moderador lo
apruebe (`foster_home_repository.go:53` filtra por `approved`), así que lo peor
que pasa es ruido en la cola de pendientes.

No se agrega cooldown ni tope. Si algún día la cola se ensucia, la mitigación es
una decisión aparte y con datos.

## Lo que este diseño NO hace

- **No congela las fotos.** Se evaluó y se descartó: si a alguien lo suspendieron
  por las fotos, bloquearlas le saca la única forma de arreglar el problema.
- **No agrega un endpoint de "solicitar revisión"** ni un estado nuevo. El
  idioma del repo es que editar es re-someter, y agregarle una segunda forma de
  hacer lo mismo sería inventar una divergencia.
- **No notifica al moderador.** El resubmit de `rejected` tampoco publica ningún
  evento: el hogar reaparece en la cola de pendientes y ése es el canal. Se
  mantiene igual por consistencia.
