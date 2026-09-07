# La ficha dice cuándo se vio por última vez al animal

**Fecha:** 2026-09-07
**Estado:** diseño aprobado, sin implementar
**Issue:** #221 (pregunta de diseño 2)
**Rama:** `feat/pet-last-seen`

> Los números de línea son de `main` al 2026-09-07 (`23992a9`). Van a moverse: al
> implementar, **matchear por el código citado y no por el número**.

## El problema

El issue #221 dejó tres preguntas de diseño. Las otras dos las respondió el paso
de candidatos (#228, #229, #230). Queda ésta:

> ¿Qué ve el usuario en la ficha de un avistamiento vencido? Si no dice nada,
> parece un reporte activo y desactualizado. Si dice "vencido", hay que
> redactarlo sin sugerir que el animal ya no está.

### Lo que se midió

| Qué | Resultado |
|---|---|
| `Pet.LastReportedAt` en el modelo | existe — `internal/domain/models.go:155` |
| ¿Lo expone `PetResponse`? | **NO**, ni el struct ni `ToPetResponse` |
| ¿Dónde sí viaja la última vista? | sólo en `StrayCandidateResponse.LastSeenNearbyAt` |
| Caducidad en el frontend | **cero**. Las únicas coincidencias de `expir` son de `ShareButton` y sus locales, que son los share links (regla #16) |
| `PetDetailPage` | el badge sale de `pet.status` a secas; el único banner es el de `found` |
| ¿Se muestra `created_at`? | **no**, en ninguna de las dos fichas |

**La ficha de un avistamiento viejo se ve idéntica a la de uno fresco, y no
porque falte un cartel: el cliente no tiene el dato para poder ponerlo.**

Hay un caso hoy completamente ciego: un callejero **sin ningún reporte**.
`straySightingNotExpired` lo hace envejecer desde su alta, y `created_at` no se
muestra en ninguna parte, así que no hay ni siquiera un timeline del que
inferirlo.

## La decisión: mostrar el HECHO, nunca el juicio

La ficha muestra **cuándo se lo vio por última vez**, siempre, en toda mascota
`lost` o `stray`. No dice "vencido", no cambia de color a los 90 días, no emite
ningún juicio.

El motivo ya estaba escrito en `internal/dto/stray_candidate_dto.go:12`, para
este mismo dato y tomado días antes:

> Lleva `last_seen_nearby_at` y NO un booleano "vencido": la pantalla muestra
> "visto por última vez hace 4 meses", que es un HECHO que la persona puede usar
> para reconocer al animal. "Vencido" es jerga nuestra, no significa nada para
> quien lo lee y sugiere que el animal ya no está — que es justo lo que no
> sabemos.

**Consecuencia estructural, y es el mayor beneficio del enfoque:** si el cliente
nunca dice "vencido", el umbral de 90 días **nunca cruza la frontera**.
`domain.StraySightingTTL` sigue siendo la única definición, y sigue siendo cierto
lo que promete su comentario — *"cambiarlo es cambiar este número y nada más"*.
Un cliente que calculara la caducidad rompería esa promesa en silencio.

### Alcance: `lost` y `stray`

Decidido con el usuario. El issue sólo pide callejeros, pero un perdido publicado
hace dos años engaña igual: también parece una búsqueda viva.

No se muestra en `registered`, `archived`, `adoption` ni `adopted`, donde la
frase no significa nada.

## Backend

### El campo

`PetResponse` (`internal/dto/pet_dto.go:151`) gana:

```go
// LastSeenAt es cuándo se vio a este animal por última vez, ya resuelto: es
// LastReportedAt, o CreatedAt cuando todavía no tiene ningún reporte.
//
// Se emite SÓLO para los estados de domain.LastSeenRelevantStatuses. Con
// `omitempty`, el cliente no necesita saber cuáles son: si el campo viene, lo
// muestra; si no viene, no muestra nada. Ni el umbral de caducidad, ni el
// fallback, ni la lista de estados salen del backend.
LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
```

**Viaja la fecha y no el texto**, siguiendo el precedente que ya está escrito
tres campos más arriba en el mismo struct, para el mismo tipo de problema:

> La edad NO viaja: viaja la fecha con su precisión y el cliente deriva.
> Calcularla acá la congelaría en el instante de la respuesta y además obligaría
> al backend a pluralizar "año/años" en tres idiomas.

### Las dos reglas van al dominio, no al mapper

**Una sexta allowlist** en `internal/domain/pet_status.go`, al lado de las cinco
que ya viven ahí:

```go
// LastSeenRelevantStatuses son los estados en los que "visto por última vez"
// significa algo. Una `registered` no se está buscando y una `adoption` no se
// perdió: mostrar la frase ahí sería ruido.
//
// EXPLÍCITA y no derivada, igual que las otras cinco: si mañana se agrega un
// estado, hay que decidir si entra. El default —quedar afuera— es el que no
// afirma nada.
var LastSeenRelevantStatuses = []string{PetStatusLost, PetStatusStray}
```

**El fallback como método del dominio**, no inline en el mapper:

```go
// LastSeen devuelve cuándo se vio por última vez a este animal, o nil si la
// pregunta no aplica a su estado.
//
// El fallback a CreatedAt no es un default de conveniencia: un animal sin
// reportes SÍ fue visto — alguien lo publicó porque lo vio. Tratar el NULL como
// "sin información" dejaría en blanco justo el caso que hoy es ciego.
func (p *Pet) LastSeen() *time.Time
```

### El riesgo aceptado: la misma regla en dos lenguajes

`straySightingNotExpired` (`internal/repository/stray_expiry_scope.go:44`) ya
hace este fallback, en SQL:

```sql
COALESCE(pets.last_reported_at, pets.created_at)
```

Con `Pet.LastSeen()` pasa a haber **dos definiciones del mismo COALESCE**, una en
Go y otra en SQL. No se puede evitar: filtrar en la base exige el SQL, y exponer
el valor exige el Go — traer todas las filas a memoria para no duplicarlo sería
mucho peor.

Lo que sí se puede es **testear el acuerdo**, que es lo que el repo ya hizo
cuando `CountStaleBefore` y `SoftDeleteStaleBefore` tenían que ver lo mismo:
> Cuando dos consultas tienen que ver lo mismo, testeá el ACUERDO, no cada una.

Un test contra Postgres real siembra los casos borde —con reporte, sin reporte,
justo en el corte— y exige que la fecha que expone `LastSeen()` sea la misma
contra la que compara el `WHERE`. Una divergencia sería invisible de otro modo:
los dos números seguirían pareciendo razonables por separado, mientras la ficha
afirma una fecha distinta de la que decidió si la mascota se ve o no.

## Frontend

### El tipo y el helper

`Pet` en `shared/types/index.ts` gana `last_seen_at?: string`.

Un helper en `shared/utils/`, **consumido igual por web y mobile**, siguiendo el
patrón exacto de `formatPetAge` (`shared/utils/petAge.ts`), que resuelve este
mismo problema —derivar un texto relativo de una fecha, pluralizado, en tres
idiomas, en las dos plataformas— y ya corre en la ficha de mobile:

```ts
formatLastSeen(t, iso, locale): { relative: string; absolute: string }
```

`relative` se arma con la pluralización de i18next (`t(clave, { count })`), igual
que `petAge.ts:51`. **`Intl.RelativeTimeFormat` queda descartado**: Hermes no lo
trae, y eso ya se pagó en el PR #230.

> El riesgo de que la pluralización tampoco exista en Hermes está acotado por
> precedente vivo: `formatPetAge` usa `{ count }` y hoy funciona en
> `mobile/app/pet/[id].tsx`. Aun así, la primera tarea de implementación lo
> verifica en el runtime real — el `Intl.PluralRules` de i18next va dentro de un
> try/catch, así que "los plurales andan" no prueba por sí solo que el motor los
> tenga.

`absolute` sale de `toLocaleDateString`, que no tiene ese problema.

### Qué se ve

Dos líneas, con ícono, en un bloque propio:

```
👁  Visto por última vez hace 4 meses
    3 de mayo de 2026
```

Dos líneas y no una: el relativo es el que se lee de un vistazo y la fecha es
consulta, así que jerarquizarlos verticalmente dice cuál es cuál. En una sola
línea separada por `·` los dos compiten, y en un teléfono angosto la fecha se
va a cortar antes que el dato principal.

Ubicación exacta, por plataforma:

- **Web** (`PetDetailPage.tsx`): entre `factCards` y `descriptionCard`, dentro
  de la columna izquierda. Como esos dos, es `null` cuando no aplica — un
  wrapper que sobrevive a su propio contenido igual aporta su margen.
- **Mobile** (`app/pet/[id].tsx`): en la misma posición relativa, después de la
  grilla de datos y antes de la descripción.

No va dentro del hero: ahí competiría con el nombre y con un scrim ya cargado,
y en una foto vertical el encabezado es la zona más disputada de la pantalla.

Las dos formas juntas porque hay **dos lectores distintos**, los dos reconocidos
por el dominio. El relativo responde *"¿esto está fresco?"* de un vistazo. La
fecha exacta responde *"¿coincide con el día que se me escapó?"* — que es
literalmente el usuario para el que existe el plazo de 90 días, según el
comentario de `StraySightingTTL`:

> alguien que perdió su perro, encuentra la app tres semanas después y busca qué
> callejeros se reportaron cerca en la fecha en que se le escapó.

Claves i18n nuevas en `shared/i18n/locales/{es,en,pt}.json`, namespace `pets`.

## Tests

**Backend**
- `ToPetResponse` emite `last_seen_at` para `lost` y `stray`, y **no** lo emite
  para los otros cinco estados. Las dos mitades: un test que sólo mira la
  presencia pasaría con la allowlist vaciada al revés.
- `Pet.LastSeen()` devuelve `LastReportedAt` cuando existe y `CreatedAt` cuando
  es nil.
- **El test de acuerdo** entre `LastSeen()` y el `COALESCE` de
  `straySightingNotExpired`, contra Postgres real (`tests/`, no mock: un mock no
  tiene el `WHERE`).

**Frontend**
- El helper: hoy, ayer, meses, y el borde exacto donde cambia la unidad.
- La ficha **no renderiza nada** cuando `last_seen_at` no viene. Es la mitad
  negativa, y sin ella un `?? ''` que imprima una línea vacía pasa desapercibido.
- Que web y mobile muestren el MISMO texto para la misma fecha — es el punto de
  tener un helper compartido, y nada más lo obliga.

## Lo que este cambio NO hace

- **No introduce ninguna noción de "vencido" en el cliente.** Deliberado; es la
  decisión central de arriba.
- **No toca `straySightingNotExpired` ni el plazo.** La caducidad sigue
  funcionando exactamente igual; esto sólo hace visible el dato con el que ya se
  decide.
- **No agrega el dato al feed ni a las tarjetas de listado.** Sólo la ficha. Si
  después se quiere en las tarjetas, el campo ya va a estar.
- **No resuelve el issue #218** (un avistamiento no caduca nunca), que es otra
  cosa y sigue siendo decisión del usuario.
