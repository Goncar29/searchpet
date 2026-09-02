# El perfil público adopta el diseño del perfil propio, y muestra lo publicado

**Fecha:** 2026-09-02
**Estado:** diseño aprobado, sin implementar

> Los números de línea son de `main` al 2026-09-02 (`57f087f`). Van a moverse:
> al implementar, **matchear por el código citado y no por el número**.

## El problema

Dos problemas independientes en la misma pantalla, `/users/:id`
(`web/src/pages/UserProfilePage.tsx`).

### 1. Quedó afuera del rediseño

Es una de las ocho pantallas que nunca se portaron al lenguaje de Stitch. Medido
en el navegador contra la app corriendo (viewport 1280):

| | Perfil propio (`/profile`) | Perfil público (`/users/:id`) |
|---|---|---|
| Contenedor | `max-w-7xl` — 1216px útiles | `max-w-lg` — **512px** |
| Borde izq. del `h1` | x=32, alineado con el logo | **x=505** |
| Estructura | 3 columnas (`lg:grid-cols-3`) | una sola columna centrada |
| Bordes | `border-gray-100 dark:border-gray-800` | `border-gray-200/700` (viejo) |
| Íconos | componente `Icon` | emoji 📍 suelto |
| i18n | completo | **~30 cadenas cableadas en español** |

Viola además la regla #50 de `CLAUDE.md`: toda página de contenido va en
`max-w-7xl`, el mismo cap que el navbar.

Hay un defecto visual concreto de paso: la tarjeta de rating pinta
`{avg_rating > 0 ? avg.toFixed(1) : '—'}` en `text-3xl font-bold`, así que un
usuario sin reseñas muestra **una barra negra suelta** al lado de cinco
estrellas grises.

### 2. No muestra nada de lo que la persona publicó

`GET /api/users/:id/profile` devuelve nombre, ciudad, puntos, contadores, badges
y rating. **Ninguna mascota.** El perfil es la pantalla de confianza del
producto —tiene reseñas, estrellas, badges y botón de denunciar— y no muestra lo
único que la persona realmente hizo.

## La regla de visibilidad

> **Se ve lo que la persona publicó y todavía no cerró.**

| Estado | ¿Lo ve un tercero? | Por qué |
|---|---|---|
| `lost` | ✅ | búsqueda activa, ya pública |
| `stray` | ✅ | ya pública |
| `adoption` | ✅ | ya listada en `/api/adoptions` |
| `found` | ✅ | ya está en `PublicSearchableStatuses` |
| `adopted` | ✅ | fue pública mientras estuvo en `adoption` |
| `registered` | ❌ | **privada** |
| `archived` | ❌ | **privada** — es el interruptor del dueño |

**`registered` es el punto entero de este diseño.** Publicar las mascotas
registradas de alguien es un mapa de qué animales tiene y dónde vive. El código
ya lo dice, en `domain/pet_status.go`:

```go
// registered and archived are private/closed and must NEVER be enumerable
// via ?status=, otherwise anyone could list every user's private pets.
```

Esto cierra ese mismo agujero en una superficie donde nadie lo había mirado.

**`archived` es la salida del dueño.** Quien no quiera que se vea su historia de
éxito o su adopción, archiva. Un solo interruptor, no una preferencia nueva por
estado.

**Sobre `adopted`, que es el único caso nuevo.** Se decidió mostrarlo. Verificado
antes de decidir: la adopción **no transfiere la mascota** — el status machine
sólo permite `adoption ↔ adopted` y `→ archived` (`domain/status_machine.go:11-12`)
y `pet_service.go` no menciona `adopted` ni una vez. No hay traspaso de
`owner_id` ni existe registro del adoptante en todo el sistema, así que no hay
privacidad de un tercero que proteger.

> **Riesgo aceptado a conciencia:** `adopted` hoy **no es enumerable
> públicamente en ningún lado** — no está en `/api/adoptions` ni en
> `PublicSearchableStatuses`. Es el único estado que esta feature vuelve público
> por primera vez. Se acepta porque la mascota ya fue pública con foto y
> descripción mientras estuvo en `adoption`, y marcarla adoptada no vuelve
> privado lo que ya se vio.

## Backend

### El filtro va en SQL. No en el servicio, y menos en React.

Hoy **no existe** ningún endpoint que devuelva las mascotas de otro usuario:
`GET /api/pets/mine` y `GET /api/pets/reported` están atados al JWT del que
llama (`router.go:429-430`).

Filtrar en el frontend no sería una versión más débil de esto: sería **no haber
hecho nada**. La API igual habría mandado las `registered` por el cable y
cualquiera las ve en devtools.

Filtrar en el servicio tampoco alcanza. Existen `FindByOwnerID` y
`FindByReporterID` (`repository/pet_repository.go:85,92`) y **ninguna de las dos
filtra por estado**: reusarlas cargaría las filas privadas a memoria para
descartarlas después. Va un método nuevo con la allowlist en el `WHERE`.

### El método

```go
// FindPublicByUserID devuelve las mascotas de un usuario que un TERCERO puede
// ver: las que publicó y todavía no cerró. La allowlist se aplica en SQL —
// una fila `registered` no debe salir nunca de Postgres.
//
// El OR cubre los dos vínculos: `owner_id` (las suyas) y `reporter_id` (los
// callejeros que reportó sin ser dueña; `owner_id` queda nil en esos casos).
// Va en UNA query y no en dos llamadas concatenadas: es defensivo — hoy esa
// fila es inalcanzable porque `CreatePet` setea owner XOR reporter — pero el
// OR no tiene que duplicar si algún día los datos lo permiten.
FindPublicByUserID(userID string) ([]domain.Pet, error)
```

> **La allowlist NO es un parámetro, y eso lo decidió el code review.** La
> primera versión era `FindPublicByUserID(userID string, statuses []string)`, y
> con esa firma el nombre promete una garantía que no cumple: pasarle una lista
> más amplia devuelve `registered` y `archived` sin chistar. Lo único entre un
> endpoint público y el inventario privado de alguien sería que el llamador se
> acuerde de la constante correcta. Peor: un slice vacío devuelve cero filas
> **sin error**, así que un bug del servicio daría un perfil vacío en silencio.
>
> Qué estados ve un desconocido es una **invariante, no una perilla** — regla
> #40, la misma por la que `DeleteExpired` no toma la retención por parámetro.
> El método lee `domain.PublicProfileVisibleStatuses` adentro.

### El tope

`.Limit(50)` en el repositorio, y el handler setea **`X-Total-Count`** con el
total real, **siempre y sin opt-in**.

> **Sin `?count=true`, y el motivo es reusable.** El proyecto tiene ese opt-in
> en `/api/stories` porque ahí UN endpoint sirve a dos llamadores con
> necesidades distintas: una lista pública que no necesita el total y una tabla
> admin que sí. Acá hay **un solo consumidor y siempre lo necesita**, así que un
> flag que siempre va en `true` es una perilla que sólo se puede poner mal — la
> regla #40 de nuevo. Un opt-in se justifica por tener dos llamadores distintos,
> no por simetría con otro endpoint.
>
> El COUNT extra es barato acá: el compute de Neon ya está despierto por la
> consulta principal del mismo request, así que el costo marginal de una segunda
> consulta indexada es despreciable. Lo que cuesta en Neon es el **tiempo
> despierto**, no la cantidad de queries (regla #59).

El riesgo no es un atacante: es un **usuario exitoso**. La lista no muestra "las
mascotas que tenés ahora" sino *todo lo que publicaste y no archivaste*, y
`reporter_id` acumula cada callejero que esa persona reportó en su vida. Un
refugio o alguien que rescata en serio junta cientos de filas con el tiempo, y
cada tarjeta pide una miniatura: 300 tarjetas son ~9 MB de **bandwidth de
Cloudinary** por visita, que es justo el cuello del plan gratuito (regla #55).
O sea que **el perfil de nuestro mejor usuario sería el más caro de mirar**, y
empeoraría solo.

Lo que NO es el motivo, y no hay que escribirlo como si lo fuera: acotar por
volumen para proteger a Neon sería teatro. Hay 18 endpoints públicos que
consultan Postgres sin tope; poner uno cierra una puerta de diecinueve
(regla #58).

**Un `LIMIT` mudo sería peor que ninguno**: el refugio vería 50 de 300 sin nada
que se lo diga, y cambiaríamos "es caro" por "es mentira". Por eso el tope viaja
siempre con su cartel.

**La infraestructura ya existe entera**, no se inventa nada: `requestWithTotal`
en `shared/api/client.ts:272` ya lee `X-Total-Count` con guarda anti-NaN;
`X-Total-Count` ya está en `middleware.ExposedResponseHeaders`; y
`success_story_handler.go:186` ya tiene el patrón de `count=true` opcional para
que un llamador que no necesita el total no pague el COUNT.

**El cartel**: una línea de texto apagado **al final de la grilla**, debajo de
la última tarjeta — *"Mostrando las 50 publicaciones más recientes de 312."*

- **No es un modal.** Un modal interrumpe para dar información que el visitante
  no pidió, sobre el perfil de otro, y sin ninguna decisión que tomar. Los
  modales son para decisiones.
- **Va abajo y no arriba.** Arriba es una advertencia antes de haber visto nada;
  abajo es la respuesta a la pregunta que uno tiene en ese momento exacto —
  *"¿esto es todo?"*.
- **Sin `role="alert"`**: anunciar algo lo vuelve urgente, y esto es una nota al
  pie. Texto plano.
- **Sólo se dibuja cuando el tope corta de verdad** (`total > mostradas`).
  Avisar antes entrena a la gente a ignorar el mensaje, así que no está cuando
  sí importa. Y no hay ninguna acción que gatillar en nadie: el que sufre el
  tope es el **dueño** del perfil, no quien lo mira, y el dueño ve su lista
  completa en "Mis mascotas", que no tiene tope.

### La allowlist

Va en `domain/pet_status.go`, al lado de las otras cuatro, **explícita y no
derivada** — misma convención que las existentes:

```go
// PublicProfileVisibleStatuses son los estados que un tercero ve en el perfil
// público de otra persona (GET /api/users/:id/pets). Excluye `registered` y
// `archived`: son privados, y publicarlos sería un inventario de qué animales
// tiene esa persona. `archived` es además el interruptor con el que el dueño
// baja cualquier publicación de esta vista.
var PublicProfileVisibleStatuses = []string{
    PetStatusLost, PetStatusStray, PetStatusFound,
    PetStatusAdoption, PetStatusAdopted,
}
```

### La ruta

```
GET /api/users/:id/pets   → público, sin auth (igual que /users/:id/profile)
```

Va en el grupo `public` de `router.go:349`, al lado de
`public.GET("/users/:id/profile")`. Responde `200` con la lista (vacía si no
publicó nada) y `404` si el usuario no existe — mismo contrato que el perfil.

Reusa el DTO `PetResponse` que ya devuelve `/api/pets/search`. No inventar uno
nuevo.

> **CORREGIDO durante la implementación — la primera versión de este recuadro
> era verdadera a medias, y la mitad que faltaba importaba.**
>
> **El dato medido:** `PetResponse` incluye `owner: {id, name, phone,
> is_verified}` cuando el repositorio hace `Preload("Owner")`, y
> `GET /api/pets/search` es **público y sin auth**. Una mascota `lost` devuelve
> el teléfono de su dueño a cualquiera, sin sesión. Eso es **deliberado y
> preexistente**: el sentido de publicar una mascota perdida es que te llamen.
> El teléfono del *reporter* de un callejero va sólo con opt-in
> (`ReporterContactPublic`, `dto/pet_dto.go:53`), y el **email nunca** se
> expone.
>
> **Lo que la primera versión concluía mal:** que por eso esta pantalla "no
> podía proteger el teléfono" y omitirlo era pura superficie. Es falso, y lo
> levantó el code review trazando el preload hasta el DTO.
>
> **Por qué era exposición NUEVA:** `adopted` no lo devuelve **ningún otro
> endpoint público** — `PublicSearchableStatuses` es {lost, stray, found} y
> `ListAdoptions` nunca devuelve `adopted`. Así que `Preload("Owner")` acá
> publicaba un teléfono en filas que antes no estaban listadas públicamente en
> ninguna parte.
>
> **Decisión: `FindPublicByUserID` NO hace `Preload("Owner")`.** Sale gratis:
> `CreatePet` setea owner **XOR** reporter, así que ese preload sólo puede
> cargar al dueño del perfil que se está mirando — N copias de la persona que
> el cliente ya tiene de `/api/users/:id/profile`. Sin el preload, el guard de
> `pet_dto.go:217` no dispara y la clave `owner` desaparece por `omitempty`.
> El endpoint hermano `FindByReporterID` ya omitía ese preload; el que sí lo
> tiene, `FindByOwnerID`, respalda `/api/pets/mine`, que es autenticado y
> self-scoped: otro modelo de amenaza, no un precedente.

## Frontend

Se reusa la estructura del perfil propio (`ProfilePage.tsx:530+`), no se diseña
nada nuevo.

**Contenedor:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10`, sin banda de
encabezado — el nombre de la persona ya es el encabezado.

**Columna izquierda** (`lg:col-span-1`), tres tarjetas
`rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800`:

1. **Identidad** — avatar `h-28 w-28 ring-4 ring-primary/20` vía
   `cloudinaryThumb(url, 224)`, nombre en `font-display text-headline`,
   "Miembro desde … · Ciudad", pill de Verificado.
   **Sin las filas de contacto**, y con el preload de owner fuera del
   repositorio (ver el recuadro de arriba) esta pantalla **no expone el teléfono
   por ningún camino**: ni arriba en la identidad, ni abajo dentro de las
   tarjetas. El email tampoco está en ningún DTO público. Quien quiera contactar
   al dueño de una mascota perdida sigue teniendo el camino de siempre — la
   ficha de esa mascota, donde el número es un dato del caso y no del perfil.
   En ese lugar van *Denunciar* y *Bloquear*.
2. **Actividad** — la grilla 2×2 de tiles del perfil propio. Entran justo
   cuatro: Puntos, Reportes, Reunidos, Compartidos.
3. **Logros** — la misma grilla, pero **sólo los conseguidos**. Los bloqueados
   en gris son copy motivacional para el dueño ("Verificá tu identidad"); a un
   desconocido le mostrarían lo que esa persona *no* logró.

**Columna derecha** (`lg:col-span-2`):

1. **Publicaciones** — `lost`, `stray`, `found`.
2. **En adopción** — `adoption`, `adopted`. El corte lo hace `splitOwnedPets`
   de `shared/utils/ownedPetBuckets`, que ya parte exactamente ese balde y hoy
   lo consumen `MyPetsPage` y `ProfilePage`. Tercer consumidor, **una sola
   definición del criterio**.
3. **Reseñas** — el promedio y la lista fusionados en **una** tarjeta (hoy son
   dos), lo que de paso mata la barra negra del rating vacío.

Las dos listas de mascotas van con `ListState` (regla #60), y valen sus dos
invariantes: ramar por `isLoading` y nunca `isPending`; decidir el cartel de
error por `query.data == null` y nunca por `items.length === 0`, porque una
tajada vacía —tiene mascotas pero ninguna en adopción— es una respuesta, no
ignorancia.

**Ojo con lo que vive fuera de la rama envuelta** (el modo de falla conocido de
la primitiva): los contadores de los encabezados y cualquier `.find()` sobre la
lista. Antes de envolver, buscar toda otra referencia a la variable y preguntar
de cada una si *afirma* algo.

## i18n

Las ~30 cadenas cableadas pasan a claves en los **tres** idiomas, con test
propio de claves. Los tests mockean `t: (key) => key`, así que una traducción
faltante se pinta cruda y en silencio y ningún test unitario la ve.

Se registra el namespace en `web/src/i18n/index.ts` en los tres bloques
`es/en/pt` (regla #21): estar en los JSON y no en el config devuelve la clave
literal.

## Verificación

- **Go**: test del repositorio contra Postgres real que siembre una mascota
  `registered` y una `archived` del mismo usuario y exija que **no** vuelvan.
  Los mocks no tienen constraints y este test no puede ser un mock (regla #34).
- **El test que importa es el negativo.** Verificar en rojo: sacar la allowlist
  del `WHERE` y confirmar que el test se pone rojo. Un test que sólo afirma que
  las cinco visibles vuelven pasa igual con el filtro roto.
- **Duplicados**: caso con `owner_id` y `reporter_id` apuntando al mismo usuario
  en la misma fila → tiene que volver **una** vez.
- **Web**: `ListState` en las dos listas, con la query en error y con datos
  cacheados.
- **Navegador**: el borde izquierdo del `h1` tiene que dar **x=32**, igual que
  el logo del navbar. Un desfase de 44px no se ve, se mide.

## Lo que este cambio NO hace

- **No toca mobile.** El perfil público de mobile queda como está.
- **No agrega una preferencia de privacidad por mascota.** El interruptor es
  `archived`, que ya existe.
- **No cambia `/api/users/:id/profile`.** El endpoint nuevo es aparte; fusionar
  las mascotas dentro del perfil obligaría a pagar esa query en toda pantalla
  que hoy lee el perfil, incluido el propio.

## Aparte, encontrado al leer el modelo

El comentario del campo `Status` en `domain/models.go:124` lista
`registered, lost, stray, found, archived` — le faltan `adoption` y `adopted`.
Es un comentario viejo, no un bug, y la fuente de verdad es `pet_status.go`
(regla #13). Se puede corregir de paso; no es parte de este cambio.
